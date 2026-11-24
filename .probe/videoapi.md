# Sonda videoapi.la


## https://videoapi.la/ -> 200 (https://videoapi.la/) [10703 bytes]

```html
<!DOCTYPE html>

<html lang="es">

<head>
	<meta charset="utf-8" />
	<meta content="width=device-width, initial-scale=1.0" name="viewport" />
	<meta name="vidapi-ui-build" content="20261022-190056" />
	<script src="/ui-update-guard.js"></script>
	<link href="/favicon.ico" rel="icon" type="image/x-icon" />
	<title>VideoAPI — API de video y generador de sitios</title>
	<meta content="API de streaming de video & Generador de Páginas Web." name="description" />
	<meta content="index, follow" name="robots" />
	<link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css" rel="stylesheet" />
	<link href="/assets/style.css?v=20260815-vidapi-parity" rel="stylesheet" />
</head>

<body>
	<nav class="va-nav" id="vaNav">
		<div class="va-container va-nav-inner">
			<a class="va-nav-brand" href="/">
				<i class="bi bi-play-btn-fill"></i>
				<span>VideoAPI</span>
			</a>
			<button aria-label="Abrir navegación" class="va-nav-toggle" id="vaNavToggle">
				<i class="bi bi-list"></i>
			</button>
			<div class="va-nav-links" id="vaNavLinks"><a class="active" href="/">Inicio</a><a
					href="/features">Funciones</a><a href="/api">API</a><a href="/player">Player</a><a
					href="/catalog">Catálogo</a><a href="/faq">FAQ</a></div>
			<div class="va-nav-actions">
				<a class="va-btn va-btn-primary" href="/login">Iniciar sesión</a>
			</div>
		</div>
	</nav>
	<main>
		<!-- Hero -->
		<section class="va-hero">
			<div class="va-container">
				<div class="va-badge"><i class="bi bi-lightning-charge-fill"></i> API gratuita y abierta</div>
				<h1>API de streaming de video<br /><span class="va-gradient">&amp; Generador de Páginas Web</span></h1>
				<p>Inserta películas, series, anime, novelas y WWE en tu sitio web en cuestión de segundos. Genera páginas de
					streaming completas con temas personalizados, skins para el reproductor y un sistema de búsqueda
					potenciado por IA. </p>
				<div class="va-hero-actions">
					<a class="va-btn va-btn-primary va-btn-lg" href="/register"><i class="bi bi-rocket-takeoff"></i>
						Comenzar gratis</a>
					<a class="va-btn va-btn-outline va-btn-lg" href="/api"><i class="bi bi-code-slash"></i> Ver
						documentación API</a>
				</div>
				<!-- Stats counter -->
				<div class="va-stats" data-public-stats="">
					<div class="va-stat">
						<span class="va-stat-number" data-count="0" data-stat-key="movies">—</span>
						<span class="va-stat-label">Películas</span>
					</div>
					<div class="va-stat-divider"></div>
					<div class="va-stat">
						<span class="va-stat-number" data-count="0" data-stat-key="tvshows">—</span>
						<span class="va-stat-label">Series</span>
					</div>
					<div class="va-stat-divider"></div>
					<div class="va-stat">
						<span class="va-stat-number" data-count="0" data-stat-key="animes">—</span>
						<span class="va-stat-label">Anime</span>
					</div>
					<div class="va-stat-divider"></div>
					<div class="va-stat">
						<span class="va-stat-number" data-count="0" data-stat-key="novels">—</span>
						<span class="va-stat-label">Novelas</span>
					</div>
					<div class="va-stat-divider"></div>
					<div class="va-stat">
						<span class="va-stat-number" data-count="0" data-stat-key="wwe">—</span>
						<span class="va-stat-label">WWE</span>
					</div>
					<div class="va-stat-divider"></div>
					<div class="va-stat">
						<span class="va-stat-number" data-count="0" data-stat-key="episodes">—</span>
						<span class="va-stat-label">Episodios</span>
					</div>
				</div>
			</div>
		</section>
		<!-- Key Features -->
		<section class="va-section">
			<div class="va-container">
				<div class="va-section-header va-fade-in">
					<h2>Todo lo que necesitas</h2>
					<p>Desde un embed simple hasta un sitio de streaming completo: VideoAPI reúne las herramientas para
						publicar en minutos.</p>
				</div>
				<div class="va-grid va-grid-3 va-fade-in">
					<div class="va-card">
						<div class="va-card-icon"><i class="bi bi-code-square"></i></div>
						<h3>API de embeds</h3>
						<p>API por iframe basada en TMDb ID para películas, series, anime, novelas y WWE. Usa rutas limpias y un
							contrato público validable.</p>
					</div>
					<div class="va-card">
						<div class="va-card-icon"><i class="bi bi-window-stack"></i></div>
						<h3>Generador de sitios</h3>
						<p>Genera sitios de streaming completos con dominio propio, SEO, analíticas, anuncios, páginas
							legales y soporte PWA.</p>
					</div>
					<div class="va-card">
						<div class="va-card-icon"><i class="bi bi-play-circle"></i></div>
						<h3>Solo 1 pop-up en el player</h3>
						<p>Un pop-up por sesión en modo con anuncios. Menos interrupciones y mejor experiencia para el
							usuario.</p>
					</div>
					<div class="va-card">
						<div class="va-card-icon"><i class="bi bi-brush"></i></div>
						<h3>Múltiples skins de player</h3>
						<p>Skins inspirados en plataformas conocidas y colores personalizables para adaptar el player a
							cada proyecto.</p>
					</div>
					<div class="va-card">
						<div class="va-card-icon"><i class="bi bi-search-heart"></i></div>
						<h3>Búsqueda con IA</h3>
						<p>Búsqueda en lenguaje natural para encontrar contenido sin depender de coincidencias exactas
							de título.</p>
					</div>
					<div class="va-card">
						<div class="va-card-icon"><i class="bi bi-phone"></i></div>
						<h3>Soporte PWA</h3>
						<p>Convierte los sitios generados en aplicaciones instalables para móvil y escritorio.</p>
					</div>
				</div>
			</div>
		</section>
		<!-- How It Works -->
		<section class="va-section" style="background: var(--bg-surface);">
			<div class="va-container">
				<div class="va-section-header va-fade-in">
					<h2>Cómo funciona</h2>
					<p>Empieza en tres pasos simples.</p>
				</div>
				<div class="va-steps va-fade-in">
					<div class="va-step">
						<div class="va-step-num">1</div>
						<h3>Regístrate</h3>
						<p>Crea tu cuenta y accede al panel con las 
```

