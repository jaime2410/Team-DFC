"""
Script 1: Lector de páginas oficiales del Ayuntamiento de Lucainena de las Torres
y su Sede Electrónica.

Extrae el contenido útil (páginas informativas, directorio de oficinas, preguntas
frecuentes, tablón de anuncios, calendario de días inhábiles, normativa y todos los
trámites del catálogo oficial) y lo guarda estructurado en datos/documentos_web.json.

Uso:
    python leer_web.py
"""

from __future__ import annotations

import json
import os
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

DIR_BASE = Path(__file__).resolve().parent
DIR_DATOS = DIR_BASE / "datos"
ARCHIVO_SALIDA = DIR_DATOS / "documentos_web.json"

TIMEOUT_HTTP = 20
MAX_HILOS = 6
MAX_PAGINAS_WEB_AYTO = 15

HEADERS_HTTP = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
}

# ---------------------------------------------------------------------------
# Fuentes configurables (puedes añadir o quitar URLs aquí fácilmente)
# ---------------------------------------------------------------------------

SEDE_BASE = "https://sede.lucainenadelastorres.es"
SEDE_CATALOGO_PATH = "/dossier"

SEDE_PAGINAS: list[tuple[str, str, str]] = [
    ("/ownership", "contacto_y_oficinas", "Titularidad, Dirección, Teléfono y Oficina de Registro"),
    ("/faqs", "preguntas_frecuentes", "Preguntas Frecuentes de la Sede Electrónica"),
    ("/board", "tablon_anuncios", "Tablón de Anuncios de la Sede Electrónica"),
    ("/calendar", "calendario_plazos", "Calendario de Días Inhábiles y Cómputo de Plazos"),
    ("/normative", "normativa", "Normativa Aplicable en la Sede Electrónica"),
    ("/id-systems", "identificacion", "Sistemas de Identificación Electrónica"),
    ("/signature-systems", "firma_electronica", "Sistemas de Firma Electrónica"),
    ("/electronic-certificates", "certificados", "Certificados Electrónicos Admitidos"),
    ("/e-invoice", "factura_electronica", "Factura Electrónica (Proveedores / FACE)"),
    ("/document-validation", "validacion_documentos", "Validación de Documentos Electrónicos"),
    ("/attorney-power", "apoderamientos", "Registro Electrónico de Apoderamientos"),
    ("/complaints-channel", "canal_denuncias", "Canal de Denuncias"),
    ("/citaprevia", "cita_previa", "Cita Previa del Ayuntamiento"),
    ("/suffrage-info", "informacion_electoral", "Información Electoral"),
    ("/info", "sede_inicio", "Inicio de la Sede Electrónica"),
    ("/transparency", "transparencia", "Portal de Transparencia"),
]

WEB_AYTO_BASE = "https://www.lucainenadelastorres.es/"
WEB_AYTO_URLS: list[str] = [
    "https://www.lucainenadelastorres.es/",
    "https://www.lucainenadelastorres.es/Servicios/cmsdipro/index.nsf/tablon_view_entidad_categoria1.xsp?p=Lucainena&cat=Pleno",
    "https://www.lucainenadelastorres.es/Servicios/cmsdipro/index.nsf/tablon_view_entidad_categoria1.xsp?p=Lucainena&cat=Normas",
]

EXTENSIONES_EXCLUIDAS = (
    ".pdf", ".jpg", ".jpeg", ".png", ".gif", ".svg", ".webp", ".ico",
    ".zip", ".rar", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
    ".mp3", ".mp4", ".avi", ".css", ".js", ".xml",
)

PATRONES_URL_EXCLUIDOS = (
    "lang=en", "aviso_legal", "politica_privacidad", "ref=cookies",
    "ref=accesibilidad", "ref=mapa-web", "galeria_view", "seccion.xsp",
)

# Patrones que indican bloqueo anti-bot o pantalla de inicio de sesión obligatoria
MARCADORES_BLOQUEO = (
    'window["bobcmn"]',
    "/TSPD/",
    "The requested URL was rejected",
    "Access Denied",
)

MARCADORES_LOGIN = (
    "Para acceder a esta sección es necesario identificarse",
    "Para acceder a esta seccion es necesario identificarse",
)

