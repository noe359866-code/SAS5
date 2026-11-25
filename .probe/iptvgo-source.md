# Sonda 14: iptvgo.cc a fondo (patrón Xtream /live/<u>/<p>/<id>.m3u8)

Fecha: 2026-11-25T19:24:43.818Z

## 1. Acceso al canal de ejemplo (id 1455)

| Intento | HTTP | Content-Type | CORS | ¿#EXTM3U? |
|---|---|---|---|---|
| UA Android (como en las listas) | 200 | application/x-mpegURL | * | sí |
| UA navegador genérico | 200 | application/x-mpegURL | * | sí |
| Sin User-Agent | 200 | application/x-mpegURL | * | sí |
| Con Referer al host | 200 | application/x-mpegURL | * | sí |

## 2. Cadena completa (playlist → variante → segmento)

| ID | Resultado | Detalle |
|---|---|---|
| 1455 | falla | host () => { try { return new URL(segUrl).host; } catch { return '?'; } } → con Range: 403 → sin Range: 403 → con Referer: 403 → UA VLC: 403 → auth por query: 403 → TS directo: 0 |
| 500 | falla | host () => { try { return new URL(segUrl).host; } catch { return '?'; } } → con Range: 403 → sin Range: 403 → con Referer: 403 → UA VLC: 403 → auth por query: 403 → TS directo: 0 |
| 1500 | falla | host () => { try { return new URL(segUrl).host; } catch { return '?'; } } → con Range: 403 → sin Range: 403 → con Referer: 403 → UA VLC: 403 → auth por query: 403 → TS directo: 0 |
| 2000 | falla | host () => { try { return new URL(segUrl).host; } catch { return '?'; } } → con Range: 403 → sin Range: 403 → con Referer: 403 → UA VLC: 403 → auth por query: 403 → TS directo: 0 |

## 3. Xtream player_api (nombres, logos, categorías)

login: HTTP 200 · status Active · expira 1802231850 · max conexiones 4
categorías en vivo: 355
canales en vivo anunciados: 33020
con logo: 29341 · muestra de nombres: HC Vita Hästen vs Borås HC @ Nov 25 6:40 PM :Hockeyettan  01 · HC Dalen vs Grästorps IK @ Nov 25 6:45 PM :Hockeyettan  02 · Mjölby HC vs BoroVetlanda HC @ Nov 25 6:50 PM :Hockeyettan  03 · Tyringe SoSS vs Kungälvs IK @ Nov 25 6:50 PM :Hockeyettan  04 ·  :Hockeyettan  05 ·  :Hockeyettan  06 ·  :Hockeyettan  07 ·  :Hockeyettan  08 ·  :Hockeyettan  09 ·  :Hockeyettan  10 ·  :Hockeyettan  11 ·  :Hockeyettan  12
categorías con canales: 356 · ids máx: 868568
top categorías: Ex-YU: 1112 · 24/7 | SHOWS: 740 · CARIBBEAN: 649 · Hungary: 592 · INDIA: 519 · 24/7 | COMEDY: 511 · Brazil: 510 · UK-Restream: 506 · 24/7 | DRAMA: 475 · Turkey: 458 · USA | ESPN+: 399 · 24/7 | Arabic: 399 · IT | SPORT: 372 · DE | SPORT: 305 · USA | PLEX: 304 · Albania: 302 · USA | Flo Hockey: 300 · Africa | Locals: 300 · USA | Disney+ Sports: 300 · FR | SPORT: 299 · DE | Kinowelt: 290 · Canada | SAMSUNG TV+: 281 · USA | SAMSUNG TV+: 280 · Thailand: 279

## 4. Enumeración de IDs (/live/<cred>/<n>.m3u8)

muestreados 119 ids · vivos: 53
vivos: 350, 450, 500, 750, 800, 850, 1050, 1100, 1150, 1200, 1250, 1300, 1350, 1400, 1450, 1500, 1550, 1600, 1650, 1700, 1750, 1800, 1850, 1900, 1950, 2000, 1440, 1441, 1442, 1443, 1444, 1445, 1446, 1447, 1449, 1451, 1453, 1454, 1455, 1456, 1457, 1458, 1459, 1460, 1461, 1462, 1463, 1464, 1465, 1466, 1467, 1469, 1470
no vivos por HTTP: 0×1 · 405×65

## Conclusión automática

- ¿Exige User-Agent? NO (responde sin UA)
- player_api usable: SÍ (nombres y logos disponibles)
