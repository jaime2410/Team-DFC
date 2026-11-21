"""
Script 2: Conversor de documentos a base vectorial (embeddings).

Lee todos los archivos de la carpeta datos/ (.json, .txt, .md y .pdf, incluyendo
datos/documentos_web.json generado por leer_web.py y cualquier ordenanza, bando
o documento que añada el Ayuntamiento), los trocea respetando párrafos y genera
los vectores con NVIDIA NIM guardándolos de forma segura en datos/vectores.json.

Uso:
    python vectorizar.py
"""

from __future__ import annotations

import json
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path

import requests
from dotenv import load_dotenv

DIR_BASE = Path(__file__).resolve().parent
load_dotenv(DIR_BASE / ".env")

DIR_DATOS = DIR_BASE / "datos"
ARCHIVO_VECTORES = DIR_DATOS / "vectores.json"

NVIDIA_EMBED_URL = "https://integrate.api.nvidia.com/v1/embeddings"
MODELO_EMBEDDINGS = os.environ.get("NVIDIA_EMBED_MODEL", "nvidia/nemotron-3-embed-1b")

CHUNK_SIZE = 700
CHUNK_OVERLAP = 100
BATCH_SIZE = 32
TIMEOUT_EMBED = 60
MAX_REINTENTOS = 3

CLAVES_FUENTE = ("fuente_url", "fuente", "url", "origen", "source")
CLAVES_TITULO = ("titulo", "title", "nombre", "name")
CLAVES_CATEGORIA = ("categoria", "category", "tipo", "seccion")


def obtener_nvidia_api_key() -> str:
    api_key = os.environ.get("NVIDIA_API_KEY", "").strip()
    if not api_key or api_key in ("nvapi-tu-clave-aqui", "nvapi-PEGA-AQUI-TU-CLAVE"):
        raise RuntimeError(
            "Falta configurar NVIDIA_API_KEY en el archivo .env con tu clave de https://build.nvidia.com/"
        )
    return api_key


def generar_vectores_nvidia(
    textos: list[str],
    input_type: str = "passage",
    modelo: str = MODELO_EMBEDDINGS,
    batch_size: int = BATCH_SIZE,
) -> list[list[float]]:
    """Convierte una lista de textos en vectores llamando a la API de NVIDIA NIM."""
    api_key = obtener_nvidia_api_key()
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }

    vectores: list[list[float]] = []
    total_lotes = (len(textos) + batch_size - 1) // batch_size

    for num_lote, inicio in enumerate(range(0, len(textos), batch_size), start=1):
        lote = textos[inicio : inicio + batch_size]
        payload = {
            "model": modelo,
            "input": lote,
            "input_type": input_type,
            "encoding_format": "float",
            "truncate": "END",
        }

        ultimo_error: Exception | None = None
        for intento in range(1, MAX_REINTENTOS + 1):
            try:
                respuesta = requests.post(
                    NVIDIA_EMBED_URL,
                    headers=headers,
                    json=payload,
                    timeout=TIMEOUT_EMBED,
                )
                if respuesta.status_code == 200:
                    datos = respuesta.json().get("data", [])
                    datos.sort(key=lambda item: item.get("index", 0))
                    if len(datos) != len(lote):
                        raise RuntimeError(
                            f"NVIDIA devolvió {len(datos)} vectores para {len(lote)} textos."
                        )
                    for item in datos:
                        vectores.append([float(v) for v in item["embedding"]])
                    ultimo_error = None
                    break

                ultimo_error = RuntimeError(
                    f"Error API NVIDIA ({respuesta.status_code}): {respuesta.text[:300]}"
                )
            except requests.RequestException as exc:
                ultimo_error = exc

            if intento < MAX_REINTENTOS:
                espera = 2 * intento
                print(f"      [Reintento {intento}/{MAX_REINTENTOS}] Lote {num_lote}/{total_lotes} en {espera}s...")
                time.sleep(espera)

        if ultimo_error is not None:
            raise RuntimeError(
                f"Fallo al generar embeddings en lote {num_lote}/{total_lotes}: {ultimo_error}"
            ) from ultimo_error

        if total_lotes > 1:
            print(f"      Lote {num_lote}/{total_lotes} vectorizado ({len(vectores)}/{len(textos)})")

    return vectores


