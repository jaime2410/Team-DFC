"""
Módulo de búsqueda semántica para conectar la base vectorial del Ayuntamiento
de Lucainena de las Torres con la IA de tu web.

Uso desde tu web (FastAPI / Flask / Django / script):
    from buscador import construir_contexto_ia

    datos = construir_contexto_ia("¿Cómo doy de alta el agua potable?", top_k=5)
    # Pasa datos["prompt_sistema"] como system prompt a tu IA
    # Pasa datos["contexto"] junto a la pregunta del ciudadano
    # Muestra datos["fuentes"] como enlaces oficiales verificados

Prueba directa desde terminal:
    python buscador.py "¿Cómo pido cita previa o doy de alta el agua?"
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import numpy as np
import requests
from dotenv import load_dotenv

from vectorizar import ARCHIVO_VECTORES, MODELO_EMBEDDINGS, generar_vectores_nvidia, obtener_nvidia_api_key

DIR_BASE = Path(__file__).resolve().parent
load_dotenv(DIR_BASE / ".env")

NVIDIA_RERANK_URL = "https://ai.api.nvidia.com/v1/retrieval/nvidia/nemotron-3.5-rerank-8b/reranking"
MODELO_RERANK = os.environ.get("NVIDIA_RERANK_MODEL", "nvidia/nemotron-3.5-rerank-8b")
UMBRAL_RESPALDO_COSENO = 0.28

PROMPT_SISTEMA_AYUNTAMIENTO = """Eres el asistente virtual oficial de información ciudadana del Ayuntamiento de Lucainena de las Torres (Almería).