REGEX_FECHA_HORA_SEDE = re.compile(
    r"^\d{1,2}\s+de\s+[a-záéíóúñ]+\s+\d{4},\s+\d{2}:\d{2}:\d{2}$",
    re.IGNORECASE,
)

LINEAS_RUIDO = {
    "|",
    "&nbsp;",
    "Saltar contenido",
    "Saltar al contenido",
    "Iniciar tramitación electrónica",
    "Volver",
    "Buscar",
    "Limpiar",
}


def crear_sesion() -> requests.Session:
    sesion = requests.Session()
    sesion.headers.update(HEADERS_HTTP)
    return sesion


def es_pagina_bloqueada(html: str) -> str | None:
    """Devuelve el motivo si la página es un bloqueo WAF/anti-bot o exige login."""
    for marcador in MARCADORES_BLOQUEO:
        if marcador in html:
            return "protección anti-bot/WAF del servidor"
    for marcador in MARCADORES_LOGIN:
        if marcador in html:
            return "requiere identificación electrónica previa"
    return None


def descargar_html(sesion: requests.Session, url: str) -> tuple[str | None, str | None]:
    """Descarga el HTML de una URL. Devuelve (html, error)."""
    try:
        respuesta = sesion.get(url, timeout=TIMEOUT_HTTP, allow_redirects=True)
        if respuesta.status_code != 200:
            return None, f"HTTP {respuesta.status_code}"
        if not respuesta.encoding or respuesta.encoding.lower() == "iso-8859-1":
            respuesta.encoding = respuesta.apparent_encoding or "utf-8"
        html = respuesta.text
        motivo_bloqueo = es_pagina_bloqueada(html)
        if motivo_bloqueo:
            return None, motivo_bloqueo
        return html, None
    except requests.RequestException as exc:
        return None, str(exc)


def extraer_titulo(soup: BeautifulSoup, respaldo: str) -> str:
    """Obtiene el título más descriptivo posible de la página."""
    for etiqueta in ("h1", "h2"):
        nodo = soup.find(etiqueta)
        if nodo:
            texto = " ".join(nodo.get_text(" ", strip=True).split())
            if texto and len(texto) >= 3 and texto.lower() not in ("identificación", "sede electrónica"):
                return texto

    if soup.title:
        titulo = " ".join(soup.title.get_text(" ", strip=True).split())
        titulo = re.sub(
            r"^Sede Electr[oó]nica de Ayuntamiento de Lucainena de las Torres\s*[-–|:]?\s*",
            "",
            titulo,
            flags=re.IGNORECASE,
        ).strip()
        if titulo and titulo.lower() not in ("identificación", "identificacion", "sede electrónica", "inicio"):
            return titulo

    return respaldo


def limpiar_html(html: str, es_sede: bool = True) -> tuple[str, str]:
    """Limpia el HTML devolviendo (titulo_detectado, texto_limpio)."""
    soup = BeautifulSoup(html, "html.parser")

    for tag in soup(["script", "style", "nav", "header", "footer", "noscript", "svg"]):
        tag.decompose()

    selectores_ruido = (
        "#readspeaker_button1", ".addthis", ".rs_skip", ".breadcrumb",
        ".cookies", "#cookies", "#header", "#menu", "#menu-top",
        "#footer", "#footerbig", "#legal", "button", "input", "select",
    )
    for selector in selectores_ruido:
        for elem in soup.select(selector):
            elem.decompose()

    if es_sede:
        nodo = soup.find("main") or soup.find(id="content") or soup.find(attrs={"role": "main"}) or soup.body or soup
    else:
        nodo = soup.find(id="content") or soup.find("main") or soup.body or soup

    titulo = extraer_titulo(nodo if isinstance(nodo, BeautifulSoup) else soup, "")
    texto_crudo = nodo.get_text(separator="\n")

    lineas_limpias: list[str] = []
    linea_anterior = ""
    for linea in texto_crudo.splitlines():
        linea = re.sub(r"\s+", " ", linea).strip()
        if not linea or linea in LINEAS_RUIDO:
            continue
        if REGEX_FECHA_HORA_SEDE.match(linea):
            continue
        if linea == linea_anterior:
            continue
        lineas_limpias.append(linea)
        linea_anterior = linea

    return titulo, "\n".join(lineas_limpias)


