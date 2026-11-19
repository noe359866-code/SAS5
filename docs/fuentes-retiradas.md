# Fuentes retiradas

Registro de las fuentes que se quitaron del addon y por qué. Una fuente se
retira cuando, en las validaciones en vivo, **no publica ningún medio
utilizable**: ni un HLS ni un MP4 con audio en español o subtitulado. No basta
con que la web responda 200 ni con que la ficha exista.

## 19-11-2026: GnulaHD, VideoApp, PelisPlus, GnulaOne y Ultra

Se retiraron los módulos, sus pruebas y sus sondas. Cinco fuentes, cinco
motivos medidos con los 12 controles de `scripts/sites-live.js` (películas de
2024-2026 y series como *Breaking Bad* o *VisionQuest*):

| Fuente | Resultado | Motivo estructural |
|---|---|---|
| `gnulaone` (`ver.gnula.one`) | 0 de 12 | `series-needs-js` en las cinco series y `no-extractable-embed` en las películas: los visores se montan con JavaScript y el HTML no trae el medio. |
| `ultra` (`verpeliculasultra.com`) | 0 de 12 | `series-not-supported` y `no-extractable-embed`: solo fichas de películas y los enlaces aparecen tras un buscador DLE con POST. |
| `gnulahd` (`ww3.gnulahd.nu`) | 0 de 12 | `no-public-media` en 7 controles: la ficha verifica bien, pero no publica un HLS etiquetado con el audio. |
| `pelisplus` (`pelisplushd.la`) | 0 de 12 | `no-match` en 7 y `series-not-supported` en 5: el catálogo no cruza con los controles y no cubre series. |
| `videoapp` (`videoapp.zip`) | 0 de 12 | `audio-unverified` en las cinco fichas que sí resolvió: el iframe Vimeos no declara idioma, así que nunca se anunció como reproducible. PelisJuanita cubre el mismo player con la versión declarada. |

Para GnulaOne y Ultra había además 32 ejecuciones previas de la sonda sin un
solo resultado; el resto se midió en dos pasadas consecutivas.

### Cómo se comprobó

`scripts/sites-live.js` mide ahora los adaptadores de sitio **y** los
proveedores del registro con los mismos controles, y deja el resultado en
`.probe/sites-live.json`. Antes de retirar a VideoApp se le dio una segunda
oportunidad justa: los controles declaran su `tmdbId`, porque VideoApp solo
trabaja por ID de TMDB y sin ese dato se saltaba los doce controles
(`tmdb-or-episode-required`), lo que no medía nada.

### Fuentes que se quedan

Ocho, todas con resultados reales en la misma sonda: Fanpelis (3), SpinFlix
(4), TubeOnLine (2), MirandoGratis (2), Cuevana 3 (8), AnimeFLV (2), FuegoCine
(2-3) y PelisJuanita (8).

## Fuentes descartadas antes de integrarse

- `animeyt.cc`: 403 de Cloudflare en todo el sitio; solo `/feed/` responde.
- `animed23.com` y `animejara.com`: reto de Cloudflare que no se resuelve sin
  navegador.
- FlixLatam, PlayLatinSRC, AnimeOnlineNinja y Cuevana 3 antiguos: se retiraron
  por falta de una ruta de reproducción fiable; quedan sus informes en
  [flixlatam-cuevana.md](flixlatam-cuevana.md) y
  [playlatinsrc-2026-11-17.md](playlatinsrc-2026-11-17.md). Cuevana 3 volvió
  después con su API actual (`cuevanas3.pro`), que es otra implementación.
