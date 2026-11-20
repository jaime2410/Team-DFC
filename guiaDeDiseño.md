# AGENT SPECIFICATION — PROYECTO "ALMERÍACERCA" (RETO 02: TU AYUNTAMIENTO, A UN MENSAJE)

> **DESTINATARIO:** Agente de desarrollo autónomo (Google Antigravity).
> **OBJETIVO:** Construir un MVP fullstack completo, funcional, visualmente atractivo, accesible y optimizado en consumo de tokens, ejecutando estrictamente **una fase por turno**.

---

## 0. PROTOCOLO DE EJECUCIÓN DEL AGENTE (OBLIGATORIO)

1. **EJECUCIÓN ESTRICTAMENTE SECUENCIAL:** Ejecuta **ÚNICAMENTE** la fase solicitada por el usuario (empezando por `FASE 0`). **PROHIBIDO** adelantar archivos o funcionalidades de fases posteriores.
2. **PARADA OBLIGATORIA AL FINALIZAR CADA FASE:** Al completar una fase:
   - Ejecuta `npm run build` (o verificación de tipos `npx tsc --noEmit`) y comprueba que no existan errores.
   - Verifica visualmente/funcionalmente los **Criterios de Salida** de esa fase.
   - Presenta un resumen breve (máx. 8 líneas) de archivos creados/modificados y resultados de verificación.
   - **DETENTE** y espera confirmación explícita del usuario (ej: *"avanza a Fase X"*) antes de continuar.
3. **EFICIENCIA DE CONTEXTO Y TOKENS:**
   - Realiza ediciones quirúrgicas; no reescribas archivos completos que ya funcionan salvo que sea estrictamente necesario.
   - No instales librerías fuera del stack definido sin justificación.
4. **RESILIENCIA TOTAL EN DEMO:**
   - La aplicación debe funcionar al **100% en local sin depender de API keys externas** gracias al proveedor `LOCAL` integrado en el router de IA.

---

## 1. REGLAS ARQUITECTÓNICAS Y DE DISEÑO (APLICABLES A TODAS LAS FASES)

### 1.1 Stack Tecnológico Único (MVP Rápido)
- **Framework:** Next.js (App Router) + TypeScript + Tailwind CSS.
- **Base de Datos y Motor RAG:** SQLite (`better-sqlite3`) con extensión nativa `FTS5` (búsqueda BM25 sin embeddings externos).
- **Ingesta de Documentos:** `pdf-parse` para `.pdf`, lectura directa UTF-8 para `.txt` y `.md`.
- **Autenticación:** Cookies HTTPOnly con JWT (`jose`) y hash de contraseñas (`bcryptjs`).
- **Mapas y Gráficas:** `leaflet` (OpenStreetMap) + `recharts`.
- **Iconos:** `lucide-react`.
- **Motor Multi-IA:** Router propio con `fetch` nativo (sin SDKs pesados). Proveedores soportados: `GEMINI`, `GROQ`, `OPENAI`, `OPENROUTER`, `LOCAL`.

### 1.2 Sistema Visual (Estilo Tablero Pinterest + Cero Fricción)
- **PROHIBIDO** usar fondo blanco puro (`#FFFFFF`) en el `body` o como estética principal.
- **Paleta obligatoria:**
  - Canvas principal (Arena Almería): `#F7F1E5`
  - Superficie secundaria: `#EFE5D3`
  - Tarjetas neutras cálidas: `#FFFDF8`
  - Terracota (Incidencias / Alerta): `#E45735`
  - Verde Cabo (Asistente / Resuelto): `#1B8A7A`
  - Sol Almería (Destacados / Ayudas): `#F2B84B`
  - Azul Mediterráneo (Seguimiento / Mapas): `#2C6E91`
  - Buganvilla (Perfil / Personalización): `#B84A62`
  - Tinta principal (Alto contraste): `#1E242B`
- **Layout anti-saturación (para usuarios sin experiencia digital):**
  - Bordes redondeados amplios (`rounded-3xl`), padding generoso (`p-6` / `p-8`), separación mínima `gap-6`.
  - **PROHIBIDO** amontonar botones pequeños pegados entre sí.
  - En portada: máximo 3 tarjetas gigantes principales + 1 tarjeta diferenciada de personalización.
  - En formularios: máximo 1 objetivo por pantalla (wizard guiado) y lenguaje cotidiano sin jerga administrativa.
  - Tablón comunitario en formato **Masonry estilo Pinterest** con tarjetas coloridas de alturas orgánicas.

### 1.3 Multi-Municipio, Multi-Idioma, Responsive y Accesibilidad
- **Aislamiento Multi-Tenant:** Toda tabla operativa y consulta SQL debe filtrar obligatoriamente por `municipality_id`. Un administrador de un municipio nunca puede ver ni editar datos de otro municipio.
- **Multi-Idioma (`i18n`):** Todos los textos de UI deben resolverse mediante `useTranslation()` leyendo diccionarios JSON (`es`, `en`, `fr`, `ar`). Al seleccionar `ar`, aplicar `dir="rtl"` al documento.
- **Responsive Mobile-First:** Todas las pantallas deben operar sin scroll horizontal en `390px` (móvil) y escalar limpiamente a escritorio (`1280px+`).
- **Accesibilidad Integrada:** Controles persistentes en la barra superior para activar/desactivar:
  1. `A+` Texto Grande (`.a11y-large-text`)
  2. Alto Contraste (`.a11y-high-contrast`)
  3. Modo Lectura Fácil (`.a11y-easy-read`, simplifica densidad y aumenta interlineado)
  4. Voz (Web Speech API: dictado en inputs principales y lectura en voz alta de respuestas del chat).

