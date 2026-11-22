'use strict';

const { buildDefs } = require('./catalogs');
const { escapeHtml } = require('./rails');
const GROUPS = [['discover', '01', 'Para descubrir', 'Tendencias, estrenos y selecciones para empezar.'], ['platform', '02', 'Tus plataformas', 'Cada servicio, en su propio espacio.'], ['genre', '03', 'Por género', 'Encuentra una historia para cada momento.']];
const groupOf = (def) => ['platform', 'studio'].includes(def.kind) ? def.kind : ['genre', 'miniseries'].includes(def.kind) ? 'genre' : 'discover';
function explorerHtml() {
  const defs = buildDefs(null);
  return `<section class="wrap section catalog-explorer" id="catalogos" aria-labelledby="explorerTitle">
    <div class="head-row"><div><span class="eyebrow">Tu biblioteca, en orden</span><h2 class="title" id="explorerTitle">Menos buscar.<br><em>Más descubrir.</em></h2><p class="subtitle">Explora los catálogos disponibles. Personaliza cuáles aparecen en Stremio.</p></div><a class="btn btn-ghost" href="/configure#plataformas">Organizar mis catálogos ↗</a></div>
    <div class="explorer-toolbar"><label class="explorer-search"><span aria-hidden="true">⌕</span><input id="catalogSearch" type="search" placeholder="Buscar Netflix, anime, comedia…" aria-label="Buscar catálogos" /></label><label class="explorer-type">Contenido <select id="catalogType"><option value="all">Todo</option><option value="movie">Películas</option><option value="series">Series</option></select></label><span id="catalogCount" role="status" aria-live="polite">${defs.length} catálogos</span></div>
    <div class="explorer-groups">${GROUPS.map(([key, number, title, description]) => `<details class="explorer-group" open><summary><span class="group-number">${number}</span><span><strong>${title}</strong><small>${description}</small></span><span class="group-toggle" aria-hidden="true">＋</span></summary><div class="catalog-grid">${defs.filter((d) => groupOf(d) === key).map((d) => `<a class="catalog-item" data-catalog-type="${d.type}" data-catalog-name="${escapeHtml(d.name)}" href="/configure#${key === 'platform' ? 'plataformas' : 'catalogos'}"><span class="catalog-symbol" aria-hidden="true">${d.type === 'movie' ? '▰' : '▤'}</span><span><b>${escapeHtml(d.name)}</b><small>${d.type === 'movie' ? 'Películas' : 'Series'}</small></span><span class="catalog-arrow" aria-hidden="true">↗</span></a>`).join('')}</div></details>`).join('')}</div><p id="catalogEmpty" hidden>No encontramos ese catálogo. Prueba otro nombre o cambia el tipo de contenido.</p>
    <p class="explorer-note">Los catálogos organizan títulos; la disponibilidad depende de tu región y de las fuentes externas.</p>
  </section>`;
}
const EXPLORER_JS = `(function(){
  var search = document.getElementById('catalogSearch');
  var type = document.getElementById('catalogType');
  if (!search || !type) return;
  var normalize = function(s){return s.normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toLowerCase().trim();};
  function filter(){
    var count=0; var query=normalize(search.value);
    document.querySelectorAll('.explorer-group').forEach(function(group){
      var matches=0;
      group.querySelectorAll('.catalog-item').forEach(function(card){
        var show=(type.value==='all'||card.dataset.catalogType===type.value)&&normalize(card.dataset.catalogName).includes(query);
        card.hidden=!show; if(show)matches++;
      });
      group.hidden=!matches; if(query)group.open=true; count+=matches;
    });
    document.getElementById('catalogCount').textContent=count+' catálogos';
    document.getElementById('catalogEmpty').hidden=count!==0;
  }
  search.addEventListener('input',filter);type.addEventListener('change',filter);
})();`;
module.exports = { explorerHtml, EXPLORER_JS, groupOf };
