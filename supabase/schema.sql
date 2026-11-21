-- Enlaces propios del addon RamdonLatam (`video_host_links`).
--
-- La tabla la define el operador con este DDL, tal cual: el addon no la crea
-- ni la migra, solo la lee (y, con `service_role`, marca enlaces roto). Este
-- archivo deja el esquema versionado junto al codigo que lo consulta
-- (lib/supabase.js, lib/siteSupabase.js).
--
-- Requisitos que el addon asume:
--   * `is_working = true` en las filas publicables (los indices son parciales).
--   * `embed_url` guarda el EMBED del anfitrion, no el .m3u8 firmado.
--   * `language` es la unica prueba del audio; vacio => "Latino (sin verificar)".
--   * `set_updated_at()` existe en el esquema (lo usa el trigger de updated_at).

-- ── Anfitriones ────────────────────────────────────────────────────────────
-- Catalogo al que apunta la FK `video_host_links.host_code`. Los `host_code`
-- que el addon sabe extraer (lib/hostExtractors.js) se siembran aqui; añadir
-- otro anfitrion es insertar su codigo y su extractor en el codigo.
create table if not exists public.video_hosts (
  host_code text not null,
  name text null,
  base_url text null,
  is_active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint video_hosts_pkey primary key (host_code)
);

insert into public.video_hosts (host_code, name, base_url) values
  ('mixdrop', 'Mixdrop', 'https://mixdrop.co'),
  ('filemoon', 'Filemoon', 'https://filemoon.sx'),
  ('vihidrive', 'Vihidrive', 'https://vihidrive.cc'),
  ('streamtape', 'Streamtape', 'https://streamtape.com'),
  ('byse', 'Byse', null)
on conflict (host_code) do nothing;

-- ── videos_host_links ──────────────────────────────────────────────────────
create table public.video_host_links (
  id bigserial not null,
  imdb_id text null,
  tmdb_id integer null,
  media_type text not null default 'movie'::text,
  season integer null,
  episode integer null,
  host_code text not null,
  embed_url text not null,
  host_file_id text null,
  extractor_type text null,
  quality text null,
  language text null,
  server_label text null,
  is_working boolean not null default true,
  fail_count integer not null default 0,
  last_error text null,
  last_extracted_at timestamp with time zone null,
  last_checked_at timestamp with time zone null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint video_host_links_pkey primary key (id),
  constraint uq_content_host_url unique NULLS not distinct (
    imdb_id,
    tmdb_id,
    media_type,
    season,
    episode,
    embed_url
  ),
  constraint video_host_links_host_code_fkey foreign KEY (host_code) references video_hosts (host_code) on update CASCADE,
  constraint chk_valid_media_type check (
    (
      media_type = any (array['movie'::text, 'series'::text])
    )
  ),
  constraint chk_has_imdb_or_tmdb check (
    (
      (imdb_id is not null)
      or (tmdb_id is not null)
    )
  ),
  constraint chk_valid_tmdb_id check (
    (
      (tmdb_id is null)
      or (tmdb_id > 0)
    )
  ),
  constraint chk_season_episode_by_type check (
    (
      (
        (media_type = 'movie'::text)
        and (season is null)
        and (episode is null)
      )
      or (
        (media_type = 'series'::text)
        and (season >= 1)
        and (episode >= 1)
      )
    )
  ),
  constraint chk_valid_imdb_id check (
    (
      (imdb_id is null)
      or (imdb_id ~ '^tt[0-9]{5,12}$'::text)
    )
  )
) TABLESPACE pg_default;

create index IF not exists idx_video_host_links_imdb on public.video_host_links using btree (imdb_id, media_type, season, episode, host_code) TABLESPACE pg_default
where
  (
    (is_working = true)
    and (imdb_id is not null)
  );

create index IF not exists idx_video_host_links_tmdb on public.video_host_links using btree (tmdb_id, media_type, season, episode, host_code) TABLESPACE pg_default
where
  (
    (is_working = true)
    and (tmdb_id is not null)
  );

create index IF not exists idx_video_host_links_lang on public.video_host_links using btree (language) TABLESPACE pg_default
where
  (is_working = true);

create trigger trg_video_host_links_updated_at BEFORE
update on video_host_links for EACH row
execute FUNCTION set_updated_at ();

-- ── RLS: lectura publica de lo que funciona, escritura solo con service_role ─
alter table public.video_host_links enable row level security;

drop policy if exists video_host_links_read on public.video_host_links;
create policy video_host_links_read on public.video_host_links
  for select to anon, authenticated
  using (is_working = true);

-- El addon nunca inserta ni actualiza con `anon`; el importador y el marcado
-- de enlaces roto usan `service_role`, que salta RLS.