## https://videoapi.la/api -> 200 (https://videoapi.la/api) [33119 bytes]

```html
<!DOCTYPE html>

<html lang="es">
<head>
	<meta name="vidapi-ui-build" content="20261022-190056" />
	<script src="/ui-update-guard.js"></script>
<meta charset="utf-8"/>
<meta content="width=device-width, initial-scale=1.0" name="viewport"/>
<link href="/favicon.ico" rel="icon" type="image/x-icon"/>
<title>API — VideoAPI</title>
<meta content="Documentación de la API pública de VideoAPI para embeds, catálogo, estadísticas y WordPress." name="description"/>
<meta content="index, follow" name="robots"/>
<link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css" rel="stylesheet"/>
<link href="/assets/style.css?v=20260815-vidapi-parity" rel="stylesheet"/>
</head>
<body>
<nav class="va-nav" id="vaNav">
<div class="va-container va-nav-inner">
<a class="va-nav-brand" href="/">
<i class="bi bi-play-btn-fill"></i>
<span>VideoAPI</span>
</a>
<button aria-label="Abrir navegación" class="va-nav-toggle" id="vaNavToggle">
<i class="bi bi-list"></i>
</button>
<div class="va-nav-links" id="vaNavLinks"><a href="/">Inicio</a><a href="/features">Funciones</a><a class="active" href="/api">API</a><a href="/player">Player</a><a href="/catalog">Catálogo</a><a href="/faq">FAQ</a></div>
<div class="va-nav-actions">
<a class="va-btn va-btn-primary" href="/login">Iniciar sesión</a>
</div>
</div>
</nav>
<main>
<!-- API Hero -->
<section class="va-hero" style="padding-bottom: 3rem;">
<div class="va-container">
<div class="va-badge">Documentación</div>
<h1>Documentación de <span class="va-gradient">API</span></h1>
<p>Guía completa para usar los endpoints públicos de VideoAPI con películas, series, anime, novelas y WWE mediante TMDb.</p>
</div>
</section>
<!-- Movie Endpoint -->
<section class="va-section-sm">
<div class="va-container">
<div class="va-endpoint va-fade-in">
<div class="va-endpoint-header">
<span class="va-method va-method-get">GET</span>
<span class="va-endpoint-url">/e/movie/{tmdb}</span>
</div>
<h3>Embed de película</h3>
<p>Integra una película usando un TMDb ID numérico. Los eventos WWE usan la misma forma unitaria con <code>/e/wwe/{tmdb}</code>.</p>
<div class="va-params-title">Parámetros</div>
<div class="va-table-wrap">
<table class="va-table">
<thead>
<tr>
<th>Parámetro</th>
<th>Obligatorio</th>
<th>Descripción</th>
</tr>
</thead>
<tbody>
<tr>
<td><code>tmdb</code></td>
<td>Sí</td>
<td><code>TMDb ID numérico de la película</code></td>
</tr>
</tbody>
</table>
</div>
<div class="va-params-title">Ejemplos</div>
<div class="va-code-block" style="margin-bottom: 0.75rem;">
<div class="va-code-header"><span>Ruta limpia</span><button class="va-code-copy">Copiar</button></div>
<pre><code>/e/movie/550</code></pre>
</div>
<div class="va-code-block" style="margin-bottom: 0.75rem;">
<div class="va-code-header"><span>Generador público</span><button class="va-code-copy">Copiar</button></div>
<pre><code>/api/v1/public/embed?type=movie&amp;tmdb=550</code></pre>
</div>
<div class="va-code-block" style="margin-bottom: 0.75rem;">
<div class="va-code-header"><span>WWE — ruta unitaria</span><button class="va-code-copy">Copiar</button></div>
<pre><code>/e/wwe/{tmdb}</code></pre>
</div>
<div class="va-params-title">Uso HTML</div>
<div class="va-code-block">
<div class="va-code-header"><span>HTML</span><button class="va-code-copy">Copiar</button></div>
<pre><code>&lt;iframe
  src="/e/movie/550"
  width="100%" height="100%"
  frameborder="0"
  allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
  allowfullscreen
  referrerpolicy="origin"
&gt;&lt;/iframe&gt;</code></pre>
</div>
</div>
<!-- TV Show Endpoint -->
<div class="va-endpoint va-fade-in">
<div class="va-endpoint-header">
<span class="va-method va-method-get">GET</span>
<span class="va-endpoint-url">/e/{tv|anime|novel}/{tmdb}/{season}/{episode}</span>
</div>
<h3>Embed de serie, anime o novela</h3>
<p>Integra un episodio concreto de serie, anime o novela con <code>TMDb</code> ID, temporada y episodio numéricos.</p>
<div class="va-params-title">Parámetros</div>
<div class="va-table-wrap">
<table class="va-table">
<thead>
<tr>
<th>Parámetro</th>
<th>Obligatorio</th>
<th>Descripción</th>
</tr>
</thead>
<tbody>
<tr>
<td><code>tmdb</code></td>
<td>Sí</td>
<td>TMDb ID numérico</td>
</tr>
<tr>
<td><code>season</code></td>
<td>Sí</td>
<td>Número de temporada</td>
</tr>
<tr>
<td><code>episode</code></td>
<td>Sí</td>
<td>Número de episodio</td>
</tr>
</tbody>
</table>
</div>
<div class="va-params-title">Formatos de URL</div>
<div class="va-table-wrap" style="margin-bottom: 1rem;">
<table class="va-table">
<thead>
<tr>
<th>Formato</th>
<th>Ejemplo</th>
<th>Descripción</th>
</tr>
</thead>
<tbody>
<tr>
<td>Serie limpia</td>
<td><code>/e/tv/1399/1/1</code></td>
<td>Ruta directa para una serie</td>
</tr>
<tr>
<td>Anime limpio</td>
<td><code>/e/anime/85937/1/1</code></td>
<td>Ruta directa para anime</td>
</tr>
<tr>
<td>Novela limpia</td>
<td><code>/e/novel/{tmdb}/1/1</code></td>
<td>Ruta directa para una novela</td>
</tr>
<tr>
<td>Generador TV</td>
<td><code>/api/v1/public/embed?type=tv&amp;tmdb=1399&amp;season=1&amp;episode=1</code></td>
<td>Construcción mediante API pública</td>
</tr>
<tr>
<td>Generador anime</td>
<td><code>/api/v1/public/embed?type=anime&amp;tmdb=85937&amp;season=1&amp;episode=1</code></td>
<td>Construcción mediante API pública</td>
</tr>
<tr>
<td>Generador novela</td>
<td><code>/api/v1/public/embed?type=novel&amp;tmdb={tmdb}&amp;season=1&amp;episode=1</code></td>
<td>Construcción mediante API pública</td>
</tr>
</tbody>
</table>
</div>
<div class="va-params-title">Ejemplos</div>
<div class="va-code-block" style="margin-bottom: 0.75rem;">
<div class="va-code-header"><span>Serie — TMDb</span><button class="va-code-copy">Copiar</button>
</div>
<pre><code>/e/tv/1399/1/1</code></pre>
</div>
<div class="va-code-block" style="margin-bottom: 0.75rem;">
<div class="va-code-header"><span>Anime — TMDb</span><button class="va-code-copy">Copiar</button>
</div>
<pre><code>/e/anime/85937/1/1</code></pre>
</div>
<div class="va-co
```

