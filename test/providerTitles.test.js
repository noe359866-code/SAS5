'use strict';

/**
 * Identidad de títulos: el mismo nombre escrito de otra forma.
 *
 * Las fuentes guardan el título como se les antoja («IntensaMente 2»,
 * «Spider-Man: Un Nuevo Día», «El Origen (2010)»), y el addon busca con el que
 * le da TMDB en español («Intensa-Mente 2»). Medido el 20-11-2026 en
 * `.probe/movies-reach.md`: los buscadores de Cuevana 3, Allpelículas y LaMovie
 * devuelven la película para «Intensamente 2» y **cero resultados** para
 * «Intensa-Mente 2».
 */

const test = require('node:test');
const assert = require('node:assert');

const { normalizeText, squash, titleScore, titleQueries, catalogYear } = require('../lib/providerTitles');

test('títulos: la forma pegada y la separada son el mismo título', () => {
  assert.equal(titleScore(['IntensaMente 2 (2024)'], ['Intensa-Mente 2']), 2);
  assert.equal(titleScore(['Spiderman: Un Nuevo Dia (2026)'], ['Spider-Man: Un nuevo día']), 2);
  assert.equal(squash('Intensa-Mente 2'), squash('IntensaMente 2'));
  assert.equal(squash('Spider-Man'), 'spiderman');
  assert.equal(normalizeText('Intensa-Mente 2'), 'intensa mente 2');
});

test('títulos: el artículo suelto sigue siendo una coincidencia secundaria', () => {
  assert.equal(titleScore(['Origen (2010)'], ['El Origen']), 1);
  assert.equal(titleScore(['The Pitt (2025)'], ['Pitt']), 1);
});

test('títulos: otra película no se acepta por parecerse', () => {
  assert.equal(titleScore(['IntensaMente 2 (2024)'], ['Intensa-Mente 3']), 0);
  assert.equal(titleScore(['El Origen (2010)'], ['El Origen de los vampiros']), 0);
  assert.equal(titleScore(['IntensaMente (2015)'], ['Intensa-Mente 2']), 0);
});

test('búsquedas: las variantes del título pedido van antes que el título original', () => {
  const queries = titleQueries(['Intensa-Mente 2', 'Inside Out 2']);
  assert.deepEqual(queries.slice(0, 3), ['Intensa-Mente 2', 'IntensaMente 2', 'Intensa Mente 2']);
  assert.ok(queries.includes('Inside Out 2'));
  // Sin duplicados y sin cadenas vacías.
  assert.equal(new Set(queries).size, queries.length);
  assert.ok(queries.every((query) => query.length > 0));
});

test('búsquedas: los signos del título se quedan, además, en blanco', () => {
  assert.deepEqual(titleQueries(['Deadpool & Wolverine']), ['Deadpool & Wolverine', 'Deadpool Wolverine']);
  assert.ok(titleQueries(['Spider-Man: Un nuevo día']).includes('Spider Man Un nuevo día'));
});

test('títulos: el año sale de la ficha aunque venga pegado al título', () => {
  assert.equal(catalogYear({ title: 'IntensaMente 2 (2024)' }), 2024);
  assert.equal(catalogYear({ release_date: '2010-07-16' }), 2010);
  assert.equal(catalogYear({ year: '2008' }), 2008);
});
