# AGENT SPECIFICATION — PROYECTO "ALMERÍACERCA" (RETO 02: TU AYUNTAMIENTO, A UN MENSAJE)

> **DESTINATARIO:** Agente de desarrollo autónomo (Google Antigravity).
> **OBJETIVO:** Construir un MVP fullstack completo, funcional, visualmente atractivo, accesible y optimizado en consumo de tokens, ejecutando estrictamente **una fase por turno** sobre **PostgreSQL + `pgvector` en Supabase**.

---

## 0. PROTOCOLO DE EJECUCIÓN DEL AGENTE (OBLIGATORIO)

1. **EJECUCIÓN ESTRICTAMENTE SECUENCIAL:** Ejecuta **ÚNICAMENTE** la fase solicitada por el usuario. **PROHIBIDO** adelantar archivos o funcionalidades de fases posteriores.
2. **PARADA OBLIGATORIA AL FINALIZAR CADA FASE:** Al completar una fase:
   - Ejecuta `npx tsc --noEmit` y `npm run build` y comprueba que no existan errores.
   - Verifica visualmente/funcionalmente los **Criterios de Salida** de esa fase contra Supabase.
   - Presenta un resumen breve (máx. 8 líneas) de archivos creados/modificados y resultados de verificación.
   - **DETENTE** y espera confirmación explícita del usuario (ej: *"avanza a Fase X"*) antes de continuar.
3. **EFICIENCIA DE CONTEXTO Y TOKENS:**
   - Realiza ediciones quirúrgicas; no reescribas archivos completos que ya funcionan salvo que sea estrictamente necesario.
   - No instales librerías fuera del stack definido sin justificación.
4. **RESILIENCIA TOTAL EN DEMO:**
   - La aplicación debe funcionar al **100% sin depender de API keys de IA externas** gracias al proveedor `LOCAL` integrado en el router de IA y al respaldo textual automático de PostgreSQL cuando no exista `GEMINI_API_KEY`.

---

## 1. REGLAS ARQUITECTÓNICAS Y DE DISEÑO (APLICABLES A TODAS LAS FASES)

### 1.1 Stack Tecnológico Único (Arquitectura Real en Producción)
- **Framework:** Next.js 14 (App Router) + TypeScript + Tailwind CSS.
- **Base de Datos Asíncrona (Supabase PostgreSQL):** Driver `pg` (`Pool` singleton) conectado mediante `DATABASE_URL` en `.env.local`, con resolución automática al **Session Pooler IPv4** de Supabase (`aws-0-eu-central-1.pooler.supabase.com:5432`) cuando el host directo solo publica registros IPv6 (`AAAA`).
- **Motor RAG Híbrido con `pgvector`:**
  - Extensión nativa `CREATE EXTENSION IF NOT EXISTS vector;` en PostgreSQL.
  - Columna `embedding vector(768)` + índice **HNSW** (`USING hnsw (embedding vector_cosine_ops)`) con operador de distancia coseno `<=>`.
  - Generación de embeddings reales de `768` dimensiones mediante **Gemini (`text-embedding-004`)** cuando exista `GEMINI_API_KEY` (en `.env.local` o activa en `ai_provider_keys`).
  - **Respaldo Textual Automático (0 API keys):** Si no hay `GEMINI_API_KEY`, el motor RAG ejecuta automáticamente búsqueda textual en PostgreSQL (`ts_rank_cd` con `to_tsvector('spanish', ...)` + ranking Okapi BM25) filtrando estrictamente por `municipality_id` y documentos con estado `'VIGENTE'`.
- **Ingesta de Documentos y Fuentes Oficiales:** `pdf-parse` para `.pdf`, lectura UTF-8 para `.txt` y `.md`, e ingesta directa de texto o URL oficial municipal con control de vigencia (`'VIGENTE' | 'DEROGADA'`) y fecha de vigencia (`valid_until`).
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
- **Aislamiento Multi-Tenant:** Toda tabla operativa y consulta SQL en PostgreSQL debe filtrar obligatoriamente por `municipality_id`. Un administrador de un municipio nunca puede ver ni editar datos de otro municipio.
- **Multi-Idioma (`i18n`):** Todos los textos de UI deben resolverse mediante `useTranslation()` leyendo diccionarios JSON (`es`, `en`, `fr`, `ar`). Al seleccionar `ar`, aplicar `dir="rtl"` al documento.
- **Responsive Mobile-First:** Todas las pantallas deben operar sin scroll horizontal en `390px` (móvil) y escalar limpiamente a escritorio (`1280px+`).
- **Accesibilidad Integrada:** Controles persistentes en la barra superior para activar/desactivar:
  1. `A+` Texto Grande (`.a11y-large-text`)
  2. Alto Contraste (`.a11y-high-contrast`)
  3. Modo Lectura Fácil (`.a11y-easy-read`, simplifica densidad y aumenta interlineado)
  4. Voz (Web Speech API: dictado en inputs principales y lectura en voz alta de respuestas del chat).

