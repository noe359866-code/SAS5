# Mega-sonda completa: tvcluboficial.com

Fecha: 2026-11-26T08:46:49.938Z

## 1. Hosts y endpoints

| URL | HTTP | Content-Type | CORS | Server | Latencia | Nota |
|---|---|---|---|---|---|---|
| http://tvcluboficial.com/ | 521 | text/html; charset=UTF-8 | — | cloudflare | 166 ms | raíz HTTP |
| https://tvcluboficial.com/ | 521 | text/html; charset=UTF-8 | — | cloudflare | 101 ms | raíz HTTPS |
| http://m3u.tvcluboficial.com/ | 404 | application/json; charset=utf-8 | * | cloudflare | 129 ms | m3u HTTP |
| https://m3u.tvcluboficial.com/ | 404 | application/json; charset=utf-8 | * | cloudflare | 95 ms | m3u HTTPS |
| http://m3u.tvcluboficial.com/player_api.php | 404 | application/json; charset=utf-8 | * | cloudflare | 55 ms | Xtream player_api |
| http://m3u.tvcluboficial.com/get.php | 404 | application/json; charset=utf-8 | * | cloudflare | 57 ms | Xtream get.php |
| http://m3u.tvcluboficial.com/xmltv.php | 404 | application/json; charset=utf-8 | * | cloudflare | 46 ms | EPG xmltv.php |
| http://m3u.tvcluboficial.com/panel_api.php | 404 | application/json; charset=utf-8 | * | cloudflare | 60 ms | Xtream panel_api |
| http://m3u.tvcluboficial.com/playlist.m3u | 404 | application/json; charset=utf-8 | * | cloudflare | 49 ms | playlist pública |

## 2. Requisitos de acceso (canal muestra id 5)

| Perfil | HTTP | Content-Type | CORS | #EXTM3U | Latencia |
|---|---|---|---|---|---|
| UA Android | 200 | text/plain; charset=utf-8 | * | sí | 48 ms |
| UA navegador genérico | 200 | text/plain; charset=utf-8 | * | sí | 44 ms |
| Sin User-Agent | 200 | text/plain; charset=utf-8 | * | sí | 50 ms |
| Con Referer al host | 200 | text/plain; charset=utf-8 | * | sí | 47 ms |

## 3. Resumen del barrido

