# Enlaces propios en Supabase (`public.video_host_links`)

La fuente `supabase` publica en Stremio los enlaces que el proyecto guarda a mano
para títulos que los sitios rastreados no tienen: Mixdrop, Filemoon, Vihidrive y
demás anfitriones de la tabla `public.video_host_links`.

## Cómo funciona

```
Stremio ──/stream/movie/tt0133093.json──▶ lib/streams.js
                                           │ resolveTitle() → imdbId, tmdbId, temporada, episodio
                                           ▼
                                 lib/siteSupabase.js  ← fuente `supabase`
                                           │ findLinks(): PostgREST, 1–2 consultas
                                           ▼
                                 public.video_host_links
                                           │ por fila: embed_url
                                           ▼
                                 lib/hostExtractors.js  → .m3u8 / .mp4
                                           │
                                           ▼
                                 stream directo para Stremio
```

- **Se guarda el embed, no el manifiesto.** La URL del `.m3u8`/`.mp4` de estos
  anfitriones va firmada y caduca en horas; el `embed_url` es estable durante
  meses. El medio se extrae en la petición y se cachea 10 minutos
  (`lib/cache.js`), así que dos usuarios que piden el mismo título lo extraen una
  vez por ventana.
- **Solo medios directos.** Igual que el resto del addon: nunca se publica un
  iframe. Si el anfitrión no tiene extractor y el `embed_url` tampoco es ya un
  `.m3u8`/`.mp4`, la fila se descarta (`unsupported-host`).
- **El idioma sale de la columna `language`.** Si está vacía se publica «Latino
  (sin verificar)»: el addon es de español latino, pero no se inventa un
  doblaje. Un `language` = `Subtitulado` pasa el filtro como audio original con
  subtítulos, igual que en AnimeFLV.

## Extractores de anfitriones

| `host_code` | Peticiones | Método |
|---|---:|---|
| `mixdrop` | 1 | packer Dean Edwards → `MDCore.wurl` / `furl` |
| `filemoon` | 1 (+2 de respaldo) | `sources: [{ file: "…m3u8" }]` en el HTML del embed; si no está, `/playlist/<id>`, `/api/source/<id>` |
| `vihidrive` | 1 (+2 de respaldo) | igual que Filemoon, con `/api/source/<id>` primero |
| `streamtape` | 2 | `robotlink` + `/get_video?id=…&dl=1` (extractor compartido con los sitios) |
| `byse` | 1 | API JSON + AES-256-GCM (extractor compartido) |
| otro | 0 | se publica solo si `embed_url` ya es `.m3u8`/`.mp4`; si no, se descarta |

Se reconocen los cambios de dominio habituales (`mxdrop.*`, `vihi.*`,
`filemoon2.*`…). Para añadir un anfitrión: una entrada en `FAMILIES` y su
extractor en `EXTRACTORS` (`lib/hostExtractors.js`), más una prueba en
`test/supabase.test.js`.

## Configuración

| Variable | Uso |
|---|---|
| `SUPABASE_URL` | `https://<ref>.supabase.co`, sin barra final |
| `SUPABASE_ANON_KEY` | clave pública; respeta RLS. Suficiente para leer |
| `SUPABASE_SERVICE_ROLE_KEY` | opcional; **secreta**. Tiene prioridad y permite marcar enlaces roto |
| `SUPABASE_ENABLED` | `off` apaga la fuente sin borrar las claves |

Local: `.env` (Node) o `.dev.vars` (Wrangler). Producción: `wrangler secret put
SUPABASE_URL`, `wrangler secret put SUPABASE_ANON_KEY` y, si se quiere escritura,
`wrangler secret put SUPABASE_SERVICE_ROLE_KEY`. La `service_role` nunca va en
`wrangler.toml` ni en el navegador: salta RLS por completo.

Sin credenciales la fuente no se anuncia: no aparece en `/configure` ni en la
lista de `/healthz`, y no se hace ninguna petición.

## RLS recomendada

Con `anon` la tabla debe ser **legible** y **no escribible** (incluido
`fail_count`). Con `service_role` se escribe solo el estado del enlace.

```sql
alter table public.video_host_links enable row level security;

-- Lectura pública de lo que funciona: es lo único que necesita el addon.
create policy video_host_links_read on public.video_host_links
  for select to anon, authenticated
  using (is_working = true);

-- El addon no necesita INSERT/UPDATE con anon. El importador usa service_role.
```

Con esa política, `findLinks` (que ya filtra `is_working=eq.true`) funciona y el
PATCH del addon falla en silencio si solo hay `anon` (no rompe la búsqueda).

## Marcar enlaces roto

Cuando el extractor confirma que el archivo ya no está (`no-source`,
`unsupported-host`, `invalid-url`) y hay `service_role`, se hace un `PATCH`:

```json
{
  "is_working": false,
  "fail_count": 1,
  "last_error": "no-source",
  "last_checked_at": "2026-11-21T00:00:00.000Z"
}
```

No se marca nada por un 429, un 5xx ni un plazo agotado: eso es transitorio y lo
gestiona la pausa de fuentes del pipeline (`STREAM_PROVIDER_COOLDOWN_SECONDS`).

## Consultas que hace el addon

Una sola clave por consulta, para que PostgREST use el índice parcial:

```
GET /rest/v1/video_host_links
  ?select=id,imdb_id,tmdb_id,media_type,season,episode,host_code,embed_url,
          host_file_id,extractor_type,quality,language,server_label,is_working
  &is_working=eq.true
  &media_type=eq.movie
  &imdb_id=eq.tt0133093
  &season=is.null&episode=is.null
  &order=host_code.asc&limit=40
```

- Película: `season`/`episode` en `is.null` (la restricción
  `chk_season_episode_by_type` ya lo garantiza; se pide explícitamente).
- Serie: `media_type=eq.series`, `season=eq.<S>`, `episode=eq.<E>`.
- Si la consulta por `imdb_id` no devuelve filas, se repite por `tmdb_id` (no en
  un `or=`, que descartaría ambos índices).
- La clave va en las cabeceras `apikey`/`Authorization`, nunca en la URL; los
  errores no reenvían el cuerpo de PostgREST ni la clave.

## Cargar enlaces

```sql
-- Película: 1080p latino en Mixdrop
insert into public.video_host_links (imdb_id, tmdb_id, media_type, host_code, embed_url, quality, language)
values ('tt0133093', 603, 'movie', 'mixdrop', 'https://mixdrop.co/e/abcd1234', '1080p', 'Latino');

-- Capítulo: T1E2 en Filemoon
insert into public.video_host_links (imdb_id, media_type, season, episode, host_code, embed_url, quality, language)
values ('tt0903747', 'series', 1, 2, 'filemoon', 'https://filemoon.sx/e/xyz123abc', '1080p', 'Latino');
```

`host_code` debe existir en `video_hosts` (FK `ON UPDATE CASCADE`). Repetir el
mismo `embed_url` para la misma obra choca con `uq_content_host_url` (que
incluye `NULLS NOT DISTINCT`): usa `on conflict do update` para refrescar
`quality`/`language` en vez de duplicar.

## Pruebas

`test/supabase.test.js` cubre el cliente PostgREST (filtros, cabeceras,
errores sin filtrar la clave), los extractores con HTML de los tres anfitriones,
el resultado final en Stremio y el marcado de enlaces roto. Todo con `fetch`
sustituido: ni red ni base de datos.