### 1.4 Reglas de Reducción de Consumo de Tokens (Obligatorias en Código)
1. **Caché FAQ (`faq_cache`):** Normalizar pregunta (minúsculas, sin tildes ni signos) antes de invocar cualquier LLM. Si existe coincidencia en el mismo municipio e idioma, responder en `0 tokens`.
2. **Router Local de Intenciones (`0 tokens`):** Saludos básicos y consultas que contengan un código `SOL-\d+` se resuelven directo contra SQLite sin llamar a IA.
3. **RAG FTS5 + Top-K Estricto:** Trocear documentos en chunks de ~350 palabras (overlap 40). Recuperar máximo `3` chunks relevantes (`<= 1800 caracteres` totales). Nunca enviar documentos completos al LLM.
4. **Personalización Determinista (`0 tokens`):** El cruce entre encuesta ciudadana, cortes de calle y ayudas municipales debe ejecutarse 100% mediante SQL y reglas deterministas, sin llamadas a IA.
5. **Ventana Deslizante:** Enviar al LLM como máximo los últimos `4` mensajes del historial.
6. **Límites Estrictos de Salida:** `max_tokens: 180` para clasificación JSON y `max_tokens: 300` para chat ciudadano (configurable desde `/admin`).

---

## 2. ESQUEMA DE BASE DE DATOS (SQLITE + FTS5)

Implementar en `lib/db/index.ts` las siguientes tablas exactas:

1. `municipalities`: `id`, `slug` (UNIQUE), `name`, `province`, `center_lat`, `center_lng`, `streets_json`, `whatsapp_phone_id`, `created_at`
2. `users`: `id`, `municipality_id`, `email` (UNIQUE), `password_hash`, `name`, `role` (`'CITIZEN' | 'ADMIN' | 'DEPARTMENT'`), `department_name`, `preferred_lang`, `created_at`
3. `citizen_profiles`: `user_id` (PK), `municipality_id`, `street_name`, `neighborhood`, `household_size` (INTEGER), `has_children` (INTEGER 0/1), `large_family` (INTEGER 0/1), `has_seniors_or_dependents` (INTEGER 0/1), `reduced_mobility` (INTEGER 0/1), `income_bracket` (`'LOW' | 'MEDIUM' | 'HIGH'`), `interests_json`, `whatsapp_phone`, `notifications_opt_in` (INTEGER 0/1), `updated_at`
4. `incidents`: `id`, `municipality_id`, `user_id` (nullable), `tracking_code` (UNIQUE), `title`, `description`, `photo_url`, `resolved_photo_url`, `lat`, `lng`, `address_label`, `category`, `urgency` (`'BAJA' | 'MEDIA' | 'ALTA' | 'CRITICA'`), `department`, `status` (`'PENDIENTE' | 'EN_REVISION' | 'EN_CURSO' | 'RESUELTA'`), `ai_reasoning`, `ai_provider_used`, `channel` (`'WEB' | 'WHATSAPP'`), `upvotes`, `internal_notes`, `created_at`, `updated_at`
5. `consultations`: `id`, `municipality_id`, `question`, `answer`, `topic`, `lang`, `channel` (`'WEB' | 'WHATSAPP'`), `tokens_saved` (INTEGER 0/1), `provider_used`, `created_at`
6. `rag_documents`: `id`, `municipality_id`, `filename`, `doc_type`, `char_count`, `chunk_count`, `uploaded_by`, `created_at`
7. `rag_chunks` + tabla virtual `rag_chunks_fts` (FTS5): `chunk_id`, `document_id`, `municipality_id`, `filename`, `content`
8. `ai_provider_keys`: `id`, `municipality_id`, `provider` (`'GEMINI' | 'GROQ' | 'OPENAI' | 'OPENROUTER' | 'LOCAL'`), `api_key`, `base_url`, `enabled` (INTEGER 0/1), `updated_at` — UNIQUE(`municipality_id`, `provider`)
9. `ai_configs`: `id`, `municipality_id`, `feature_key` (`'CHAT' | 'CLASSIFY' | 'VISION'`), `primary_provider`, `primary_model`, `backups_json` (JSON array ordenado de `{ provider, model }`), `max_tokens`, `temperature`, `updated_at` — UNIQUE(`municipality_id`, `feature_key`)
10. `municipal_aids`: `id`, `municipality_id`, `title`, `description`, `discount_label`, `requirements_json` (JSON con reglas opcionales: `min_household`, `large_family`, `has_children`, `has_seniors_or_dependents`, `reduced_mobility`, `max_income`), `deadline`, `apply_url`, `active`, `created_at`
11. `street_alerts`: `id`, `municipality_id`, `title`, `message`, `affected_streets_json` (JSON array de calles), `start_date`, `end_date`, `severity` (`'INFO' | 'WARNING' | 'CRITICAL'`), `created_at`
12. `user_notifications`: `id`, `user_id`, `municipality_id`, `type` (`'STREET_ALERT' | 'AID_MATCH' | 'INCIDENT_UPDATE'`), `title`, `body`, `ref_id`, `is_read` (INTEGER 0/1), `created_at`
13. `faq_cache`: `id`, `municipality_id`, `normalized_question`, `lang`, `answer`, `hits`, `created_at` — UNIQUE(`municipality_id`, `normalized_question`, `lang`)

