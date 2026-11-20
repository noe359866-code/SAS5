# Sonda 2 de pelisjuanita.org (episodios y player)

| paso | url | estado | tipo | cf | bytes | notas |
|---|---|---|---|---|---|---|
| api episode-seasons | `pelisjuanita.org/api/rest/v1/episode-seasons?item_id=…` | 502 | application/json | - | 870 | 0 items · claves - · ejemplo {} |
| api episodes s1 | `pelisjuanita.org/api/rest/v1/episodes?item_id=…&season=…&limit=…&page=…` | 502 | application/json | - | 870 | 0 items · claves - · ejemplo {} |
| api content serie | `pelisjuanita.org/api/rest/v1/content/serie/breaking-bad-2008` | 502 | application/json | - | 870 | claves type,title,status,detail,instance,error_code,error_name,error_category,ray_id,timestamp,zone,cloudflare_error,retryable,retry_after,owner_action_required,what_you_should_do,footer |
| página serie | `pelisjuanita.org/serie/breaking-bad-2008` | 502 | application/json | - | 870 | 0 iframes [] · 0 medios [] |
| página episodio | `pelisjuanita.org/serie/breaking-bad-2008/temporada-1/episodio-1` | 502 | application/json | - | 870 | 0 iframes [] · 0 medios [] |
| player movie | `videoapp.mov/e/movie/969681` | 502 | application/json | - | 866 | 0 iframes [] · 0 medios [] · idiomas: — |
| player tv | `videoapp.mov/e/tv/1396/1/1` | 502 | application/json | - | 866 | 0 iframes [] · 0 medios [] · idiomas: — |

Sonda de diagnóstico: solo cabeceras y HTML/JSON público; sin tokens ni segmentos.