### 1.4 Reglas de Reducción de Consumo de Tokens (Obligatorias en Código)
1. **Caché FAQ (`faq_cache`) + FAQ Sugeridas:** Normalizar pregunta (minúsculas, sin tildes ni signos) antes de invocar cualquier LLM. Si existe coincidencia en el mismo municipio e idioma, responder en `0 tokens`. Las consultas repetidas o derivadas se sugieren en `/admin` para aprobarlas con 1 clic en `faq_cache`.
2. **Router Local de Intenciones (`0 tokens`):** Saludos básicos, comando `"borrar mis datos"` y consultas que contengan un código `SOL-\d+` se resuelven directo contra PostgreSQL sin llamar a IA.
3. **RAG `pgvector` HNSW + Top-K Estricto sobre Documentos Vigentes:** Trocear documentos en chunks de ~350 palabras (overlap 40). Recuperar máximo `3` chunks relevantes (`<= 1800 caracteres` totales) exclusivamente de documentos con `status = 'VIGENTE'`. Nunca enviar documentos completos ni normativa derogada al LLM.
4. **Personalización Determinista (`0 tokens`):** El cruce entre encuesta ciudadana, cortes de calle y ayudas municipales debe ejecutarse 100% mediante PostgreSQL y reglas deterministas, sin llamadas a IA.
5. **Ventana Deslizante:** Enviar al LLM como máximo los últimos `4` mensajes del historial.
6. **Límites Estrictos de Salida:** `max_tokens: 180` para clasificación JSON y `max_tokens: 300` para chat ciudadano (configurable desde `/admin`).

---

## 2. ESQUEMA DE BASE DE DATOS (POSTGRESQL + `pgvector` EN SUPABASE)

Implementado en `lib/db/index.ts` sobre Supabase PostgreSQL (`CREATE EXTENSION IF NOT EXISTS vector;`) con aislamiento estricto por `municipality_id`:

1. `municipalities`:
   - `id` (TEXT PK), `slug` (TEXT UNIQUE), `name`, `province`, `center_lat` (DOUBLE PRECISION), `center_lng` (DOUBLE PRECISION), `streets_json`, `whatsapp_phone_id`, `created_at`
2. `users`:
   - `id` (TEXT PK), `municipality_id` (FK), `email` (TEXT UNIQUE), `password_hash`, `name`, `role` (`'CITIZEN' | 'ADMIN' | 'DEPARTMENT'`), `department_name`, `preferred_lang`, `created_at`
3. `citizen_profiles`:
   - `user_id` (TEXT PK FK), `municipality_id` (FK), `street_name`, `neighborhood`, `household_size` (INTEGER), `has_children` (INTEGER 0/1), `large_family` (INTEGER 0/1), `has_seniors_or_dependents` (INTEGER 0/1), `reduced_mobility` (INTEGER 0/1), `income_bracket` (`'LOW' | 'MEDIUM' | 'HIGH'`), `interests_json`, `whatsapp_phone`, `notifications_opt_in` (INTEGER 0/1), `updated_at`
