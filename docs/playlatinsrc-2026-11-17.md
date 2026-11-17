# PlayLatinSRC como proveedor de streams — 17/11/2026

Integración del sitio **<https://playlatinsrc.co>** como 15.º proveedor de streams del addon,
con el mismo alcance que el PR de las fuentes hispanas (código, tests, sonda, CI y docs).

| | |
|---|---|
| Módulo | `lib/playlatin.js` |
| Registro | `lib/streams.js` → `PROVIDERS` / `SEARCHERS` (15 proveedores) |
| Configuración | `PLAYLATIN` (`on`/`off`), `PLAYLATIN_URL` |
| Tests | `test/playlatin.test.js` (11 casos offline) |
| Sonda | `npm run playlatin:check` (`scripts/playlatin-check.mjs`) |
| CI | paso estricto en `.github/workflows/providers.yml` |

---

## 1. Por qué este proveedor y no otro

PlayLatinSRC declara **21.615 películas, 290 series y 11.568 episodios**, con tres versiones
(Latino, Castellano y Subtitulado) servidas desde el mismo embed. Lo decisivo para el addon es
cómo identifica el contenido:

| Fuente hispana | Identifica por | ¿Necesita clave? | ¿PoW? |
|---|---|---|---|
| **PlayLatinSRC** | **IMDb id** | No | No |
| VideoAPI | TMDB id | No | No |
| Fanpelis | texto (título traducido) | No | No |
| Embed69 | IMDb id | No | **Sí** (~9 s de SHA-256) |

Es la única de las cuatro que funciona **solo con el IMDb que manda Stremio**: VideoAPI se salta
la petición cuando TMDB no responde, Fanpelis depende de acertar el título traducido y Embed69
no cabe en el plan Free. Cuando TMDB falla, este proveedor es la única fuente hispana que sigue
teniendo con qué preguntar.

## 2. Contrato real del sitio (verificado, nov-2026)

1. `GET /custom/movie/{imdb}` o `GET /custom/serial/{imdb}/{temporada}/{episodio}` devuelve una
   **cáscara** (no los enlaces): un `.player-shell` con
   `data-id`, `data-type`, `data-season`, `data-episode`, `data-mode` y `data-resolve-token`.
2. `POST /api/resolve` con `{type, id, season, episode, mode, token}` **en el cuerpo** devuelve
   `{ok, title, type, id, imdb_id, sources:[{id,name,url,version,kind,embed,proxy_url}]}`.
3. `kind` es `mp4`, `hls` o `embed`. Los dos primeros se reproducen directos; el tercero es un
   iframe de Dropload, Doodstream, Mixdrop o «Otra fuente (UnlimPlay)».

Comprobaciones hechas contra el servicio en vivo:

| Petición | Respuesta |
|---|---|
| `GET /api/resolve` sin parámetros | `{"ok":false,"error":"missing_id"}` |
| `POST /api/resolve` sin token válido | `{"ok":false,"error":"invalid_token","message":"Missing or expired resolve token — load the embed page first."}` |
| `GET /custom/movie/tt0110357` (El rey león) | cáscara + token (el resolve sí devuelve fuentes, ver §4) |
| `GET /custom/serial/tt0108778/1/2` (Friends) | cáscara + selector de versiones |

**Conclusión del contrato:** el token es obligatorio y caduca con la sesión del reproductor. Sin
la página previa no hay forma de resolver, y por eso la sonda va página → token → resolve, no
directa al endpoint.

## 3. Cómo está implementado

`lib/playlatin.js` sigue el contrato de los demás buscadores (`{ hits }` o `{ skipped }`), así que
`lib/streams.js` lo trata como uno más (`SEARCHERS.playlatin`) y hereda paralelismo, timeout,
caché, pausa por fallos y los filtros de `/configure`.

- **`pagePath(resolved)`** — `/custom/movie/tt…` o `/custom/serial/tt…/s/e`. Sin IMDb válido o
  sin temporada/episodio devuelve `null` (y el buscador se salta, no falla).
