'use strict';
const $ = id => document.getElementById(id);
const state = { catalogs: [], tab: 'all', page: 1, search: '', items: [], selected: null, listRun: 0, detailRun: 0, streamRun: 0, episodeRun: 0 };
let saved = [];
try { saved = JSON.parse(localStorage.getItem('catalogos-watch-list') || '[]'); if (!Array.isArray(saved)) saved = []; } catch (_) { saved = []; }
async function api(action, params = {}) {
  const response = await fetch('/internal/watch/' + action + '?' + new URLSearchParams(params));
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'No se pudo consultar la fuente.');
  return data;
}
function text(tag, value, cls) { const el = document.createElement(tag); el.textContent = value || ''; if (cls) el.className = cls; return el; }
function imageUrl(value) { try { const u = new URL(value); return u.protocol === 'https:' ? u.href : ''; } catch (_) { return ''; } }
function backdrop(el, value) { const url = imageUrl(value); el.style.backgroundImage = url ? `url(${JSON.stringify(url)})` : ''; }
function currentCatalog() { return state.catalogs.find(c => c.id === $('catalog').value); }
function fillCatalogs() {
  const items = state.catalogs.filter(c => state.tab === 'all' || (state.tab === 'anime' ? /anime/.test(c.id) : c.type === state.tab));
  $('catalog').replaceChildren(...items.map(c => { const o = text('option', `${c.type === 'movie' ? 'Películas' : 'Series'} · ${c.name}`); o.value = c.id; return o; }));
}
function draw(items, append = false, target = $('grid')) {
  if (!append) target.replaceChildren();
  for (const m of items) {
    const card = text('button', '', 'card');
    const src = imageUrl(m.poster);
    if (src) { const img = document.createElement('img'); img.src = src; img.alt = ''; img.loading = 'lazy'; img.addEventListener('error', () => img.replaceWith(text('div', '', 'poster-placeholder')), { once: true }); card.append(img); }
    else card.append(text('div', '', 'poster-placeholder'));
    card.append(text('strong', m.name), text('small', [m.releaseInfo, m.imdbRating ? `★ ${m.imdbRating}` : '', m.type === 'series' ? 'Serie' : 'Película'].filter(Boolean).join(' · ')));
    card.onclick = () => openDetail(m); target.append(card);
  }
}
async function load(append = false) {
  const run = ++state.listRun;
  if (!append) { state.page = 1; state.items = []; $('grid').replaceChildren(); }
  $('more').hidden = true; $('status').textContent = 'Buscando historias para ti…';
  if (state.tab === 'saved') { draw(saved); $('status').textContent = saved.length ? `${saved.length} títulos guardados en este navegador` : 'Tu lista está vacía. Guarda títulos desde su ficha.'; return; }
  const cat = currentCatalog(); if (!cat) { $('status').textContent = 'No hay catálogos disponibles.'; return; }
  try {
    const data = await api(state.search ? 'search' : 'catalog', state.search ? { q: state.search, type: $('search-type').value, page: state.page } : { id: cat.id, type: cat.type, page: state.page });
    if (run !== state.listRun) return;
    const metas = (data.metas || []).filter(m => !state.items.some(i => i.id === m.id && i.type === m.type));
    state.items.push(...metas); draw(metas, append);
    $('status').textContent = state.items.length ? `${state.items.length} títulos · ${state.search ? 'Resultados de búsqueda' : cat.name}` : 'No hay resultados. Prueba otro catálogo o búsqueda; comprueba las claves del servidor.';
    $('more').hidden = !data.hasMore; $('more').disabled = false; $('more').textContent = 'Cargar más títulos';
    if (!append && metas[0] && state.tab === 'all' && !state.search) setHero(metas[0]);
  } catch (e) { if (run === state.listRun) { $('status').textContent = e.message; $('more').disabled = false; if (append) { state.page--; $('more').hidden = false; $('more').textContent = 'Reintentar'; } } }
}
function updateSave() { $('save').textContent = saved.some(m => m.id === state.selected?.id && m.type === state.selected?.type) ? '✓ En mi lista' : '＋ Mi lista'; }
function stopPlayer() { $('player').removeAttribute('src'); if ($('playback').open) $('playback').close(); $('player-status').textContent = ''; playingData = null; }
async function openDetail(m) {
  const run = ++state.detailRun; ++state.streamRun; ++state.episodeRun; state.selected = m;
  stopPlayer(); $('detail-title').textContent = m.name; $('detail-kind').textContent = m.type === 'series' ? 'SERIE · ELIGE UN EPISODIO' : 'PELÍCULA';
  $('description').textContent = m.description || ''; $('detail-info').textContent = [m.releaseInfo, m.imdbRating && `★ ${m.imdbRating}`].filter(Boolean).join(' · ');
  backdrop($('detail-art'), m.background); $('sources').replaceChildren(); $('source-status').textContent = 'Cargando ficha…'; $('episodes').hidden = true; updateSave();
  $('browse').hidden = true; $('detail').hidden = false;
  $('episode-cards').replaceChildren(); $('selected-episode').textContent = '';
  for (const id of ['cast-section', 'trailer-section', 'recommendation-section']) $(id).hidden = true;
  $('facts').replaceChildren(); $('genres').replaceChildren();
  $('choose').disabled = m.type === 'series';
  if (location.hash !== '#title/' + m.type + '/' + encodeURIComponent(m.id)) history.pushState(null, '', '#title/' + m.type + '/' + encodeURIComponent(m.id));
  window.scrollTo(0, 0); $('detail-title').focus({ preventScroll: true });
  loadExtras(m, run);
  try {
    const data = await api('meta', { id: m.id, type: m.type }); if (run !== state.detailRun) return;
    const meta = data.meta || m; state.selected = { ...m, ...meta, id: m.id, type: m.type }; $('detail-title').textContent = meta.name || m.name; $('description').textContent = meta.description || m.description || ''; backdrop($('detail-art'), meta.background || m.background);
    $('detail-info').textContent = [meta.releaseInfo || m.releaseInfo, meta.runtime, meta.imdbRating && `★ ${meta.imdbRating}`].filter(Boolean).join(' · ');
    if (m.type === 'series') await loadEpisodes(run); else { $('source-status').textContent = 'Pulsa «Elegir fuente» para buscar torrents disponibles.'; }
  } catch (e) { if (run === state.detailRun) $('source-status').textContent = e.message; }
}
async function loadEpisodes(detailRun, season) {
  const run = ++state.episodeRun; ++state.streamRun; stopPlayer(); $('sources').replaceChildren(); $('source-status').textContent = 'Cargando episodios…'; $('season').disabled = true; $('episode').disabled = true; $('choose').disabled = true; $('episode-cards').replaceChildren();
  try {
    const data = await api('episodes', { id: state.selected.id, ...(season ? { season } : {}) });
    if (detailRun !== state.detailRun || run !== state.episodeRun) return;
    $('episodes').hidden = false;
    if (!season) $('season').replaceChildren(...data.seasons.map(s => { const o = text('option', s.name || `Temporada ${s.season_number}`); o.value = s.season_number; return o; }));
    $('episode').replaceChildren(...data.episodes.map(e => { const o = text('option', `${e.number}. ${e.name}`); o.value = e.number; return o; }));
    $('season').disabled = false; $('episode').disabled = false;
    if (!data.episodes.length) { $('source-status').textContent = 'No hay episodios disponibles para esta temporada.'; return; }
    $('episode-cards').replaceChildren();
    for (const e of data.episodes) {
      const b = text('button', '', 'episode-card'); b.dataset.episode = e.number; b.setAttribute('aria-pressed', 'false');
      const src = imageUrl(e.image);
      if (src) { const img = document.createElement('img'); img.src = src; img.alt = ''; img.loading = 'lazy'; b.append(img); } else b.append(text('div', '', 'episode-placeholder'));
      b.append(text('strong', `${e.number}. ${e.name}`), text('small', [e.runtime && `${e.runtime} min`, e.airDate].filter(Boolean).join(' · ')), text('p', e.description));
      b.onclick = () => { $('episode').value = e.number; selectEpisode(); loadStreams(detailRun); scrollToSources(); }; $('episode-cards').append(b);
    }
    $('choose').disabled = false; selectEpisode();
    $('source-status').textContent = 'Elige un episodio para buscar sus fuentes.';
  } catch (e) { if (detailRun === state.detailRun && run === state.episodeRun) { $('source-status').textContent = e.message; $('season').disabled = false; } }
}
async function loadStreams(detailRun = state.detailRun) {
  const run = ++state.streamRun; stopPlayer(); $('sources').replaceChildren(); $('source-status').textContent = 'Buscando torrents en los proveedores. Puede tardar unos segundos…';
  try {
    const data = await api('streams', { id: state.selected.id, type: state.selected.type, season: $('season').value, episode: $('episode').value });
    if (run !== state.streamRun || detailRun !== state.detailRun) return;
    $('source-status').textContent = data.streams.length ? `${data.streams.length} fuentes encontradas. Selecciona una para reproducir.` : 'No se encontraron fuentes. La disponibilidad depende de los proveedores y seeders.';
    for (const stream of data.streams) {
      if (!/^[a-f\d]{40}$/i.test(stream.infoHash || '')) continue;
      const b = text('button', '', 'source'); b.append(text('strong', stream.name || 'Torrent'), text('span', stream.title || stream.description || stream.infoHash));
      b.onclick = () => { for (const n of $('sources').querySelectorAll('.source')) n.setAttribute('aria-pressed', String(n === b)); play(stream); }; $('sources').append(b);
    }
    const retry = text('button', 'Volver a buscar'); retry.onclick = () => loadStreams(); $('sources').append(retry);
  } catch (e) { if (run === state.streamRun && detailRun === state.detailRun) { $('source-status').textContent = e.message; const retry = text('button', 'Reintentar'); retry.onclick = () => loadStreams(); $('sources').append(retry); } }
}
let playingData = null;
function play(stream) {
  const params = new URLSearchParams({ xt: `urn:btih:${stream.infoHash}`, dn: state.selected.name });
  for (const source of stream.sources || []) if (source.startsWith('tracker:')) params.append('tr', source.slice(8));
  playingData = { magnet: 'magnet:?' + params, title: state.selected.name };
  if (!$('playback').open) $('playback').showModal(); $('playing-episode').textContent = $('selected-episode').textContent; $('playing').textContent = state.selected.name; $('player-status').textContent = 'Conectando con Webtor… Si no inicia, prueba otra fuente.';
  $('player').src = '/watch/player.html';
  $('playback').focus({ preventScroll: true });
  $('playback').scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
}
window.addEventListener('message', event => {
  if (event.source !== $('player').contentWindow || !$('playback').open || !playingData) return;
  if (event.data?.type === 'watch-ready' && playingData) $('player').contentWindow.postMessage({ type: 'watch-play', ...playingData }, '*');
  if (event.data?.type === 'watch-error') $('player-status').textContent = 'Webtor no pudo cargar. Prueba otra fuente o abre el contenido en Stremio.';
  if (event.data?.type === 'watch-torrent-ready') $('player-status').textContent = 'Torrent localizado. Pulsa reproducir en Webtor; la reproducción depende de los seeders y del formato.';
  if (event.data?.type === 'watch-loaded') $('player-status').textContent = 'Webtor cargado. El inicio depende de la disponibilidad del torrent.';
});
$('stop').onclick = () => { stopPlayer(); scrollToSources(); $('sources').querySelector('button')?.focus(); };
$('playback').addEventListener('close', () => { if ($('playback').open) return; $('player').removeAttribute('src'); playingData = null; });
function closeDetail() { ++state.detailRun; ++state.streamRun; ++state.episodeRun; stopPlayer(); state.selected = null; $('detail').hidden = true; $('browse').hidden = false; }
$('close').onclick = () => { closeDetail(); history.pushState(null, '', location.pathname + location.search); window.scrollTo(0, 0); };
window.addEventListener('popstate', route);
function route() {
  const match = /^#title\/(movie|series)\/(.+)$/.exec(location.hash);
  if (match) { let id; try { id = decodeURIComponent(match[2]); } catch (_) { return; } if (state.selected?.id !== id) openDetail({ type: match[1], id, name: 'Cargando…' }); }
  else if (!location.hash.startsWith('#title/')) closeDetail();
}
$('season').onchange = () => loadEpisodes(state.detailRun, $('season').value); $('episode').onchange = () => { selectEpisode(); loadStreams(); };
$('save').onclick = () => { const m = state.selected; const exists = saved.some(i => i.id === m.id && i.type === m.type); saved = exists ? saved.filter(i => i.id !== m.id || i.type !== m.type) : [...saved, m].slice(-200); try { localStorage.setItem('catalogos-watch-list', JSON.stringify(saved)); } catch (_) { $('source-status').textContent = 'El navegador no permite guardar la lista de forma permanente.'; } updateSave(); if (state.tab === 'saved') load(); };
for (const b of document.querySelectorAll('[data-tab]')) b.onclick = () => { closeDetail(); history.replaceState(null, '', location.pathname + location.search); state.tab = b.dataset.tab; state.search = ''; $('query').value = ''; $('reset').hidden = true; for (const n of document.querySelectorAll('[data-tab]')) n.setAttribute('aria-pressed', n === b ? 'true' : 'false'); $('page-title').textContent = b.textContent === 'Inicio' ? 'Ver ahora' : b.textContent; $('catalog').disabled = state.tab === 'saved'; $('discovery').hidden = state.tab !== 'all'; $('hero').hidden = state.tab !== 'all'; fillCatalogs(); load(); };
$('catalog').onchange = () => { state.search = ''; $('reset').hidden = true; load(); };
$('search').onsubmit = e => { e.preventDefault(); state.search = $('query').value.trim(); if (state.tab === 'saved') { state.tab = 'all'; $('catalog').disabled = false; fillCatalogs(); } $('reset').hidden = !state.search; load(); };
$('reset').onclick = () => { state.search = ''; $('query').value = ''; $('reset').hidden = true; load(); };
$('search-type').onchange = () => { if (state.search) load(); };
$('more').onclick = () => { $('more').disabled = true; state.page++; load(true); };
$('hero-action').onclick = () => $('catalog').focus();
api('catalogs').then(data => { state.catalogs = data.catalogs; fillCatalogs(); renderPlatforms(data.platforms || []); load(); loadHomeRails(data.configured); route(); }).catch(e => { $('status').textContent = e.message; });