4. `incidents`:
   - `id` (TEXT PK), `municipality_id` (FK), `user_id` (TEXT nullable FK), `tracking_code` (TEXT UNIQUE), `title`, `description`, `photo_url`, `resolved_photo_url` (foto de cierre adjuntada por el operario/admin), `lat` (DOUBLE PRECISION), `lng` (DOUBLE PRECISION), `address_label`, `category`
   - `urgency`: `'BAJA' | 'MEDIA' | 'ALTA' | 'URGENTE' | 'EMERGENCIA_112'` (admite `'CRITICA'` como alias legado de `'URGENTE'`)
   - `department`: `'Electricidad' | 'Limpieza Viaria' | 'Obras y Urbanismo' | 'Aguas y Mantenimiento' | 'Medio Ambiente' | 'Atención Ciudadana'`
   - `status` (ciclo oficial de 5 estados): `'RECIBIDO' | 'VISTO' | 'ASIGNADO' | 'EN_CURSO' | 'RESUELTO'` (compatible con valores previos `'PENDIENTE' -> 'RECIBIDO'`, `'EN_REVISION' -> 'VISTO'`, `'RESUELTA' -> 'RESUELTO'`)
   - `ai_reasoning`, `ai_provider_used`, `channel` (`'WEB' | 'WHATSAPP'`), `upvotes` (INTEGER), `internal_notes`
   - `reporter_ids_json` (TEXT DEFAULT `'[]'`, JSON array con los `user_id` de todos los vecinos agrupados en la misma incidencia o que pulsaron *"Me pasa lo mismo (+1)"* a `< 150m` para notificarles el cierre)
   - `citizen_rating` (INTEGER nullable 1..5, valoración ciudadana tras el cierre), `citizen_feedback` (TEXT nullable), `reopened_count` (INTEGER DEFAULT 0, incrementado cuando el vecino pulsa *"Sigue sin funcionar"*)
   - `is_quarantined` (INTEGER 0/1 DEFAULT 0, indica si el aviso está en cuarentena/spam), `quarantine_reason` (TEXT nullable, motivo registrado de cuarentena)
   - `created_at`, `updated_at`
5. `consultations`:
   - `id` (TEXT PK), `municipality_id` (FK), `question`, `answer`, `topic`, `lang`, `channel` (`'WEB' | 'WHATSAPP'`), `tokens_saved` (INTEGER 0/1), `provider_used`, `escalated_to_human` (INTEGER 0/1 DEFAULT 0), `rag_doc_ids_json` (TEXT DEFAULT `'[]'`), `created_at`
6. `rag_documents`:
   - `id` (TEXT PK), `municipality_id` (FK), `filename`, `doc_type` (`'PDF' | 'TXT' | 'MD' | 'URL' | 'TEXT'`), `source_url` (TEXT nullable), `status` (`'VIGENTE' | 'DEROGADA'` DEFAULT `'VIGENTE'`), `valid_until` (TEXT nullable, fecha de vigencia), `usage_count` (INTEGER DEFAULT 0, contador de veces usado en respuestas), `char_count` (INTEGER), `chunk_count` (INTEGER), `uploaded_by`, `created_at`
7. `rag_chunks` y `rag_chunks_fts`:
   - `chunk_id` (TEXT PK), `document_id` (FK), `municipality_id` (FK), `filename`, `content`, `embedding vector(768)`
   - Índices HNSW: `CREATE INDEX IF NOT EXISTS idx_rag_chunks_embedding_hnsw ON rag_chunks USING hnsw (embedding vector_cosine_ops);` y `CREATE INDEX IF NOT EXISTS idx_rag_fts_embedding_hnsw ON rag_chunks_fts USING hnsw (embedding vector_cosine_ops);`
8. `ai_provider_keys`:
   - `id` (TEXT PK), `municipality_id` (FK), `provider` (`'GEMINI' | 'GROQ' | 'OPENAI' | 'OPENROUTER' | 'LOCAL'`), `api_key`, `base_url`, `enabled` (INTEGER 0/1), `updated_at` — UNIQUE(`municipality_id`, `provider`)
9. `ai_configs`:
   - `id` (TEXT PK), `municipality_id` (FK), `feature_key` (`'CHAT' | 'CLASSIFY' | 'VISION'`), `primary_provider`, `primary_model`, `backups_json` (JSON array ordenado de `{ provider, model }`), `max_tokens`, `temperature`, `updated_at` — UNIQUE(`municipality_id`, `feature_key`)
10. `municipal_aids`:
    - `id` (TEXT PK), `municipality_id` (FK), `title`, `description`, `discount_label`, `requirements_json`, `deadline`, `apply_url`, `active` (INTEGER 0/1), `created_at`
11. `street_alerts`:
    - `id` (TEXT PK), `municipality_id` (FK), `title`, `message`, `affected_streets_json`, `start_date`, `end_date`, `severity` (`'INFO' | 'WARNING' | 'CRITICAL'`), `created_at`
12. `user_notifications`:
    - `id` (TEXT PK), `user_id` (FK), `municipality_id` (FK), `type` (`'STREET_ALERT' | 'AID_MATCH' | 'INCIDENT_UPDATE'`), `title`, `body`, `ref_id`, `is_read` (INTEGER 0/1), `created_at`
13. `faq_cache`:
    - `id` (TEXT PK), `municipality_id` (FK), `normalized_question`, `lang`, `answer`, `hits` (INTEGER), `approved_by_admin` (INTEGER 0/1 DEFAULT 1), `created_at` — UNIQUE(`municipality_id`, `normalized_question`, `lang`)

