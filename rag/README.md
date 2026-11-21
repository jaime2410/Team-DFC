# Base de Conocimiento Oficial (RAG) — Ayuntamiento de Lucainena de las Torres

Módulo de lectura oficial, vectorización y búsqueda semántica para el **Reto 2: Tu ayuntamiento, a un mensaje** (Hackathon UAL).

## Archivos del proyecto

| Archivo | Qué hace |
| :--- | :--- |
| `leer_web.py` | Lee la Sede Electrónica (páginas informativas + los 67 trámites oficiales) y la web del Ayuntamiento, y lo guarda en `datos/documentos_web.json`. |
| `vectorizar.py` | Lee todos los archivos `.json`, `.txt`, `.md` y `.pdf` de `datos/`, los trocea y genera `datos/vectores.json` con NVIDIA NIM. |
| `buscador.py` | Busca los fragmentos oficiales más relevantes (coseno + NVIDIA Rerank), indica si hay respaldo oficial (`tiene_respaldo`) y devuelve el contexto y `prompt_sistema` listos para el LLM. |
| `api.py` | API HTTP (FastAPI) lista para conectar desde cualquier web, app o bot de WhatsApp (incluye búsqueda y subida/borrado de PDFs/ordenanzas). |

## 1. Instalación rápida

```bash
pip install -r requirements.txt
```

Copia `.env.example` a `.env` y pega tu clave de [build.nvidia.com](https://build.nvidia.com/):

```env
NVIDIA_API_KEY=nvapi-TU-CLAVE-AQUI
NVIDIA_EMBED_MODEL=nvidia/nemotron-3-embed-1b
NVIDIA_RERANK_MODEL=nvidia/nemotron-3.5-rerank-8b
```

> El archivo `.env` está en `.gitignore` para no subir nunca claves a GitHub.

## 2. Actualizar documentos y vectores

```bash
python leer_web.py
python vectorizar.py
```

Si quieres añadir una ordenanza o bando nuevo manualmente, solo suelta el archivo (`.pdf`, `.txt`, `.md` o `.json`) dentro de la carpeta `datos/` y ejecuta `python vectorizar.py`.

## 3. Cómo conectarlo (para tu compañero)

### Opción A — Si el backend/IA está en Python

```python
from buscador import construir_contexto_ia

paquete = construir_contexto_ia("¿Cómo doy de alta el agua potable?", top_k=5)

if not paquete["tiene_respaldo"]:
    # Derivar a Atención Municipal (no inventar respuesta)
    print("Sin respaldo oficial -> derivar a una persona")
else:
    # Pasar a tu modelo de chat (Gemini, NVIDIA NIM, etc.):
    system_prompt = paquete["prompt_sistema"]
    user_prompt = f"CONTEXTO OFICIAL:\n{paquete['contexto']}\n\nPREGUNTA:\n{paquete['pregunta']}"
    fuentes = paquete["fuentes"]  # Enlaces oficiales verificados para mostrar al ciudadano
```

### Opción B — Si la web / app / WhatsApp está en JavaScript, TypeScript u otro lenguaje

Arranca la API:

```bash
python -m uvicorn api:app --host 0.0.0.0 --port 8000
```

Documentación interactiva lista para probar en el navegador: `http://localhost:8000/docs`.

Ejemplo desde JavaScript / React / Ionic / Node:

```js
const resp = await fetch("http://localhost:8000/buscar", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    pregunta: "¿Cómo doy de alta el suministro de agua?",
    top_k: 5
  })
});
const paquete = await resp.json();
// paquete.tiene_respaldo  -> true / false (si es false, derivar a una persona)
// paquete.prompt_sistema  -> system prompt para el LLM
// paquete.contexto        -> fragmentos oficiales encontrados
// paquete.fuentes         -> [{ titulo, categoria, fuente_url }]
```

### Endpoints disponibles en `api.py`

- `GET /salud` — Verifica si los vectores están cargados.
- `POST /buscar` — Búsqueda semántica oficial (RAG).
- `GET /documentos` — Lista documentos web y archivos locales subidos.
- `POST /documentos/subir` — Sube un `.pdf`, `.txt`, `.md` o `.json` (ej. una ordenanza) y re-vectoriza al instante.
- `DELETE /documentos/{nombre}` — Retira una ordenanza derogada y re-vectoriza.
- `POST /actualizar-web` — Vuelve a leer la web y la Sede Electrónica y regenera los vectores.