def extraer_sede_electronica() -> list[dict[str, str]]:
    """Lee las páginas informativas y todos los trámites de la Sede Electrónica."""
    sesion = crear_sesion()
    ahora = datetime.now(timezone.utc).isoformat()
    documentos: list[dict[str, str]] = []

    print(f"[1/3] Leyendo páginas informativas de la Sede Electrónica ({len(SEDE_PAGINAS)} páginas)...")
    for ruta, categoria, titulo_respaldo in SEDE_PAGINAS:
        url = urljoin(SEDE_BASE, ruta)
        html, error = descargar_html(sesion, url)
        if not html:
            print(f"      [Omitida] {url} -> {error}")
            continue

        titulo_html, texto = limpiar_html(html, es_sede=True)
        if len(texto) < 80:
            print(f"      [Omitida por poco contenido] {url} ({len(texto)} chars)")
            continue

        titulo = titulo_html or titulo_respaldo
        slug = re.sub(r"[^a-z0-9]+", "-", ruta.strip("/").lower()).strip("-") or "inicio"
        documentos.append(
            {
                "id": f"sede-pagina-{slug}",
                "titulo": titulo,
                "categoria": categoria,
                "fuente_url": url,
                "fecha_extraccion": ahora,
                "texto": texto,
            }
        )
        print(f"      [OK] {titulo} ({len(texto)} chars)")

    # Descubrir todos los trámites oficiales desde /dossier
    url_catalogo = urljoin(SEDE_BASE, SEDE_CATALOGO_PATH)
    print(f"\n[2/3] Descubriendo catálogo oficial de trámites en {url_catalogo}...")
    html_catalogo, error_cat = descargar_html(sesion, url_catalogo)
    enlaces_tramites: list[tuple[str, str]] = []

    if html_catalogo:
        soup_cat = BeautifulSoup(html_catalogo, "html.parser")
        vistos: set[str] = set()
        for a in soup_cat.find_all("a", href=True):
            href = a["href"].strip()
            if "/catalog/t/" not in href:
                continue
            url_tramite = urljoin(url_catalogo, href).split("#")[0]
            if url_tramite in vistos:
                continue
            vistos.add(url_tramite)
            nombre = " ".join(a.get_text(" ", strip=True).split()) or "Trámite municipal"
            enlaces_tramites.append((nombre, url_tramite))
    else:
        print(f"      [AVISO] No se pudo leer el catálogo de trámites: {error_cat}")

    print(f"      Encontrados {len(enlaces_tramites)} trámites oficiales. Descargando detalles...")

    def _descargar_tramite(item: tuple[str, str]) -> dict[str, str] | None:
        nombre_enlace, url_tramite = item
        s_local = crear_sesion()
        html_t, err_t = descargar_html(s_local, url_tramite)
        if not html_t:
            return None
        titulo_html, texto = limpiar_html(html_t, es_sede=True)
        if len(texto) < 60:
            return None
        titulo = nombre_enlace or titulo_html
        id_tramite = url_tramite.rstrip("/").split("/")[-1]
        return {
            "id": f"sede-tramite-{id_tramite}",
            "titulo": titulo,
            "categoria": "tramite_sede",
            "fuente_url": url_tramite,
            "fecha_extraccion": ahora,
            "texto": texto,
        }

    tramites_ok = 0
    with ThreadPoolExecutor(max_workers=MAX_HILOS) as pool:
        futuros = [pool.submit(_descargar_tramite, item) for item in enlaces_tramites]
        for futuro in as_completed(futuros):
            doc = futuro.result()
            if doc:
                documentos.append(doc)
                tramites_ok += 1

    # Orden estable por id para evitar ruido en diffs
    documentos.sort(key=lambda d: (d["categoria"], d["titulo"].lower()))
    print(f"      [OK] Trámites descargados correctamente: {tramites_ok}/{len(enlaces_tramites)}")
    return documentos


def _es_enlace_ayto_valido(url: str, dominio_base: str) -> bool:
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        return False
    dominio = parsed.netloc.lower()
    if dominio != dominio_base and dominio != dominio_base.removeprefix("www."):
        return False
    path_lower = parsed.path.lower()
    if any(path_lower.endswith(ext) for ext in EXTENSIONES_EXCLUIDAS):
        return False
    url_lower = url.lower()
    if any(patron in url_lower for patron in PATRONES_URL_EXCLUIDOS):
        return False
    return True