Reglas estrictas para responder con rigor y criterio municipal:
1. Basa tus respuestas ÚNICAMENTE en la documentación oficial proporcionada en el CONTEXTO.
2. Nunca inventes tasas, importes, plazos, teléfonos, direcciones, horarios ni requisitos que no aparezcan explícitamente en el contexto.
3. Cuando exista un trámite oficial de la Sede Electrónica relacionado, indica claramente su nombre exacto, código SIA (si figura), los requisitos/plazos disponibles y el enlace oficial directo para que el ciudadano pueda consultarlo o iniciarlo.
4. Si la información solicitada no consta en el contexto oficial, dilo con total transparencia y orienta al ciudadano para que consulte directamente con el Ayuntamiento de Lucainena de las Torres (Plaza del Ayuntamiento, n.º 4, tel. 950 36 40 68, registro@lucainenadelastorres.es) o en la Sede Electrónica (https://sede.lucainenadelastorres.es).
5. Usa un tono claro, cercano, respetuoso y preciso, pensado para ayudar a cualquier vecino o visitante."""


class _IndiceEnMemoria:
    """Mantiene la matriz de vectores en RAM y recarga automáticamente si el archivo cambia."""

    def __init__(self) -> None:
        self.ruta: Path | None = None
        self.mtime: float = -1.0
        self.modelo: str = MODELO_EMBEDDINGS
        self.fragmentos: list[dict[str, object]] = []
        self.matriz_norm: np.ndarray | None = None

    def cargar(self, ruta: Path = ARCHIVO_VECTORES) -> None:
        ruta = Path(ruta)
        if not ruta.exists():
            raise FileNotFoundError(
                f"No existe la base vectorial '{ruta}'. "
                "Ejecuta primero 'python leer_web.py' y 'python vectorizar.py'."
            )

        mtime_actual = ruta.stat().st_mtime
        if self.ruta == ruta and self.mtime == mtime_actual and self.matriz_norm is not None:
            return

        datos = json.loads(ruta.read_text(encoding="utf-8"))
        fragmentos = datos.get("fragmentos", [])
        if not fragmentos:
            raise ValueError(f"La base vectorial '{ruta}' está vacía.")

        matriz = np.asarray([reg["vector"] for reg in fragmentos], dtype=np.float32)
        normas = np.linalg.norm(matriz, axis=1, keepdims=True)
        normas = np.where(normas == 0.0, 1.0, normas)

        self.ruta = ruta
        self.mtime = mtime_actual
        self.modelo = str(datos.get("modelo", MODELO_EMBEDDINGS))
        self.fragmentos = fragmentos
        self.matriz_norm = matriz / normas


_INDICE = _IndiceEnMemoria()


def _reranquear_nvidia(
    pregunta: str,
    candidatos: list[dict[str, object]],
    top_k: int,
    timeout: int = 30,
) -> list[tuple[float, dict[str, object]]] | None:
    """Reordena los candidatos por relevancia semántica exacta con NVIDIA Rerank."""
    if not candidatos:
        return None

    api_key = obtener_nvidia_api_key()
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    payload = {
        "model": MODELO_RERANK,
        "query": {"text": pregunta},
        "passages": [
            {"text": f"{c['titulo']} ({c['categoria']})\n{c['texto']}"}
            for c in candidatos
        ],
        "truncate": "END",
    }

    try:
        respuesta = requests.post(NVIDIA_RERANK_URL, headers=headers, json=payload, timeout=timeout)
        if respuesta.status_code != 200:
            return None
        rankings = respuesta.json().get("rankings", [])
        ordenados: list[tuple[float, dict[str, object]]] = []
        for item in rankings:
            idx = int(item["index"])
            score = float(item.get("logit", item.get("relevance_score", 0.0)))
            if 0 <= idx < len(candidatos):
                ordenados.append((score, candidatos[idx]))
        ordenados.sort(key=lambda par: par[0], reverse=True)
        return ordenados[:top_k] if ordenados else None
    except requests.RequestException:
        return None


def buscar_contexto(
    pregunta: str,
    top_k: int = 5,
    usar_rerank: bool = True,
    archivo_vectores: Path = ARCHIVO_VECTORES,
) -> list[dict[str, object]]:
    """
    Busca los fragmentos oficiales más relevantes para una pregunta del ciudadano.
    Devuelve una lista de diccionarios con titulo, categoria, fuente_url, texto y puntuacion.
    """
    _INDICE.cargar(archivo_vectores)
    assert _INDICE.matriz_norm is not None

    vector_q = np.asarray(
        generar_vectores_nvidia([pregunta], input_type="query", modelo=_INDICE.modelo)[0],
        dtype=np.float32,
    )
    if vector_q.shape[0] != _INDICE.matriz_norm.shape[1]:
        raise ValueError(
            f"Dimensión incompatible entre vectores.json ({_INDICE.matriz_norm.shape[1]}) "
            f"y el modelo ({vector_q.shape[0]}). Ejecuta 'python vectorizar.py'."
        )

    norma_q = float(np.linalg.norm(vector_q))
    if norma_q > 0.0:
        vector_q = vector_q / norma_q

    similitudes = _INDICE.matriz_norm @ vector_q
    num_candidatos = min(max(top_k * 4, 15), len(_INDICE.fragmentos))
    indices_top = np.argsort(similitudes)[::-1][:num_candidatos]

    candidatos = [_INDICE.fragmentos[int(i)] for i in indices_top]
    coseno_por_id = {
        int(_INDICE.fragmentos[int(i)]["id"]): float(similitudes[int(i)])
        for i in indices_top
    }
    pares_coseno = [(float(similitudes[int(i)]), _INDICE.fragmentos[int(i)]) for i in indices_top[:top_k]]

    metodo = "coseno"
    mejores = pares_coseno
    if usar_rerank and len(candidatos) > 1:
        rerankeados = _reranquear_nvidia(pregunta, candidatos, top_k=top_k)
        if rerankeados:
            mejores = rerankeados
            metodo = "rerank"

    resultados: list[dict[str, object]] = []
    for score, reg in mejores:
        reg_id = int(reg["id"])
        resultados.append(
            {
                "id": reg_id,
                "titulo": reg["titulo"],
                "categoria": reg["categoria"],
                "fuente_url": reg["fuente_url"],
                "texto": reg["texto"],
                "puntuacion": round(score, 4),
                "similitud_coseno": round(coseno_por_id.get(reg_id, 0.0), 4),
                "metodo": metodo,
            }
        )
    return resultados


def construir_contexto_ia(
    pregunta: str,
    top_k: int = 5,
    usar_rerank: bool = True,
    archivo_vectores: Path = ARCHIVO_VECTORES,
) -> dict[str, object]:
    """
    Prepara todo lo que necesita el LLM de tu web para responder con precisión
    basándose en información oficial del Ayuntamiento.
    """
    resultados = buscar_contexto(
        pregunta=pregunta,
        top_k=top_k,
        usar_rerank=usar_rerank,
        archivo_vectores=archivo_vectores,
    )

    bloques_texto: list[str] = []
    fuentes_unicas: list[dict[str, str]] = []
    urls_vistas: set[str] = set()

    for idx, res in enumerate(resultados, start=1):
        bloques_texto.append(
            f"[Documento {idx}]\n"
            f"Título: {res['titulo']}\n"
            f"Categoría: {res['categoria']}\n"
            f"Fuente oficial: {res['fuente_url']}\n"
            f"Contenido:\n{res['texto']}"
        )
        url = str(res["fuente_url"])
        if url not in urls_vistas:
            urls_vistas.add(url)
            fuentes_unicas.append(
                {
                    "titulo": str(res["titulo"]),
                    "categoria": str(res["categoria"]),
                    "fuente_url": url,
                }
            )

    similitud_maxima = max(
        (float(r["similitud_coseno"]) for r in resultados),
        default=0.0,
    )
    tiene_respaldo = similitud_maxima >= UMBRAL_RESPALDO_COSENO

    return {
        "pregunta": pregunta,
        "tiene_respaldo": tiene_respaldo,
        "similitud_maxima": round(similitud_maxima, 4),
        "prompt_sistema": PROMPT_SISTEMA_AYUNTAMIENTO,
        "contexto": "\n\n---\n\n".join(bloques_texto),
        "fuentes": fuentes_unicas,
        "resultados": resultados,
    }


def main() -> None:
    pregunta = " ".join(sys.argv[1:]).strip() or "¿Cómo doy de alta el suministro de agua potable?"
    paquete = construir_contexto_ia(pregunta, top_k=3)

    print("=" * 72)
    print(f"PREGUNTA: {paquete['pregunta']}")
    print("=" * 72)
    for pos, res in enumerate(paquete["resultados"], start=1):
        print(f"\n#{pos} [{res['metodo']}: {res['puntuacion']}] {res['titulo']} ({res['categoria']})")
        print(f"Fuente: {res['fuente_url']}")
        print("-" * 72)
        print(res["texto"])
    print("\n" + "=" * 72)


if __name__ == "__main__":
    main()
