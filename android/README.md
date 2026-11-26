# StreamFlix Mobile — Plugin Edition (Nuvio `manifest.json`)

Aplicación Android **exclusiva para móvil (`APP_LAYOUT=mobile`)** basada en [StreamFlix Reborn](https://git.gay/streamflix-reborn2/streamflix), rediseñada sin ningún scraper ni extractor interno y equipada con un motor externo de plugins JavaScript compatible con la especificación **`manifest.json` de Nuvio**.

## Características principales

- **Solo móvil (`mobile`)**: sin dependencias Leanback ni vistas/actividades de Android TV.
- **Cero scrapers internos**: no contiene proveedores web integrados, extractores embebidos ni WebViews de bypass.
- **Catálogo TMDB multi-idioma**: portada, tendencias, búsqueda, fichas de películas/series, temporadas, reparto, tráilers, favoritos e historial de reproducción respaldados por TMDB (`es`, `en`, `it`, `fr`, `de`, `pt`).
- **Motor de plugins JS compatible con Nuvio (`QuickJS`)**:
  - Instalación de repositorios externos mediante URLs raw `manifest.json` (o URLs de repositorios GitHub `https://github.com/usuario/repo`) y enlaces profundos `streamflix://plugin?url=<manifest_url>`.
  - Ejecución aislada en `QuickJS` con soporte nativo para `fetch`, `axios` (`get`/`post`/`request`), `cheerio` (puente DOM respaldado por Jsoup), `CryptoJS` (`crypto-js` 4.2.0), `URL`, `URLSearchParams`, `atob`/`btoa`, `TextEncoder`/`TextDecoder`, `SCRAPER_ID`, `SCRAPER_SETTINGS` y `TMDB_API_KEY`.
  - Soporte completo en Media3/ExoPlayer para cabeceras HTTP personalizadas por enlace (`Referer`, `Origin`, `User-Agent`, `Cookie`, etc.), pistas de subtítulos externas devueltas por el plugin y detección automática HLS/DASH/MP4/MKV/WebM.
  - Gestión completa desde la pantalla **Plugins y Catálogo** (accesible desde el icono superior en Inicio o desde **Ajustes → Plugins externos (`manifest.json`)**): añadir, actualizar, activar/desactivar repositorios o scrapers individuales y eliminar repositorios.
- **Reproducción en un solo toque**: el usuario sólo pulsa **Ver ahora** / **Watch**; `StreamAutoSelector` ordena los streams del plugin y el reproductor abre el primero, encadenando el siguiente si falla. Orden automático:
  1. **Formato**: MP4 > MKV > WebM > HLS > DASH > endpoint directo sin extensión > página `/embed/` o `/e/` (siempre al final, porque ExoPlayer no la abre sin extractor). Se usa el MIME declarado por el plugin (`type`) y, si falta, la extensión/patrón de la URL.
  2. **Calidad**: 4K > 1080p > 720p > SD.
  3. **Idioma**: latino > castellano > subtitulado.
  4. **HTTPS** y hosts que ya funcionaron antes; los que fallan en la sesión se hunden al final.
  El encabezado del reproductor muestra lo elegido (`S2 E5 • Título • MP4 1080p · auto`). Elegir un servidor a mano en **Ajustes → Servidores** sigue disponible como override, pero nunca es obligatorio.

## Formato compatible de `manifest.json`

```json
{
  "name": "Mi Repositorio Nuvio",
  "version": "1.0.0",
  "description": "Scrapers externos en JS",
  "scrapers": [
    {
      "id": "ejemplo_hd",
      "name": "Ejemplo HD",
      "version": "1.0.0",
      "filename": "providers/ejemplo_hd.js",
      "supportedTypes": ["movie", "tv"],
      "enabled": true,
      "contentLanguage": ["es", "en"]
    }
  ]
}
```

Cada archivo `.js` exporta `getStreams(tmdbId, mediaType, season, episode)` mediante `module.exports = { getStreams }` o `globalThis.getStreams`:

```js
const cheerio = require('cheerio');
const CryptoJS = require('crypto-js');

async function getStreams(tmdbId, mediaType, season, episode) {
  // mediaType: "movie" o "tv"
  return [
    {
      name: "Servidor Principal",
      title: "1080p Latino",
      url: "https://cdn.ejemplo.com/master.m3u8",
      quality: "1080p",
      headers: {
        "Referer": "https://ejemplo.com/"
      },
      subtitles: [
        {
          url: "https://cdn.ejemplo.com/subs/es.vtt",
          label: "Español",
          lang: "es"
        }
      ]
    }
  ];
}

module.exports = { getStreams };
```

## Nota sobre el motor QuickJS

`quickjs-kt` guarda la referencia `JavaVM` en un estático nativo **global del proceso** que se borra en
cuanto se libera *cualquier* runtime (`clear_java_vm_cache()` en `releaseGlobals`). Si dos scrapers se
ejecutaban en paralelo, el runtime que terminaba primero invalidaba el de los demás: las llamadas
Kotlin (`fetch`, `cheerio`, `__capture_result`, ...) fallaban en silencio con
`Cannot get jni env because the vm is not cached.` y el scraper devolvía cero fuentes.

Por eso `PluginRuntime` serializa las sesiones QuickJS con un `Mutex` compartido
(`PluginRuntime.withQuickJsSession`): el `PluginManager` sigue lanzando los scrapers en corrutinas
paralelas, pero solo hay un runtime vivo a la vez. El *timeout* de cada scraper se aplica después de
obtener el turno, así que la espera en cola no consume su presupuesto.

## Compilación y pruebas

Desde el directorio `android/`:

```bash
# Ejecutar tests unitarios JVM (incluye QuickJS + MockWebServer + CryptoJS + Cheerio)
./gradlew :app:testDebugUnitTest

# Generar APKs Debug y Release firmados
./gradlew :app:assembleDebug :app:assembleRelease
```

También se compila automáticamente en GitHub Actions mediante `.github/workflows/build-mobile-apk.yml`, publicando el artefacto `streamflix-mobile-plugins-apks` con los APK listos para instalar en Android móvil.
