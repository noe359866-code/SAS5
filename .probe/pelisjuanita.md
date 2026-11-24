# Sonda de pelisjuanita.org

| paso | url | estado | tipo | cf | bytes | notas |
|---|---|---|---|---|---|---|
| search «spider-man» | `pelisjuanita.org/api/rest/v1/search?q=…` | 200 | application/json | - | 6749 | 15 items · claves backdrop_path,catalog_item_id,featured,kind,likes_count,poster_path,quality,rating_avg,ratings_count,runtime,slug,title,tmdb_id,url,views_7d,views_total,vote_average,year · kinds movie/serie/anime |
| search «la odisea» | `pelisjuanita.org/api/rest/v1/search?q=…` | 200 | application/json | - | 7325 | 17 items · claves backdrop_path,catalog_item_id,featured,kind,likes_count,poster_path,quality,rating_avg,ratings_count,runtime,slug,title,tmdb_id,url,views_7d,views_total,vote_average,year · kinds movie/serie |
| search «breaking bad» | `pelisjuanita.org/api/rest/v1/search?q=…` | 200 | application/json | - | 1414 | 3 items · claves backdrop_path,catalog_item_id,featured,kind,likes_count,poster_path,quality,rating_avg,ratings_count,runtime,slug,title,tmdb_id,url,views_7d,views_total,vote_average,year · kinds serie/movie |
| content movie/spider-man-un-nuevo-dia-2026 | `pelisjuanita.org/api/rest/v1/content/movie/spider-man-un-nuevo-dia-2026` | 200 | application/json | - | 47054 | claves cast,comments,crew,episode_loader,episode_seasons,episodes,features,item,overview,related · menciona reproductores |
| content serie/tu-amigo-y-vecino-spider-man-2025 | `pelisjuanita.org/api/rest/v1/content/serie/tu-amigo-y-vecino-spider-man-2025` | 200 | application/json | - | 46130 | claves cast,comments,crew,episode_loader,episode_seasons,episodes,features,item,overview,related |
| ficha HTML película | `pelisjuanita.org/pelicula/spider-man-un-nuevo-dia-2026` | 200 | text/html | - | 28918 | 0 iframes [] · 1 medios [videoapp.mov/e/movie/969681] |
| api play (GET) | `pelisjuanita.org/api/play` | 404 | application/json | - | 21 | {"error":"not_found"} |
| ruta /e/ | `pelisjuanita.org/e/` | 200 | text/html | - | 789 | <!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="robots" content="noindex"><meta name="referrer" c |

Sonda de diagnóstico: solo cabeceras y JSON público; sin tokens ni segmentos.