def _aplanar_json(dato: object, prefijo: str = "") -> list[str]:
    """Convierte un JSON genérico en líneas de texto legible."""
    lineas: list[str] = []
    if isinstance(dato, dict):
        for clave, valor in dato.items():
            if clave.lower() in (*CLAVES_FUENTE, "id", "fecha_extraccion"):
                continue
            if valor in (None, "", [], {}):
                continue
            etiqueta = f"{prefijo} - {clave}" if prefijo else str(clave)
            if isinstance(valor, (dict, list)):
                lineas.extend(_aplanar_json(valor, prefijo=etiqueta))
            else:
                txt = re.sub(r"\s+", " ", str(valor)).strip()
                if txt:
                    lineas.append(f"{etiqueta}: {txt}")
    elif isinstance(dato, list):
        simples = [
            re.sub(r"\s+", " ", str(v)).strip()
            for v in dato
            if not isinstance(v, (dict, list)) and v is not None and str(v).strip()
        ]
        if simples and len(simples) == len(dato):
            lineas.append(f"{prefijo}: {', '.join(simples)}" if prefijo else ", ".join(simples))
        else:
            for elem in dato:
                lineas.extend(_aplanar_json(elem, prefijo=prefijo))
    elif dato is not None:
        txt = re.sub(r"\s+", " ", str(dato)).strip()
        if txt:
            lineas.append(f"{prefijo}: {txt}" if prefijo else txt)
    return lineas


def _buscar_clave(item: dict, claves: tuple[str, ...], respaldo: str) -> str:
    for clave in claves:
        valor = item.get(clave)
        if isinstance(valor, str) and valor.strip():
            return valor.strip()
    return respaldo


def _parsear_item_json(item: object, nombre_archivo: str) -> dict[str, str] | None:
    if isinstance(item, dict):
        fuente = _buscar_clave(item, CLAVES_FUENTE, nombre_archivo)
        titulo = _buscar_clave(item, CLAVES_TITULO, Path(nombre_archivo).stem)
        categoria = _buscar_clave(item, CLAVES_CATEGORIA, "documento_local")

        # Si ya tiene campo "texto" estructurado (como el generado por leer_web.py), usarlo directo
        if isinstance(item.get("texto"), str) and item["texto"].strip():
            texto = item["texto"].strip()
        else:
            texto = "\n".join(_aplanar_json(item)).strip()

        if texto:
            return {
                "titulo": titulo,
                "categoria": categoria,
                "fuente_url": fuente,
                "texto": texto,
            }
    elif item is not None:
        texto = str(item).strip()
        if texto:
            return {
                "titulo": Path(nombre_archivo).stem,
                "categoria": "documento_local",
                "fuente_url": nombre_archivo,
                "texto": texto,
            }
    return None


def _leer_texto_pdf(ruta_pdf: Path) -> str:
    """Extrae el texto limpio de un archivo PDF usando pypdf."""
    from pypdf import PdfReader

    lector = PdfReader(str(ruta_pdf))
    paginas: list[str] = []
    for pagina in lector.pages:
        texto_pag = (pagina.extract_text() or "").strip()
        if texto_pag:
            paginas.append(texto_pag)
    return "\n\n".join(paginas).strip()


