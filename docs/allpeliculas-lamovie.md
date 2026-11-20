# Allpelículas y LaMovie

Dos fuentes nuevas del **mismo CMS que Cuevana 3**, con API JSON propia y el
visor de Vimeos. Se añadieron el 20-11-2026 después de medir la cadena completa
desde el runner de GitHub Actions, que es el mismo tipo de cliente que el
Worker.

| Clave | Sitio | API | Dialecto |
|---|---|---|---|
| `allpeliculas` | `allpeliculas.la` | `/wp-api/v1` | `wpa` |
| `lamovie` | `lamovie.org` | `/wp-api/v1` | `wpa` |

## Cómo se llegó a ellas

El complemento latino de Nuvio (`Droydr13/pluggin-latino`) publica un proveedor
por sitio. Leyendo sus módulos salieron las APIs que no dependen de ejecutar
JavaScript ni de resolver captchas, y se probaron desde el runner:

| Sitio | Buscar | Reproductor | Visor | Resultado |
|---|---|---|---|---|
| `allpeliculas.la` | `/wp-api/v1/search` 200 | `/player?postId=` 200, `embeds=1`, `lang=Latino` | `vimeos.net` | HLS ✓ |
| `lamovie.org` | idem 200 | idem 200, `lang=latino` | `vimeos.net` | HLS ✓ |
| `allcalidad.re` | `/api/rest/search` 200 | `/api/rest/player?post_id=` 200, `lang=latino - inglés` | `vimeos.net` | HLS ✓ (solo películas medidas) |
| `hackstore2.com` | `/api/rest/single` 200 | `/api/rest/player` 200 | `vimeos.net` | HLS ✓ |
| `embed69.org` | por IMDb `/f/<tt>` | — | — | captcha (Anubis): descartado |
| `pelisgo.online`, `sololatino.net`, `vitaminagg.vip` | 403 | — | — | challenge: descartados |
| `tioplus.app` | 521 | — | — | caído |
| `cinecalidad.vg`, `seriesmetro.net`, `gnula.life`, `cuevans3.eu` | HTML con solo el tráiler | — | — | sin visor en el HTML |

Medición: `.probe/candidates2.md`, `.probe/candidates3.md` y
`.probe/vimeos-chain.md`.

## Qué publican

La API entrega el embed ya resuelto, con idioma y calidad declarados:

```json
{ "data": { "embeds": [{ "url": "https://vimeos.net/embed-….html",
                          "lang": "Latino", "quality": "Full HD" }] } }
```

En series el embed trae además `season` y `episode`, así que la identidad no se
adivina por el slug: se compara con el episodio pedido y se descarta el resto.
El HLS sale del propio embed de Vimeos con `lib/vimeos.js`, el mismo camino que
Cuevana 3, AnimeFLV, Fanpelis y PelisJuanita; el manifiesto no se abre para
anunciarlo.

Cadena medida con *The Pitt* 1x1 el 20-11-2026 (`.probe/vimeos-chain.md`):

| Paso | Allpelículas | LaMovie |
|---|---|---|
| buscar (`the pitt`) | 200 · `tvshows:25427` | 200 · `tvshows:17925` |
| episodios T1 | 15 · 1x1 `25434` | 15 · 1x1 `17928` |
| player | 1 embed · `vimeos.net` · Latino · Full HD | 1 embed · `vimeos.net` · latino · Full HD |
| Vimeos resuelto | HLS ✓ · 503 ms | HLS ✓ · 449 ms |

## Qué se dejó fuera y por qué

- **`lamovie.cc`** es el espejo de LaMovie: no respondió dentro del plazo
  (`AbortError`) en dos pasadas, así que no se registra.
- **`allcalidad.re`** y **`hackstore2.com`** resuelven igual de bien, pero solo
  se midió su rama de películas (`/api/rest/episodes` no está confirmada). Se
  quedan documentados en `.probe/calidad-chain.md`; el dialecto `rest` ya está
  implementado en `lib/sites/vimeosJson.js` por si se confirma la de series.
- **`embed69.org`** sería la pieza más valiosa (se direcciona por IMDb, sin
  buscador), pero responde con un desafío de Anubis: sin ejecutar JavaScript no
  hay medio.

## Estructura

`lib/sites/vimeosJson.js` contiene el camino común: identidad por título y año,
episodio por temporada y número, embeds con audio declarado, salto intermedio
opcional, resolución de Vimeos y caché por visor. `lib/sites/cuevanas3.js`,
`lib/sites/allpeliculas.js` y `lib/sites/lamovie.js` son instancias que solo
declaran su base, su API y el dialecto; Cuevana 3 conserva sus nombres
exportados para las pruebas y `scripts/sites-live.js`.
