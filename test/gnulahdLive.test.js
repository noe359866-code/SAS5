'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { probe } = require('../scripts/gnulahd-live');

const origin = 'https://ww3.gnulahd.nu';
const show = { title: 'Mi serie', year: 2025, slug: 'mi-serie', season: 1, episode: 2 };
const page = (title, year, content = '') => `<title>${title} (${year}) | Gnula</title><h1>${title}</h1>${content}`;

function mockFetch(t, routes) {
  t.after(() => assert.equal(routes.length, 0));
  t.mock.method(global, 'fetch', async (url, init) => {
    const route = routes.shift();
    assert.ok(route, 'no debe consultar descargas, iframes ni episodios que no correspondan');
    assert.equal(url, `${origin}${route[0]}`);
    assert.equal(init.redirect, 'manual');
    return new Response(route[1]);
  });
}

test('GnulaHD: continúa solo por el enlace exacto y confirma el capítulo en la ficha resultante', async (t) => {
  mockFetch(t, [['/ver/mi-serie/', page(show.title, show.year, `
    <a href="/mi-serie-1x01/">Uno</a><a href="/mi-serie-2x02/">Otra temporada</a>
    <a href="https://other.example/mi-serie-1x02/">Otro origen</a><a href="/mi-serie-1x02/">Dos</a>`) ],
  ['/mi-serie-1x02/', '<h1>Ver Mi serie 1×02 Online — Dos</h1><a href="/ver/mi-serie/">Todos</a><iframe src="https://embed.example/view"></iframe>']]);
  const result = await probe(show);
  assert.match(result, /^episodio exacto identificado;/);
  assert.match(result, /etiquetas de vídeo=0; fuentes HTML de vídeo=0; URL en vídeo=—; iframes=1 \(embed\.example\)/);
});

test('GnulaHD: una ficha sin enlace válido no provoca una petición de episodio inferida', async (t) => {
  mockFetch(t, [['/ver/mi-serie/', page(show.title, show.year, '<a href="https://other.example/mi-serie-1x02/">Varios</a><a href="/otra-serie-1x02/">Dos</a>')]]);
  assert.equal(await probe(show), 'serie identificada; sin enlace al episodio exacto');
});

test('GnulaHD: una descarga, un tráiler y un iframe con extensión MP4 no se confunden con vídeo nativo', async (t) => {
  mockFetch(t, [['/ver/control/', page('Control', 2001, `<video class="trailer" src="https://cdn.example/trailer.mp4"></video>
    <div class="downloads"><video src="https://cdn.example/download.mp4"></video></div>
    <a href="https://cdn.example/download.mp4" download>Descargar</a>
    <iframe src="https://player.example/pretend.mp4"></iframe><video src="https://cdn.example/live.m3u8" data-lang="Latino"></video><video></video>`)]]);
  const result = await probe({ title: 'Control', year: 2001, slug: 'control' });
  assert.match(result, /etiquetas de vídeo=2; fuentes HTML de vídeo=1; URL en vídeo=cdn\.example\.m3u8 \(Latino\); iframes=1/);
  assert.doesNotMatch(result, /https:|pretend\.mp4|download\.mp4|trailer\.mp4/);
});

test('GnulaHD: distingue las llamadas del script con vídeo del resto sin ejecutar ni volcar valores', async (t) => {
  mockFetch(t, [['/ver/control/', page('Control', 2001, `
    <script>window.gnula = {ajax: '${origin}/wp-admin/admin-ajax.php?signature=secret-marker', nonce: 'secret-marker'};</script>
    <script>fetch('/wp-json/gnula/comment', { method: 'POST' });</script>
    <script>
      throw new Error('No se debe ejecutar este código');
      document.addEventListener('click', async () => {
        const body = new URLSearchParams();
        body.set('action', 'secret-action');
        body.set('post_id', 'private-id');
        body.set('lang', 'secret-language');
        body.set('nonce', window.gnula.nonce);
        await fetch(window.gnula.ajax, { method: 'POST', body });
        const player = document.createElement('video');
        const hls = new Hls();
        hls.loadSource('secret-source');
        player.play();
      });
    </script>`)]]);
  const result = await probe({ title: 'Control', year: 2001, slug: 'control' });
  assert.match(result, /destinos declarados=AJAX WordPress, REST WordPress/);
  assert.match(result, /scripts con señales de reproductor=1; crea=video;/);
  assert.match(result, /señales en esos scripts=(?=[^;]*clic)(?=[^;]*Hls)(?=[^;]*loadSource\(\))(?=[^;]*play\(\))/);
  assert.match(result, /llamadas en esos scripts=POST destino dinámico \((?=[^)]*acción)(?=[^)]*id de contenido)(?=[^)]*idioma)(?=[^)]*verificador)[^)]*\); llamadas en otros scripts=POST REST WordPress/);
  assert.doesNotMatch(result, /secret|private-id|admin-ajax\.php|wp-json|https:/);
});

test('GnulaHD: JSON-LD y metadatos sociales se cuentan por separado de un vídeo reproducible', async (t) => {
  mockFetch(t, [['/ver/control/', page('Control', 2001, `
    <meta property="og:video" content="https://trailer.example/asset.mp4">
    <script type="application/ld+json">{"@graph":[{"@type":"Movie"},{"@type":"VideoObject", "embedUrl":"https://trailer.example/secret"}]}</script>`)]]);
  const result = await probe({ title: 'Control', year: 2001, slug: 'control' });
  assert.match(result, /etiquetas de vídeo=0; fuentes HTML de vídeo=0; URL en vídeo=—/);
  assert.match(result, /\(VideoObject=1, contentUrl=0, embedUrl=1\); meta de vídeo=1/);
  assert.doesNotMatch(result, /https:|secret/);
});

test('GnulaHD: los avisos y controles del HTML no cuentan textos de descargas ni scripts', async (t) => {
  mockFetch(t, [['/ver/control/', page('Control', 2001, `
    <div class="downloads"><button>Latino</button>Cargando servidores…</div>
    <script>const player = 'Cargando servidores…';</script>
    <button>Haz clic para reproducir</button>
    <div role="menuitemradio">✓ Subtitulado</div>`)]]);
  const result = await probe({ title: 'Control', year: 2001, slug: 'control' });
  assert.match(result, /controles de audio HTML=Subtitulado; avisos HTML=Haz clic para reproducir;/);
  assert.match(result, /etiquetas de vídeo=0; fuentes HTML de vídeo=0; URL en vídeo=—;/);
});
