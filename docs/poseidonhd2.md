# PoseidonHD 2 (`www.poseidonhd2.co`): medido y no integrado

Revisado el 20-11-2026 con `scripts/poseidonhd2-probe.mjs` desde el runner de
GitHub Actions. **No se añade al addon**: el sitio no publica ningún medio que
el addon pueda servir sin ejecutar JavaScript, y publicarlo daría listas vacías
en casi todos los títulos.

## Lo que sí tiene a favor

Es una aplicación Next.js y resuelve todo en el servidor: el HTML trae
`__NEXT_DATA__` con el JSON completo, así que se lee sin ejecutar JS.

| Paso | Ruta | Qué publica |
|---|---|---|
| Película | `/pelicula/<tmdb>/<slug>` | `pageProps.thisMovie` con `TMDbId`, títulos (`name` y `original`), `videos` y `downloads`. |
| Serie | `/serie/<tmdb>/<slug>` | `pageProps.serie` con `TMDbId` y temporadas. |
| Episodio | `/serie/<tmdb>/<slug>/temporada/<N>/episodio/<M>` | `pageProps.episode.videos`. |
| Buscador | `/search?q=<texto>` | SSR: `pageProps.movies[]` con `TMDbId` y `url.slug` (películas y series en la misma lista). |

Dos detalles muy cómodos: la identidad viene dada por el **ID de TMDb** —no hay
que comparar títulos— y el slug de la ficha se ignora, así que
`/pelicula/1368337/slug-inventado` devuelve la ficha correcta. Coste: una
petición por búsqueda, el más barato del registro.

`videos` agrupa por idioma (`latino`, `spanish`, `english`) y cada entrada es
`{cyberlocker, result, quality}`, donde `result` es un salto propio:
`https://player.poseidonhd2.co/player.php?h=<token>`.

## Lo que lo descarta

Ese salto acaba en visores que el addon ya clasifica como opacos. Medido sobre
una película, un episodio y una muestra de diez fichas de la portada:

| Visor | Destino real | Estado |
|---|---|---|
| voesx | `voe.sx/e/…` | opaque: muro JS de ~100 KB o 403 de Cloudflare |
| doodstream | `doodstream.com/e/…` | **403** de Cloudflare; el embed no trae `pass_md5` |
| streamwish | `streamwish.to/e/…` | opaque (`main.js` ofuscado) |
| vidhide | `vidhidepro.com/v/…` | opaque |
| vidara | `vidara.to/e/…` | JS |
| netu | `waaw.to/f/…` | JS |
| filemoon | `bysejikuar.com/e/…` | Byse está soportado, pero `fetch-error` con los tres `Referer` probados |
| streamtape | `streamtape.com/e/…` | soportado, pero `fetch-error` con los tres `Referer` probados |

Reparto en 91 opciones de vídeo de 10 fichas: voesx 18, doodstream 18,
streamwish 16, vidhide 18, vidara 18, filemoon 1, streamtape 2, netu 2.
**Cero medios directos**: ni un `.m3u8` ni un `.mp4` en el HTML, ni en
`downloads`, que son páginas de 1fichier, Doodstream y StreamWish.

En resumen: la única ruta compatible (Byse y Streamtape, 3 de 91 entradas) no
responde desde el runner, y el resto exige ejecutar JS o resolver un captcha de
Cloudflare. Añadir la fuente con estas condiciones repetiría el fallo de
FuegoCine y AnimeFLV —el adaptador «acierta» pero el usuario no ve nada—, solo
que esta vez sin arreglo posible.

## Si se quiere reintentar

`node scripts/poseidonhd2-probe.mjs` recorre buscador, ficha, episodio y
`player.php`, y vuelca su tabla en `.probe/poseidonhd2.md`. Se ejecuta en el
workflow **Sitios en vivo (sonda de descubrimiento)**. Si algún día algún visor
publica el medio en el HTML, la sonda lo dirá y el adaptador es fácil: una
petición a la ficha y `videos` ya viene con idioma y calidad.