---

## 3. PLAN DE EJECUCIÓN POR FASES

---

### FASE 0: Scaffolding, Base de Datos SQLite + FTS5, Seed Multi-Municipio, i18n y AppShell Accesible

**Objetivo:** Dejar la infraestructura base compilando con datos de 2 municipios, sistema visual Pinterest cálido, cambio de idioma y barra de accesibilidad operativa.

**Tareas obligatorias:**
1. Inicializar proyecto Next.js (App Router, TypeScript, Tailwind CSS) e instalar dependencias:
   `better-sqlite3`, `@types/better-sqlite3`, `lucide-react`, `bcryptjs`, `@types/bcryptjs`, `jose`, `pdf-parse`, `@types/pdf-parse`, `leaflet`, `@types/leaflet`, `recharts`.
2. Configurar `app/globals.css` y `tailwind.config.ts` con la paleta de la Sección 1.2, tipografías legibles (`Outfit` para títulos, `Atkinson Hyperlegible` o `Plus Jakarta Sans` para cuerpo) y estilos globales para `.a11y-large-text`, `.a11y-high-contrast`, `.a11y-easy-read`.
3. Implementar `lib/db/index.ts` (conexión singleton a `./data/almeriacerca.db`, WAL mode, creación automática de las 13 tablas + tabla virtual `rag_chunks_fts`).
4. Implementar `lib/db/seed.ts` (idempotente y con función `resetDatabase()` reutilizable) con datos realistas para **2 municipios de Almería**:
   - **Lucainena de las Torres** (`lucainena`, lat `37.0408`, lng `-2.1995`, calles: `Calle Real`, `Plaza del Ayuntamiento`, `Calle Eras`, `Calle Horno`, `Avenida Vía Verde`).
   - **Níjar** (`nijar`, lat `36.9667`, lng `-2.2063`, calles: `Avenida Federico García Lorca`, `Plaza de la Glorieta`, `Calle Carrera`, `Calle Alfareros`, `Camino de las Eras`).
   - Sembrar por cada municipio:
     - Admin: `admin@lucainena.es` / `1234` y `admin@nijar.es` / `1234`.
     - Ciudadano demo: `vecino@lucainena.es` / `1234` y `vecino@nijar.es` / `1234`.
     - 8 incidencias variadas (distintas categorías, estados y coordenadas dentro del municipio).
     - 6 ayudas/descuentos municipales realistas (Familia Numerosa 50% IBI/tasas, Bono Transporte Joven/Estudiantes, Descuento Piscina y Deportes, Ayuda Comedor Escolar, Bono Mayores y Dependencia, Subvención Accesibilidad Vivienda).
     - 3 avisos de cortes de calle activos (incluyendo `Calle Real` en Lucainena y `Calle Carrera` en Níjar).
     - 2 documentos oficiales pre-indexados en `rag_documents` y `rag_chunks_fts` (Horarios/Trámites del Ayuntamiento y Normativa de Ayudas y Recogida de Residuos).
     - Configuración inicial en `ai_provider_keys` (`LOCAL` habilitado por defecto; `GEMINI`, `GROQ`, `OPENAI`, `OPENROUTER` preparados para editar) y `ai_configs` para `CHAT`, `CLASSIFY`, `VISION` con cadena de backups terminando en `LOCAL`.
5. Implementar sistema de idioma en `lib/i18n/` (`es.json`, `en.json`, `fr.json`, `ar.json`) + `I18nProvider` y hook `useTranslation()` con soporte `dir="rtl"` en árabe.
6. Crear `MunicipalityProvider` (permite seleccionar el municipio activo y persiste en `localStorage`) + API `GET /api/municipalities`.
7. Crear componente global `components/AppShell.tsx` responsive con:
   - Selector de municipio limpio.
   - Selector de idioma (`ES`, `EN`, `FR`, `AR`).
   - Menú desplegable de accesibilidad (`A+`, `Alto Contraste`, `Lectura Fácil`).
   - Enlace limpio a `Entrar / Mi Perfil` (o `Panel Admin` si está autenticado como admin).

**Criterios de salida (Verificar y DETENERSE):**
- `npm run build` pasa sin errores.
- `./data/almeriacerca.db` se crea automáticamente con ambos municipios poblados.
- La app carga con fondo cálido `#F7F1E5`, cambio de municipio, cambio de idioma (incluyendo RTL en árabe) y toggles de accesibilidad funcionales.

---

### FASE 1: Portada Ciudadana sin Login + Tablón Estilo Pinterest + Seguimiento Rápido

**Objetivo:** Construir la experiencia ciudadana abierta (sin registro obligatorio), visualmente impactante y extremadamente sencilla.