- **IDs sondeados**: 3930 (denso `1..3500` + 430 centinelas `3550..25000`)
- **IDs vivos (cadena HLS completa OK)**: **416** (rango `5..1181`)
- **Maestras rotas (200 #EXTM3U pero segmento fallido)**: 90
- **IDs inactivos (404/vacíos)**: 3424
- **Hallazgos en centinelas > 3500**: 0
- **Latencia maestra**: p50 = 48 ms · p95 = 72 ms
- **Latencia primer segmento**: p50 = 29 ms · p95 = 143 ms
- **Formato de segmentos**: MPEG-TS: 416
- **Duración total de la mega-sonda**: 7.2 s

## 4. Clúster de servidores de segmentos (`tsN.tvcluboficial.com`)

| Servidor | Vivos | Segmento roto | Latencia seg. p50 |
|---|---:|---:|---:|
| ts6.tvcluboficial.com | 224 | 61 | 28 ms |
| ts1.tvcluboficial.com | 70 | 6 | 57 ms |
| ts0.tvcluboficial.com | 46 | 8 | 57 ms |
| ts4.tvcluboficial.com | 33 | 6 | 9 ms |
| ts9.tvcluboficial.com | 23 | 2 | 57 ms |
| ts5.tvcluboficial.com | 15 | 5 | 33 ms |
| ts8.tvcluboficial.com | 5 | 2 | 29 ms |

## 5. Catálogo resultante y cobertura

- **Canales únicos válidos**: **373** (duplicados colapsados: 41)
- **Origen del nombre**: 159 conocidos · 214 por slug interno · 0 genéricos
- **Cobertura de logos**: **154/373** (41 %)
- **IDs vivos por encima del máximo previo (1173)**: 4

### Por país

- Latinoamérica: 284
- México: 19
- España: 16
- Colombia: 12
- Argentina: 12
- EE. UU.: 7
- Ecuador: 6
- Perú: 5
- Honduras: 3
- Chile: 2
- Guatemala: 2
- Costa Rica: 2
- Nicaragua: 2
- Panamá: 1

### Por tema

- entretenimiento: 120
- cine: 86
- deportes: 74
- infantil: 47
- documentales: 21
- anime: 17
- noticias: 4
- musica: 3
- religion: 1

### Muestra de maestras rotas (90 en total)

- id 8 (`AE_HD` · ts6.tvcluboficial.com): segmento HTTP 404 bytes=548
- id 9 (`APlus` · ts6.tvcluboficial.com): segmento HTTP 404 bytes=548
- id 32 (`AMC_ES` · ts6.tvcluboficial.com): segmento HTTP 404 bytes=548
- id 43 (`Animaniacs` · ts6.tvcluboficial.com): segmento HTTP 404 bytes=548
- id 45 (`Antena3` · ts6.tvcluboficial.com): segmento HTTP 404 bytes=548
- id 83 (`Bandamax` · ts6.tvcluboficial.com): segmento HTTP 404 bytes=548
- id 84 (`Bandamax_HD` · ts6.tvcluboficial.com): segmento HTTP 404 bytes=548
- id 92 (`BitMe` · ts6.tvcluboficial.com): segmento HTTP 404 bytes=548
- id 107 (`Canal5_LD` · ts6.tvcluboficial.com): segmento HTTP 404 bytes=548
- id 121 (`Toros` · ts1.tvcluboficial.com): segmento HTTP 404 bytes=548
- id 140 (`CBS_HD` · ts6.tvcluboficial.com): segmento HTTP 404 bytes=548
- id 143 (`CDFPremium_HD` · ts1.tvcluboficial.com): segmento HTTP 404 bytes=548
- id 155 (`CH_CHV` · ts6.tvcluboficial.com): segmento HTTP 404 bytes=548
- id 158 (`Cine247_Accion_HD` · ts6.tvcluboficial.com): segmento HTTP 404 bytes=548
- id 167 (`Cine247_Ficcion_2_HD` · ts6.tvcluboficial.com): segmento HTTP 404 bytes=548
- id 171 (`Cine247_Infantil_Sagas` · ts6.tvcluboficial.com): segmento HTTP 404 bytes=548
- id 179 (`Cine247_Romance_HD` · ts6.tvcluboficial.com): segmento HTTP 404 bytes=548
- id 181 (`Cine247_Terror_HD` · ts6.tvcluboficial.com): segmento HTTP 404 bytes=548
- id 183 (`Cine247_Zombies` · ts6.tvcluboficial.com): segmento HTTP 404 bytes=548
- id 280 (`DisneyChannel` · ts5.tvcluboficial.com): segmento HTTP 404 bytes=548

### Muestra de señales duplicadas colapsadas (41 en total)

- Azteca 7: id 72 duplicado de id 71
- Azteca 7: id 74 duplicado de id 71
- beIN Sports: id 89 duplicado de id 88
- Bein Sports N: id 91 duplicado de id 90
- Las Estrellas: id 118 duplicado de id 114
- Comedy Central: id 218 duplicado de id 216
- Comedy Central: id 219 duplicado de id 216
- Disney Junior: id 286 duplicado de id 284
- DSports: id 314 duplicado de id 312
- Film Arts HD: id 420 duplicado de id 419
- F1 TV: id 427 duplicado de id 426
- FX: id 476 duplicado de id 474
- Golden HD: id 497 duplicado de id 494
- HBO 2: id 521 duplicado de id 518
- CH Mega: id 652 duplicado de id 651
- Eventos 1: id 714 duplicado de id 325
- Nick JR: id 732 duplicado de id 729
- Space: id 825 duplicado de id 823
- Space: id 826 duplicado de id 823
- Star: id 835 duplicado de id 832

semilla tvclub escrita: 377 -> 373
