# AlmeríaCerca — Tu Ayuntamiento, a un mensaje (Reto 02)

Plataforma municipal omnicanal (**Web PWA + WhatsApp Cloud API + Panel Multi-Ayuntamiento**) diseñada para los municipios de la provincia de Almería (con demostración activa y aislada para **Lucainena de las Torres** y **Níjar**).

Combina una **estética cálida tipo tablero Pinterest mediterráneo** (`#F7F1E5` Arena Cálida, `#E45735` Terracota, `#1B8A7A` Verde Cabo de Gata, `#F2B84B` Sol de Almería) con accesibilidad universal para personas mayores (`AA/AAA`, modo letra grande y alto contraste, voz a texto y lectura en voz alta) e inteligencia artificial auditable sobre **PostgreSQL + `pgvector` en Supabase**.

---

## 1. Arquitectura Técnica

- **Frontend & Backend:** Next.js 14 (App Router) + TypeScript estricto + Tailwind CSS + Lucide Icons + Leaflet (mapas interactivos con radio proporcional a vecinos afectados) + Recharts.
- **Base de Datos y Motor Vectorial:** **PostgreSQL asíncrono en Supabase** (`pg` con resolución automática al Session Pooler IPv4) + extensión **`pgvector`** (`embedding vector(768)` con índice **HNSW** `vector_cosine_ops` y operador `<=>`).
- **Motor RAG Híbrido con Vigencia Normativa (`lib/rag/fts.ts`):**
  - Genera embeddings semánticos de 768 dimensiones con Gemini (`text-embedding-004`) y ejecuta búsqueda vectorial coseno (`<=>`) combinada con `ts_rank` (`to_tsvector('spanish', ...)`).
  - Si no hay `GEMINI_API_KEY`, degrada limpiamente a búsqueda textual en PostgreSQL.
  - Filtra estrictamente por `municipality_id`, `status = 'VIGENTE'` y fecha `valid_until`, registra `usage_count` en cada documento citado y muestra al vecino la **fecha de vigencia y enlace clicable** al documento oficial.
- **Router Multi-IA Resiliente y Ahorrador de Tokens (`lib/ai/router.ts`, `lib/ai/tokenSaver.ts`):**
  - **Nivel 1 (`0 tokens`):** Caché exacta/normalizada de FAQs aprobadas por el Ayuntamiento (`faq_cache`) + detector local de intenciones frecuentes (saludos, códigos `SOL-XXX`, horarios, teléfono, derecho al olvido RGPD `"borrar mis datos"`).
  - **Nivel 2 (Presupuesto estricto):** Llamada al proveedor principal configurado por el Ayuntamiento (`GEMINI` / `GROQ` / `OPENAI` / `OPENROUTER`) con cadena ordenada de **backups en cascada** y caída final garantizada al motor determinista `LOCAL`.
  - **Medición real de tokens:** Registra `input_tokens`, `output_tokens` y tokens ahorrados en `consultations`.
- **Persistencia Segura de Incidencias antes de IA (`lib/incidents/service.ts`):**
  - Todo aviso ciudadano se inserta primero en PostgreSQL en estado `'RECIBIDO'` con su código único `SOL-XXX` e historial de auditoría (`history_json`) **antes** de invocar a la IA. Si la IA falla o caduca, el aviso jamás se pierde.
  - **100% compatible con Vercel Serverless:** Las fotografías de reporte (`photo_url`) y de cierre del operario (`resolved_photo_url`) se comprimen en cliente y se almacenan como Data URL Base64 en PostgreSQL, sin escrituras en disco local.

---

## 2. Cumplimiento de la Rúbrica Oficial (Reto 02)

