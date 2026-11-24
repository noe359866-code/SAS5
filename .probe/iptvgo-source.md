# Sonda 14: iptvgo.cc a fondo (patrón Xtream /live/<u>/<p>/<id>.m3u8)

Fecha: 2026-11-24T21:30:06.483Z

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
| 1455 | falla | segmento HTTP 403 · 0 B · — variantes |
| 1 | falla | playlist HTTP 405 |
| 100 | falla | playlist HTTP 405 |
| 500 | falla | segmento HTTP 403 · 0 B · — variantes |
| 1000 | falla | playlist HTTP 405 |
| 1500 | falla | segmento HTTP 403 · 0 B · — variantes |
| 2000 | falla | segmento HTTP 403 · 0 B · — variantes |

## 3. Xtream player_api (nombres, logos, categorías)

login: HTTP 200 · status Active · expira 1802231850 · max conexiones 4
categorías en vivo: 355
get_live_streams: HTTP 200 · no-JSON (2000000 B)

## 4. Enumeración de IDs (/live/<cred>/<n>.m3u8)

muestreados 119 ids · vivos: 53
vivos: 350, 450, 500, 750, 800, 850, 1050, 1100, 1150, 1200, 1250, 1300, 1350, 1400, 1450, 1500, 1550, 1600, 1650, 1700, 1750, 1800, 1850, 1900, 1950, 2000, 1440, 1441, 1442, 1443, 1444, 1445, 1446, 1447, 1449, 1451, 1453, 1454, 1455, 1456, 1457, 1458, 1459, 1460, 1461, 1462, 1463, 1464, 1465, 1466, 1467, 1469, 1470
no vivos por HTTP: 0×1 · 405×65

## Conclusión automática

- ¿Exige User-Agent? NO (responde sin UA)
- player_api usable: SÍ (nombres y logos disponibles)
