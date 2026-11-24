# Proveedores nuevos del 24-11-2026: HackStore y AllCalidad

Dos fuentes nuevas entraron en el registro: `hackstore` (`hackstore.mx`) y
`allcalidad` (`allcalidad.re`). Ambas usan el camino común de
`lib/sites/vimeosJson.js`: una API JSON que declara idioma, calidad y
temporada/episodio, y un embed de Vimeos que el addon ya resuelve sin abrir el
manifiesto. Con ellas el registro pasa a **doce fuentes** (las diez que ya
había, incluida `videoapi`, más estas dos).

La medición la hizo `scripts/candidates4-probe.mjs` en GitHub Actions con los
tres controles habituales de `scripts/sites-live.js`. La sonda **llama al código
del addon**, no solo a `curl`: construye un proveedor con `createVimeosJsonProvider`
y recorre búsqueda → ficha → episodio → reproductor → embed → HLS con el mismo
presupuesto de peticiones que en producción. No descarga segmentos ni imprime
URLs firmadas. El resultado íntegro está en `.probe/candidates4.md`.

| Control | HackStore | AllCalidad |
|---|---|---|
| *La Odisea* (2026) | 2 HLS / Latino | 2 HLS / Latino |
| *The Pitt* 1x01 | 2 HLS / Latino | 2 HLS / Latino |
| *Breaking Bad* 1x01 | 2 HLS / Latino | 2 HLS / Latino |

Los seis controles devuelven `hits` reales. El detalle de hosts (`s1.vimeos.net`,
`p7.vimeos.zip`, `p3.vimeos.zip`…) cambia entre pasadas porque Vimeos reparte
sus manifiestos entre CDN; el addon deduplica URLs y descarta las firmas vencidas.

## `hackstore.mx` (clave `hackstore`)

El dominio antiguo del proyecto (`hackstore2.com`) ya no sirve la API. El
actual publica la misma familia `/wp-api/v1` que Cuevana 3, Allpelículas y
LaMovie:

```text
GET /wp-api/v1/search?q=<título>&page=1&postType=any&postsPerPage=18
  → { data: { posts: [{ _id: 76899, title: "La Odisea (2026)", type: "movies" }] } }

GET /wp-api/v1/single/episodes/list?_id=<serie>&season=<n>&page=1&postsPerPage=50
  → { data: { posts: [{ _id: 62238, season_number: 1, episode_number: 1 }] } }

GET /wp-api/v1/player?postId=<id>
  → { data: { embeds: [{ url: "https://vimeos.net/embed-….html",
                          lang: "Latino", season: 1, episode: 1 }] } }
```

El adaptador es una instancia del dialecto `wpa` con su propia base. El embed
trae temporada y episodio, así que una ficha de otro capítulo se descarta sin
abrirla. No hace falta ejecutar JavaScript ni resolver desafíos.

## `allcalidad.re` (clave `allcalidad`)

Usa la variante `/api/rest`, con tres diferencias frente al dialecto `wpa`:

- el buscador pide `post_type=movies` o `post_type=tvshows` en la consulta;
- `/episodes?post_id=…` devuelve **un array directo** dentro de `data`, no
  `{ posts: [...] }`;
- `/player?post_id=…&_any=1` usa `post_id` en snake_case.

```text
GET /api/rest/search?post_type=tvshows&query=the%20pitt&page=1&posts_per_page=24
  → { data: { posts: [{ _id: 27051, title: "The Pitt (2025)", type: "tvshows" }] } }

GET /api/rest/episodes?post_id=27051&page=1
  → { data: [{ _id: 27053, season_number: 1, episode_number: 1 }] }

GET /api/rest/player?post_id=27053&_any=1
  → { data: { embeds: [{ url: "https://vimeos.net/embed-….html",
                          lang: "latino", quality: "Full HD" }] } }
```

`lib/sites/vimeosJson.js` acepta ahora las dos formas de lista de episodios;
antes solo leía `data.posts` y esta fuente habría terminado siempre en
`no-episode`. El etiquetado de audio («latino», «latino - inglés») pasa por
`audioOf`, que publica `Latino` cuando el doblaje español está presente.

## Candidatas medidas pero no integradas

### `allcalidad.cc` — cadena válida, catálogo duplicado

La misma marca en otro dominio responde con una API distinta
(`/api/rest/v1/search` → `/content/<movie|serie>/<slug>` → `player_url` →
`videoapp.mov` → iframe de Vimeos). La sonda encontró HLS de Vimeos para *La
Odisea*, así que **es integrable**. No se añade ahora porque su catálogo y su
visor son los mismos que los de `allcalidad.re`: una tercera instancia no
aportaría obras nuevas y sí una petición más por búsqueda. Se puede activar
después si `allcalidad.re` cae o si sus catálogos divergen.

### `cinemitas.org` — ficha sin servidores para un cliente de servidor

El buscador Dooplay (`/?dooplay=search&post_type=movies&s=…`) sí devuelve
fichas, y un navegador ve hasta nueve opciones etiquetadas («LATINO HD»,
«CASTELLANO», «SUBTITULADO») con visores que el addon ya sabe resolver (Cvid).
Pero el HTML que recibe el runner no trae esa sección:

| Paso | HTTP | Resultado |
|---|---|---|
| buscador | 200 | fichas de *La Odisea*, *Encantada*… |
| ficha | 200 | `data-post=0`, `doo_player=false`, `cvid=false` |

Es el mismo fallo que dejó fuera a `seriesretro.com` ([informe](candidatas-2026-11-20.md)):
sin `data-post` no hay petición `admin-ajax.php` que hacer, y el addon no
ejecuta el JavaScript que monta la lista. La puerta queda abierta si el sitio
empieza a servir la sección en el HTML del servidor.

## Cómo repetir la medición

```sh
node scripts/candidates4-probe.mjs   # escribe .probe/candidates4.md
node --test test/newProviders.test.js
npm test
```

El workflow **Candidatas 4** ejecuta la sonda sola (unos 20 segundos) y devuelve
el resumen a la rama. La sonda de descubrimiento mayor la incluye también entre
sus pasos, pero comparte los diez minutos de límite con todas las demás.
