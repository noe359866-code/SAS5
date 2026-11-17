# Investigación: 401, 403 y desafíos en Worker

## Alcance y resultados

Se hizo fetch del [documento oficial de 403](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/4xx-client-error/error-403/), [detección de Challenge Pages](https://developers.cloudflare.com/cloudflare-challenges/challenge-types/challenge-pages/detect-response/), [clearance](https://developers.cloudflare.com/cloudflare-challenges/concepts/clearance/) y [reglas Skip](https://developers.cloudflare.com/waf/custom-rules/skip/).

La [sonda GitHub Actions 44183885164](https://github.com/noe359866-code/SAS5/actions/runs/44183885164) comparó dos perfiles con un solo GET por perfil, sin registrar cookies ni tokens:

| Recurso | UA mínimo | UA navegador + Referer | Conclusión limitada |
|---|---|---|---|
| MStream `/api/v1/watch/1625240` | HTTP 401, sin `cf-mitigated: challenge` | HTTP 403, con `cf-mitigated: challenge` | En ese runner, Referer/UA no fue una solución; se requieren permisos y/o superar controles del sitio. |
| JKAnime `/one-piece/1/` | HTTP 403, con `cf-mitigated: challenge` | HTTP 403, con `cf-mitigated: challenge` | El runner recibió una Challenge Page con ambos perfiles. |
| FrenchStream película | El buscador de producción obtuvo un HLS en ese run | — | La extracción no verifica reproducción ni acceso futuro. |

El lector externo de páginas mostró la ficha de JKAnime y el mismo endpoint de MStream devolvió 401. No se trata de la misma red, sesión ni cliente que GitHub Actions. **Estos resultados no demuestran qué devuelve el Worker desplegado**, para lo cual hace falta probar el mismo flujo allí con autorización y sin compartir secretos. El sandbox tiene salida restringida, por eso se recurrió al lector y al runner.

## Qué sí se puede hacer

1. **Diagnosticar cada 403, no aplicar un remedio universal.** Asegurar método y parámetros de la API, permisos, Referer si el proveedor lo requiere, e identificar `cf-mitigated: challenge`. Un 401 requiere investigar autenticación; un 403 sin ese encabezado no prueba por sí solo un challenge ni identifica la regla responsable. Un 200 tampoco asegura contenido útil.
2. **Para un servicio propio o autorizado**, usar la API y credenciales previstas por el operador. Si administra su zona Cloudflare, el operador puede configurar una regla Skip acotada al cliente y reglas autorizadas. Esto no es una solución para zonas de terceros; Skip tampoco omite Bot Fight Mode en plan Free.
3. **Cuando el CDN exige Referer**, el addon ya ofrece `proxyHeaders` y un proxy HLS con lista de hosts permitidos. Se debe comprobar el master y segmentos, no solo el HTML. El proxy añade subrequests y no arregla una política WAF ni garantiza playback: el fallo puede ocurrir en master, variante, claves o segmentos.
4. **Si aparece `cf-mitigated: challenge`**, la aplicación ahora distingue el challenge y pausa ese proveedor por el cooldown configurado. No lo resuelve ni intenta reintentos repetidos. Esta es una mejora de diagnóstico y consumo, **no una solución de acceso**.

Cloudflare documenta que el `cf_clearance` está vinculado al visitante/dispositivo; no es una cookie universal portable del navegador al Worker. Un servicio de navegador externo o proxy con IP fija supondría infraestructura y coste adicionales, y solo debe usarse con autorización del operador; no se ha integrado ni probado aquí.

## Límites

- Cabeceras de navegador/Referer pueden ser apropiadas para requisitos documentados de una API, pero no hay evidencia de que solucionen estos dos proveedores. No falsificar IP ni confiar en una cookie ajena.
- Un challenge puede ser dinámico, depender de la ubicación, sesión o egress, y el servicio puede cambiar. No extrapolar GitHub al Worker.
- Detección automática en `lib/http.js` usa únicamente la cabecera documentada: una página de verificación personalizada sin ella puede pasar desapercibida, incluso con HTTP 200.
- Esta investigación no ha habilitado JKAnime o MStream ni demostrado reproducción sin anuncios.