**Tareas obligatorias:**
1. Crear API pública `GET /api/public/board?municipalityId=...` que devuelva en un solo payload para el municipio activo:
   - Avisos de calles activos (`street_alerts`).
   - Ayudas destacadas (`municipal_aids`).
   - Incidencias resueltas recientes (`incidents` con `status = 'RESUELTA'`).
   - Tarjetas informativas rápidas de trámites/horarios/eventos.
2. Crear API pública `GET /api/incidents/track?code=SOL-XXX&municipalityId=...` para consultar el estado de un aviso sin iniciar sesión.
3. Diseñar `app/page.tsx` cumpliendo estrictamente las reglas visuales:
   - Cabecera acogedora con nombre del municipio activo y subtítulo cercano.
   - **3 Tarjetas Gigantes de Acción** (muy espaciadas, iconos grandes, texto claro, sin botones pegados):
     1. Verde Cabo (`#1B8A7A`): **Preguntar al Ayuntamiento** -> navega a `/asistente`.
     2. Terracota (`#E45735`): **Avisar de un problema** -> navega a `/incidencia`.
     3. Azul Mediterráneo (`#2C6E91`): **Ver cómo va mi aviso** -> abre modal limpio para introducir código `SOL-XXX` y muestra línea temporal visual (`Recibido -> En revisión -> En curso -> Resuelto`).
   - **Tarjeta Destacada Opcional** (Buganvilla `#B84A62`): **Activar avisos de mi calle y mis ayudas** -> navega a `/mi-perfil` (explicando en 1 frase que es opcional y permite recibir alertas de cortes en su calle y ayudas según su hogar).
   - **Tablón Visual del Pueblo (Masonry estilo Pinterest):**
     - Columnas adaptativas (`columns-1 sm:columns-2 lg:columns-3 gap-6`).
     - Chips de filtro grandes y espaciados (`Todo`, `Cortes y Avisos`, `Ayudas`, `Arreglado`, `Trámites`).
     - Tarjetas coloridas con etiquetas legibles; al hacer clic se abre modal de detalle con botón *"Preguntar al asistente sobre esto"* (redirige a `/asistente?q=...`).

**Criterios de salida (Verificar y DETENERSE):**
- `npm run build` pasa sin errores.
- Cambiar de municipio actualiza instantáneamente el Tablón Pinterest.
- Consultar un código de incidencia del seed desde la portada muestra el estado sin requerir login.
- Comprobado sin desbordamiento en viewport `390px` y escritorio.

---

### FASE 2: Motor Multi-IA con Backups en Cascada + RAG SQLite FTS5 + Optimizador de Tokens

**Objetivo:** Construir el núcleo backend reutilizable de IA configurable, gestión de backups, motor RAG sobre documentos oficiales y ahorro de tokens.

**Tareas obligatorias:**
1. Implementar `lib/rag/fts.ts`:
   - `extractTextFromFile(buffer: Buffer, filename: string)`: soporta `.pdf` (usando `pdf-parse`), `.txt` y `.md`.
   - `chunkText(text: string, wordsPerChunk = 350, overlap = 40): string[]`.
   - `ingestDocument({ municipalityId, filename, docType, text, uploadedBy })`: inserta en `rag_documents`, trocea e inserta en `rag_chunks` y `rag_chunks_fts`.
   - `deleteDocument(municipalityId, documentId)`: elimina documento y todos sus chunks de `rag_chunks` y `rag_chunks_fts`.
   - `retrieveContext({ municipalityId, query, topK = 3, maxChars = 1800 })`: sanitiza la consulta para FTS5, busca por relevancia `bm25()` filtrada estrictamente por `municipality_id`, devuelve chunks con `filename` y `content`.
2. Implementar `lib/ai/tokenSaver.ts`:
   - `normalizeQuestion(text: string)`: minúsculas, elimina tildes y signos de puntuación.
   - `checkFaqCache(municipalityId, question, lang)` y `saveFaqCache(...)`.
   - `detectZeroTokenIntent(municipalityId, message)`: resuelve saludos y búsquedas de código `SOL-\d+` directo desde SQLite (`0 tokens`).
   - `trimHistory(history, maxTurns = 4)`: recorta historial a los últimos 4 mensajes.
3. Implementar `lib/ai/router.ts`:
   - `runAITask({ municipalityId, featureKey, systemPrompt, userPrompt, history, imageBase64 })`:
     - Lee `ai_configs` para `(municipalityId, featureKey)` y `ai_provider_keys` habilitadas para ese `municipalityId`.
     - Construye la cadena ordenada: `[primary, ...backups_json, { provider: 'LOCAL', model: 'deterministic-v1' }]`.
     - Implementa adaptadores con `fetch` nativo (timeout `10000ms`) para:
       - `GEMINI`: `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` (soporta texto e imagen base64).
       - `GROQ`: `https://api.groq.com/openai/v1/chat/completions`.
       - `OPENAI`: `https://api.openai.com/v1/chat/completions`.
       - `OPENROUTER`: `https://openrouter.ai/api/v1/chat/completions`.
       - `LOCAL`: motor determinista sin red ni API key que sintetiza respuestas usando los chunks del RAG o reglas de clasificación.
     - Si un proveedor falla (sin key, HTTP error, timeout o deshabilitado), salta automáticamente al siguiente backup y registra `fallbackTriggered: true`.
     - Retorna `{ text, providerUsed, modelUsed, fallbackTriggered, attempts }`.
   - `testProviderConnection({ provider, apiKey, model, baseUrl })`: realiza una prueba mínima (`max_tokens: 10`) para el botón *"Probar conexión"* del panel admin.

