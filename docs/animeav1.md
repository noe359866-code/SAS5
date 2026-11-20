# AnimeAV1: anime con latino y subtitulado

Hasta el 20-11-2026 el addon tenía **una** fuente de anime, `animeflv.or.at`, y
solo subtitulada. AnimeAV1 (`animeav1.com`) publica las dos versiones y las
declara por separado, así que entra como séptima… y como la primera fuente de
anime **con doblaje latino**.

## Cómo se encontró

Los sitios de anime se buscaron en los complementos latinos de Nuvio
(`Droydr13/pluggin-latino`), que traen un proveedor por sitio. Se probaron once
desde el runner y se descartaron nueve antes de escribir código:

| Sitio | Resultado | Motivo |
|---|---|---|
| `jkanime.net` | 403 | challenge de Cloudflare en portada y buscador |
| `katanime.net` | 403 | idem |
| `anime-jl.net` | 403 | idem |
| `henaojara.com` | error de red | el dominio no resuelve |
| `monoschinos.st` | 200, 7 visores | Filemoon, Doodstream, Voe, MP4Upload y Ok.ru: todos opacos o sin soporte |
| `latanime.org` | 200, 9 visores | Filemoon, DSVPlay, Mega, Uqload y Luluvid: ninguno extraíble |
| `tioanime.com` | 200, buscador vacío | `/api/search` no devuelve nada al runner y el slug directo da 404 |
| `donghualife.com`, `danimados.cc` | 200 | sin fichas enlazadas en el HTML que se sirve al runner |
| `animeav1.com` | **200, 17 visores** | el visor propio entrega HLS; único con audio declarado por grupo |

Medición: `.probe/anime-candidates.md`, `.probe/anime-players.md` y
`.probe/anime-players2.md`.

## Cómo funciona

| Paso | Petición | Qué devuelve |
|---|---|---|
| buscador | `GET /catalogo?search=<término>` | `<article>` con `<h3>` (nombre), portada con `alt`, enlace `/media/<slug>`. **Filtra** de verdad (5 fichas para «solo leveling») |
| ficha | `GET /media/<slug>` | `<h1>` con el nombre y los episodios como `/media/<slug>/<n>` (12 en la ficha medida) |
| episodio | `GET /media/<slug>/<n>` | JS con `embeds:{SUB:[…],DUB:[…]}` y, aparte, `downloads` |
| visor | `GET player.zilla-networks.com/m3u8/<hex>` | manifiesto HLS (`application/x-mpegURL`, ~14 KB) |

El visor propio se anuncia como `/play/<hex>`, una SPA de 1006 bytes que **no**
trae el manifiesto en el HTML. El mismo host sirve el medio en `/m3u8/<hex>`, así
que el adaptador reescribe la ruta y **comprueba** que responda `#EXTM3U` antes
de anunciarla; si no, pasa al siguiente visor. La comprobación lee el manifiesto
entero (hasta 256 KB): con un tope de 2 KB la lectura moría en «Respuesta
demasiado grande» y el visor propio se descartaba en vivo aunque la ruta fuese
la buena (medido el 20-11-2026; lo detectó `scripts/animeav1-debug.mjs`).

Reparto de visores en el episodio 1 medido: propio (HLS), UPNShare, Voe, Byse,
YourUpload, MP4Upload, VidHide y StreamTape, cada uno en SUB y en DUB. Se
ordenan por lo que el addon puede reproducir: primero el propio, después los
extraíbles (Byse, StreamTape) y al final los opacos, que se cuentan y no se
abren. Los `downloads` (Mega, 1Fichier, TransferIt) no cuentan como visores.

### Identidad y temporadas

El sitio abre **una ficha por temporada** (`…-season-2`). Como el `h1` no
siempre dice la temporada, el adaptador mira el slug: si pide la temporada 1 y
la ficha es `-season-2`, la descarta, y al revés. El `h1` se compara con las
variantes de título («Season 2», «2nd Season», «Temporada 2»…), las mismas que
usa AnimeFLV.

### Idioma

`DUB` → `Latino` (o `Castellano` si el visor lo dice) y `SUB` → `Subtitulado`.
Son etiquetas independientes en `lib/streamChoices.js`: la entrada latina cuenta
como `lat` y la subtitulada como `sub`, no como doblaje.

## Estado

- Pruebas: `test/animeav1.test.js`, 14 casos con HTML real capturado
  (`test/fixtures/sites/animeav1-*.html`); dos de ellos reproducen fallos
  medidos en vivo: el tope de lectura del manifiesto y el gasto inútil en
  visores de terceros cuando el propio ya sirve SUB y DUB.
- Medición del adaptador en vivo (`.probe/sites-live.md`, 20-11-2026, 12
  controles): **Naruto → 2 pistas HLS** («Latino» y «Subtitulado») en 2,1 s;
  **Ao Ashi Season 2 → «Subtitulado»** en 10,6 s; los controles que no son
  anime → `no-match`. La única que se le escapa entre los títulos de anime es
  *Black Clover 2nd Season* (`no-match`).
- Depuración paso a paso (`.probe/animeav1-debug.md`): el manifiesto propio
  llega en 378 ms (14 352 B, `#EXTM3U`, `#EXT-X-VERSION:7`), y el recorrido
  completo del adaptador tarda 1,5 s con 2 hits.
- Las dos correcciones salieron de esa depuración: (a) la comprobación del
  manifiesto se hacía con un tope de 2 KB y moría en «Respuesta demasiado
  grande», así que el visor propio se descartaba y la fuente daba 0 aciertos;
  (b) el presupuesto era por petición, no global, y se seguía abriendo visores
  opacos después de tener SUB y DUB: Naruto acababa en `probe-timeout`.
