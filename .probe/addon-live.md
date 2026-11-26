# Sonda en vivo del addon desplegado

- URL base: `https://ramdonlatam.noe359866.workers.dev`
- Fecha: 2026-11-26T08:55:15.220Z

## 1. `/healthz`
- HTTP: **200** (915 ms) · runtime: `worker` · CORS: `*`
```json
{
  "ok": true,
  "addon": "net.ramdonlatam.catalogos",
  "version": "2.1.0",
  "runtime": "cloudflare-workers",
  "channelsOnly": true,
  "configurable": false,
  "catalogs": 37,
  "m3uProxyConfigured": false,
  "cache": {
    "entries": 0,
    "maxEntries": 8000,
    "inFlight": 0,
    "hits": 0,
    "misses": 0,
    "staleHits": 0,
    "evictions": 0,
    "coalesced": 0
  }
}
```

## 2. `/manifest.json`
- HTTP: **200** (38 ms) · Content-Type: `application/json; charset=utf-8` · CORS: `*`
- id: `net.ramdonlatam.catalogos` · version: `2.1.0` · name: `RamdonLatam Canales`
- types: `["tv"]` · resources: `["catalog","meta","stream"]` · idPrefixes: `["rlch:m3u:"]`
- catalogs: **37**
- primeros 5 catálogos: `tv/tv_m3u_24-7` (24/7), `tv/tv_m3u_argentina` (Argentina), `tv/tv_m3u_bolivia` (Bolivia), `tv/tv_m3u_brasil` (Brasil), `tv/tv_m3u_canada` (Canadá)

## 3. Catálogo `tv/tv_m3u_nicaragua` (Nicaragua)
- HTTP: **200** (42 ms) · metas: **14**
### Canal: Canal 10 HD (`rlch:m3u:nicaragua:canal-10-hd`)
- `/meta`: HTTP **200** (41 ms) · name=`Canal 10 HD` · id=`rlch:m3u:nicaragua:canal-10-hd`
- `/stream`: HTTP **200** (349 ms) · streams=**0** · flags={"proxySecretRequired":true,"cacheMaxAge":240,"error":null}
```json
{"streams":[],"cacheMaxAge":240,"proxySecretRequired":true}
```

### Canal: Canal 11 HD (`rlch:m3u:nicaragua:canal-11-hd`)
- `/meta`: HTTP **200** (40 ms) · name=`Canal 11 HD` · id=`rlch:m3u:nicaragua:canal-11-hd`
- `/stream`: HTTP **200** (19 ms) · streams=**0** · flags={"proxySecretRequired":true,"cacheMaxAge":240,"error":null}
```json
{"streams":[],"cacheMaxAge":240,"proxySecretRequired":true}
```

## 3. Catálogo `tv/tv_m3u_24-7` (24/7)
- HTTP: **200** (21 ms) · metas: **100**
### Canal: 24/7 100 Percent Hotter (`rlch:m3u:24-7:24-7-100-percent-hotter`)
- `/meta`: HTTP **200** (25 ms) · name=`24/7 100 Percent Hotter` · id=`rlch:m3u:24-7:24-7-100-percent-hotter`
- `/stream`: HTTP **200** (32 ms) · streams=**0** · flags={"proxySecretRequired":true,"cacheMaxAge":240,"error":null}
```json
{"streams":[],"cacheMaxAge":240,"proxySecretRequired":true}
```

### Canal: 24/7 12 oz Mouse (`rlch:m3u:24-7:24-7-12-oz-mouse`)
- `/meta`: HTTP **200** (19 ms) · name=`24/7 12 oz Mouse` · id=`rlch:m3u:24-7:24-7-12-oz-mouse`
- `/stream`: HTTP **200** (51 ms) · streams=**0** · flags={"proxySecretRequired":true,"cacheMaxAge":240,"error":null}
```json
{"streams":[],"cacheMaxAge":240,"proxySecretRequired":true}
```

