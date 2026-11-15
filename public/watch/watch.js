'use strict';
const $ = id => document.getElementById(id);
const state = { catalogs: [], tab: 'all', page: 1, search: '', items: [], selected: null, listRun: 0, detailRun: 0, streamRun: 0, episodeRun: 0 };

// Profiles: the people who share this browser. Each one has its own list and its own preferences.
// Everything stays in localStorage: there are no accounts and nothing is sent to the server. With
// storage blocked the page still works; profiles and lists then last for the visit only.
const PROFILE_STORE = 'catalogos-watch-profiles', LIST_STORE = 'catalogos-watch-list', PROFILE_CHOSEN = 'catalogos-watch-profile-chosen', EXTENSIONS_CLOSED = 'catalogos-extensions-closed';
const MAX_PROFILES = 5, MAX_LIST = 200;
const COLORS = { blue: 'Azul', violet: 'Violeta', pink: 'Rosa', red: 'Rojo', orange: 'Naranja', green: 'Verde', teal: 'Turquesa', graphite: 'Grafito' }; // the tones are in watch.css
const SYMBOLS = { '': 'Inicial', star: 'Estrella', heart: 'Corazón', zap: 'Rayo', moon: 'Luna', ghost: 'Fantasma', crown: 'Corona', rocket: 'Cohete' };
const PREF_OPTIONS = { home: ['all', 'movie', 'series', 'anime', 'saved'], searchType: ['movie', 'series'], player: ['embed', 'tab'], posters: ['small', 'medium', 'large'] };
const DEFAULT_PREFS = { home: 'all', searchType: 'movie', player: 'embed', posters: 'medium', autoSources: false, reduceMotion: false };
const store = {
  get(key) { try { return localStorage.getItem(key); } catch (_) { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); return true; } catch (_) { return false; } },
  remove(key) { try { localStorage.removeItem(key); } catch (_) { /* nothing was stored */ } },
  json(key) { try { return JSON.parse(this.get(key)); } catch (_) { return null; } },
};
const listKey = id => LIST_STORE + ':' + id;
const newProfileId = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const cleanName = value => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 20);
// Stored data is read back as untrusted input: unknown values fall back to the defaults.
function cleanPrefs(raw) {
  const prefs = { ...DEFAULT_PREFS };
  for (const key of Object.keys(prefs)) {
    const value = raw?.[key];
    if (PREF_OPTIONS[key] ? PREF_OPTIONS[key].includes(value) : typeof value === 'boolean') prefs[key] = value;
  }
  return prefs;
}
function cleanProfile(raw) {
  const name = cleanName(raw?.name);
  if (!name || typeof raw.id !== 'string' || !/^[a-z\d]{1,24}$/.test(raw.id)) return null;
  return { id: raw.id, name, color: Object.hasOwn(COLORS, raw.color) ? raw.color : 'blue', symbol: Object.hasOwn(SYMBOLS, raw.symbol) ? raw.symbol : '', prefs: cleanPrefs(raw.prefs) };
}
// A saved title keeps what its card and its sheet need, not the whole record (episode lists are large).
function cleanItem(raw) {
  if (!raw || typeof raw.id !== 'string' || !/^(tmdb:(movie|tv):\d+|tt\d+|tvmaze:\d+)$/.test(raw.id) || !['movie', 'series'].includes(raw.type)) return null;
  const item = { id: raw.id, type: raw.type, name: String(raw.name || 'Sin título').slice(0, 300) };
  for (const [key, max] of [['poster', 500], ['background', 500], ['releaseInfo', 40], ['imdbRating', 10], ['description', 2000]]) {
    if (typeof raw[key] === 'string' || typeof raw[key] === 'number') item[key] = String(raw[key]).slice(0, max);
  }
  return item;
}
function cleanList(raw) {
  const list = [];
  for (const entry of Array.isArray(raw) ? raw : []) {
    const item = cleanItem(entry);
    if (item && !list.some(i => i.id === item.id && i.type === item.type)) list.push(item);
  }
  return list.slice(-MAX_LIST);
}
const lists = new Map(); // profile id → titles; what the visit works with, written through to storage
let profiles = [], active, askProfile = true, saved = [];
function saveProfiles() { return store.set(PROFILE_STORE, JSON.stringify({ version: 1, active: active.id, ask: askProfile, profiles })); }
function listOf(id) { if (!lists.has(id)) lists.set(id, cleanList(store.json(listKey(id)))); return lists.get(id); }
function setSaved(list) { saved = list; lists.set(active.id, list); return store.set(listKey(active.id), JSON.stringify(list)); }
function readProfiles() {
  const raw = store.json(PROFILE_STORE);
  profiles = [];
  for (const entry of Array.isArray(raw?.profiles) ? raw.profiles : []) {
    const profile = cleanProfile(entry);
    if (profile && profiles.length < MAX_PROFILES && !profiles.some(p => p.id === profile.id)) profiles.push(profile);
  }
  askProfile = raw?.ask !== false;
  if (!profiles.length) {
    // First visit since profiles exist: the list this browser already had becomes the first profile's.
    active = { id: newProfileId(), name: 'Principal', color: 'blue', symbol: '', prefs: { ...DEFAULT_PREFS } };
    profiles.push(active);
    const before = cleanList(store.json(LIST_STORE));
    if (!saveProfiles()) { saved = before; lists.set(active.id, before); } else if (setSaved(before)) store.remove(LIST_STORE);
    return;
  }
  active = profiles.find(p => p.id === raw.active) || profiles[0];
  saved = listOf(active.id);
}
readProfiles();
const reducedMotion = () => active.prefs.reduceMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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
function stopPlayer() { clearTimeout(playerTimer); loadPlayer(); if ($('playback').open) $('playback').close(); $('player-status').textContent = ''; playingData = null; playingStream = null; }
async function openDetail(m) {
  const run = ++state.detailRun; ++state.streamRun; ++state.episodeRun; state.selected = m;
  stopPlayer(); $('detail-title').textContent = m.name; $('detail-kind').textContent = m.type === 'series' ? 'SERIE · ELIGE UN EPISODIO' : 'PELÍCULA';
  $('description').textContent = m.description || ''; $('detail-info').textContent = [m.releaseInfo, m.imdbRating && `★ ${m.imdbRating}`].filter(Boolean).join(' · ');
  backdrop($('detail-art'), m.background); $('sources').replaceChildren(); $('source-status').textContent = 'Cargando ficha…'; $('episodes').hidden = true; updateSave();
  $('browse').hidden = true; $('settings').hidden = true; $('detail').hidden = false;
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
    if (m.type === 'series') await loadEpisodes(run); else if (active.prefs.autoSources) loadStreams(run); else { $('source-status').textContent = 'Pulsa «Elegir fuente» para buscar torrents disponibles.'; }
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
let playingData = null, playingStream = null, playerTimer;
// The Webtor SDK runs code sent by webtor.io in the page that loads it. That page is built here as a
// data: document: its origin is always opaque, so it cannot reach this application's DOM or storage,
// and player.js refuses to start anywhere else. The webtor.io frame nested inside keeps its own origin
// (its player needs its storage and its job log), which sandboxing the origin of #player would take away.
function playerUrl() {
  return 'data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>Reproductor aislado</title><style>html,body{height:100%;margin:0;overflow:hidden;background:#000;color:#ccc;font:14px system-ui,sans-serif}#webtor{width:100%;height:100%}#webtor iframe{display:block;width:100%;height:100%;border:0}p{position:absolute;inset:0;margin:0;padding:16px;pointer-events:none}</style><script defer src="' + location.origin + '/watch/player.js"></script></head><body><div id="webtor"></div><p id="status">Preparando reproductor externo…</p></body></html>');
}
// Each playback gets a new frame, and stopping leaves an empty one. The first document of a new frame
// adds no entry to the browser history, so Back keeps leaving the title instead of replaying old players.
function loadPlayer(url) {
  if (!url && !$('player').hasAttribute('src')) return;
  const frame = $('player').cloneNode();
  if (url) frame.src = url; else frame.removeAttribute('src');
  $('player').replaceWith(frame);
}
const PLAYER_ERRORS = {
  sdk: ['No se pudo cargar Webtor', 'Comprueba tu conexión o si un bloqueador de contenido impide cargar el reproductor.'],
  timeout: ['Webtor tarda demasiado en cargar', 'Comprueba tu conexión y vuelve a intentarlo, o abre el contenido en una pestaña de Webtor.'],
  torrent: ['Webtor no pudo abrir este torrent', 'Vuelve a las fuentes y prueba otra copia, o ábrelo en una pestaña de Webtor.'],
  silent: ['El reproductor integrado no respondió', 'Puede que Webtor no ofrezca ahora la reproducción integrada o que el navegador la bloquee. Ábrelo en una pestaña de Webtor o prueba otra fuente.'],
};
function playerState(name, message) { $('playback').dataset.state = name; $('player-status').textContent = message; }
function playerFailed(reason) {
  clearTimeout(playerTimer);
  const [title, detail] = PLAYER_ERRORS[Object.hasOwn(PLAYER_ERRORS, reason) ? reason : 'silent'];
  $('stage-error-title').textContent = title; $('stage-error-text').textContent = detail;
  playerState('error', title + '.');
}
// Webtor reports nothing when its embed is switched off or blocked: silence is the only sign.
function expectPlayer(ms) { clearTimeout(playerTimer); playerTimer = setTimeout(() => playerFailed('silent'), ms); }
// The profile can send sources straight to a Webtor tab. The link stays on screen: a browser may block the tab.
function openInTab(magnet) {
  const link = text('a', 'Abrir en Webtor ↗', 'status-link'); link.href = 'https://webtor.io/' + magnet; link.target = '_blank'; link.rel = 'noopener noreferrer';
  $('source-status').replaceChildren('Se abre en una pestaña de Webtor. Si el navegador la bloquea, usa este enlace: ', link);
  link.click();
}
function play(stream) {
  const name = state.selected.name;
  // A literal urn:btih: keeps the magnet readable by every torrent client, not only by Webtor.
  let magnet = `magnet:?xt=urn:btih:${stream.infoHash.toLowerCase()}&dn=${encodeURIComponent(name)}`;
  for (const source of stream.sources || []) if (source.startsWith('tracker:')) magnet += '&tr=' + encodeURIComponent(source.slice(8));
  if (active.prefs.player === 'tab') { openInTab(magnet); return; }
  const art = imageUrl(state.selected.background);
  playingStream = stream; playingData = { magnet, title: name, poster: art };
  const details = String(stream.title || '').split('\n');
  $('playing-source').textContent = [stream.name, details.length > 1 ? details.at(-1) : ''].filter(Boolean).join(' · '); $('playing-source').title = details[0]; $('playing-source').hidden = !$('playing-source').textContent;
  for (const link of document.querySelectorAll('.open-webtor')) link.href = 'https://webtor.io/' + magnet;
  $('playback').style.setProperty('--art', art ? `url(${JSON.stringify(art)})` : 'none');
  if (!$('playback').open) $('playback').showModal(); $('playing-episode').textContent = $('selected-episode').textContent; $('playing').textContent = name;
  playerState('loading', 'Conectando con Webtor…'); expectPlayer(30000);
  loadPlayer(playerUrl());
  $('playback').focus({ preventScroll: true });
}
window.addEventListener('message', event => {
  if (event.source !== $('player').contentWindow || !$('playback').open || !playingData) return;
  // The frame runs third-party code: its messages only ever select one of our own texts.
  const type = event.data?.type, loading = $('playback').dataset.state === 'loading';
  if (type === 'watch-ready') $('player').contentWindow.postMessage({ type: 'watch-play', ...playingData }, '*');
  if (type === 'watch-loaded' && loading) expectPlayer(20000);
  if (type === 'watch-frame' && loading) expectPlayer(6000);
  if (type === 'watch-inited') { clearTimeout(playerTimer); playerState('ready', 'Reproductor listo. Pulsa ▶ para empezar.'); }
  if (type === 'watch-playing') playerState('ready', 'Reproduciendo con Webtor. El arranque depende de los seeders; si no avanza, prueba otra fuente.');
  if (type === 'watch-torrent-ready') playerState('ready', 'Torrent localizado. La reproducción depende de los seeders y del formato.');
  if (type === 'watch-error') playerFailed(event.data.reason);
});
$('stop').onclick = () => { stopPlayer(); scrollToSources(); $('sources').querySelector('button')?.focus(); };
$('retry-player').onclick = () => { if (playingStream) play(playingStream); };
$('copy-magnet').onclick = async () => {
  if (!playingData) return;
  let copied = false;
  try { await navigator.clipboard.writeText(playingData.magnet); copied = true; } catch (_) {
    // No clipboard permission or plain http: copy from a field inside the dialog (the rest of the page is inert).
    const field = document.createElement('textarea'); field.value = playingData.magnet; field.readOnly = true; field.className = 'sr-only';
    $('playback').append(field); field.select(); try { copied = document.execCommand('copy'); } catch (_) { /* reported below */ } field.remove();
  }
  $('copy-magnet').textContent = copied ? '✓ Magnet copiado' : 'No se pudo copiar'; setTimeout(() => { $('copy-magnet').textContent = 'Copiar magnet'; }, 2200);
};
$('playback').addEventListener('close', () => { if ($('playback').open) return; clearTimeout(playerTimer); loadPlayer(); playingData = null; playingStream = null; });
function closeDetail() { ++state.detailRun; ++state.streamRun; ++state.episodeRun; stopPlayer(); state.selected = null; $('detail').hidden = true; $('settings').hidden = true; $('browse').hidden = false; }
$('close').onclick = () => { closeDetail(); history.pushState(null, '', location.pathname + location.search); window.scrollTo(0, 0); };
window.addEventListener('popstate', route);
function route() {
  const match = /^#title\/(movie|series)\/(.+)$/.exec(location.hash);
  if (match) { let id; try { id = decodeURIComponent(match[2]); } catch (_) { return; } if (state.selected?.id !== id) openDetail({ type: match[1], id, name: 'Cargando…' }); }
  else if (location.hash === '#settings') { if ($('settings').hidden) openSettings(); }
  else if (!location.hash.startsWith('#title/')) closeDetail();
}
$('season').onchange = () => loadEpisodes(state.detailRun, $('season').value); $('episode').onchange = () => { selectEpisode(); loadStreams(); };
$('save').onclick = () => { const m = state.selected; const exists = saved.some(i => i.id === m.id && i.type === m.type); if (!setSaved(exists ? saved.filter(i => i.id !== m.id || i.type !== m.type) : [...saved, cleanItem(m) || m].slice(-MAX_LIST))) $('source-status').textContent = 'El navegador no permite guardar la lista de forma permanente.'; updateSave(); if (state.tab === 'saved') load(); };
function setTab(tab) {
  state.tab = tab; state.search = ''; $('query').value = ''; $('reset').hidden = true;
  for (const n of document.querySelectorAll('[data-tab]')) { const on = n.dataset.tab === tab; n.setAttribute('aria-pressed', on ? 'true' : 'false'); if (on) $('page-title').textContent = tab === 'all' ? 'Ver ahora' : n.textContent; }
  $('catalog').disabled = tab === 'saved'; $('discovery').hidden = tab !== 'all'; $('hero').hidden = tab !== 'all';
}
for (const b of document.querySelectorAll('[data-tab]')) b.onclick = () => { closeDetail(); history.replaceState(null, '', location.pathname + location.search); setTab(b.dataset.tab); fillCatalogs(); load(); };
$('catalog').onchange = () => { state.search = ''; $('reset').hidden = true; load(); };
$('search').onsubmit = e => { e.preventDefault(); state.search = $('query').value.trim(); if (state.tab === 'saved') { state.tab = 'all'; $('catalog').disabled = false; fillCatalogs(); } $('reset').hidden = !state.search; load(); };
$('reset').onclick = () => { state.search = ''; $('query').value = ''; $('reset').hidden = true; load(); };
$('search-type').onchange = () => { if (state.search) load(); };
$('more').onclick = () => { $('more').disabled = true; state.page++; load(true); };
$('hero-action').onclick = () => $('catalog').focus();
api('catalogs').then(data => { state.catalogs = data.catalogs; if (state.tab === 'all' && active.prefs.home !== 'all') setTab(active.prefs.home); fillCatalogs(); renderPlatforms(data.platforms || []); load(); loadHomeRails(data.configured); route(); }).catch(e => { $('status').textContent = e.message; });

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
function scrollToSources() { $('source-panel').scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'instant' : 'smooth' }); }
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