def extraer_web_ayuntamiento() -> list[dict[str, str]]:
    """
    Intenta leer la web principal del Ayuntamiento y enlaces internos clave.
    Si el servidor responde con protección anti-bot/WAF, lo informa y omite limpiamente.
    """
    sesion = crear_sesion()
    ahora = datetime.now(timezone.utc).isoformat()
    dominio_base = urlparse(WEB_AYTO_BASE).netloc.lower()
    documentos: list[dict[str, str]] = []
    visitadas: set[str] = set()
    pendientes: list[str] = list(WEB_AYTO_URLS)
    bloqueos = 0

    print(f"\n[3/3] Intentando leer la web municipal ({WEB_AYTO_BASE})...")
    while pendientes and len(documentos) < MAX_PAGINAS_WEB_AYTO:
        url = pendientes.pop(0)
        if url in visitadas:
            continue
        visitadas.add(url)

        html, error = descargar_html(sesion, url)
        if not html:
            print(f"      [Omitida] {url} -> {error}")
            if error and "anti-bot" in error:
                bloqueos += 1
                if bloqueos >= 2:
                    print(
                        "      [AVISO] La web principal tiene protección anti-bot activa en este momento; "
                        "se continúa con la información oficial de la Sede Electrónica."
                    )
                    break
            continue

        if url.rstrip("/") == WEB_AYTO_BASE.rstrip("/"):
            soup_inicio = BeautifulSoup(html, "html.parser")
            for a in soup_inicio.find_all("a", href=True):
                href = a["href"].strip()
                if not href or href.startswith(("#", "javascript:", "mailto:", "tel:")):
                    continue
                url_abs = urljoin(url, href).split("#")[0].strip()
                if url_abs not in visitadas and _es_enlace_ayto_valido(url_abs, dominio_base):
                    pendientes.append(url_abs)

        titulo_html, texto = limpiar_html(html, es_sede=False)
        if len(texto) < 80:
            continue

        documentos.append(
            {
                "id": f"web-ayto-{len(documentos) + 1:03d}",
                "titulo": titulo_html or "Web Ayuntamiento de Lucainena de las Torres",
                "categoria": "web_ayuntamiento",
                "fuente_url": url,
                "fecha_extraccion": ahora,
                "texto": texto,
            }
        )
        print(f"      [OK] {documentos[-1]['titulo']} ({len(texto)} chars)")

    return documentos


def guardar_documentos(documentos: list[dict[str, str]], ruta_salida: Path = ARCHIVO_SALIDA) -> int:
    """Guarda los documentos (sin duplicados exactos) de forma atómica."""
    if not documentos:
        raise RuntimeError("No se extrajo ningún documento válido de las fuentes web.")

    documentos_unicos: list[dict[str, str]] = []
    textos_vistos: set[str] = set()
    for doc in documentos:
        huella = re.sub(r"\s+", " ", doc["texto"]).strip().lower()
        if huella in textos_vistos:
            continue
        textos_vistos.add(huella)
        documentos_unicos.append(doc)

    ruta_salida.parent.mkdir(parents=True, exist_ok=True)
    ruta_tmp = ruta_salida.with_suffix(ruta_salida.suffix + ".tmp")
    ruta_tmp.write_text(
        json.dumps(documentos_unicos, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    os.replace(ruta_tmp, ruta_salida)
    return len(documentos_unicos)


def main() -> None:
    docs_sede = extraer_sede_electronica()
    docs_ayto = extraer_web_ayuntamiento()
    todos = docs_sede + docs_ayto

    total_guardados = guardar_documentos(todos, ARCHIVO_SALIDA)
    print("\n" + "=" * 72)
    print(f"LECTURA COMPLETADA: {total_guardados} documentos guardados en {ARCHIVO_SALIDA}")
    print(f"  - Sede Electrónica (páginas + trámites): {len(docs_sede)}")
    print(f"  - Web del Ayuntamiento:                  {len(docs_ayto)}")
    print("Siguiente paso: ejecuta 'python vectorizar.py' para convertirlos en vectores.")
    print("=" * 72)


if __name__ == "__main__":
    main()