---

## 3. PLAN DE EJECUCIÓN POR FASES

---

### FASE 0: Scaffolding, Base de Datos PostgreSQL (Supabase) + `pgvector`, Seed Multi-Municipio, i18n y AppShell Accesible — [COMPLETADA]

**Estado:** **COMPLETADA Y VERIFICADA EN SUPABASE.**
- Proyecto Next.js 14 (App Router, TypeScript, Tailwind CSS) con paleta cálida `#F7F1E5` y clases globales `.a11y-large-text`, `.a11y-high-contrast`, `.a11y-easy-read`.
- Conexión asíncrona a Supabase PostgreSQL (`lib/db/index.ts`) vía `DATABASE_URL` (`.env.local`) con soporte automático de Session Pooler IPv4, extensión `vector` (`pgvector`) e índices HNSW.
- Seed multi-municipio idempotente (`lib/db/seed.ts`) para **Lucainena de las Torres** y **Níjar**.
- Sistema multi-idioma (`es`, `en`, `fr`, `ar` con `dir="rtl"`), `MunicipalityProvider` y `AppShell` accesible.

---

### FASE 1: Portada Ciudadana sin Login + Tablón Estilo Pinterest + Seguimiento Rápido — [COMPLETADA]

**Estado:** **COMPLETADA Y VERIFICADA EN SUPABASE.**
- Endpoints públicos `GET /api/public/board` y `GET /api/incidents/track` aislados por `municipality_id`.
- Portada `app/page.tsx` con las 3 Tarjetas Gigantes (`#1B8A7A`, `#E45735`, `#2C6E91`), Tarjeta Opcional Buganvilla (`#B84A62`), Tablón Masonry estilo Pinterest con 5 filtros, modal de detalle hacia `/asistente?q=...` y modal de seguimiento `SOL-XXX`.

---

### FASE 2: Motor Multi-IA con Backups en Cascada + RAG Híbrido `pgvector` + Optimizador de Tokens — [COMPLETADA]

**Estado:** **COMPLETADA Y VERIFICADA EN SUPABASE.**
- `lib/rag/fts.ts` con ingesta `.pdf`/`.txt`/`.md`, búsqueda vectorial real `pgvector` (`embedding vector(768)` + índice HNSW `<=>` con `text-embedding-004` de Gemini) y respaldo automático `to_tsvector` + Okapi BM25 en PostgreSQL.
- `lib/ai/tokenSaver.ts` (`normalizeQuestion`, `checkFaqCache`, `saveFaqCache`, `detectZeroTokenIntent`, `trimHistory`).
- `lib/ai/router.ts` (`runAITask` con cascada `[primary, ...backups, LOCAL]` y `testProviderConnection`).

---

### FASE 3: Asistente Virtual Web + Webhook Real WhatsApp Business API + Simulador — [COMPLETADA]

**Estado:** **COMPLETADA Y VERIFICADA EN SUPABASE.**
- `lib/chat/service.ts` y `POST /api/chat` con ahorro de tokens, RAG Top-3 y detección de problemas urbanos (`suggestIncident`).
- Interfaz `/asistente` con chips FAQ, dictado por voz, lectura por voz (`speechSynthesis`), tarjeta de desvío a `/incidencia?desc=...` y badge de fuente/ahorro.
- Webhook oficial `GET`/`POST /api/webhooks/whatsapp` y simulador `/whatsapp-demo`.

---

### FASE 4: Reporte de Incidencias en 3 Pasos + Clasificación Automática IA — [COMPLETADA]

**Estado:** **COMPLETADA Y VERIFICADA EN SUPABASE.**
- Clasificador `lib/ai/classifier.ts` y servicio `lib/incidents/service.ts` compartidos entre web y WhatsApp.
- Endpoints `POST /api/incidents`, `GET /api/incidents/nearby` (`< 150m`) y `POST /api/incidents/[id]/upvote`.
- Wizard de 3 pasos en `/incidencia` con foto comprimida, dictado por voz, mapa interactivo Leaflet y detección de duplicados cercanos.

---

### FASE 5: Autenticación Multi-Rol + Perfil Ciudadano + Encuesta + Motor de Alertas y Ayudas (0 Tokens) — [COMPLETADA]