## https://videoapi.la/e/movie/550 -> 200 (https://videoapi.la/e/movie/550) [22502 bytes]

```html
<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="origin">
<link rel="icon" href="/favicon.ico" sizes="any">
<title>El Club de la Pelea</title>
<style>
:root{--primary:#7c3aed;--bg:#070014}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;overflow:hidden;background:var(--bg)}
#app{position:relative;width:100%;height:100%}
iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
.logo{position:absolute;top:12px;left:12px;height:28px;z-index:5;pointer-events:none;opacity:.9}
.veil{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:var(--bg);color:#fff;font-family:system-ui;z-index:10}
.veil.hidden{display:none}
.spinner{width:42px;height:42px;border:3px solid #ffffff22;border-top-color:var(--primary);border-radius:50%;animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.notice{position:absolute;inset:0;display:none;flex-direction:column;gap:.8rem;align-items:center;justify-content:center;background:var(--bg);color:#fff;font-family:system-ui;text-align:center;padding:1rem;z-index:20}
.notice.show{display:flex}
.notice button{padding:.6rem 1.2rem;border:0;border-radius:6px;background:var(--primary);color:#fff;cursor:pointer;font-size:.95rem}
</style>
</head>
<body><script type="text/javascript" data-vidapi-external-player="1">(function () {
  'use strict';
  var config = {"domain":"videoapp.zip","everyMinutes":10,"excludedParents":[],"frequency":"once_per_video_session","host":"f83edf4b648b49228f0464fabfb985ba|videoapp.zip","videoKey":"movie:550:0:0","vst":"_jMvMjk5MDQ4ZTUtO-EzNSWWYzYxL-EyZDUtNGNmM2IWNmE1NTBl"};
  var started = false;

  function sourceHost() {
    if (!document.referrer) return '';
    try { return new URL(document.referrer).hostname.toLowerCase().replace(/\.$/, ''); }
    catch (_) { return ''; }
  }

  function patternMatches(host, pattern) {
    pattern = pattern.toLowerCase().trim();
    if (!pattern.includes('*')) return host === pattern || host.endsWith('.' + pattern);
    var parts = pattern.split('*');
    var cursor = 0;
    for (var i = 0; i < parts.length; i++) {
      if (!parts[i]) continue;
      var index = host.indexOf(parts[i], cursor);
      if (index === -1 || (i === 0 && index !== 0)) return false;
      cursor = index + parts[i].length;
    }
    return pattern.endsWith('*') || host.endsWith(parts[parts.length - 1]);
  }

  function excluded() {
    var host = sourceHost();
    return !!host && config.excludedParents.some(function (pattern) {
      return patternMatches(host, pattern);
    });
  }

  function storage(mode) {
    try { return mode === 'once_per_video_session' ? window.sessionStorage : window.localStorage; }
    catch (_) { return null; }
  }

  function identifier(value) {
    var hash = 2166136261;
    for (var i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function allowed() {
    if (config.frequency === 'every_load') return true;
    var store = storage(config.frequency);
    if (!store) return true;
    var scope = 'vidapi-player-ad:v1:' + identifier(config.domain + '|' + config.host + '|' + config.vst);
    var key = config.frequency === 'every_n_minutes' ? scope + ':cooldown' : scope + ':video:' + config.videoKey;
    var previous;
    try { previous = store.getItem(key); }
    catch (_) { return true; }
    if (config.frequency === 'every_n_minutes') {
      var then = Number(previous);
      if (previous && Number.isFinite(then) && then <= Date.now()
        && Date.now() - then < config.everyMinutes * 60000) return false;
    } else if (previous) {
      return false;
    }
    try { store.setItem(key, String(Date.now())); }
    catch (_) { return true; }
    if (config.frequency === 'once_per_video_session') {
      window.addEventListener('pagehide', function () {
        try { store.removeItem(key); } catch (_) { /* storage unavailable */ }
      }, { once: true });
    }
    return true;
  }

  function mount() {
    if (started || !document.getElementById('app') || document.getElementById('vidapi-external-player-ad')) return;
    started = true;
    if (excluded() || !allowed()) return;
    var aaScript = document.createElement('script');
    aaScript.id = 'vidapi-external-player-ad';
    aaScript.type = 'text/javascript';
    aaScript.async = true;
    aaScript.src = 'https://cvt-s2.agl003.com/o?' + new URLSearchParams({
      vst: [encodeURIComponent(config.vst)],
      lang: 'en',
      container: '#app',
      cp: JSON.stringify({ domain: config.domain, host: config.host })
    }).toString();
    document.body.appendChild(aaScript);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
</script>
<div id="app">
  
  <div class="veil" id="veil"><div class="spinner"></div></div>
  <iframe id="frame" src="https://vimeos.net/embed-w9bvt2hrk0b2.html?cf=eyJhbGciOiJIUzI1NiIsImtpZCI6Im1haW4iLCJ0eXAiOiJWSURBUEktQ0YifQ.eyJhZHMiOjAsImFvIjpbImh0dHBzOi8vdmlkZW9hcGkubGEiXSwiYXAiOiJkZWZhdWx0IiwiYyI6eyJhY2NlbnQiOiIjMDBkMDg0IiwiaWNvbiI6IiNmZmZmZmYiLCJzZWNvbmRhcnkiOiIjMTExODI3In0sImNrIjoibW92aWUiLCJjdCI6MzAsImN2Ijo1NCwiZG0iOjEsImVlIjoiaHR0cHM6Ly92aWRlb2FwaS5sYS9fL3IiLCJlciI6dHJ1ZSwiZXhwIjoxNzk1NTAyMjQwLCJmZyI6eyJhbiI6ZmFsc2UsImFwIjpmYWxzZSwiaGMiOmZhbHNlLCJodCI6dHJ1ZSwicXMiOnRydWUsInJzIjp0cnVlLCJzYSI6MCwic2kiOmZhbHNlLCJzdCI6dHJ1ZSwidGgiOmZhbHNlfSwiaWF0IjoxNzk1NDgwNjQwLCJraWQiOiJtYWluIiwibSI6InZpcCIsIm1pIjp7ImNhdGFsb2dfa2luZCI6Im1vdmllIiwiZXBpc29kZSI6bnVsbCwibWVkaWFfdHlwZSI6Im1vdmllIiwic2Vhc29uIjpudWxsLCJ0aXRsZSI6IkVsIENsdWIgZGUgbGEgUGVsZWEiLCJ0bWRiIjo1NTAsInR5cGUiOiJtb3ZpZSJ9LCJtdCI6Im1vdmllIiwibyI6Mywib3JpZ2luIjoiaHR0cHM6Ly92aWRlb2FwaS5sYSIsInAiOiJkZTFhNzYwYy03YTNjLTRhMzgtYjQ4Ny1hM
```

