# Sonda 13: m3u.tvcluboficial.com a fondo

Fecha: 2026-11-25T16:48:39.399Z

## 1. Acceso al canal de ejemplo (id 293)

| Intento | HTTP | Content-Type | CORS | ¿#EXTM3U? |
|---|---|---|---|---|
| UA de la lista (Android) | 200 | text/plain; charset=utf-8 | * | sí |
| UA navegador genérico | 200 | text/plain; charset=utf-8 | * | sí |
| Sin User-Agent | 200 | text/plain; charset=utf-8 | * | sí |
| Con Referer al host | 200 | text/plain; charset=utf-8 | * | sí |

## 2. Cadena completa (playlist → variante → segmento)

| Canal (id) | Maestra | Variante/segmento |
|---|---|---|
| id 293 | OK | segmento HTTP 206 · MPEG-TS |
| id 344 | OK | segmento HTTP 206 · MPEG-TS |
| id 635 | OK | segmento HTTP 206 · MPEG-TS |
| id 155 | falla | segmento HTTP 404 · 548 B |
| id 118 | OK | segmento HTTP 206 · MPEG-TS |
| id 45 | falla | segmento HTTP 404 · 548 B |
| id 588 | OK | segmento HTTP 206 · MPEG-TS |

## 3. Enumeración de IDs (/free/ReachBot/Kip/<n>.m3u8)

muestreados 83 ids · vivos: 33
vivos: 5, 6, 8, 9, 14, 17, 20, 27, 28, 29, 32, 33, 35, 100, 140, 180, 220, 420, 500, 660, 940, 980, 1060, 1100, 1180, 1105, 1110, 1115, 1120, 1125, 1130, 1150, 1165

## 4. Segundo host de la lista: tv.m3uts.xyz

| Canal | Con UA lista | Sin UA |
|---|---|---|
| tv.m3uts.xyz/stream/secure/DBHmCasm/1171.m3u8 | 404 | 404 |

## Conclusión automática

- ¿Exige User-Agent propio? NO (responde sin UA)