// Profiles and settings. The library above runs with the stored profile whatever happens here.
function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('class', 'icon'); svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use'); use.setAttribute('href', '#i-' + name); svg.append(use);
  return svg;
}
const initial = name => [...name][0].toLocaleUpperCase('es');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
function paintAvatar(el, profile) { el.dataset.color = profile.color; el.replaceChildren(profile.symbol ? icon(profile.symbol) : initial(profile.name)); }
function avatar(profile) { const el = text('span', '', 'avatar'); paintAvatar(el, profile); return el; }
// What a profile changes on the page: its colour, its poster size, its motion and the header button.
function applyProfile() {
  const root = document.documentElement;
  root.dataset.accent = active.color; root.dataset.posters = active.prefs.posters; root.toggleAttribute('data-reduce-motion', active.prefs.reduceMotion);
  paintAvatar($('profile-avatar'), active); $('profile-name').textContent = active.name;
  $('profile-button').setAttribute('aria-label', `Perfil de ${active.name}: abrir el menú`);
}
function chosen() { try { sessionStorage.setItem(PROFILE_CHOSEN, '1'); } catch (_) { /* asked again on the next load */ } }
function switchProfile(id) {
  const next = profiles.find(p => p.id === id); if (!next) return;
  const changed = next !== active;
  active = next; saved = listOf(active.id); saveProfiles(); chosen(); applyProfile();
  if (changed) enterProfile();
}
// A different person is watching: their list, their search type and their start section.
function enterProfile() {
  $('search-type').value = active.prefs.searchType;
  if (state.selected) updateSave();
  if (!$('settings').hidden) syncSettings();
  setTab(active.prefs.home); fillCatalogs();
  // Before the catalogues arrive there is nothing to list yet: their arrival loads this profile's section.
  if (state.catalogs.length || state.tab === 'saved') load();
}

