'use strict';

/**
 * Tests del saneado de texto de TMDB/TVMaze (lib/sanitize.js).
 *
 * Motivo: el addon publicaba tal cual la publicidad que alguien había metido en
 * los `overview` y hasta en los `title`/`name` de TMDB
 * (docs/pruebas-en-vivo-2026-11-17.md).
 */

const test = require('node:test');
const assert = require('node:assert');
const { cleanTitle, cleanOverview, hasSpam } = require('../lib/sanitize');

test('cleanOverview: quita el gancho de «Busca … en Google» y el dominio', () => {
  const input = '¿Buscas películas y series gratis? ¡Busca Vercineo.net en Google!  Un mágico unicornio que canta retiene a su elenco.';
  assert.equal(cleanOverview(input), 'Un mágico unicornio que canta retiene a su elenco.');
});

test('cleanOverview: quita «ver gratis in …» al principio de la sinopsis', () => {
  assert.equal(
    cleanOverview('ver gratis in vercineo.net El poder está en juego cuando los Harrigan.'),
    'El poder está en juego cuando los Harrigan.'
  );
});

test('cleanOverview: quita la marca en camelCase con extensión (VerGratisEnSITIO.NET)', () => {
  assert.equal(
    cleanOverview('VerGratisEnVERCINEO.NET Un ingenuo entrenador de fútbol americano decide probar suerte.'),
    'Un ingenuo entrenador de fútbol americano decide probar suerte.'
  );
});

test('cleanOverview: conserva el texto legítimo intacto', () => {
  const ok = 'El detective vive en Londres. Su hija estudia en Oxford. Fin.';
  assert.equal(cleanOverview(ok), ok);
  assert.equal(cleanOverview('Matrix 2.0 la secuela.'), 'Matrix 2.0 la secuela.');
  assert.equal(cleanOverview('Sinopsis normal con dos frases. Y una segunda frase.'),
    'Sinopsis normal con dos frases. Y una segunda frase.');
});

test('cleanOverview: descarta la frase que aún lleva un dominio no catalogado', () => {
  assert.equal(
    cleanOverview('Visita ejemplo.com para saber más. La trama real empieza aquí.'),
    'La trama real empieza aquí.'
  );
});

test('cleanOverview: solo publicidad → cadena vacía', () => {
  assert.equal(cleanOverview('¿Buscas películas y series gratis? ¡Busca Vercineo.net en Google!'), '');
});

test('cleanTitle: recorta el anuncio pegado al nombre', () => {
  assert.equal(cleanTitle('Pokémon ¡Busca Vercineo.net en Google!'), 'Pokémon');
  assert.equal(cleanTitle('Anatomía de Grey ¡Busca Vercineo.net en Google!'), 'Anatomía de Grey');
});

test('cleanTitle: no toca títulos legítimos con puntos ni siglas', () => {
  for (const title of ['The Matrix', 'Blade Runner 2049', 'S.W.A.T.', 'Dr. House', 'Spider-Man: No Way Home', 'Ted Lasso']) {
    assert.equal(cleanTitle(title), title);
  }
});

test('cleanTitle: un nombre que era solo el anuncio queda vacío (no se republica)', () => {
  assert.equal(cleanTitle('¿Buscas películas y series gratis? ¡Busca Vercineo.net en Google!'), '');
});

test('cleanTitle/cleanOverview: respetan null y undefined', () => {
  assert.equal(cleanTitle(null), null);
  assert.equal(cleanOverview(undefined), undefined);
  assert.equal(cleanTitle(''), '');
});

test('hasSpam: detecta publicidad y no da falsos positivos', () => {
  assert.equal(hasSpam('¿Buscas películas y series gratis? ¡Busca Vercineo.net en Google!'), true);
  assert.equal(hasSpam('VerGratisEnVERCINEO.NET algo'), true);
  assert.equal(hasSpam('Una sinopsis normal sobre un detective.'), false);
  assert.equal(hasSpam('Matrix 2.0 la secuela.'), false);
  assert.equal(hasSpam(''), false);
});