**Estado:** **COMPLETADA Y VERIFICADA EN SUPABASE.**
- Sesiones JWT HTTPOnly en `lib/auth/session.ts` y endpoints `/api/auth/register`, `/api/auth/login`, `/api/auth/logout`, `/api/auth/me`.
- Pantalla `/login` con pestañas Ciudadano/Admin y Acceso Rápido Demo 1-clic.
- Motor determinista `lib/personalization/matcher.ts` (`0 tokens`) + `/api/profile` (`GET`/`PUT`), `/api/notifications/read` (`PATCH`) y pantalla `/mi-perfil` con avisos de calle, ayudas compatibles y encuesta visual de hogar.

---

### FASE 6: Panel Administrador Multi-Municipio, Ciclo de 5 Estados, Cuarentena Anti-Spam, Vigencia RAG y FAQ Sugeridas

**Objetivo:** Entregar el centro de mando administrativo completo en `/admin`, estrictamente aislado al `municipality_id` del administrador autenticado, cumpliendo todos los criterios de la rúbrica oficial del Reto 2.

**Tareas obligatorias:**
1. **Actualización Incremental del Esquema en PostgreSQL (`lib/db/index.ts`):**
   - Añadir mediante `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` las columnas de la Sección 2 en:
     - `incidents`: `reporter_ids_json`, `citizen_rating`, `citizen_feedback`, `reopened_count`, `is_quarantined`, `quarantine_reason`.
     - `rag_documents`: `source_url`, `status` (`'VIGENTE' | 'DEROGADA'`), `valid_until`, `usage_count`.
     - `consultations`: `escalated_to_human`, `rag_doc_ids_json`.
     - `faq_cache`: `approved_by_admin`.
   - Ampliar los `CHECK` constraints de `incidents` en PostgreSQL para admitir el ciclo oficial de **5 estados** (`'RECIBIDO' | 'VISTO' | 'ASIGNADO' | 'EN_CURSO' | 'RESUELTO'`, normalizando filas previas `'PENDIENTE' -> 'RECIBIDO'`, `'EN_REVISION' -> 'VISTO'`, `'RESUELTA' -> 'RESUELTO'`) y los **5 niveles de prioridad** (`'BAJA' | 'MEDIA' | 'ALTA' | 'URGENTE' | 'EMERGENCIA_112'`, normalizando `'CRITICA' -> 'URGENTE'`).
2. **Ciclo de 5 Estados, Agrupación de Duplicados (`< 150m`), Foto de Cierre y Reapertura Ciudadana:**
   - **Agrupación y Escalado Automático de Prioridad (`< 150m`):**
     - En `POST /api/incidents/[id]/upvote` (y al reportar un duplicado cercano), añadir el `user_id` de la sesión activa (si existe) a `reporter_ids_json` sin duplicar, incrementar `upvotes` y **escalar automáticamente la prioridad** según apoyos vecinales (`>= 3` apoyos -> mínimo `'ALTA'`; `>= 5` apoyos -> `'URGENTE'`; riesgo vital / `112` -> `'EMERGENCIA_112'`).
   - **Cierre con Foto del Operario y Notificación Multi-Reportante:**
     - Al actualizar una incidencia en `/admin` (`PATCH /api/admin/incidents/[id]`) cambiando estado (`RECIBIDO -> VISTO -> ASIGNADO -> EN_CURSO -> RESUELTO`), departamento, nota interna o adjuntando **foto de cierre del operario** (`resolved_photo_url`), insertar notificación `INCIDENT_UPDATE` en `user_notifications` para el autor (`user_id`) **y para todos los ciudadanos registrados en `reporter_ids_json`**.
   - **Valoración Ciudadana y Botón *"Sigue sin funcionar"* (Reapertura):**
     - Crear endpoint público/ciudadano `POST /api/incidents/[id]/feedback` que permita:
       - Valorar una incidencia `'RESUELTO'` (`rating: 1..5`, `feedback?: string`).
       - O pulsar **"Sigue sin funcionar"** (`action: 'REOPEN'`, `reason?: string`), cambiando el estado de `'RESUELTO'` a `'EN_CURSO'`, incrementando `reopened_count = reopened_count + 1` y escalando la prioridad a `'URGENTE'`.
     - Integrar en `components/TrackIncidentModal.tsx` y en `app/mi-perfil/page.tsx` la línea temporal visual de **5 estados** (`Recibido -> Visto -> Asignado -> En curso -> Resuelto`), la visualización de la foto de cierre del operario (`resolved_photo_url`), las estrellas de valoración y el botón **"Sigue sin funcionar"**.
