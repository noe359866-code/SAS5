# Candidatas del 20-11-2026: seriesretro, seriesflix y documaniatv

Revisadas con el runner de GitHub Actions (`scripts/candidates-probe.mjs` y
`scripts/sites-probe.mjs`). **Ninguna se integra**: las tres cierran la puerta
antes de llegar al vídeo, cada una por un motivo distinto.

## `seriesretro.com` — el HTML del servidor no trae la sección de reproducción

Es WordPress y su estructura invita al optimismo: `/peliculas/<slug>` y
`/series/<slug>`, ficha con título, original, año, duración y sinopsis. Un
navegador doméstico ve incluso la lista de servidores («Opciones de
reproducción», con **vimeos.net**, que el addon ya resuelve).

El problema es que esa sección **no está en el HTML que recibe un servidor**:

| Petición | HTTP | Bytes | `data-post` | `vimeos` | `<iframe>` | `.m3u8` |
|---|---|---|---|---|---|---|
| UA normal | 200 | 31 921 | 0 | 0 | 0 | 0 |
| Cabeceras de navegador completas | 200 | 31 921 | 0 | 0 | 0 | 0 |

Mismo cuerpo byte a byte con y sin `sec-ch-ua`/`sec-fetch-*`, y sin rastro de
`#playeroptionsul`, `admin-ajax` ni `doo_player_ajax`: no hay players que pedir.
La página que sí los muestra se sirve a otras redes. Como el Worker también
consulta desde un centro de datos, en producción vería la versión sin
reproducción.

Si el sitio dejara de filtrar, el adaptador sería de los fáciles: es el patrón
Dooplay clásico (`<li data-post data-nume>` + `admin-ajax.php`), y el visor
declarado es Vimeos, que ya se resuelve sin abrir el manifiesto.

## `seriesflix.life` — SPA sin datos y buscador con challenge

La portada responde 200 (61 KB) pero es solo el armazón de la aplicación: sin
`__NEXT_DATA__`, sin `__NUXT__`, sin configuración embebida y sin un solo
`.m3u8`/`.mp4`. Los doce scripts son bundles propios y rastreadores; el bundle
principal (87 KB) no contiene `fetch(` ni rutas de API, así que los datos llegan
desde otro sitio que no se anuncia en el HTML.

Además, el buscador (`/search?q=…`) responde **403** con challenge de Cloudflare
desde el runner, y `/peliculas` y `/api` son 404. Sin buscador fiable no hay
forma de identificar la obra, y sin datos en el HTML no hay nada que publicar.

## `documaniatv.com` — 403 de Cloudflare

Documentales en español, con reproductor HTML5 propio en la ficha
(`/<categoría>/<slug>-video_<hash>.html`), que en principio sería lo más
publicable de las tres. Pero el runner recibe **403** en portada, en la ficha y
en la segunda ficha probada, con `cf-mitigated: challenge`, y añadir las
cabeceras de un navegador de escritorio no cambia nada (5 997 bytes de página de
desafío).

Es el mismo muro que ya dejó fuera a `animeyt.cc` y a `animed23.com`: resolverlo
exige ejecutar JavaScript, y el addon no lo hace. Aunque el cuerpo trae el
reproductor, no hay vídeo al que llegar.

## Resumen

| Sitio | Qué tenía a favor | Por qué no | Veredicto |
|---|---|---|---|
| `seriesretro.com` | WordPress, ficha limpia, visor Vimeos | la sección de reproducción no se sirve a un cliente de servidor | fuera |
| `seriesflix.life` | catálogo amplio | SPA sin datos en el HTML y buscador con 403 | fuera |
| `documaniatv.com` | reproductor HTML5 propio | 403 de Cloudflare en todo | fuera |

La sonda deja la puerta abierta: `node scripts/candidates-probe.mjs` vuelve a
medir las tres y escribe su tabla en `.probe/candidates.md`, dentro del workflow
**Sitios en vivo (sonda de descubrimiento)**.