// Destructive buttons ask once more in place (see twice() below). A redrawn screen disarms them:
// the second press must be about what the first one showed.
const armed = [];
function disarm() { for (const reset of armed) reset(); }

// Header menu.
function toggleMenu(open) {
  $('profile-menu').hidden = !open; $('profile-button').setAttribute('aria-expanded', String(open));
  if (!open) return;
  $('menu-profiles').replaceChildren(...profiles.map(p => {
    const b = text('button'); b.type = 'button'; b.append(avatar(p), text('span', p.name));
    if (p === active) { b.setAttribute('aria-current', 'true'); b.append(icon('check')); }
    b.onclick = () => { toggleMenu(false); switchProfile(p.id); };
    return b;
  }));
}
$('profile-button').onclick = () => toggleMenu($('profile-menu').hidden);
$('menu-settings').onclick = () => { toggleMenu(false); openSettings(); };
$('menu-manage').onclick = () => { toggleMenu(false); openProfiles({ manage: true }); };
document.addEventListener('click', event => { if (!$('profile-menu').hidden && !event.target.closest('.account')) toggleMenu(false); });
document.querySelector('.account').addEventListener('keydown', event => { if (event.key === 'Escape' && !$('profile-menu').hidden) { toggleMenu(false); $('profile-button').focus(); } });
document.querySelector('.account').addEventListener('focusout', event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) toggleMenu(false); });

