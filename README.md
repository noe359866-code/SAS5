# Catálogos+

Addon gratuito para Stremio con catálogos de películas y series, metadatos en español latino y fuentes de reproducción directa verificadas en audio latino.

## Fuentes de reproducción

Se consultan en paralelo las fuentes directas activadas: Fanpelis y PlayLatinSRC. Solo se publican enlaces reproducibles con evidencia de audio latino; se descartan audio inglés, dual, castellano, subtítulos sin doblaje, enlaces de descarga y resultados sin idioma identificable. La resolución de títulos y metadatos usa TMDB, TVMaze y Cinemeta cuando corresponde.

El conjunto recomendado de fuentes queda en Fanpelis y PlayLatinSRC, ambas sin pruebas de trabajo pesadas. Configura `STREAM_PROVIDERS` para limitar las fuentes y `STREAM_MAX_RESULTS` para fijar el máximo de resultados. También se pueden seleccionar fuentes desde `/configure`.

## Configuración local

Requiere Node.js 18 o posterior.

```sh
npm install
cp .env.example .env
npm start
```

Configura `TMDB_API_KEY` o `TMDB_ACCESS_TOKEN` para catálogos y metadatos. `WATCH_REGION` define el país usado para disponibilidad de plataformas; por defecto es `NI`. El idioma editorial permanece fijo en `es-MX`.

Para desarrollo con Cloudflare Workers:

```sh
npm run dev:worker
npm run deploy
```

`npm run deploy` compila la web, pregenera catálogos configurados y despliega el Worker.

## Rutas

- `/manifest.json` y `/<config>/manifest.json`: manifests de Stremio.
- `/catalog/:type/:id.json`: catálogos.
- `/meta/:type/:id.json`: metadatos.
- `/stream/:type/:id.json`: resultados de reproducción directa en español latino.
- `/configure`: selección de región, plataformas, estudios y fuentes directas.
- `/healthz`: estado de servicio y proveedores.

## Desarrollo y pruebas

```sh
npm test
npm run build:web
npm run prerender
```

Las pruebas usan respuestas simuladas y no garantizan que un proveedor externo esté disponible en vivo. Catálogos+ no aloja ni distribuye archivos; presenta metadatos y enlaces directos proporcionados por fuentes externas.