**Criterios de salida (Verificar y DETENERSE):**
- `npm run build` pasa sin errores.
- El router resuelve correctamente con `LOCAL` cuando no existen API keys reales.
- `retrieveContext` recupera fragmentos relevantes respetando el aislamiento por `municipality_id`.

---

### FASE 3: Asistente Virtual Web + Webhook Real WhatsApp Business API + Simulador

**Objetivo:** Entregar el chat ciudadano conectado al RAG y a la caché de tokens, junto con la integración preparada para Meta WhatsApp Cloud API y su simulador web.

**Tareas obligatorias:**
1. Crear `lib/chat/service.ts` (lógica compartida entre Web y WhatsApp):
   - Recibe `{ municipalityId, message, history, lang, channel }`.
   - Ejecuta el pipeline de ahorro de tokens:
     1. `detectZeroTokenIntent` -> si resuelve, devuelve respuesta (`tokensSaved: true`, `providerUsed: 'LOCAL_INTENT'`).
     2. `checkFaqCache` -> si hay hit, devuelve respuesta (`tokensSaved: true`, `providerUsed: 'FAQ_CACHE'`).
     3. `retrieveContext` -> obtiene Top-3 fragmentos oficiales del RAG del municipio.
     4. Invoca `runAITask` (`featureKey: 'CHAT'`) con instrucciones estrictas: responder claro, breve, en idioma `lang`, basado en el contexto oficial del municipio y citando el documento fuente si aplica.
     5. Detecta si el mensaje describe una avería/problema urbano (bache, farola, basura, fuga, árbol caído...) -> devuelve `suggestIncident: true` y `prefillDescription`.
     6. Registra en tabla `consultations` y guarda en `faq_cache` cuando es consulta informativa general.
2. Crear endpoint `POST /api/chat` que invoque `lib/chat/service.ts`.
3. Diseñar `app/asistente/page.tsx`:
   - Interfaz cálida y espaciosa, pensada para usuarios novatos.
   - Chips grandes de preguntas frecuentes bien separados.
   - Soporte de query param `?q=...` para pre-cargar preguntas desde el Tablón Pinterest.
   - Botón **Dictado por Voz** (Web Speech Recognition) en el input y botón **Escuchar respuesta** (`speechSynthesis`) en cada mensaje del asistente.
   - Si `suggestIncident === true`, mostrar una tarjeta Terracota clara con botón *"Avisar de este problema ahora"* que lleva a `/incidencia?desc=...`.
   - Mostrar badge discreto con fuente/ahorro (`Caché 0 tokens`, `RAG Oficial`, o nombre del proveedor IA utilizado).
4. Crear integración real de **WhatsApp Business API (Meta Cloud API)**:
   - `app/api/webhooks/whatsapp/route.ts`:
     - `GET`: valida `hub.mode === 'subscribe'` y `hub.verify_token === (process.env.WHATSAPP_VERIFY_TOKEN || 'almeriacerca_verify_token')` y retorna `hub.challenge` en texto plano (`200`).
     - `POST`: parsea el payload oficial de Meta (`entry[0].changes[0].value.messages[0]`):
       - Soporta mensajes `text`, `location` y `image`.
       - Identifica el municipio por `phone_number_id` (fallback al municipio por defecto).
       - Procesa consultas vía `lib/chat/service.ts` (`channel: 'WHATSAPP'`) y reportes de ubicación/incidencia vía el flujo de incidencias.
       - Si existen `process.env.WHATSAPP_ACCESS_TOKEN` y `phone_number_id`, envía la respuesta real mediante `POST https://graph.facebook.com/v21.0/{phone_number_id}/messages`.
       - Devuelve siempre JSON estructurado con la respuesta generada para depuración y demo.
5. Crear `app/whatsapp-demo/page.tsx`:
   - Simulador visual de móvil que construye payloads reales en formato Meta Cloud API y los envía a `POST /api/webhooks/whatsapp` (permitiendo enviar texto, simular envío de foto o ubicación GPS y ver la respuesta real del webhook).

**Criterios de salida (Verificar y DETENERSE):**
- `npm run build` pasa sin errores.
- Preguntar dos veces lo mismo en `/asistente` demuestra `FAQ_CACHE` (`0 tokens`) en la segunda petición.
- `GET /api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=almeriacerca_verify_token&hub.challenge=12345` devuelve `12345`.
- `/whatsapp-demo` envía mensajes al webhook y registra la consulta con `channel = 'WHATSAPP'`.

---

### FASE 4: Reporte de Incidencias en 3 Pasos + Clasificación Automática IA

**Objetivo:** Permitir a cualquier ciudadano (con o sin sesión) reportar incidencias con texto, foto y mapa GPS, clasificadas automáticamente por tipo, urgencia y departamento.