def leer_documentos_carpeta(carpeta: Path = DIR_DATOS) -> list[dict[str, str]]:
    """Lee todos los archivos .json, .txt, .md y .pdf de la carpeta datos/."""
    if not carpeta.exists():
        raise FileNotFoundError(
            f"No existe la carpeta '{carpeta}'. Ejecuta primero 'python leer_web.py' "
            "o añade tus archivos en datos/."
        )

    archivos = sorted(
        ruta
        for ruta in carpeta.iterdir()
        if ruta.is_file()
        and ruta.name != ARCHIVO_VECTORES.name
        and not ruta.name.endswith(".tmp")
        and ruta.suffix.lower() in (".json", ".txt", ".md", ".pdf")
    )

    print(f"[1/3] Leyendo archivos en {carpeta} ({len(archivos)} archivos encontrados)...")
    documentos: list[dict[str, str]] = []

    for ruta in archivos:
        ext = ruta.suffix.lower()
        try:
            if ext == ".json":
                contenido = json.loads(ruta.read_text(encoding="utf-8"))
                count_antes = len(documentos)
                if isinstance(contenido, list):
                    for item in contenido:
                        doc = _parsear_item_json(item, ruta.name)
                        if doc:
                            documentos.append(doc)
                elif isinstance(contenido, dict):
                    doc = _parsear_item_json(contenido, ruta.name)
                    if doc:
                        documentos.append(doc)
                print(f"      [JSON] {ruta.name}: {len(documentos) - count_antes} documentos")
            elif ext == ".pdf":
                texto = _leer_texto_pdf(ruta)
                if texto:
                    documentos.append(
                        {
                            "titulo": ruta.stem.replace("_", " ").replace("-", " ").strip().title(),
                            "categoria": "documento_ayuntamiento",
                            "fuente_url": ruta.name,
                            "texto": texto,
                        }
                    )
                    print(f"      [PDF] {ruta.name}: {len(texto)} caracteres")
                else:
                    print(f"      [AVISO] PDF sin texto extraíble: {ruta.name}")
            else:
                texto = ruta.read_text(encoding="utf-8").strip()
                if texto:
                    documentos.append(
                        {
                            "titulo": ruta.stem.replace("_", " ").replace("-", " ").strip().title(),
                            "categoria": "documento_ayuntamiento",
                            "fuente_url": ruta.name,
                            "texto": texto,
                        }
                    )
                    print(f"      [TEXTO] {ruta.name}: {len(texto)} caracteres")
        except Exception as exc:
            print(f"      [AVISO] No se pudo leer {ruta.name}: {exc}")

    return documentos