3. **Filtro Anti-Spam y Bandeja de Cuarentena:**
   - En `lib/incidents/service.ts`, si la descripción contiene patrones evidentes de spam/insultos/prueba vacía o el administrador la marca como spam, registrar `is_quarantined = 1` y `quarantine_reason` (ej. *"Contenido inapropiado o spam detectado automáticamente"*, *"Marcado en cuarentena por administración"*). Las incidencias en cuarentena no se contabilizan en el tablón público ni en avisos cercanos.
   - En `/admin`, incluir vista/filtro de **Cuarentena / Spam** mostrando el motivo registrado (`quarantine_reason`) y botón **"Recuperar aviso legítimo"** (`is_quarantined = 0`, `quarantine_reason = null`) o eliminación definitiva.
4. **Middleware `requireAdminSession()` y Endpoints Administrativos Protegidos (filtrados por `session.municipalityId`):**
   - Crear helper `requireAdminSession()` en `lib/auth/session.ts` que valide rol `'ADMIN'` o `'DEPARTMENT'` y devuelva su `municipalityId` (rechaza con `401`/`403` cualquier acceso no autorizado).
   - **Incidencias y Cuarentena:**
     - `GET /api/admin/incidents` (devuelve incidencias activas y en cuarentena del municipio) y `PATCH /api/admin/incidents/[id]` (actualizar estado dentro de los 5 estados, prioridad, departamento, nota al vecino, `resolved_photo_url`, enviar a cuarentena con motivo o recuperar de cuarentena).
   - **Configuración de APIs de IA y Backups:**
     - `GET /api/admin/ai-config` y `PUT /api/admin/ai-config`: leer y guardar `ai_provider_keys` (devolviendo API keys enmascaradas en GET) y `ai_configs` por funcionalidad (`CHAT`, `CLASSIFY`, `VISION`) incluyendo proveedor principal, modelo, lista ordenada de backups y `max_tokens`.
     - `POST /api/admin/ai-config/test`: invoca `testProviderConnection`.
   - **Base de Conocimiento Oficial (RAG con Vigencia y Contador de Uso):**
     - Actualizar `retrieveContext` en `lib/rag/fts.ts` para recuperar únicamente fragmentos cuyos documentos en `rag_documents` tengan `status = 'VIGENTE'` (y `valid_until IS NULL OR valid_until >= current_date`), incrementando `usage_count = usage_count + 1` en los documentos utilizados.
     - `GET /api/admin/rag`: lista documentos del municipio con `status` (`VIGENTE` / `DEROGADA`), `valid_until`, `usage_count`, `source_url`, `chunk_count`.
     - `POST /api/admin/rag/upload`: soporta subida multipart de `.pdf`, `.txt`, `.md` **y también** ingesta JSON de texto libre o URL oficial (`{ title, text, sourceUrl, validUntil }`) con fecha de vigencia opcional.
     - `PATCH /api/admin/rag/[id]`: permite **derogar o reactivar con 1 clic** (`status: 'DEROGADA' | 'VIGENTE'`, o actualizar `valid_until`).
     - `DELETE /api/admin/rag/[id]`: elimina documento y sus chunks.
     - `POST /api/admin/rag/search`: prueba en vivo de recuperación RAG (`pgvector` `<=>` / `to_tsvector`) sobre documentos vigentes.
   - **FAQ Sugeridas (Aprobación 1-Clic para 0 Tokens):**
     - `GET /api/admin/faqs`: devuelve las FAQs activas en `faq_cache` del municipio y la lista de **FAQ Sugeridas** detectadas automáticamente a partir de `consultations` (preguntas repetidas o escaladas que aún no están en `faq_cache`).
     - `POST /api/admin/faqs`: aprueba con 1 clic una FAQ sugerida (o crea una nueva) insertándola en `faq_cache` (`approved_by_admin = 1`) para que futuras consultas idénticas respondan en `0 tokens`.
     - `DELETE /api/admin/faqs`: elimina una entrada de `faq_cache`.
   - **Difusión por Calle y Ayudas:**
     - `GET / POST / DELETE /api/admin/street-alerts` (al crear, ejecuta `broadcastStreetAlert` y devuelve `notifiedCount`).
     - `GET / POST / DELETE /api/admin/aids` (al crear, ejecuta `broadcastNewAid` y devuelve `matchedCount`).
   - **Analíticas y Reset Demo:**
     - `GET /api/admin/analytics`: devuelve KPIs (total incidencias, % resueltas, urgentes/emergencia activas, en cuarentena, total consultas, % respuestas 0-tokens ahorradas), series para Recharts (por categoría, por departamento, por los 5 estados, canales Web vs WhatsApp), listado de incidencias con coordenadas para el mapa Leaflet y últimas consultas.
     - `POST /api/admin/reset-demo`: ejecuta `resetDatabase(db)` restaurando el seed limpio en Supabase.