function setHero(m) {
  backdrop($('hero'), m.background); $('hero-title').textContent = m.name;
  $('hero-description').textContent = (m.description || '').split('\n')[0];
  $('hero-meta').textContent = [m.type === 'series' ? 'SERIE DESTACADA' : 'PELÍCULA DESTACADA', m.releaseInfo, m.imdbRating && `★ ${m.imdbRating}`].filter(Boolean).join(' · ');
  $('hero-action').textContent = '▶ Descubrir'; $('hero-action').onclick = () => openDetail(m);
}
function renderPlatforms(platforms) {
  for (const p of platforms) {
    const b = text('button', '', 'platform'); const src = imageUrl(p.logo);
    if (src) { const img = document.createElement('img'); img.src = src; img.alt = ''; img.loading = 'lazy'; b.append(img); }
    b.append(text('span', p.name)); b.onclick = () => browseCatalog('cine_' + p.key); $('platforms').append(b);
  }
}
function browseCatalog(id) {
  if (!$('detail').hidden) closeDetail();
  state.tab = 'all'; state.search = ''; $('query').value = ''; $('reset').hidden = true; $('catalog').disabled = false;
  for (const n of document.querySelectorAll('[data-tab]')) n.setAttribute('aria-pressed', String(n.dataset.tab === 'all'));
  $('hero').hidden = false; $('discovery').hidden = false; fillCatalogs(); $('catalog').value = id; load();
  $('library').scrollIntoView({ block: 'start' });
}
async function loadHomeRails(configured) {
  if (!configured) return;
  // Four independent public requests; no eager torrent searches.
  await Promise.all([['cine_tendencias','Películas en tendencia','movie'],['tv_tendencias','Series que dan que hablar','series'],['tv_anime','El universo anime','series'],['cine_top','Historias inolvidables','movie']].map(async ([id, label, type]) => {
    const section = text('section', '', 'rail-section'); const heading = text('div', '', 'rail-heading');
    const more = text('button', 'Ver todo →'); more.onclick = () => browseCatalog(id); heading.append(text('h2', label), more);
    const rail = text('div', '', 'rail'); section.append(heading, rail); $('home-rails').append(section);
    try { const data = await api('catalog', { id, type }); draw(data.metas || [], false, rail); if (!data.metas?.length) section.hidden = true; }
    catch (_) { rail.append(text('p', 'No se pudo cargar esta fila. Puedes reintentar desde la biblioteca.', 'fine')); }
  }));
}
function selectEpisode() {
  for (const b of $('episode-cards').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.episode === $('episode').value));
  $('selected-episode').textContent = `Temporada ${$('season').value} · ${$('episode').selectedOptions[0]?.textContent || ''}`;
}
function scrollToSources() { $('source-panel').scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }); }
$('choose').onclick = () => { if (state.selected?.type === 'series') selectEpisode(); loadStreams(); scrollToSources(); };
async function loadExtras(m, run) {
  try {
    const data = await api('extras', { id: m.id, type: m.type }); if (run !== state.detailRun) return;
    $('genres').replaceChildren(...(data.genres || []).map(g => text('span', g, 'chip')));
    for (const [label, value] of [['Duración', data.runtime && `${data.runtime} min`], ['Idioma', data.language?.toUpperCase()], ['Estado', data.status], ['Temporadas', data.seasons], ['Episodios', data.episodeCount]]) {
      if (!value) continue; const fact = text('div', '', 'fact'); fact.append(text('small', label), text('span', value)); $('facts').append(fact);
    }
    $('cast').replaceChildren();
    for (const c of data.cast || []) {
      const card = text('div', '', 'cast-card'); const src = imageUrl(c.image);
      if (src) { const img = document.createElement('img'); img.src = src; img.alt = ''; img.loading = 'lazy'; card.append(img); } else card.append(text('div', '', 'cast-placeholder'));
      card.append(text('strong', c.name), text('small', c.character)); $('cast').append(card);
    }
    $('cast-section').hidden = !data.cast?.length;
    $('trailers').replaceChildren();
    for (const t of data.trailers || []) { const a = text('a', '▷ ' + t.name, 'trailer-link'); const u = new URL(t.url); if (u.origin !== 'https://www.youtube.com') continue; a.href = u.href; a.target = '_blank'; a.rel = 'noopener noreferrer'; $('trailers').append(a); }
    $('trailer-section').hidden = !$('trailers').children.length;
    draw(data.recommendations || [], false, $('recommendations')); $('recommendation-section').hidden = !data.recommendations?.length;
  } catch (_) { /* Optional sections stay hidden; the title and sources remain usable. */ }
}