// Picker and editor share one full-screen dialog: «¿Quién está viendo?», manage mode and the profile form.
let managing = false, editing = null, draft = null, editorBack = false;
function openProfiles({ manage = false, edit } = {}) {
  managing = manage; showPicker();
  if (!$('profiles').open) $('profiles').showModal();
  if (edit) openEditor(edit, false); else $('profiles-title').focus({ preventScroll: true });
}
function showPicker() {
  $('profile-form').hidden = true; $('profiles-pick').hidden = false; $('profiles').setAttribute('aria-labelledby', 'profiles-title');
  $('profiles').toggleAttribute('data-managing', managing);
  $('profiles-title').replaceChildren(...(managing ? ['Gestionar ', text('span', 'perfiles.')] : ['¿Quién está ', text('span', 'viendo?')]));
  $('profiles-manage').textContent = managing ? 'Listo' : 'Gestionar perfiles'; $('profiles-manage').setAttribute('aria-pressed', String(managing));
  const tiles = profiles.map(p => {
    const b = text('button', '', 'profile-tile'); b.type = 'button'; b.dataset.profile = p.id;
    const face = avatar(p); if (managing) { const badge = text('span', '', 'tile-edit'); badge.append(icon('pencil')); face.append(badge); }
    b.append(face, text('strong', p.name), text('small', p === active ? 'Perfil activo' : ''));
    b.setAttribute('aria-label', managing ? `Editar el perfil ${p.name}` : `Ver como ${p.name}${p === active ? ' (perfil activo)' : ''}`);
    b.onclick = () => { if (managing) openEditor(p, true); else { switchProfile(p.id); $('profiles').close(); } };
    return b;
  });
  if (profiles.length < MAX_PROFILES) {
    const add = text('button', '', 'profile-tile profile-add'); add.type = 'button'; add.id = 'profile-add';
    const face = text('span', '', 'avatar'); face.append(icon('plus')); add.append(face, text('strong', 'Añadir perfil'), text('small', ''));
    add.onclick = () => openEditor(null, true); tiles.push(add);
  }
  $('profile-tiles').replaceChildren(...tiles);
}
function options(target, names, key) {
  target.replaceChildren(...Object.entries(names).map(([value, label]) => {
    const option = text('label'); const input = document.createElement('input');
    input.type = 'radio'; input.className = 'sr-only'; input.name = 'profile-' + key; input.value = value; input.checked = draft[key] === value; input.setAttribute('aria-label', label);
    input.onchange = () => { draft[key] = value; paintDraft(); };
    const face = text('span'); if (key === 'color') face.dataset.color = value; else face.append(value ? icon(value) : 'Aa');
    option.append(input, face); return option;
  }));
}
function paintDraft() { paintAvatar($('editor-avatar'), { ...draft, name: cleanName(draft.name) || '?' }); $('profiles').dataset.accent = draft.color; }
// `back` says where Save and Cancel lead: to the picker, or out of the dialog (opened from the settings).
function openEditor(profile, back) {
  editing = profile; editorBack = back;
  draft = profile ? { name: profile.name, color: profile.color, symbol: profile.symbol } : { name: '', color: Object.keys(COLORS).find(c => !profiles.some(p => p.color === c)) || 'blue', symbol: '' };
  $('profiles-pick').hidden = true; $('profile-form').hidden = false; $('profiles').setAttribute('aria-labelledby', 'profile-form-title');
  $('profile-form-kind').textContent = profile ? 'EDITAR PERFIL' : 'NUEVO PERFIL';
  $('profile-form-title').replaceChildren(...(profile ? ['Edita ', text('span', 'el perfil.')] : ['Crea ', text('span', 'un perfil.')]));
  $('profile-name-input').value = draft.name; $('profile-error').textContent = '';
  options($('color-options'), COLORS, 'color'); options($('symbol-options'), SYMBOLS, 'symbol'); paintDraft();
  disarm(); $('profile-delete').hidden = !profile || profiles.length < 2;
  $('profile-name-input').focus();
}
function closeEditor() {
  delete $('profiles').dataset.accent;
  if (editorBack) { showPicker(); $('profiles-title').focus({ preventScroll: true }); } else $('profiles').close();
}
$('profile-name-input').oninput = () => { draft.name = $('profile-name-input').value; $('profile-error').textContent = ''; paintDraft(); };
$('profile-form').onsubmit = event => {
  event.preventDefault();
  const name = cleanName($('profile-name-input').value);
  const taken = profiles.some(p => p !== editing && p.name.toLocaleLowerCase('es') === name.toLocaleLowerCase('es'));
  if (!name || taken) { $('profile-error').textContent = name ? 'Ya hay un perfil con ese nombre.' : 'Escribe un nombre para el perfil.'; $('profile-name-input').focus(); return; }
  if (editing) Object.assign(editing, { name, color: draft.color, symbol: draft.symbol });
  else profiles.push({ id: newProfileId(), name, color: draft.color, symbol: draft.symbol, prefs: { ...DEFAULT_PREFS } });
  const stored = saveProfiles(); applyProfile(); if (!$('settings').hidden) syncSettings();
  closeEditor(); if (!stored) report(false);
};
$('profile-cancel').onclick = closeEditor;
twice($('profile-delete'), () => {
  store.remove(listKey(editing.id)); lists.delete(editing.id);
  profiles = profiles.filter(p => p !== editing);
  if (editing === active) { active = profiles[0]; saved = listOf(active.id); applyProfile(); enterProfile(); }
  saveProfiles(); if (!$('settings').hidden) syncSettings();
  editorBack = true; closeEditor();
});
$('profiles-manage').onclick = () => { managing = !managing; showPicker(); $('profiles-manage').focus(); };
$('profiles-close').onclick = () => $('profiles').close();
// Escape leaves the form first, and only then the dialog.
$('profiles').addEventListener('cancel', event => { if (!$('profile-form').hidden && editorBack) { event.preventDefault(); closeEditor(); } });
$('profiles').addEventListener('close', () => { delete $('profiles').dataset.accent; chosen(); });

