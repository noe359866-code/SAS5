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
function draw(items, append = false) {
  if (!append) $('grid').replaceChildren();
  for (const m of items) {
    const card = text('button', '', 'card');
    const src = imageUrl(m.poster);
    if (src) { const img = document.createElement('img'); img.src = src; img.alt = ''; img.loading = 'lazy'; img.addEventListener('error', () => img.replaceWith(text('div', '', 'poster-placeholder')), { once: true }); card.append(img); }
    else card.append(text('div', '', 'poster-placeholder'));
    card.append(text('strong', m.name), text('small', [m.releaseInfo, m.imdbRating ? `★ ${m.imdbRating}` : '', m.type === 'series' ? 'Serie' : 'Película'].filter(Boolean).join(' · ')));
    card.onclick = () => openDetail(m); $('grid').append(card);
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
    if (!append && metas[0]) { backdrop($('hero'), metas[0].background); $('hero-action').textContent = 'Descubrir ' + metas[0].name; $('hero-action').onclick = () => openDetail(metas[0]); }
  } catch (e) { if (run === state.listRun) { $('status').textContent = e.message; $('more').disabled = false; if (append) { state.page--; $('more').hidden = false; $('more').textContent = 'Reintentar'; } } }
}
function updateSave() { $('save').textContent = saved.some(m => m.id === state.selected?.id && m.type === state.selected?.type) ? '✓ En mi lista' : '＋ Mi lista'; }
function stopPlayer() { $('player').removeAttribute('src'); $('playback').hidden = true; $('player-status').textContent = ''; }
async function openDetail(m) {
  const run = ++state.detailRun; ++state.streamRun; ++state.episodeRun; state.selected = m;
  stopPlayer(); $('detail-title').textContent = m.name; $('detail-kind').textContent = m.type === 'series' ? 'SERIE · ELIGE UN EPISODIO' : 'PELÍCULA';
  $('description').textContent = m.description || ''; $('detail-info').textContent = [m.releaseInfo, m.imdbRating && `★ ${m.imdbRating}`].filter(Boolean).join(' · ');
  backdrop($('detail-art'), m.background); $('sources').replaceChildren(); $('source-status').textContent = 'Cargando ficha…'; $('episodes').hidden = true; updateSave();
  $('detail').showModal();
  try {
    const data = await api('meta', { id: m.id, type: m.type }); if (run !== state.detailRun) return;
    const meta = data.meta || m; $('description').textContent = meta.description || m.description || ''; backdrop($('detail-art'), meta.background || m.background);
    if (m.type === 'series') await loadEpisodes(run); else await loadStreams(run);
  } catch (e) { if (run === state.detailRun) $('source-status').textContent = e.message; }
}
async function loadEpisodes(detailRun, season) {
  const run = ++state.episodeRun; ++state.streamRun; stopPlayer(); $('sources').replaceChildren(); $('source-status').textContent = 'Cargando episodios…'; $('season').disabled = true; $('episode').disabled = true;
  try {
    const data = await api('episodes', { id: state.selected.id, ...(season ? { season } : {}) });
    if (detailRun !== state.detailRun || run !== state.episodeRun) return;
    $('episodes').hidden = false;
    if (!season) $('season').replaceChildren(...data.seasons.map(s => { const o = text('option', s.name || `Temporada ${s.season_number}`); o.value = s.season_number; return o; }));
    $('episode').replaceChildren(...data.episodes.map(e => { const o = text('option', `${e.number}. ${e.name}`); o.value = e.number; return o; }));
    $('season').disabled = false; $('episode').disabled = false;
    if (!data.episodes.length) { $('source-status').textContent = 'No hay episodios disponibles para esta temporada.'; return; }
    await loadStreams(detailRun);
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
      b.onclick = () => play(stream); $('sources').append(b);
    }
    const retry = text('button', 'Volver a buscar'); retry.onclick = () => loadStreams(); $('sources').append(retry);
  } catch (e) { if (run === state.streamRun && detailRun === state.detailRun) { $('source-status').textContent = e.message; const retry = text('button', 'Reintentar'); retry.onclick = () => loadStreams(); $('sources').append(retry); } }
}
let playingData = null;
function play(stream) {
  const params = new URLSearchParams({ xt: `urn:btih:${stream.infoHash}`, dn: state.selected.name });
  for (const source of stream.sources || []) if (source.startsWith('tracker:')) params.append('tr', source.slice(8));
  playingData = { magnet: 'magnet:?' + params, title: state.selected.name };
  $('playback').hidden = false; $('playing').textContent = state.selected.name; $('player-status').textContent = 'Conectando con Webtor… Si no inicia, prueba otra fuente.';
  $('player').src = '/watch/player.html'; $('playback').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
window.addEventListener('message', event => {
  if (event.source !== $('player').contentWindow) return;
  if (event.data?.type === 'watch-ready' && playingData) $('player').contentWindow.postMessage({ type: 'watch-play', ...playingData }, '*');
  if (event.data?.type === 'watch-error') $('player-status').textContent = 'Webtor no pudo cargar. Prueba otra fuente o abre el contenido en Stremio.';
  if (event.data?.type === 'watch-loaded') $('player-status').textContent = 'Webtor cargado. El inicio depende de la disponibilidad del torrent.';
});
$('stop').onclick = stopPlayer; $('close').onclick = () => $('detail').close();
$('detail').addEventListener('close', () => { ++state.detailRun; ++state.streamRun; ++state.episodeRun; stopPlayer(); state.selected = null; playingData = null; });
$('season').onchange = () => loadEpisodes(state.detailRun, $('season').value); $('episode').onchange = () => loadStreams();
$('save').onclick = () => { const m = state.selected; const exists = saved.some(i => i.id === m.id && i.type === m.type); saved = exists ? saved.filter(i => i.id !== m.id || i.type !== m.type) : [...saved, m].slice(-200); try { localStorage.setItem('catalogos-watch-list', JSON.stringify(saved)); } catch (_) { $('source-status').textContent = 'El navegador no permite guardar la lista de forma permanente.'; } updateSave(); if (state.tab === 'saved') load(); };
for (const b of document.querySelectorAll('[data-tab]')) b.onclick = () => { state.tab = b.dataset.tab; state.search = ''; $('query').value = ''; $('reset').hidden = true; for (const n of document.querySelectorAll('[data-tab]')) n.setAttribute('aria-pressed', n === b ? 'true' : 'false'); $('page-title').textContent = b.textContent === 'Inicio' ? 'Ver ahora' : b.textContent; $('catalog').disabled = state.tab === 'saved'; fillCatalogs(); load(); };
$('catalog').onchange = () => { state.search = ''; $('reset').hidden = true; load(); };
$('search').onsubmit = e => { e.preventDefault(); state.search = $('query').value.trim(); if (state.tab === 'saved') { state.tab = 'all'; fillCatalogs(); } $('reset').hidden = !state.search; load(); };
$('reset').onclick = () => { state.search = ''; $('query').value = ''; $('reset').hidden = true; load(); };
$('search-type').onchange = () => { if (state.search) load(); };
$('more').onclick = () => { $('more').disabled = true; state.page++; load(true); };
$('hero-action').onclick = () => $('catalog').focus();
api('catalogs').then(data => { state.catalogs = data.catalogs; fillCatalogs(); load(); }).catch(e => { $('status').textContent = e.message; });