5. **Diseñar `app/admin/page.tsx` con cabecera indicando el Municipio Activo y 5 pestañas amplias:**
   - **Pestaña 1 — Incidencias, Departamentos y Cuarentena:** Filtros por departamento/estado (5 estados)/prioridad + sub-vista de **Cuarentena / Spam** con motivo y botón *"Recuperar aviso legítimo"*. Modal de gestión para cambiar entre los 5 estados (`RECIBIDO`, `VISTO`, `ASIGNADO`, `EN_CURSO`, `RESUELTO`), reasignar departamento, escribir nota al vecino, **subir foto de cierre del operario** (`resolved_photo_url`) o enviar a cuarentena.
   - **Pestaña 2 — APIs de IA, Backups y FAQ Sugeridas (0 Tokens):**
     - Gestión de proveedores (`GEMINI`, `GROQ`, `OPENAI`, `OPENROUTER`, `LOCAL`), edición de API Key, activar/desactivar y botón *"Probar conexión"*.
     - Matriz por funcionalidad (`CHAT`, `CLASSIFY`, `VISION`) con backups en cascada y `max_tokens`.
     - Bloque de **FAQ Sugeridas (0 Tokens)**: muestra preguntas frecuentes detectadas en consultas reales con botón **"Aprobar FAQ (1 clic)"** y listado de FAQs activas en caché.
   - **Pestaña 3 — Base de Conocimiento Oficial (RAG + Vigencia):**
     - Subida drag-and-drop de `.pdf`, `.txt`, `.md` **+ formulario para ingestar Texto o URL oficial** con selector de **Fecha de Vigencia** (`valid_until`).
     - Listado de documentos con badge `VIGENTE` / `DEROGADA`, fecha de vigencia, **contador de usos en respuestas (`usage_count`)**, botón **"Derogar / Reactivar (1 clic)"** y eliminar.
     - Buscador en directo *"Probar recuperación RAG (`pgvector`)"*.
   - **Pestaña 4 — Avisos por Calle y Ayudas:**
     - Crear alerta de corte/obra seleccionando calles afectadas -> muestra *"Notificado a X vecinos"*.
     - Crear nueva ayuda/descuento marcando requisitos -> muestra *"Compatible con X vecinos"*.
   - **Pestaña 5 — Mapa, Consultas y Analíticas:**
     - Tarjetas KPI, mapa interactivo Leaflet con marcadores por prioridad, gráficas Recharts (Categorías, Departamentos, Estados, Canales) y botón *"Reiniciar datos de demo"*.

**Criterios de salida (Verificar y DETENERSE):**
- `npx tsc --noEmit` y `npm run build` pasan sin errores.
- Iniciar sesión como `admin@lucainena.es` muestra exclusivamente datos de Lucainena; `admin@nijar.es` muestra exclusivamente datos de Níjar.
- Cambiar una incidencia por el ciclo de 5 estados hasta `'RESUELTO'` con foto de cierre notifica a todos los reportantes, y pulsar *"Sigue sin funcionar"* la reabre a `'EN_CURSO'`.
- Enviar un aviso a Cuarentena lo oculta del tablón público y *"Recuperar aviso legítimo"* lo restaura.
- Subir un documento o texto al RAG permite responder en `/asistente` incrementando `usage_count`, y pulsar *"Derogar"* evita que el RAG vuelva a citarlo.
- Aprobar una FAQ sugerida en `/admin` hace que `/asistente` responda esa pregunta con `FAQ_CACHE` (`0 tokens`).

---

### FASE 7: Escalado a Humano, Derecho al Olvido RGPD, Documentación, Despliegue en Vercel + Capacitor y Auditoría E2E

**Objetivo:** Completar las salvaguardas ciudadanas de la rúbrica oficial (derivación a agente humano y borrado RGPD), documentar y desplegar públicamente el proyecto, y verificar los flujos E2E sin errores.

**Tareas obligatorias:**
1. **Botón *"Hablar con una persona"* en `/asistente` (Escalado a Humano):**
   - Cuando el motor RAG no encuentre fragmentos vigentes relevantes (`usedRag === false` en una consulta que no sea saludo ni seguimiento `SOL-XXX`) o cuando el vecino pida hablar con un agente/persona, devolver `suggestHumanEscalation: true` en `lib/chat/service.ts`.
   - En `app/asistente/page.tsx`, mostrar una tarjeta cálida con el botón **"Hablar con una persona"** que invoca `POST /api/chat/escalate` (registra la consulta con `escalated_to_human = 1`, muestra el teléfono/horario de atención presencial del municipio activo y confirma que su solicitud ha quedado anotada para atención humana).
