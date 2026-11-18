'use strict';

// Inspección estática: el contenido remoto se trata como texto. Ni el AST ni
// el HTML autorizan una petición nueva; no se guardan valores ni URLs.
const { parse } = require('acorn');

const relevant = /\b(?:player|embeds?|servers?|iframe|ajax\w*)\b|admin-ajax|gnula/i;
const functions = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
const maxScript = 384 * 1024;
const maxScripts = 12;
const maxNodes = 25000;
const summary = (items, cap = 8) => [...new Set(items)].filter(Boolean).slice(0, cap).join(', ') || '—';
const literal = (node) => node?.type === 'Literal' && typeof node.value === 'string' ? node.value : '';
const word = (node) => node?.type === 'Identifier' ? node.name : literal(node);

function reference(node, depth = 0) {
  if (!node || depth > 5) return '';
  if (node.type === 'Identifier') return node.name;
  if (node.type !== 'MemberExpression') return '';
  const base = reference(node.object, depth + 1);
  const key = node.computed ? literal(node.property) : word(node.property);
  return base && /^[a-z_$][\w$]{0,31}$/i.test(key) ? `${base}.${key}` : '';
}

function route(raw, page) {
  if (!/^(?:https:\/\/|\/)/i.test(raw)) return '';
  try {
    const url = new URL(raw, page);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return '';
    if (url.origin !== new URL(page).origin) return 'otro origen';
    if (url.pathname === '/wp-admin/admin-ajax.php') return 'AJAX WordPress';
    if (url.pathname.startsWith('/wp-json/')) return 'REST WordPress';
    if (/(?:^|\/)(?:embed|player|play|reproductor)(?:[/-]|\.php$|$)/i.test(url.pathname)) return 'visor del sitio';
    return 'mismo origen';
  } catch { return ''; }
}

function children(node, push) {
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value) if (typeof child?.type === 'string') push(child);
    } else if (typeof value?.type === 'string') push(value);
  }
}

function astNodes(script, sourceType) {
  let root;
  try { root = parse(script, { ecmaVersion: 'latest', sourceType }); } catch { return null; }
  const list = [];
  const stack = [{ node: root, scope: root }];
  while (stack.length && list.length < maxNodes) {
    const { node, scope } = stack.pop();
    const owner = functions.has(node.type) ? node : scope;
    list.push({ node, scope: owner });
    children(node, (child) => stack.push({ node: child, scope: owner }));
  }
  return stack.length ? null : list;
}

function properties(node) {
  return node?.type === 'ObjectExpression' ? node.properties.filter((p) => p.type === 'Property' && !p.computed) : [];
}

function setting(node, name) {
  return properties(node).find((p) => word(p.key) === name)?.value;
}

function inputKind(key) {
  if (/^(?:_?ajax_?nonce|_wpnonce|nonce|token|signature|hash|security|csrf)$/i.test(key)) return 'verificador';
  if (/^(?:action|accion)$/i.test(key)) return 'acción';
  if (/^(?:id|pid|post_?id|post|media_?id|episode_?id)$/i.test(key)) return 'id de contenido';
  if (/^(?:audio|lang|language|locale|idioma)$/i.test(key)) return 'idioma';
  if (/^(?:server|server_?id|index|idx|slot|num|number|quality)$/i.test(key)) return 'servidor/índice';
  if (/^(?:type|post_?type|media_?type)$/i.test(key)) return 'tipo';
  return '';
}

function callShape(node, formKinds, page) {
  const ref = reference(node.callee);
  if (!['fetch', 'window.fetch', '$.ajax', 'jQuery.ajax', '$.post', 'jQuery.post'].includes(ref)) return '';
  const [first, second] = node.arguments;
  const ajaxObject = ref.endsWith('.ajax') && first?.type === 'ObjectExpression';
  const options = ajaxObject ? first : second;
  // Un literal declarado en otra parte no demuestra que sea el destino de esta llamada.
  const dest = route(literal(ajaxObject ? setting(options, 'url') : first), page) || 'destino dinámico';
  const isFetch = ref.endsWith('fetch');
  const method = ref.endsWith('.post') ? 'POST' : literal(setting(options, 'method') || (!isFetch && setting(options, 'type'))).toUpperCase() || (options ? '?' : 'GET');
  const body = isFetch ? setting(options, 'body') : ref.endsWith('.post') ? second : setting(options, 'data');
  const encoded = body?.type === 'NewExpression' && ['URLSearchParams', 'FormData'].includes(reference(body.callee));
  const keys = properties(encoded ? body.arguments[0] : body).map((p) => inputKind(word(p.key)));
  const fields = [...keys, ...(formKinds?.get(reference(body)) || [])].filter(Boolean);
  return `${/^(?:GET|POST)$/.test(method) ? method : 'otro método o dinámico'} ${dest}${fields.length ? ` (${summary(fields)})` : ''}`;
}