**Tareas obligatorias:**
1. Implementar `lib/ai/classifier.ts`:
   - `classifyIncident({ municipalityId, description, imageBase64 })`:
     - Usa `runAITask` con `featureKey: imageBase64 ? 'VISION' : 'CLASSIFY'` y `max_tokens: 180`.
     - Exige JSON estricto con campos: `{ title, category, urgency, department, aiReasoning }`.
     - Catálogo cerrado:
       - `category`: `Alumbrado` | `Limpieza y Basura` | `Baches y Vía Pública` | `Agua y Averías` | `Parques y Jardines` | `Otros`
       - `urgency`: `BAJA` | `MEDIA` | `ALTA` | `CRITICA`
       - `department`: `Electricidad` | `Limpieza Viaria` | `Obras y Urbanismo` | `Aguas y Mantenimiento` | `Medio Ambiente` | `Atención Ciudadana`
     - Si el modelo no devuelve JSON válido o se ejecuta `LOCAL`, aplica clasificador determinista robusto por palabras clave de riesgo y categoría.
2. Crear endpoints de incidencias:
   - `POST /api/incidents`: valida datos, guarda imagen (en `/public/uploads/` o Data URL comprimida), ejecuta `classifyIncident`, genera `tracking_code` (`SOL-XXX`), asocia `user_id` si hay sesión activa, inserta en SQLite y devuelve la incidencia creada.
   - `GET /api/incidents/nearby?municipalityId=...&lat=...&lng=...&category=...`: detecta incidencias abiertas a `< 150 metros` para evitar duplicados.
   - `POST /api/incidents/[id]/upvote`: incrementa `upvotes` cuando otro vecino confirma el mismo problema.
3. Diseñar `app/incidencia/page.tsx` como **Wizard ultra simple de 3 pasos** (1 sola tarea por pantalla):
   - **Paso 1 — ¿Qué ocurre?:** Botón gigante para subir/hacer foto con vista previa, caja de texto grande con dictado por voz (soporta `?desc=...`) y 5 tarjetas rápidas visuales opcionales.
   - **Paso 2 — ¿Dónde está?:** Botón gigante *"Usar mi ubicación GPS"* + mapa interactivo Leaflet centrado en el municipio (tocar para mover pin) + campo opcional de calle/referencia. Si existe incidencia cercana similar, mostrar tarjeta amigable con botón *"Me pasa lo mismo (+1)"*.
   - **Paso 3 — Confirmación:** Muestra código gigante `SOL-XXX` + resumen visual de la clasificación automática (Categoría, Urgencia con color, Departamento asignado y motivo breve).

**Criterios de salida (Verificar y DETENERSE):**
- `npm run build` pasa sin errores.
- Completar el wizard crea la incidencia en SQLite con clasificación automática y devuelve un código `SOL-XXX` rastreable desde la portada.

---

### FASE 5: Autenticación Multi-Rol + Perfil Ciudadano + Encuesta + Motor de Alertas y Ayudas (0 Tokens)

**Objetivo:** Habilitar el inicio de sesión (ciudadano y administrador por municipio) y el sistema personalizado de encuesta, avisos por calle y recomendaciones de ayudas/descuentos.

**Tareas obligatorias:**
1. Implementar sistema de autenticación en `lib/auth/session.ts` y endpoints:
   - `POST /api/auth/register` (registro de ciudadano vinculado a `municipality_id`).
   - `POST /api/auth/login` (valida email/password; para rol `ADMIN`/`DEPARTMENT`, verifica coincidencia con el municipio seleccionado o asigna automáticamente su municipio).
   - `POST /api/auth/logout` y `GET /api/auth/me`.
2. Diseñar `app/login/page.tsx`:
   - Dos pestañas claras y espaciadas: **Soy Ciudadano** (Entrar / Crear cuenta) y **Acceso Ayuntamiento (Admin)** con selector de municipio.
   - Incluir bloque discreto de **"Acceso Rápido Demo"** (botones 1-clic para `Vecino Lucainena`, `Admin Lucainena`, `Admin Níjar`) para agilizar pruebas y presentación.
3. Implementar motor determinista `lib/personalization/matcher.ts` (**0 tokens de IA**):
   - `normalizeStreet(street: string)`: normaliza nombres de calles para comparación exacta/parcial tolerante a tildes y mayúsculas.
   - `matchAidsForProfile(municipalityId, profile)`: evalúa todas las filas activas de `municipal_aids` contra `requirements_json` y devuelve las ayudas elegibles con `matchReasons: string[]` (ej: *"Cumples el requisito de Familia Numerosa"*, *"Vivienda de 4 o más integrantes"*).
   - `syncNotificationsForCitizen(userId)`: cruza `citizen_profiles` contra `street_alerts` (calle afectada) y contra `matchAidsForProfile`, insertando notificaciones sin duplicar en `user_notifications`.
   - `broadcastStreetAlert(municipalityId, alertId)` y `broadcastNewAid(municipalityId, aidId)`: disparan notificaciones inmediatas a todos los ciudadanos registrados cuyo perfil coincida.