2. **Derecho al Olvido RGPD — Botón y Comando *"Borrar mis datos"*:**
   - Crear endpoint `DELETE /api/profile` que elimine de PostgreSQL las notificaciones (`user_notifications`), perfil (`citizen_profiles`), desvincule sus incidencias (`UPDATE incidents SET user_id = NULL WHERE user_id = $1`) y elimine la cuenta (`users`) del ciudadano autenticado, limpiando la cookie de sesión.
   - En `app/mi-perfil/page.tsx`, añadir bloque claro de privacidad con botón **"Borrar mis datos"** (con confirmación en 1 paso para evitar borrados accidentales).
   - En `lib/ai/tokenSaver.ts` (`detectZeroTokenIntent`), reconocer el comando `"borrar mis datos"` / `"eliminar mis datos"` en `0 tokens` indicando el enlace directo o confirmando el procedimiento inmediato de baja.
3. **Documentación Completa (`README.md`), Vercel y Capacitor:**
   - Actualizar `README.md` con: descripción de **AlmeríaCerca (Reto 02)**, arquitectura técnica (Next.js 14, Supabase PostgreSQL + `pgvector` HNSW, Router Multi-IA con fallback `LOCAL` y ahorro de tokens, Webhook Meta WhatsApp Cloud API), guía paso a paso de configuración (`.env.local`), tabla de usuarios demo (`Lucainena` y `Níjar`) y matriz de cumplimiento de la rúbrica oficial.
   - Crear configuración de empaquetado móvil opcional con **Capacitor** (`capacitor.config.ts`) apuntando a la app web responsive.
   - Verificar configuración de despliegue público en **Vercel** conectado al repositorio de **GitHub**.
4. **Auditoría E2E y Pulido Final Mobile/Desktop:**
   - Ejecutar verificación completa de los 4 flujos E2E (Ciudadano sin login, Perfil + Encuesta + Reapertura/Valoración + Borrado RGPD, Admin Multi-Municipio con 5 estados/Cuarentena/RAG Vigencia/FAQ Sugeridas, y WhatsApp Webhook).
   - Comprobar 0 errores de compilación (`npx tsc --noEmit` y `npm run build`) y diseño responsive limpio en `390x844` y escritorio.

**Criterios de salida (Entrega final):**
- 0 errores de compilación TypeScript y `npm run build` limpio.
- Todos los ítems del Checklist Final verificados.

---

## 4. CHECKLIST FINAL DE VERIFICACIÓN

- [x] Diseño estilo tablero Pinterest cálido (`#F7F1E5`), sin fondo blanco clínico ni botones amontonados.
- [x] Base de datos migrada a **PostgreSQL en Supabase + `pgvector`** (`embedding vector(768)` + índice HNSW `<=>` y respaldo textual `to_tsvector`).
- [x] Acceso básico completo sin iniciar sesión (Asistente, Incidencias, Seguimiento, Tablón).
- [x] Login ciudadano + Encuesta de hogar + Alertas automáticas por calle + Recomendador de ayudas/descuentos (`0 tokens`).
- [x] Login administrador aislado por municipio (multi-tenant).
- [ ] Ciclo de 5 estados en incidencias (`RECIBIDO`, `VISTO`, `ASIGNADO`, `EN_CURSO`, `RESUELTO`), foto de cierre del operario, valoración ciudadana, botón *"Sigue sin funcionar"* (reapertura) y agrupación de duplicados (`< 150m`) con escalado automático de prioridad (`BAJA` a `EMERGENCIA_112`) y notificación a todos los reportantes.
- [ ] Bandeja de Cuarentena / Spam en `/admin` con motivo registrado y recuperación de avisos legítimos.
- [ ] Base de Conocimiento en `/admin` con subida `.pdf`/`.txt`/`.md` o texto/URL oficial, estado de vigencia (`VIGENTE` / `DEROGADA`), contador de usos en respuestas y botón de derogar en 1 clic.
- [ ] Sección de "FAQ Sugeridas" en `/admin` aprobables en 1 clic para responder en `0 tokens`.
- [ ] Botón *"Hablar con una persona"* en `/asistente` cuando el RAG no tenga respaldo y botón/comando *"Borrar mis datos"* en `/mi-perfil`.
- [ ] `README.md` completo, configuración Capacitor y despliegue en Vercel conectado a GitHub.