## https://videoapi.la/e/tv/1399/1/1 -> 200 (https://videoapi.la/e/tv/1399/1/1) [22573 bytes]

```html
<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="origin">
<link rel="icon" href="/favicon.ico" sizes="any">
<title>Se acerca el invierno</title>
<style>
:root{--primary:#7c3aed;--bg:#070014}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;overflow:hidden;background:var(--bg)}
#app{position:relative;width:100%;height:100%}
iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
.logo{position:absolute;top:12px;left:12px;height:28px;z-index:5;pointer-events:none;opacity:.9}
.veil{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:var(--bg);color:#fff;font-family:system-ui;z-index:10}
.veil.hidden{display:none}
.spinner{width:42px;height:42px;border:3px solid #ffffff22;border-top-color:var(--primary);border-radius:50%;animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.notice{position:absolute;inset:0;display:none;flex-direction:column;gap:.8rem;align-items:center;justify-content:center;background:var(--bg);color:#fff;font-family:system-ui;text-align:center;padding:1rem;z-index:20}
.notice.show{display:flex}
.notice button{padding:.6rem 1.2rem;border:0;border-radius:6px;background:var(--primary);color:#fff;cursor:pointer;font-size:.95rem}
</style>
</head>
<body><script type="text/javascript" data-vidapi-external-player="1">(function () {
  'use strict';
  var config = {"domain":"videoapp.zip","everyMinutes":10,"excludedParents":[],"frequency":"once_per_video_session","host":"f83edf4b648b49228f0464fabfb985ba|videoapp.zip","videoKey":"serie:1399:1:1","vst":"_jMvMjk5MDQ4ZTUtO-EzNSWWYzYxL-EyZDUtNGNmM2IWNmE1NTBl"};
  var started = false;

  function sourceHost() {
    if (!document.referrer) return '';
    try { return new URL(document.referrer).hostname.toLowerCase().replace(/\.$/, ''); }
    catch (_) { return ''; }
  }

  function patternMatches(host, pattern) {
    pattern = pattern.toLowerCase().trim();
    if (!pattern.includes('*')) return host === pattern || host.endsWith('.' + pattern);
    var parts = pattern.split('*');
    var cursor = 0;
    for (var i = 0; i < parts.length; i++) {
      if (!parts[i]) continue;
      var index = host.indexOf(parts[i], cursor);
      if (index === -1 || (i === 0 && index !== 0)) return false;
      cursor = index + parts[i].length;
    }
    return pattern.endsWith('*') || host.endsWith(parts[parts.length - 1]);
  }

  function excluded() {
    var host = sourceHost();
    return !!host && config.excludedParents.some(function (pattern) {
      return patternMatches(host, pattern);
    });
  }

  function storage(mode) {
    try { return mode === 'once_per_video_session' ? window.sessionStorage : window.localStorage; }
    catch (_) { return null; }
  }

  function identifier(value) {
    var hash = 2166136261;
    for (var i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function allowed() {
    if (config.frequency === 'every_load') return true;
    var store = storage(config.frequency);
    if (!store) return true;
    var scope = 'vidapi-player-ad:v1:' + identifier(config.domain + '|' + config.host + '|' + config.vst);
    var key = config.frequency === 'every_n_minutes' ? scope + ':cooldown' : scope + ':video:' + config.videoKey;
    var previous;
    try { previous = store.getItem(key); }
    catch (_) { return true; }
    if (config.frequency === 'every_n_minutes') {
      var then = Number(previous);
      if (previous && Number.isFinite(then) && then <= Date.now()
        && Date.now() - then < config.everyMinutes * 60000) return false;
    } else if (previous) {
      return false;
    }
    try { store.setItem(key, String(Date.now())); }
    catch (_) { return true; }
    if (config.frequency === 'once_per_video_session') {
      window.addEventListener('pagehide', function () {
        try { store.removeItem(key); } catch (_) { /* storage unavailable */ }
      }, { once: true });
    }
    return true;
  }

  function mount() {
    if (started || !document.getElementById('app') || document.getElementById('vidapi-external-player-ad')) return;
    started = true;
    if (excluded() || !allowed()) return;
    var aaScript = document.createElement('script');
    aaScript.id = 'vidapi-external-player-ad';
    aaScript.type = 'text/javascript';
    aaScript.async = true;
    aaScript.src = 'https://cvt-s2.agl003.com/o?' + new URLSearchParams({
      vst: [encodeURIComponent(config.vst)],
      lang: 'en',
      container: '#app',
      cp: JSON.stringify({ domain: config.domain, host: config.host })
    }).toString();
    document.body.appendChild(aaScript);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
</script>
<div id="app">
  
  <div class="veil" id="veil"><div class="spinner"></div></div>
  <iframe id="frame" src="https://vimeos.net/embed-uh1n724ozegr.html?cf=eyJhbGciOiJIUzI1NiIsImtpZCI6Im1haW4iLCJ0eXAiOiJWSURBUEktQ0YifQ.eyJhZHMiOjAsImFvIjpbImh0dHBzOi8vdmlkZW9hcGkubGEiXSwiYXAiOiJkZWZhdWx0IiwiYyI6eyJhY2NlbnQiOiIjMDBkMDg0IiwiaWNvbiI6IiNmZmZmZmYiLCJzZWNvbmRhcnkiOiIjMTExODI3In0sImNrIjoic2VyaWUiLCJjdCI6MzAsImN2Ijo1NCwiZG0iOjEsImVlIjoiaHR0cHM6Ly92aWRlb2FwaS5sYS9fL3IiLCJlcCI6MSwiZXBpc29kZSI6MSwiZXIiOnRydWUsImV4cCI6MTc5NTUwMjI0MCwiZmciOnsiYW4iOmZhbHNlLCJhcCI6ZmFsc2UsImhjIjpmYWxzZSwiaHQiOnRydWUsInFzIjp0cnVlLCJycyI6dHJ1ZSwic2EiOjAsInNpIjpmYWxzZSwic3QiOnRydWUsInRoIjpmYWxzZX0sImlhdCI6MTc5NTQ4MDY0MCwia2lkIjoibWFpbiIsIm0iOiJ2aXAiLCJtaSI6eyJjYXRhbG9nX2tpbmQiOiJzZXJpZSIsImVwaXNvZGUiOjEsIm1lZGlhX3R5cGUiOiJ0diIsInNlYXNvbiI6MSwidGl0bGUiOiJTZSBhY2VyY2EgZWwgaW52aWVybm8iLCJ0bWRiIjoxMzk5LCJ0eXBlIjoidHYifSwibXQiOiJ0diIsIm8iOjMsIm9yaWdpbiI6Imh0dHBzOi8vdmlkZW9hcGkubGEiLCJwIjoiZGUxYTc2MGMtN2EzYy00YT
```

## https://api.videoapi.la/ -> 404 (https://api.videoapi.la/) [0 bytes]

```html

```