4. Crear APIs de perfil ciudadano:
   - `GET /api/profile`: devuelve datos del usuario, encuesta (`citizen_profiles`), ayudas compatibles con motivos, notificaciones (`user_notifications`) e incidencias propias del usuario.
   - `PUT /api/profile`: guarda/actualiza `citizen_profiles`, ejecuta `syncNotificationsForCitizen(userId)` y devuelve el estado recalculado al instante.
   - `PATCH /api/notifications/read`: marca notificaciones como leídas.
5. Diseñar `app/mi-perfil/page.tsx` (si no hay sesión, invita amablemente a iniciar sesión o registrarse):
   - **Sección 1 — Tus Avisos Personalizados:** Tarjetas llamativas para alertas de cortes/obras en su calle, cambios de estado de sus incidencias y nuevas ayudas detectadas.
   - **Sección 2 — Ayudas y Descuentos para Ti:** Tarjetas estilo Pinterest con el descuento destacado, los motivos por los que le corresponde y botón *"Preguntar al asistente cómo pedirla"*.
   - **Sección 3 — Tu Encuesta de Hogar (Visual y Fácil):**
     - Selector/autocompletado de calle del municipio (`streets_json` + opción texto libre).
     - Contador visual `- / +` de integrantes en la vivienda.
     - Tarjetas toggle grandes y claras: `Familia numerosa`, `Menores en casa`, `Mayores o personas dependientes`, `Movilidad reducida`.
     - Selector simple de tramo orientativo de renta (`Reducida`, `Media`, `Alta`).
     - Teléfono WhatsApp opcional + toggle *"Quiero recibir avisos por WhatsApp"*.
     - Al pulsar **Guardar mi perfil**, recalcula y actualiza en pantalla al instante sus avisos de calle y sus ayudas.

**Criterios de salida (Verificar y DETENERSE):**
- `npm run build` pasa sin errores.
- Al iniciar sesión como ciudadano, seleccionar `Calle Real` + activar `Familia numerosa` + `4 integrantes` y guardar, aparecen inmediatamente el aviso de corte de `Calle Real` y las ayudas/descuentos correspondientes sin gastar ningún token de IA.

---

### FASE 6: Panel Administrador Multi-Municipio (Incidencias, APIs IA + Backups, RAG, Difusión y Analíticas)

**Objetivo:** Entregar el centro de mando administrativo completo, estrictamente aislado al `municipality_id` del administrador autenticado.

**Tareas obligatorias:**
1. Crear middleware/helper `requireAdminSession()` que valide rol `ADMIN` o `DEPARTMENT` y devuelva su `municipality_id` (rechaza con `401`/`403` cualquier acceso no autorizado).
2. Crear endpoints administrativos protegidos (todos filtrados por `session.municipalityId`):
   - **Incidencias:** `GET /api/admin/incidents` y `PATCH /api/admin/incidents/[id]` (actualizar estado, departamento, nota interna, foto de resolución; si la incidencia pertenece a un ciudadano registrado, inserta notificación `INCIDENT_UPDATE`).
   - **Configuración de APIs de IA y Backups:**
     - `GET /api/admin/ai-config` y `PUT /api/admin/ai-config`: leer y guardar `ai_provider_keys` (devolviendo API keys enmascaradas en GET) y `ai_configs` por funcionalidad (`CHAT`, `CLASSIFY`, `VISION`) incluyendo proveedor principal, modelo, lista ordenada de múltiples backups y `max_tokens`.
     - `POST /api/admin/ai-config/test`: invoca `testProviderConnection`.
   - **Documentos Oficiales (RAG):**
     - `GET /api/admin/rag`, `POST /api/admin/rag/upload` (multipart `.pdf`, `.txt`, `.md`), `DELETE /api/admin/rag/[id]`, `POST /api/admin/rag/search` (prueba en vivo de recuperación FTS5).
   - **Difusión por Calle y Ayudas:**
     - `GET / POST / DELETE /api/admin/street-alerts` (al crear, ejecuta `broadcastStreetAlert` y devuelve cuántos vecinos fueron notificados).
     - `GET / POST / DELETE /api/admin/aids` (al crear, ejecuta `broadcastNewAid` y devuelve cuántos perfiles hicieron match).
   - **Analíticas y Reset Demo:**
     - `GET /api/admin/analytics`: devuelve KPIs (total incidencias, % resueltas, urgentes activas, total consultas, % respuestas 0-tokens ahorradas), series para Recharts (por categoría, por departamento, por estado, temas consultados), listado de incidencias con coordenadas para el mapa y últimas consultas.
     - `POST /api/admin/reset-demo`: restaura el seed limpio para la presentación.
