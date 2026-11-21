"""
API HTTP (FastAPI) para que la web, la app o el bot de WhatsApp de tu equipo
puedan consultar la base de conocimiento oficial del Ayuntamiento desde cualquier
lenguaje (JavaScript, TypeScript, Python, etc.).

Arranque en local:
    python -m uvicorn api:app --reload --port 8000

Documentación interactiva automática (Swagger):
    http://localhost:8000/docs
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from buscador import construir_contexto_ia
from leer_web import ARCHIVO_SALIDA as ARCHIVO_WEB, extraer_sede_electronica, extraer_web_ayuntamiento, guardar_documentos
from vectorizar import ARCHIVO_VECTORES, DIR_DATOS, vectorizar_documentos

EXTENSIONES_PERMITIDAS = {".pdf", ".txt", ".md", ".json"}

app = FastAPI(
    title="API Base de Conocimiento — Ayuntamiento de Lucainena de las Torres",
    description="Búsqueda semántica oficial (RAG) y gestión de documentos municipales.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class PeticionBusqueda(BaseModel):
    pregunta: str = Field(..., min_length=2, description="Pregunta del ciudadano.")
    top_k: int = Field(default=5, ge=1, le=15, description="Número de fragmentos oficiales a devolver.")
    usar_rerank: bool = Field(default=True, description="Reordenar resultados con NVIDIA Rerank.")


def _nombre_seguro(nombre_original: str) -> str:
    nombre_base = Path(nombre_original).name
    nombre_limpio = re.sub(r"[^a-zA-Z0-9._-]+", "_", nombre_base).strip("._")
    return nombre_limpio or "documento.txt"


@app.get("/salud")
def salud() -> dict[str, object]:
    """Comprueba el estado del servicio y si la base vectorial está lista."""
    if not ARCHIVO_VECTORES.exists():
        return {"ok": False, "vectores_listos": False, "detalle": "Falta ejecutar vectorizar.py"}

    datos = json.loads(ARCHIVO_VECTORES.read_text(encoding="utf-8"))
    return {
        "ok": True,
        "vectores_listos": True,
        "modelo": datos.get("modelo"),
        "dimension": datos.get("dimension"),
        "total_fragmentos": datos.get("total_fragmentos", 0),
        "fecha_generacion": datos.get("fecha_generacion"),
    }


@app.post("/buscar")
def buscar(peticion: PeticionBusqueda) -> dict[str, object]:
    """
    Devuelve los fragmentos oficiales más relevantes, las fuentes citables,
    si existe respaldo oficial (tiene_respaldo) y el prompt_sistema listo para el LLM.
    """
    try:
        return construir_contexto_ia(
            pregunta=peticion.pregunta.strip(),
            top_k=peticion.top_k,
            usar_rerank=peticion.usar_rerank,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Error en búsqueda vectorial: {exc}") from exc


@app.get("/documentos")
def listar_documentos() -> dict[str, object]:
    """Lista los archivos locales subidos (ordenanzas, bandos, PDFs) y documentos web."""
    DIR_DATOS.mkdir(parents=True, exist_ok=True)
    archivos_locales = []
    for ruta in sorted(DIR_DATOS.iterdir()):
        if (
            ruta.is_file()
            and ruta.name not in (ARCHIVO_VECTORES.name, ARCHIVO_WEB.name)
            and not ruta.name.endswith(".tmp")
            and ruta.suffix.lower() in EXTENSIONES_PERMITIDAS
        ):
            archivos_locales.append(
                {
                    "nombre": ruta.name,
                    "extension": ruta.suffix.lower(),
                    "tamano_bytes": ruta.stat().st_size,
                }
            )

    total_web = 0
    if ARCHIVO_WEB.exists():
        try:
            total_web = len(json.loads(ARCHIVO_WEB.read_text(encoding="utf-8")))
        except Exception:
            total_web = 0

    return {
        "documentos_web_indexados": total_web,
        "documentos_locales": archivos_locales,
    }


@app.post("/documentos/subir")
async def subir_documento(archivo: UploadFile = File(...)) -> dict[str, object]:
    """
    Permite al personal del Ayuntamiento subir un PDF, TXT, MD o JSON (ej. una nueva
    ordenanza o bando) y re-vectoriza automáticamente la base de conocimiento.
    """
    if not archivo.filename:
        raise HTTPException(status_code=400, detail="Falta el nombre del archivo.")

    nombre = _nombre_seguro(archivo.filename)
    extension = Path(nombre).suffix.lower()
    if extension not in EXTENSIONES_PERMITIDAS:
        raise HTTPException(
            status_code=400,
            detail=f"Formato '{extension}' no soportado. Usa: {', '.join(sorted(EXTENSIONES_PERMITIDAS))}",
        )
    if nombre in (ARCHIVO_VECTORES.name, ARCHIVO_WEB.name):
        raise HTTPException(status_code=400, detail="Nombre de archivo reservado por el sistema.")

    contenido = await archivo.read()
    if not contenido:
        raise HTTPException(status_code=400, detail="El archivo está vacío.")

    DIR_DATOS.mkdir(parents=True, exist_ok=True)
    destino = DIR_DATOS / nombre
    destino.write_bytes(contenido)

    try:
        resumen = vectorizar_documentos()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Archivo guardado pero falló la vectorización: {exc}") from exc

    return {
        "ok": True,
        "archivo": nombre,
        "resumen_vectores": resumen,
    }


@app.delete("/documentos/{nombre}")
def eliminar_documento(nombre: str) -> dict[str, object]:
    """Retira un documento local (por ejemplo, una ordenanza derogada) y re-vectoriza."""
    nombre_limpio = Path(nombre).name
    if nombre_limpio in (ARCHIVO_VECTORES.name, ARCHIVO_WEB.name):
        raise HTTPException(status_code=400, detail="No se puede eliminar un archivo del sistema.")

    ruta = DIR_DATOS / nombre_limpio
    if not ruta.exists() or not ruta.is_file():
        raise HTTPException(status_code=404, detail=f"No existe el documento '{nombre_limpio}'.")

    ruta.unlink()
    resumen = vectorizar_documentos()
    return {
        "ok": True,
        "eliminado": nombre_limpio,
        "resumen_vectores": resumen,
    }


@app.post("/actualizar-web")
def actualizar_web() -> dict[str, object]:
    """Vuelve a leer la Sede Electrónica y la web del Ayuntamiento y regenera los vectores."""
    try:
        docs = extraer_sede_electronica() + extraer_web_ayuntamiento()
        total_docs = guardar_documentos(docs, ARCHIVO_WEB)
        resumen = vectorizar_documentos()
        return {
            "ok": True,
            "documentos_web_guardados": total_docs,
            "resumen_vectores": resumen,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Error al actualizar desde la web: {exc}") from exc
