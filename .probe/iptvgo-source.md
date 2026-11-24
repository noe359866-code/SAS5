# Sonda 14: iptvgo.cc a fondo (patrón Xtream /live/<u>/<p>/<id>.m3u8)

Fecha: 2026-11-24T23:16:20.669Z

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
con logo: 29341 · muestra de nombres: Grums IK vs Karlskrona HK @ Nov 22 1:45 PM :Hockeyettan  01 · Kalix HC vs IF Sundsvall Hockey @ Nov 22 1:50 PM :Hockeyettan  02 · Kiruna IF vs Hudiksvalls HC @ Nov 22 1:50 PM :Hockeyettan  03 · Kungälvs IK vs Hanvikens SK @ Nov 22 1:50 PM :Hockeyettan  04 · Lindlövens IF vs Piteå HC @ Nov 22 1:50 PM :Hockeyettan  05 · Surahammars IF vs Örnsköldsvik HF @ Nov 22 1:50 PM :Hockeyettan  06 · Grästorps IK vs Nyköpings SK @ Nov 22 3:45 PM :Hockeyettan  07 · Halmstad Hammers HC vs HC Vita Hästen @ Nov 22 3:45 PM :Hockeyettan  08 · Borlänge HF vs Vallentuna Hockey @ Nov 22 3:50 PM :Hockeyettan  09 · BoroVetlanda HC vs Tranås AIF @ Nov 22 3:50 PM :Hockeyettan  10 · Huddinge IK vs HC Dalen @ Nov 22 3:50 PM :Hockeyettan  11 · Järfälla HC vs Norrtälje IK @ Nov 22 3:50 PM :Hockeyettan  12
categorías con canales: 356 · ids máx: 868568
top categorías: Ex-YU: 1112 · 24/7 | SHOWS: 740 · CARIBBEAN: 649 · Hungary: 592 · INDIA: 519 · 24/7 | COMEDY: 511 · Brazil: 510 · UK-Restream: 506 · 24/7 | DRAMA: 475 · Turkey: 458 · USA | ESPN+: 399 · 24/7 | Arabic: 399 · IT | SPORT: 372 · DE | SPORT: 305 · USA | PLEX: 304 · Albania: 302 · USA | Flo Hockey: 300 · Africa | Locals: 300 · USA | Disney+ Sports: 300 · FR | SPORT: 299 · DE | Kinowelt: 290 · Canada | SAMSUNG TV+: 281 · USA | SAMSUNG TV+: 280 · Thailand: 279

## 4. Enumeración de IDs (/live/<cred>/<n>.m3u8)

muestreados 119 ids · vivos: 53
vivos: 350, 450, 500, 750, 800, 850, 1050, 1100, 1150, 1200, 1250, 1300, 1350, 1400, 1450, 1500, 1550, 1600, 1650, 1700, 1750, 1800, 1850, 1900, 1950, 2000, 1440, 1441, 1442, 1443, 1444, 1445, 1446, 1447, 1449, 1451, 1453, 1454, 1455, 1456, 1457, 1458, 1459, 1460, 1461, 1462, 1463, 1464, 1465, 1466, 1467, 1469, 1470
no vivos por HTTP: 0×1 · 405×65

## Conclusión automática

- ¿Exige User-Agent? NO (responde sin UA)
- player_api usable: SÍ (nombres y logos disponibles)
