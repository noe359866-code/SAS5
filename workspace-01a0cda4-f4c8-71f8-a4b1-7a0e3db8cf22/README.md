# 🎬 Torrents Español HD - Stremio Addon Serverless para Vercel & Supabase

Addon oficial y modular para **Stremio** construido en **Node.js** con el SDK oficial (`stremio-addon-sdk`), diseñado para ejecutarse de forma **100% gratuita y Serverless en Vercel**, consultando un catálogo de torrents en Español (Castellano, Latino, Dual y Subtitulado) alojado en **Supabase (PostgreSQL)**.

---

## 🌟 Características Principales

- ⚡ **100% Serverless & Gratuito en Vercel:** Sin servidores dedicados que mantener, escalado automático con 0 coste.
- 🗄️ **Integración Nativa con Supabase:** Utiliza `@supabase/supabase-js` para consultas rápidas optimizadas a la tabla `public.torrents`.
- 🌐 **Soporte CORS Universal:** Headers `Access-Control-Allow-Origin: *` configurados para Stremio Web, Desktop, Mobile y Android TV.
- 🎯 **Filtrado y Formato Inteligente:**
  - Soporta Películas (`movie`), Series (`series`) y Anime (`anime`).
  - Parseo automático de IDs simples (`tt0111161`) y compuestos (`tt0944947:1:5` -> temporada 1, episodio 5).
  - Encabezados claros en pantalla: `[ESP] 1080p`, `[LAT] 4K`, `[DUAL] 1080p`, `[SUB] 720p`.
  - Metadatos multilínea enriquecidos con códec, fuente, audio, subtítulos, tamaño legible en GB y número de semillas.
  - Inyección de trackers públicos de alta velocidad y soporte para `infoHash` o `magnetUrl`.
- 🚀 **Caché CDN Edge:** Cabeceras `Cache-Control` configuradas para evitar saturar tu cuota gratuita de Supabase.
- 🖥️ **Landing Page Interactiva:** Página web en la raíz (`/`) con botón de instalación en 1 clic (`stremio://`).

---

## 📁 Estructura del Proyecto

```text
├── api/
│   └── index.js             # Entrypoint Serverless para Vercel (Express + SDK Router + Landing)
├── lib/
│   ├── formatter.js         # Utilidades de detección de calidad, audio, tamaño e infoHash
│   └── supabase.js          # Inicialización del cliente Supabase con @supabase/supabase-js
├── test/
│   ├── test-suite.js        # Pruebas automatizadas (Manifest, Formateo, Endpoints HTTP, CORS)
│   └── test-supabase-mock.js# Prueba de integración con datos simulados de Supabase
├── .env.example             # Plantilla de variables de entorno
├── .gitignore               # Archivos excluidos del control de versiones
├── addon.js                 # Lógica del addonBuilder, Manifest y defineStreamHandler
├── package.json             # Dependencias del proyecto y scripts
├── server.js                # Servidor para desarrollo y pruebas en local
├── vercel.json              # Configuración de enrutamiento y cabeceras Serverless en Vercel
└── README.md                # Documentación completa y guía de despliegue
```

---

## ⚙️ Variables de Entorno

Crea un archivo `.env` en la raíz basándote en `.env.example`:

```env
# URL de tu proyecto en Supabase (Settings > API > Project URL)
SUPABASE_URL=https://tu-proyecto.supabase.co

# Clave Service Role (Recomendado para backend, omite políticas RLS en SELECT)
SUPABASE_SERVICE_ROLE_KEY=tu-service-role-key-secreta

# Clave Anon (Alternativa si tu tabla 'torrents' tiene RLS público de lectura)
SUPABASE_ANON_KEY=tu-anon-key-publica

# Puerto para desarrollo local (Opcional, por defecto 7000)
PORT=7000
```

---

## 🛠️ Ejecución y Pruebas en Local

### 1. Instalar dependencias
```bash
npm install
```

### 2. Configurar variables de entorno
```bash
cp .env.example .env
# Edita .env con tus credenciales de Supabase
```

### 3. Ejecutar suite de pruebas
El proyecto incluye pruebas automatizadas que verifican el Manifest, los formateadores de metadatos, los encabezados CORS y los endpoints HTTP:
```bash
npm test
```

### 4. Iniciar el servidor local
```bash
npm start
```

El servidor estará disponible en `http://localhost:7000`:
- **Landing Page:** `http://localhost:7000/`
- **Manifest:** `http://localhost:7000/manifest.json`
- **Prueba Stream Película:** `http://localhost:7000/stream/movie/tt0111161.json`
- **Prueba Stream Serie:** `http://localhost:7000/stream/series/tt0944947:1:1.json`
- **Instalación directa en Stremio:** `stremio://localhost:7000/manifest.json`

---