// Destructive buttons ask once more in place: the second press within five seconds does it.
function twice(button, action) {
  const label = button.textContent; let timer;
  const reset = () => { clearTimeout(timer); button.removeAttribute('data-armed'); button.textContent = label; };
  armed.push(reset);
  button.addEventListener('click', () => {
    if (button.hasAttribute('data-armed')) { reset(); action(); return; }
    button.setAttribute('data-armed', ''); button.textContent = '¿Seguro? Pulsa otra vez'; timer = setTimeout(reset, 5000);
  });
  button.addEventListener('blur', reset);
}

// Settings page.
const HOME_NAMES = { all: 'Inicio', movie: 'Películas', series: 'Series', anime: 'Anime', saved: 'Mi lista' };
let settingsPushed = false, reportTimer;
// `message` true/false is the outcome of a write; a string is said as it is.
function report(message) {
  $('settings-status').textContent = message === true ? '✓ Guardado en este navegador' : message === false ? 'El navegador no permite guardar: el cambio dura solo esta visita.' : message;
  clearTimeout(reportTimer); reportTimer = setTimeout(() => { $('settings-status').textContent = ''; }, 3200);
}
function syncSettings() {
  const prefs = active.prefs; disarm();
  paintAvatar($('settings-avatar'), active); $('set-profile-title').textContent = active.name;
  $('settings-profile-meta').textContent = `${plural(saved.length, 'título', 'títulos')} en Mi lista · ${plural(profiles.length, 'perfil', 'perfiles')} en este navegador`;
  for (const input of $('settings').querySelectorAll('[data-pref]')) input.checked = input.type === 'radio' ? prefs[input.dataset.pref] === input.value : prefs[input.dataset.pref];
  $('settings-swatch').dataset.color = active.color; $('settings-color-name').textContent = COLORS[active.color];
  $('list-count').textContent = `${plural(saved.length, 'título guardado', 'títulos guardados')} de ${MAX_LIST} posibles. Exporta la lista para llevarla a otro perfil o navegador.`;
  $('list-export').disabled = $('list-clear').disabled = !saved.length;
  $('device-ask').checked = askProfile && profiles.length > 1; $('device-ask').disabled = profiles.length < 2;
  $('device-ask-help').textContent = profiles.length < 2 ? 'Añade otro perfil para elegir quién ve al empezar.' : 'Muestra la pantalla de perfiles al empezar cada sesión.';
  $('device-extensions').checked = store.get(EXTENSIONS_CLOSED) !== '1';
  const summary = {
    profile: active.name, home: `Abre en ${HOME_NAMES[prefs.home]}`, playback: prefs.player === 'tab' ? 'Pestaña de Webtor' : 'Reproductor integrado',
    look: `Pósters ${{ small: 'pequeños', medium: 'medianos', large: 'grandes' }[prefs.posters]}`, data: plural(saved.length, 'título', 'títulos'),
    device: plural(profiles.length, 'perfil', 'perfiles'), addon: 'Se configura aparte',
  };
  for (const el of $('settings').querySelectorAll('[data-summary]')) el.textContent = summary[el.dataset.summary];
}
function openSettings() {
  settingsPushed = location.hash !== '#settings';
  closeDetail(); $('browse').hidden = true; $('settings').hidden = false; syncSettings();
  if (settingsPushed) history.pushState(null, '', '#settings');
  window.scrollTo(0, 0); spyAfter = 0; markSection('set-profile'); $('settings-title').focus({ preventScroll: true });
}
// Back to where the settings were opened from (a title sheet reloads); a direct visit goes to the library.
$('settings-close').onclick = () => {
  if (settingsPushed) { settingsPushed = false; history.back(); return; }
  closeDetail(); history.pushState(null, '', location.pathname + location.search); window.scrollTo(0, 0);
};
$('settings').addEventListener('change', event => {
  const key = event.target.dataset.pref; if (!key) return;
  active.prefs = cleanPrefs({ ...active.prefs, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value });
  if (key === 'searchType') $('search-type').value = active.prefs.searchType;
  report(saveProfiles()); applyProfile(); syncSettings();
});
// The index marks the group being read. A group chosen from the index stays marked while the page travels
// to it: the last ones cannot reach the top of the window, and the position alone would name another.
let spyAfter = 0;
function markSection(id) { for (const b of $('settings-index').children) { if (b.dataset.section === id) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); } }
for (const b of $('settings-index').children) b.onclick = () => { spyAfter = Date.now() + 1000; markSection(b.dataset.section); $(b.dataset.section).scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'instant' : 'smooth' }); };
function spySettings() {
  if ($('settings').hidden || Date.now() < spyAfter) return;
  const groups = [...$('settings').querySelectorAll('.settings-group')];
  let current = groups[0];
  for (const g of groups) if (g.getBoundingClientRect().top <= 170) current = g;
  if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) current = groups.at(-1);
  markSection(current.id);
}
window.addEventListener('scroll', spySettings, { passive: true });
$('settings-edit').onclick = $('settings-color').onclick = () => openProfiles({ edit: active });
$('settings-switch').onclick = () => openProfiles();
$('prefs-reset').onclick = () => { active.prefs = { ...DEFAULT_PREFS }; $('search-type').value = active.prefs.searchType; const stored = saveProfiles(); applyProfile(); syncSettings(); report(stored ? 'Ajustes del perfil restablecidos.' : false); };
$('device-ask').onchange = () => { askProfile = $('device-ask').checked; report(saveProfiles()); };
$('device-extensions').onchange = () => {
  if ($('device-extensions').checked) { store.remove(EXTENSIONS_CLOSED); report('El aviso volverá a aparecer donde puedan instalarse.'); }
  else { $('extensions').hidden = true; report(store.set(EXTENSIONS_CLOSED, '1')); }
};
// The list travels as a file: there is no account to carry it between profiles or browsers.
$('list-export').onclick = () => {
  const file = JSON.stringify({ app: 'catalogos-plus', kind: 'watch-list', version: 1, profile: active.name, exported: new Date().toISOString(), items: saved }, null, 2);
  try {
    const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([file], { type: 'application/json' }));
    link.download = `mi-lista-${active.name.toLocaleLowerCase('es').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'perfil'}.json`;
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(link.href), 2000);
    report(`Lista exportada: ${plural(saved.length, 'título', 'títulos')}.`);
  } catch (_) { report('Este navegador no permite descargar el archivo.'); }
};
$('list-import').onclick = () => $('list-file').click();
$('list-file').onchange = async () => {
  const file = $('list-file').files[0]; $('list-file').value = ''; if (!file) return;
  let data = null;
  try {
    if (file.size <= 2e6) data = JSON.parse(await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsText(file); }));
  } catch (_) { /* reported below */ }
  const items = cleanList(Array.isArray(data) ? data : data?.items);
  if (!items.length) { report('Ese archivo no contiene una lista de Catálogos+.'); return; }
  const fresh = items.filter(item => !saved.some(i => i.id === item.id && i.type === item.type));
  const added = fresh.slice(0, MAX_LIST - saved.length);
  const stored = added.length ? setSaved([...saved, ...added]) : true;
  syncSettings(); if (state.tab === 'saved') load();
  report(!stored ? false : `${plural(added.length, 'título añadido', 'títulos añadidos')} a Mi lista.${items.length > fresh.length ? ` ${plural(items.length - fresh.length, 'ya estaba', 'ya estaban')}.` : ''}${fresh.length > added.length ? ` La lista admite ${MAX_LIST}.` : ''}`);
};
twice($('list-clear'), () => { const stored = setSaved([]); syncSettings(); if (state.tab === 'saved') load(); report(stored ? 'Mi lista está vacía.' : false); });
twice($('wipe-all'), () => {
  for (const p of profiles) store.remove(listKey(p.id));
  for (const key of [PROFILE_STORE, LIST_STORE, EXTENSIONS_CLOSED]) store.remove(key);
  try { sessionStorage.removeItem(PROFILE_CHOSEN); } catch (_) { /* nothing was stored */ }
  lists.clear(); readProfiles(); applyProfile(); enterProfile();
  report('Datos borrados. Empiezas con un perfil nuevo.');
});

