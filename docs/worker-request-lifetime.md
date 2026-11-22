# Promesas y CPU en Cloudflare Workers

Las promesas en curso de `cache` y `responseCache` se deduplican dentro de cada
invocación mediante AsyncLocalStorage. El entrypoint del Worker crea el contexto;
`waitUntil` conserva ese contexto para las tareas de revalidación. Node mantiene
la coalescencia global habitual. Solo los valores ya resueltos se comparten entre
solicitudes del Worker. No desactivar `handle_cross_request_promise_resolution`:
ocultaría el problema de propiedad de I/O sin corregirlo.

Esto implica cargas independientes si varias solicitudes llegan simultáneamente
a una clave fría. Las posteriores siguen usando los resultados en memoria o Cache
API. Para single-flight entre solicitudes se necesita coordinación externa (por
ejemplo, Durable Objects), no un Map global de promesas.

Los scrapers HTML usan htmlparser2 en modo HTML en lugar de reconstruir documentos
HTML5 con parse5. El desempaquetador Packer rechaza bases fuera de 2–62, contadores
excesivos y trabajo proporcional a contador × tamaño mayor de 8 MiB. Esto limita
el coste síncrono; los timeouts de red no limitan CPU y no pueden interrumpir un
parser síncrono. No se ha elevado el límite de CPU ni cambiado el plan del Worker.

Validación local: pruebas unitarias de aislamiento, rechazo, reintento, parser y
proveedores; `npx wrangler deploy --dry-run`. Tras desplegar, repetir las rutas de
stream reportadas y comprobar CPU en Workers Observability: no se puede asegurar
el presupuesto de producción con las páginas reales solo mediante fixtures.

Atención al despliegue: wrangler.toml declara `catalogos-plus`, mientras el servicio
reportado es `ramdonlatam`. Confirmar el nombre correcto y desplegar explícitamente
con `npx wrangler deploy --name ramdonlatam` si ese es el destino. Este cambio no
incluye despliegue ni modificaciones de credenciales.