| Bloque | Implementación verificable en AlmeríaCerca |
| :--- | :--- |
| **Ciclo de 5 estados + Auditoría + Tiempos reales** | `RECIBIDO` → `VISTO` (`viewed_at`) → `ASIGNADO` → `EN_CURSO` → `RESUELTO` (`resolved_at`) con historial completo `history_json` (fecha, actor, nota), foto de cierre del operario (`resolved_photo_url`), valoración 1-5 estrellas y botón ciudadano **«Sigue sin funcionar»** (reapertura automática a `EN_CURSO` con prioridad `URGENTE`). |
| **Agrupación de duplicados (`< 150m`) y Emergencias 112** | Fórmula de Haversine a `< 150 m`: agrupa con el aviso existente, suma reportantes en `incident_reporters`, escala la prioridad (`BAJA` → `MEDIA` → `ALTA` → `URGENTE` → `EMERGENCIA_112`) y notifica a todos los vecinos cuando cambia de estado. Si detecta peligro inmediato (`cables`, `fuego`, `humo`, `herido`, `inundación`), asigna a **Policía Local** y muestra **`⚠️ Peligro inmediato: llama al 112 ahora mismo`**. |
| **Coherencia Foto-Texto (`VISION`)** | `classifyIncident` evalúa `{ imageDescription, photoMatchesText, detectedRisk }`. Si la imagen muestra riesgo adicional, eleva la prioridad; si no coincide con el texto, añade nota pidiendo confirmación sin descartar el aviso. |
| **Escalado Humano y Respuesta Municipal → FAQ `0 tokens`** | Botón **«Hablar con una persona»** (`POST /api/chat/escalate`) en `/asistente`. En `/admin`, Atención Ciudadana responde por escrito (`PATCH /api/admin/consultations/[id]`) y convierte la respuesta en FAQ aprobada (`0 tokens`) con 1 clic. |
| **WhatsApp Bidireccional (Vecino + Operario + Voz)** | Webhook `POST /api/webhooks/whatsapp` y simulador `/whatsapp-demo` con selector **Modo Vecino / Modo Operario Municipal**, envío de texto, foto, ubicación GPS, **nota de voz (`audio`)** y comandos de operario (`SOL-101 resuelto [nota]` con foto de cierre). |
| **Personalización Proactiva y Derecho al Olvido RGPD** | Encuesta visual de hogar en `/mi-perfil`, alertas por calle afectada, recomendador orientativo de ayudas (*"podría encajar contigo"*, `0 tokens`) y botón/comando **«Borrar mis datos»** (`DELETE /api/profile`). |

---

## 3. Configuración Local (`.env.local`)

1. Clona el repositorio e instala dependencias:
   ```bash
   npm install
   ```
2. Crea un archivo `.env.local` en la raíz del proyecto:
   ```env
   # Conexión PostgreSQL en Supabase (soporta host directo o Session Pooler IPv4)
   DATABASE_URL="postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres"

   # Clave secreta para firmar cookies JWT HttpOnly
   JWT_SECRET="almeriacerca-super-secret-jwt-key-2026"

   # Proveedores de IA opcionales (si se dejan vacíos, el sistema funciona al 100% con el motor LOCAL y puede configurarse desde /admin)
   GEMINI_API_KEY=""
   GROQ_API_KEY=""
   OPENAI_API_KEY=""
   OPENROUTER_API_KEY=""

   # Token de verificación para el webhook de Meta WhatsApp Cloud API
   WHATSAPP_VERIFY_TOKEN="almeria_cerca_verify_2026"
   ```
3. Inicia el servidor de desarrollo:
   ```bash
   npm run dev
   ```
   Al arrancar por primera vez, `lib/db/index.ts` ejecuta automáticamente `CREATE EXTENSION IF NOT EXISTS vector`, crea las tablas e índices HNSW y siembra los datos completos de **Lucainena de las Torres** y **Níjar**.

---

## 4. Credenciales de Demostración (Acceso 1-Clic en `/login`, `/mi-perfil` y `/admin`)

Todas las cuentas demo utilizan la contraseña **`1234`** (y disponen de botones de acceso directo en 1 clic):

| Rol | Municipio | Email | Contraseña | Qué permite probar |
| :--- | :--- | :--- | :--- | :--- |
| **Vecino** | Lucainena de las Torres | `vecino@lucainena.es` | `1234` | Avisos de corte en *Calle Real*, ayudas compatibles, seguimiento con historial y borrado RGPD. |
| **Vecino** | Níjar | `vecino@nijar.es` | `1234` | Avisos de *Avenida Federico García Lorca (Campohermoso)*, ayudas y seguimiento en Níjar. |
| **Admin Municipal** | Lucainena de las Torres | `admin@lucainena.es` | `1234` | Gestión aislada de Lucainena: 5 estados, foto cierre, cuarentena, RAG vigencia, FAQs y analíticas. |
| **Admin Municipal** | Níjar | `admin@nijar.es` | `1234` | Gestión aislada de Níjar (multi-tenant estricto en PostgreSQL). |

---

## 5. Despliegue en Vercel y Empaquetado Móvil (Capacitor)

### Despliegue en Vercel conectado a GitHub
1. Sube el repositorio a GitHub.
2. Importa el proyecto en [Vercel](https://vercel.com/new).
3. Añade las variables `DATABASE_URL` y `JWT_SECRET` (más `GEMINI_API_KEY` / `GROQ_API_KEY` si deseas IA cloud por defecto) en **Project Settings → Environment Variables**.
4. Pulsa **Deploy**. Toda la persistencia (incluidas fotos Base64 comprimidas y embeddings `pgvector`) reside en Supabase PostgreSQL, por lo que es 100% compatible con el entorno serverless de Vercel.

### Empaquetado Móvil con Capacitor
El archivo [`capacitor.config.ts`](file:///c:/Users/jaime/OneDrive/Escritorio/hackatonAlm/capacitor.config.ts) está preconfigurado con `appId: 'es.almeriacerca.app'` y permisos de Cámara y Geolocalización de alta precisión para empaquetar la PWA en Android e iOS (`npx cap sync`).
