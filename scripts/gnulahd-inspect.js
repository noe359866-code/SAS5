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
  const stack = [{ node: root, parent: null, scope: root }];
  while (stack.length && list.length < maxNodes) {
    const { node, parent, scope } = stack.pop();
    const owner = functions.has(node.type) ? node : scope;
    list.push({ node, parent, scope: owner });
    children(node, (child) => stack.push({ node: child, parent: node, scope: owner }));
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

function observedRequests(groups, page) {
  const paths = new Set();
  const bindings = new Map();
  function remember(ref, value, depth = 0) {
    if (!ref || depth > 3) return;
    const kind = route(literal(value), page);
    if (kind && kind !== 'otro origen') {
      if (kind !== 'mismo origen') paths.add(kind);
      const previous = bindings.get(ref);
      // Un nombre reutilizado no permite atribuir el destino de una llamada.
      bindings.set(ref, previous && previous !== kind ? 'destino variable' : kind);
    }
    for (const prop of properties(value)) {
      const key = word(prop.key);
      if (/^[a-z_$][\w$]{0,31}$/i.test(key)) remember(`${ref}.${key}`, prop.value, depth + 1);
    }
  }
  const formKinds = new Map();
  const frames = new Set();
  for (const list of groups) for (const { node, scope } of list) {
    if (node.type === 'VariableDeclarator') remember(reference(node.id), node.init);
    if (node.type === 'AssignmentExpression' && node.operator === '=') remember(reference(node.left), node.right);
    if (node.type === 'Literal') {
      const kind = route(literal(node), page);
      if (['AJAX WordPress', 'REST WordPress', 'visor del sitio'].includes(kind)) paths.add(kind);
    }
    if (node.type !== 'CallExpression') continue;
    const key = reference(node.callee).split('.').pop();
    if (key === 'createElement' && /^(?:video|iframe|source)$/i.test(literal(node.arguments[0]))) frames.add(literal(node.arguments[0]).toLowerCase());
    if (key !== 'append' && key !== 'set') continue;
    const kind = inputKind(literal(node.arguments[0]));
    if (kind) {
      if (!formKinds.has(scope)) formKinds.set(scope, new Map());
      const target = reference(node.callee.object);
      const fields = formKinds.get(scope);
      if (target && !fields.has(target)) fields.set(target, new Set());
      fields.get(target)?.add(kind);
    }
  }
  const requests = [];
  for (const list of groups) for (const { node, scope } of list) {
    if (node.type !== 'CallExpression') continue;
    const ref = reference(node.callee);
    if (!['fetch', 'window.fetch', '$.ajax', 'jQuery.ajax', '$.post', 'jQuery.post'].includes(ref)) continue;
    const [first, second] = node.arguments;
    const options = ref.endsWith('.ajax') && first?.type === 'ObjectExpression' ? first : second;
    const target = options === first ? setting(options, 'url') : first;
    const dest = route(literal(target), page) || bindings.get(reference(target)) || 'destino dinámico';
    if (dest === 'otro origen') continue;
    const isFetch = ref.endsWith('fetch');
    const method = ref.endsWith('.post') ? 'POST' : literal(setting(options, 'method') || setting(options, 'type')).toUpperCase() || (options ? '?' : 'GET');
    const body = isFetch ? setting(options, 'body') : ref.endsWith('.post') ? second : setting(options, 'data');
    const encoded = body?.type === 'NewExpression' && ['URLSearchParams', 'FormData'].includes(reference(body.callee));
    const keys = properties(encoded ? body.arguments[0] : body).map((p) => inputKind(word(p.key)));
    const fields = [...keys, ...(formKinds.get(scope)?.get(reference(body)) || [])].filter(Boolean);
    requests.push(`${/^(?:GET|POST)$/.test(method) ? method : 'método no literal'} ${dest}${fields.length ? ` (${summary(fields)})` : ''}`);
  }
  return { paths: summary(paths), requests: summary(requests), created: summary(frames) };
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
  const evidence = observedRequests(groups, page);
  return `JS analizado=${groups.length}/${candidates.length}; destinos declarados=${evidence.paths}; llamadas estáticas=${evidence.requests}; crea=${evidence.created}; ${structuredData($)}`;
}

module.exports = { inspectInline };