function inspectScript(list, page) {
  const paths = new Set();
  const created = new Set();
  const signals = new Set();
  const formKinds = new Map();
  const requests = [];
  for (const { node, scope } of list) {
    if (node.type === 'Literal') {
      const kind = route(literal(node), page);
      if (['AJAX WordPress', 'REST WordPress', 'visor del sitio'].includes(kind)) paths.add(kind);
    }
    if (node.type === 'AssignmentExpression' && reference(node.left).endsWith('.onclick')) signals.add('clic');
    const ref = reference(node.callee);
    if (node.type === 'NewExpression' && ['Hls', 'window.Hls'].includes(ref)) signals.add('Hls');
    if (node.type !== 'CallExpression') continue;
    const key = ref.split('.').pop();
    const arg = literal(node.arguments[0]);
    if (['document.createElement', 'window.document.createElement'].includes(ref) && /^(?:video|iframe|source)$/i.test(arg)) created.add(arg.toLowerCase());
    if (key === 'addEventListener' && arg === 'click') signals.add('clic');
    if (key === 'play') signals.add('play()');
    if (key === 'loadSource') signals.add('loadSource()');
    if (key !== 'append' && key !== 'set') continue;
    const kind = inputKind(arg);
    const target = reference(node.callee.object);
    if (kind && target) {
      if (!formKinds.has(scope)) formKinds.set(scope, new Map());
      const fields = formKinds.get(scope);
      if (!fields.has(target)) fields.set(target, new Set());
      fields.get(target).add(kind);
    }
  }
  for (const { node, scope } of list) {
    if (node.type !== 'CallExpression') continue;
    const call = callShape(node, formKinds.get(scope), page);
    if (call) requests.push(call);
  }
  return { paths: [...paths], created: [...created], signals: [...signals], requests };
}

function structuredData($) {
  const types = [];
  let videos = 0;
  let content = 0;
  let embeds = 0;
  for (const node of $('script[type="application/ld+json"]').toArray().slice(0, 8)) {
    const source = $(node).html() || '';
    if (!source || source.length > 64 * 1024) continue;
    let value;
    try { value = JSON.parse(source); } catch { continue; }
    const stack = [value];
    for (let n = 0; n < 500 && stack.length; n++) {
      const item = stack.pop();
      if (!item || typeof item !== 'object') continue;
      const kinds = [].concat(item['@type'] || []);
      for (const kind of kinds) if (['Movie', 'TVSeries', 'TVEpisode', 'VideoObject', 'WebPage'].includes(kind)) types.push(kind);
      if (kinds.includes('VideoObject')) {
        videos++;
        if (typeof item.contentUrl === 'string' && item.contentUrl) content++;
        if (typeof item.embedUrl === 'string' && item.embedUrl) embeds++;
      }
      for (const child of Object.values(item)) if (child && typeof child === 'object') stack.push(child);
    }
  }
  const social = $('meta[property^="og:video"],meta[name="twitter:player"]').length;
  return `JSON-LD=${summary(types)} (VideoObject=${videos}, contentUrl=${content}, embedUrl=${embeds}); meta de vídeo=${social}`;
}

function inspectInline($, page) {
  const candidates = $('script:not([src])').toArray().map((node) => ({ type: $(node).attr('type'), text: $(node).html() || '' }))
    .filter(({ type, text }) => (!type || ['module', 'text/javascript', 'application/javascript'].includes(type)) && relevant.test(text));
  const groups = candidates.slice(0, maxScripts).map(({ type, text }) => text.length <= maxScript ? astNodes(text, type === 'module' ? 'module' : 'script') : null).filter(Boolean);
  const scripts = groups.map((list) => inspectScript(list, page));
  const players = scripts.filter(({ created, signals }) => created.length || signals.includes('Hls'));
  const others = scripts.filter((script) => !players.includes(script));
  const combine = (rows, key) => summary(rows.flatMap((row) => row[key]));
  return `JS analizado=${groups.length}/${candidates.length}; destinos declarados=${combine(scripts, 'paths')}; `
    + `scripts con señales de reproductor=${players.length}; crea=${combine(players, 'created')}; `
    + `señales en esos scripts=${combine(players, 'signals')}; llamadas en esos scripts=${combine(players, 'requests')}; `
    + `llamadas en otros scripts=${combine(others, 'requests')}; ${structuredData($)}`;
}

module.exports = { inspectInline };
