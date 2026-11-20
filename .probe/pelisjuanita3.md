# Sonda 3 de pelisjuanita.org (idioma en el visor)

| paso | url | estado | tipo | cf | bytes | notas |
|---|---|---|---|---|---|---|
| api item película | `pelisjuanita.org/api/rest/v1/item?id=…` | 502 | application/json | - | 870 | claves type,title,status,detail,instance,error_code,error_name,error_category,ray_id,timestamp,zone,cloudflare_error,retryable,retry_after,owner_action_required,what_you_should_do,footer · sin campo de idioma |
| api item serie | `pelisjuanita.org/api/rest/v1/item?id=…` | 502 | application/json | - | 870 | claves type,title,status,detail,instance,error_code,error_name,error_category,ray_id,timestamp,zone,cloudflare_error,retryable,retry_after,owner_action_required,what_you_should_do,footer · sin campo de idioma |
| player movie | `videoapp.mov/e/movie/969681` | 502 | application/json | - | 866 | 0 iframes [] |
| player tv | `videoapp.mov/e/tv/1396/1/1` | 502 | application/json | - | 866 | 0 iframes [] |

Sonda de diagnóstico: las firmas se recortan antes de guardar; no se descarga el manifiesto.