def trocear_texto(texto: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    """
    Divide un texto en fragmentos intentando respetar saltos de línea y frases,
    manteniendo un solapamiento controlado entre fragmentos consecutivos.
    """
    texto = re.sub(r"\n{3,}", "\n\n", texto.strip())
    if len(texto) <= chunk_size:
        return [texto] if texto else []

    lineas = [l.strip() for l in texto.splitlines() if l.strip()]
    fragmentos: list[str] = []
    actual: list[str] = []
    longitud_actual = 0

    for linea in lineas:
        # Si una sola línea supera chunk_size, dividirla con ventana deslizante
        if len(linea) > chunk_size:
            if actual:
                fragmentos.append("\n".join(actual))
                actual = []
                longitud_actual = 0
            paso = chunk_size - overlap
            for i in range(0, len(linea), paso):
                trozo = linea[i : i + chunk_size].strip()
                if trozo:
                    fragmentos.append(trozo)
                if i + chunk_size >= len(linea):
                    break
            continue

        espacio_extra = 1 if actual else 0
        if longitud_actual + len(linea) + espacio_extra <= chunk_size:
            actual.append(linea)
            longitud_actual += len(linea) + espacio_extra
        else:
            bloque = "\n".join(actual)
            fragmentos.append(bloque)

            # Conservar solapamiento con las últimas líneas que quepan en overlap
            cola: list[str] = []
            len_cola = 0
            for prev in reversed(actual):
                if len_cola + len(prev) + 1 <= overlap:
                    cola.insert(0, prev)
                    len_cola += len(prev) + 1
                else:
                    break
            actual = cola + [linea]
            longitud_actual = sum(len(x) for x in actual) + max(0, len(actual) - 1)

    if actual:
        fragmentos.append("\n".join(actual))

    return fragmentos


def construir_fragmentos(documentos: list[dict[str, str]]) -> list[dict[str, object]]:
    """Trocea todos los documentos conservando título, categoría y fuente oficial."""
    fragmentos: list[dict[str, object]] = []
    contador = 1

    for doc in documentos:
        trozos = trocear_texto(doc["texto"])
        for trozo in trozos:
            fragmentos.append(
                {
                    "id": contador,
                    "titulo": doc["titulo"],
                    "categoria": doc["categoria"],
                    "fuente_url": doc["fuente_url"],
                    "texto": trozo,
                }
            )
            contador += 1

    print(f"[2/3] Troceado completado: {len(fragmentos)} fragmentos a partir de {len(documentos)} documentos.")
    return fragmentos


def guardar_base_vectorial(
    fragmentos: list[dict[str, object]],
    vectores: list[list[float]],
    ruta_salida: Path = ARCHIVO_VECTORES,
    modelo: str = MODELO_EMBEDDINGS,
) -> None:
    """Guarda los fragmentos junto a sus vectores de forma atómica."""
    if not fragmentos or len(fragmentos) != len(vectores):
        raise ValueError("El número de fragmentos y vectores no coincide o está vacío.")

    registros = []
    for frag, vec in zip(fragmentos, vectores):
        registros.append(
            {
                "id": int(frag["id"]),
                "titulo": str(frag["titulo"]),
                "categoria": str(frag["categoria"]),
                "fuente_url": str(frag["fuente_url"]),
                "texto": str(frag["texto"]),
                "vector": vec,
            }
        )

    estructura = {
        "modelo": modelo,
        "dimension": len(vectores[0]),
        "fecha_generacion": datetime.now(timezone.utc).isoformat(),
        "total_fragmentos": len(registros),
        "fragmentos": registros,
    }

    ruta_salida.parent.mkdir(parents=True, exist_ok=True)
    ruta_tmp = ruta_salida.with_suffix(ruta_salida.suffix + ".tmp")
    ruta_tmp.write_text(
        json.dumps(estructura, ensure_ascii=False),
        encoding="utf-8",
    )
    os.replace(ruta_tmp, ruta_salida)


def vectorizar_documentos(
    carpeta_datos: Path = DIR_DATOS,
    ruta_salida: Path = ARCHIVO_VECTORES,
    modelo: str = MODELO_EMBEDDINGS,
) -> dict[str, object]:
    """Pipeline completo: lee archivos en datos/, los trocea y genera datos/vectores.json."""
    obtener_nvidia_api_key()
    documentos = leer_documentos_carpeta(carpeta_datos)
    if not documentos:
        raise RuntimeError(
            f"No se encontraron documentos en '{carpeta_datos}'. Ejecuta primero 'python leer_web.py'."
        )

    fragmentos = construir_fragmentos(documentos)
    print(f"[3/3] Generando vectores con NVIDIA NIM ('{modelo}')...")

    # Incluimos título y categoría en el texto que se vectoriza para mejorar la búsqueda semántica
    textos_para_embed = [
        f"{frag['titulo']} ({frag['categoria']})\n{frag['texto']}"
        for frag in fragmentos
    ]
    vectores = generar_vectores_nvidia(textos_para_embed, input_type="passage", modelo=modelo)
    guardar_base_vectorial(fragmentos, vectores, ruta_salida=ruta_salida, modelo=modelo)

    resumen = {
        "documentos": len(documentos),
        "fragmentos": len(fragmentos),
        "dimension": len(vectores[0]),
        "modelo": modelo,
        "archivo": str(ruta_salida),
    }
    print("\n" + "=" * 72)
    print(f"VECTORIZACIÓN COMPLETADA -> {ruta_salida}")
    print(f"  - Documentos leídos: {resumen['documentos']}")
    print(f"  - Fragmentos:        {resumen['fragmentos']}")
    print(f"  - Dimensión vector:  {resumen['dimension']} ({modelo})")
    print("=" * 72)
    return resumen


def main() -> None:
    vectorizar_documentos()


if __name__ == "__main__":
    main()