- **`parseShell(html)`** — lee los `data-*` aceptando comillas dobles o simples. `ok` exige
  **token e id**: sin ambos se asume título fuera de catálogo o captcha, y se devuelven 0
  streams sin marcar el proveedor como caído.
- **`normalizeSources(payload)`** — solo `https`, sin duplicados, `kind ∈ {mp4,hls,embed}`, tope
  de 4 servidores por título (el mismo enlace en tres idiomas ya son tres entradas).
- **Hits** — `{provider:'playlatin', url, audioLabel: Latino|Castellano|Subtitulado, server,
  quality:'HLS'|'Embed', referer:'{base}/', relevant:true}`. `toStream` los entrega con
  `notWebReady` y `behaviorHints.proxyHeaders.request.Referer`, porque los hosts validan
  `Referer`.
- **Token** — viaja de la página al resolve dentro de la misma invocación. **No se guarda, no se
  cachea y no se reenvía** a terceros.
- **Caché** — 30 min por ruta (`playlatin:servers:{path}`): corto a propósito, porque los
  enlaces caducan con la sesión del reproductor.
- **Un solo `fetch` extra en `lib/http.js`** — `request()` aceptó `method`/`body` opcionales para
  el POST del resolve. Sin `body`, todas las demás llamadas siguen siendo GET.

## 4. Verificación

- `npm test` → **343/343**. Los 11 casos nuevos cubren rutas, `parseShell` (con y sin token,
  comillas simples), normalización de fuentes, película y episodio de punta a punta con
  `mockFetch`, que el token **no** aparezca en la URL, `ok:false`, `PLAYLATIN=off` y el stream
  final con `proxyHeaders`.
- `npm run playlatin:check -- --imdb tt0110357 --series tt0108778 --season 1 --episode 1 --stream`
  → sonda con el código de producción. Sale con código 1 si la página, el resolve o los enlaces
  fallan; es el paso **estricto** de la CI.
- `npm run providers:check` incorpora ahora una línea `playlatin (página → resolve por IMDb)`
  junto a las demás fuentes hispanas.
- `npx wrangler deploy --dry-run` → 778,86 KiB / 229,87 KiB gzip, dentro del límite del plan Free.

### 4.1. Ejecución real en la CI del PR #26

El workflow `probe` (run `44160555886`) ejecutó el paso **estricto** con el código de producción y
salió en verde:

```
✔ película tt0110357 · /custom/movie/tt0110357
    4 stream(s) · Latino, Castellano · embed
    hosts: Dropload, Doodstream, Mixdrop
    resolve ok=true · sources=9
✔ serie tt0108778 S1E1 · /custom/serial/tt0108778/1/1
    2 stream(s) · Latino · embed
    hosts: Dropload, Doodstream
✔ buscador del addon · 4 hit(s) en 549 ms
    idiomas: Latino, Castellano · referer: true
```

Ambos runs (`44160555886` y `44161234325`) salieron en verde con el paso estricto ya incluido.

Y la sonda agregada `providers-check` añadió su línea:

```
✔ playlatin (página → resolve por IMDb) (899 ms)
    4 resultados · consulta playlatin tt0133093
```

Eso confirma de punta a punta el contrato: página con token → resolve con `sources` → hit con
`audioLabel` y `Referer`. La vista renderizada del sitio en un navegador puede mostrar «Playback
unavailable» (el reproductor necesita su propio JS); el addon no depende de eso.

## 5. Límites conocidos

- **El catálogo no es completo.** Un título que no esté indexado devuelve una página sin token y
  el proveedor responde 0 streams en silencio (correcto: no es una caída). `tt0110357` sí estaba
  en el catálogo cuando lo comprobó la CI, así que la cobertura cambia a diario.
- **Las series tienen una sola versión de idioma** (así lo indica el propio sitio), a diferencia
  de las películas.
- **Los enlaces de los hosts caducan.** De ahí el TTL de 30 min y el `notWebReady`.
- **No sustituye a un debrid**: son embeds, no archivos, y no se puede elegir calidad.