3. Diseñar `app/admin/page.tsx` con cabecera clara indicando el **Municipio Activo** y 5 pestañas amplias y ordenadas:
   - **Pestaña 1 — Incidencias y Departamentos:** Filtros por departamento/estado/urgencia, tabla/tarjetas claras y modal para cambiar estado, reasignar departamento, escribir nota al vecino y adjuntar foto de resolución.
   - **Pestaña 2 — APIs de IA y Backups:**
     - Gestión de proveedores (`GEMINI`, `GROQ`, `OPENAI`, `OPENROUTER`, `LOCAL`): editar API Key, activar/desactivar y botón *"Probar conexión"*.
     - Matriz por funcionalidad (`CHAT`, `CLASSIFY`, `VISION`): seleccionar proveedor/modelo principal, añadir/quitar/reordenar múltiples backups en cascada y definir `max_tokens`.
     - Panel indicador de ahorro de tokens (% consultas servidas con 0 tokens).
   - **Pestaña 3 — Documentos Oficiales (RAG):**
     - Subida drag-and-drop de `.pdf`, `.txt`, `.md`.
     - Listado de documentos indexados (nombre, fecha, nº chunks FTS5, eliminar).
     - Buscador de prueba *"Probar recuperación RAG"* para verificar fragmentos en directo.
   - **Pestaña 4 — Avisos por Calle y Ayudas:**
     - Crear alerta de corte/obra seleccionando calles afectadas -> muestra contador *"Notificado a X vecinos"*.
     - Crear nueva ayuda/descuento marcando checkboxes de requisitos -> muestra contador *"Compatible con X vecinos"*.
   - **Pestaña 5 — Mapa, Consultas y Analíticas:**
     - Tarjetas KPI de colores.
     - Mapa interactivo Leaflet con marcadores por urgencia.
     - Gráficas Recharts (Categorías, Carga por Departamento, Canales Web vs WhatsApp).
     - Historial de consultas recientes con etiqueta de canal y proveedor IA.
     - Botón discreto *"Reiniciar datos de demo"*.

**Criterios de salida (Verificar y DETENERSE):**
- `npm run build` pasa sin errores.
- Iniciar sesión como `admin@lucainena.es` muestra exclusivamente datos de Lucainena; `admin@nijar.es` muestra exclusivamente datos de Níjar.
- Subir un documento `.txt`/`.pdf` en el RAG permite que `/asistente` responda usando su contenido inmediatamente.
- Cambiar el proveedor/backup de IA en `/admin` persiste en SQLite y es respetado por `lib/ai/router.ts`.
- Crear un aviso de calle notifica inmediatamente al ciudadano correspondiente en `/mi-perfil`.

---

### FASE 7: Auditoría E2E, Pulido Visual Mobile/Desktop y Validación Final

**Objetivo:** Verificar todos los flujos de extremo a extremo, corregir cualquier fallo de consola o diseño y dejar la app lista para el escenario.

**Tareas obligatorias:**
1. Ejecutar verificación completa de flujos (navegador y endpoints):
   - **Flujo Sin Login:** Portada `#F7F1E5` -> cambiar idioma (`ES -> EN -> AR -> ES`) -> activar `A+` y `Alto Contraste` -> consultar en `/asistente` (2 veces para validar caché 0-tokens) -> reportar incidencia en `/incidencia` -> consultar código `SOL-XXX` en portada.
   - **Flujo Perfil Ciudadano:** Login `vecino@lucainena.es` -> completar encuesta (`Calle Real`, `Familia numerosa`) -> verificar alerta de calle y tarjetas de ayudas.
   - **Flujo Admin Multi-Municipio:** Login `admin@lucainena.es` -> resolver la incidencia creada -> subir documento al RAG -> configurar backups de IA -> publicar un nuevo aviso en `Calle Real` -> comprobar notificación en `/mi-perfil` -> verificar aislamiento entrando en `admin@nijar.es`.
   - **Flujo WhatsApp:** Enviar mensaje desde `/whatsapp-demo` -> verificar respuesta del webhook y aparición en analíticas de `/admin` con canal `WHATSAPP`.
2. Corregir cualquier warning/error en consola del navegador o servidor, problemas de hidratación de Leaflet/Recharts o desbordamientos en móvil (`390x844`).
3. Ejecutar `npm run build` final limpio.

**Criterios de salida (Entrega final):**
- 0 errores de compilación TypeScript y 0 errores en consola durante los 4 flujos E2E.
- Todos los ítems del Checklist Final verificados.

---

## 4. CHECKLIST FINAL DE VERIFICACIÓN

- [ ] Diseño estilo tablero Pinterest cálido (`#F7F1E5`), sin fondo blanco clínico ni botones amontonados.
- [ ] Acceso básico completo sin iniciar sesión (Asistente, Incidencias, Seguimiento, Tablón).
- [ ] Login ciudadano + Encuesta de hogar + Alertas automáticas por calle + Recomendador de ayudas/descuentos.
- [ ] Login administrador aislado por municipio (multi-tenant).
- [ ] Panel Admin: edición de APIs de IA, asignación por funcionalidad y múltiples backups en cascada.
- [ ] Panel Admin: subida de documentos oficiales (`.pdf`, `.txt`, `.md`) al motor RAG SQLite FTS5.
- [ ] Webhook oficial de WhatsApp Business API (`GET`/`POST /api/webhooks/whatsapp`) + simulador `/whatsapp-demo`.
- [ ] Clasificación automática de incidencias (tipo, urgencia, departamento) + seguimiento de estados.
- [ ] Multi-idioma (`ES`, `EN`, `FR`, `AR` con RTL), responsive mobile-first y barra de accesibilidad + voz.
- [ ] Optimizaciones activas de ahorro de tokens (Caché FAQ, FTS5 Top-3, Router 0-tokens, Matching 0-tokens, Sliding Window).
- [ ] Panel de analíticas, mapa interactivo y botón de reinicio de demo.