applyProfile(); $('search-type').value = active.prefs.searchType;
// With more than one profile, each session starts by asking who is watching.
{
  let known = false;
  try { known = sessionStorage.getItem(PROFILE_CHOSEN) === '1'; } catch (_) { /* no storage: ask */ }
  if (profiles.length > 1 && askProfile && !known) openProfiles();
}

// Recommended extensions (Chrome Web Store). The card opens by itself only where they can be installed,
// a desktop Chromium browser, and only until the visitor closes it; the footer button opens it anywhere.
// Kept last: the library above is already running whatever happens here.
let extensionsOpener = null;
function installsChromeExtensions() {
  const data = navigator.userAgentData;
  if (data) return !data.mobile && data.platform !== 'Android';
  return /Chrome\//.test(navigator.userAgent) && !/Mobi|Android|TV|Web0S/.test(navigator.userAgent);
}
$('extensions-open').onclick = () => { extensionsOpener = $('extensions-open'); $('extensions').hidden = false; $('extensions').focus(); };
$('extensions-close').onclick = () => {
  $('extensions').hidden = true;
  try { localStorage.setItem(EXTENSIONS_CLOSED, '1'); } catch (_) { /* no storage: closed for this visit only */ }
  // Opened from the footer: give the focus back. Opened by itself: it never took the focus.
  if (extensionsOpener) { extensionsOpener.focus({ preventScroll: true }); extensionsOpener = null; }
};
$('extensions').onkeydown = event => { if (event.key === 'Escape') $('extensions-close').click(); };
{
  let closed = false;
  try { closed = localStorage.getItem(EXTENSIONS_CLOSED) === '1'; } catch (_) { /* no storage: offer it */ }
  if (!closed && installsChromeExtensions()) setTimeout(() => { $('extensions').hidden = false; }, 1500);
}
