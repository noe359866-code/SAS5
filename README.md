# RamdonLatam Canales

Addon gratuito para Stremio dedicado únicamente a canales de TV en vivo. Ya no publica catálogos, fichas ni streams de películas o series.

## Catálogos del addon

Los catálogos de Stremio reproducen los `group-title` de la M3U: países (Nicaragua, México, EE. UU., España…), además de grupos temáticos y especiales como Deportes, Cine, Música y 24/7. Cada grupo es paginado y entrega los mismos nombres, logos y señales que la lista. El addon incluye fichas y resolución de streams para canales `tv`.

## Enmascaramiento de enlaces en Cloudflare Worker

Las URLs de stream de los canales no se devuelven directamente a Stremio: el Worker entrega rutas opacas cifradas y retransmite el HLS, reescribiendo también las URLs de manifiestos, segmentos y claves. Para habilitarlo, configura una clave privada de al menos 24 caracteres:

```sh
openssl rand -hex 32 | npx wrangler secret put M3U_PROXY_SECRET
```

Para desarrollo local, guarda la clave privada en `.dev.vars` o `.env` (usa `.dev.vars.example` como guía). **No la publiques en Git.** Sin esta clave, la API de streams de la M3U no devuelve los enlaces directos.

Esto oculta los orígenes en la respuesta del addon, pero no puede impedir por completo que alguien copie el catálogo, reutilice una URL proxy o inspeccione solicitudes desde un cliente que reproduce el canal. Como la lista M3U de este repositorio es pública, tampoco se puede impedir que copien su contenido mientras siga siendo accesible públicamente.

- **Manifest:** `/manifest.json`
- **Instalación en Stremio:** `stremio://<host>/manifest.json`
- **Lista M3U completa:** [`listas/ramdonlatam-tv.m3u`](listas/ramdonlatam-tv.m3u)
- **M3U pública:** `https://raw.githubusercontent.com/noe359866-code/SAS5/main/listas/ramdonlatam-tv.m3u`

La M3U combina semillas de canales, agrupa los canales por país o tema y conserva señales alternativas como entradas separadas. Los catálogos del Worker usan directamente esa misma fuente. Se regenera con `npm run m3u:export`; las semillas están en `lib/data/liveChannels*.json`.

## Desarrollo local

Requiere Node.js 18 o posterior.

```sh
npm install
npm start
```

El servidor solo expone las rutas del addon; `/` redirige al manifest y no hay páginas web ni configurador. Para desarrollar/desplegar en Cloudflare Workers:

```sh
npm run dev:worker
npm run deploy
```

Configura el secret `M3U_PROXY_SECRET` en el Worker antes de habilitar la reproducción enmascarada.

## Comprobaciones

```sh
npm test
npm run m3u:export
```

Los tests comprueban que el manifest solo declara `tv`, que sus catálogos corresponden a los grupos de la M3U y que los enlaces del proxy ocultan los orígenes.

## Fuentes y actualización de listas

Las listas se alimentan de fuentes M3U públicas y de semillas mantenidas en `lib/data/`. No todas las fuentes están disponibles en todo momento; las URLs de canales pueden caducar o dejar de funcionar. La lista M3U es un índice de enlaces de terceros, no aloja ni retransmite vídeo.