## 🚀 Despliegue en Vercel (Paso a Paso)

Vercel permite alojar este Addon de forma **100% gratuita** dentro de su plan Hobby.

### Paso 1: Subir el proyecto a GitHub
1. Crea un repositorio en tu cuenta de GitHub (público o privado).
2. Sube los archivos del proyecto:
   ```bash
   git init
   git add .
   git commit -m "feat: Addon Stremio Torrents Español para Vercel"
   git branch -M main
   git remote add origin https://github.com/tu-usuario/tu-repo-stremio.git
   git push -u origin main
   ```

### Paso 2: Importar en Vercel
1. Ingresa a [vercel.com](https://vercel.com) e inicia sesión con tu cuenta de GitHub.
2. Haz clic en **"Add New..."** > **"Project"**.
3. Selecciona el repositorio de GitHub que acabas de subir y pulsa **"Import"**.

### Paso 3: Configurar las Variables de Entorno en Vercel
Antes de hacer clic en Deploy, despliega la sección **"Environment Variables"** y añade:

| Variable | Valor | Descripción |
| :--- | :--- | :--- |
| `SUPABASE_URL` | `https://xxxx.supabase.co` | URL del proyecto Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJh...` | Clave secreta Service Role de Supabase |
| `NODE_ENV` | `production` | Modo de ejecución |

*(Nota: También puedes usar `SUPABASE_ANON_KEY` si tu base de datos tiene habilitada la lectura pública de la tabla `torrents`).*

### Paso 4: Desplegar
- Haz clic en **"Deploy"**.
- En unos 30-60 segundos, Vercel compilará la función Serverless y te asignará un subdominio público gratuito tipo:
  `https://tu-proyecto.vercel.app`

---

## 📺 Cómo Instalar el Addon en Stremio

Una vez desplegado en Vercel:

### Enlace Oficial del Manifest:
```text
https://tu-proyecto.vercel.app/manifest.json
```

### Método A: Instalación Automática (1 Clic)
1. Abre tu navegador y accede a `https://tu-proyecto.vercel.app`.
2. Haz clic en el botón morado **"🚀 Instalar en Stremio"**.
3. Tu navegador abrirá automáticamente la aplicación de Stremio solicitando confirmación para instalarlo.

### Método B: Instalación Manual en la App de Stremio
1. Abre **Stremio** en tu PC, móvil o Android TV.
2. Ve a la sección **Add-ons** (icono de pieza de rompecabezas 🧩).
3. En la barra de búsqueda superior, **pega la URL completa**:
   ```text
   https://tu-proyecto.vercel.app/manifest.json
   ```
4. Aparecerá el botón **"Instalar"** ("Install"). Haz clic y listo.

---

## 🗄️ Esquema de Datos Esperado (`public.torrents`)

El Addon realiza la consulta directamente a la tabla `torrents` utilizando el cliente oficial `@supabase/supabase-js`. El formateador del Addon es flexible y admite múltiples variantes de nombres de columnas:

```sql
-- Estructura de referencia (ya existente en tu base de datos):
CREATE TABLE IF NOT EXISTS public.torrents (
    id BIGSERIAL PRIMARY KEY,
    imdb_id VARCHAR(20) NOT NULL,            -- Ej: 'tt0111161'
    season INTEGER,                          -- NULL para películas, 1, 2... para series
    episode INTEGER,                         -- NULL para películas, 1, 2... para series
    title TEXT NOT NULL,                     -- Ej: 'El Padrino 1972 1080p BluRay'
    info_hash CHAR(40) NOT NULL,             -- Hash SHA-1 de 40 caracteres hex
    magnet_url TEXT,                         -- Opcional si hay info_hash
    seeders INTEGER DEFAULT 0,               -- Número de semillas activas
    size_bytes BIGINT,                       -- Tamaño en bytes (o columna 'size')
    resolution VARCHAR(20),                  -- Ej: '1080p', '4K', '720p'
    audio VARCHAR(100),                      -- Ej: 'Castellano AC3 5.1', 'Latino'
    subtitles VARCHAR(100),                  -- Ej: 'Español Forzados / Completos'
    codec VARCHAR(20),                       -- Ej: 'x264', 'x265'
    source VARCHAR(50),                      -- Ej: 'BluRay', 'WEB-DL'
    file_idx INTEGER                         -- Índice del archivo dentro del torrent
);

-- Índices recomendados para máxima velocidad de respuesta:
CREATE INDEX IF NOT EXISTS idx_torrents_imdb_movie ON public.torrents (imdb_id, seeders DESC);
CREATE INDEX IF NOT EXISTS idx_torrents_imdb_series ON public.torrents (imdb_id, season, episode, seeders DESC);
```

---

## 📄 Licencia

Este proyecto está bajo la licencia [MIT](LICENSE).
