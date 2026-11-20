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

## Títulos que «no estaban» (medido el 20-11-2026)

La queja era concreta: películas que sí están en los sitios y el addon no
encontraba. El buscador crudo lo explicó (`.probe/movies-reach.md`):

| Consulta | Cuevana 3 | Allpelículas | LaMovie |
|---|---|---|---|
| `Intensa-Mente 2` (título de TMDB) | 0 resultados | 0 resultados | 0 resultados |
| `Intensamente 2` (sin guion) | `IntensaMente 2 (2024)` | idem | idem |

El buscador es un `LIKE` sobre el título **guardado**, y el guardado une las
palabras. Se corrigió en el camino común (`lib/providerTitles.js`), así que vale
para todas las fuentes que lo usan:

- la comparación de títulos ignora también los espacios («Intensa-Mente 2» ≡
  «IntensaMente 2», «Spider-Man» ≡ «Spiderman»);
- las consultas incluyen la forma pegada y la de signos en blanco, y las
  variantes del título pedido se prueban **antes** del título original;
- si la ficha no aparece en la primera página del buscador (18 resultados), se
  mira una página más: «El Origen» llena la primera con otros títulos que
  también lo llevan.

## Validación en vivo (20-11-2026)

`scripts/sites-live.js allpeliculas lamovie`, los 12 controles del addon
(`.probe/sites-live.md`): **8 de 12** en cada una, todos con `HLS` y audio
`Latino` verificado en el manifiesto.

| Control | Allpelículas | LaMovie |
|---|---|---|
| Spider-Man: Un nuevo día | HLS/Latino | HLS/Latino |
| Breaking Bad 1x1 | HLS/Latino | HLS/Latino |
| Alien: Romulus | HLS/Latino | HLS/Latino |
| Deadpool & Wolverine | HLS/Latino | HLS/Latino |
| El reino prohibido | HLS/Latino | HLS/Latino |
| Naruto 1x1 | HLS/Latino | HLS/Latino |
| La Odisea | HLS/Latino | HLS/Latino |
| VisionQuest | HLS/Latino | HLS/Latino |
| Inception, Inside Out 2, Ao Ashi 2, Black Clover 2 | `no-match` | `no-match` |

Los tiempos van de 1,1 s a 3,5 s por fuente y control.

### Son frentes del mismo catálogo que Cuevana 3

En los controles medidos, **Allpelículas, LaMovie y Cuevana 3 devuelven el
mismo HLS de Vimeos** (mismo identificador de la biblioteca; solo cambia el nodo
del CDN que responde). Es decir: no aportan obras nuevas, aportan **frentes
alternativos**. Se mantienen porque son baratas (tres peticiones por búsqueda),
porque sobreviven a la caída de un dominio y porque su índice de búsqueda no es
idéntico al de Cuevana 3. Quien prefiera el catálogo sin duplicados puede
desmarcarlas en `/configure`.

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
