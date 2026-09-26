import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

// genres.js y lastfm.js importan db.js, que abre una SQLite en DATA_DIR al cargarse. Apuntamos
// DATA_DIR a un temporal ANTES del import dinámico para no tocar la base real.
process.env.DATA_DIR = path.join(os.tmpdir(), `liderarr-test-genres-${Date.now()}`);
const { canonicalize, TAXONOMY } = await import('../src/genres.js');
const { mapTagAlbums } = await import('../src/lastfm.js');

// --- normalización de géneros ------------------------------------------------
// Los casos salen de la colección real (1.081 grafías distintas para 33.000 discos).

test('reconoce el género en español y en inglés como el mismo', () => {
  const es = canonicalize('Electrónica');
  const en = canonicalize('Electronic');
  assert.equal(es[0].top, 'electronica');
  assert.equal(en[0].top, 'electronica');
});

test('ignora mayúsculas, acentos y signos', () => {
  for (const raw of ['rock', 'ROCK', 'Rock']) {
    assert.equal(canonicalize(raw)[0].top, 'rock', `falla con «${raw}»`);
  }
});

test('la etiqueta compuesta que se reconoce ENTERA no se parte además en trozos', () => {
  // «Alternativa & Indie» es un género en sí mismo en muchos ripeos. Si además se partiera,
  // el disco contaría como «Rock alternativo» Y «Indie rock», inflando ambos subgéneros.
  const hits = canonicalize('Alternativa & Indie');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].top, 'indie');
  assert.equal(hits[0].sub, null);
});

test('la etiqueta compuesta que NO se reconoce entera sí se parte', () => {
  const hits = canonicalize('Jazz, Funk');
  const tops = hits.map((h) => h.top).sort();
  assert.deepEqual(tops, ['jazz', 'soul']);
});

test('el guion sin espacios NO parte el género', () => {
  // partir por «-» a secas rompería Hip-Hop, Post-punk o Trip-hop por la mitad
  assert.equal(canonicalize('Hip-Hop')[0].top, 'hiphop');
  assert.equal(canonicalize('Post-punk')[0].sub, 'Post-punk');
  assert.equal(canonicalize('Trip-hop')[0].sub, 'Trip-hop');
});

test('el guion CON espacios sí parte («Punk - New Wave»)', () => {
  const tops = canonicalize('Punk - New Wave').map((h) => h.top);
  assert.ok(tops.includes('punk'));
  assert.ok(tops.includes('indie')); // new wave cuelga de indie/alternativa
});

test('las etiquetas vacías de significado no clasifican', () => {
  for (const raw of ['Varios', 'Other', 'Unknown', 'Miscellaneous']) {
    assert.deepEqual(canonicalize(raw), [], `«${raw}» no debería clasificar`);
  }
});

test('las grafías localizadas de iTunes caen en el mismo género', () => {
  for (const raw of ['Alternatif et Indé', 'Musica alternativa e indie', 'Alt. Rock', 'AlternRock']) {
    assert.equal(canonicalize(raw)[0]?.top, 'indie', `falla con «${raw}»`);
  }
});

test('una etiqueta desconocida no se fuerza a ningún género', () => {
  assert.deepEqual(canonicalize('Bakalao de Valencia 1993'), []);
});

test('cada subgénero de la taxonomía se reconoce a sí mismo', () => {
  for (const top of TAXONOMY) {
    for (const sub of top.children) {
      const hits = canonicalize(sub);
      assert.ok(hits.length > 0, `«${sub}» no se reconoce`);
      assert.equal(hits[0].top, top.slug, `«${sub}» debería colgar de ${top.slug}`);
    }
  }
});

// --- recomendaciones por género ----------------------------------------------

test('parsea la respuesta de tag.getTopAlbums de Last.fm', () => {
  // forma documentada de la respuesta; la llamada real no se puede ejercitar aquí porque la
  // clave va cifrada en la BBDD del usuario.
  const data = {
    albums: {
      album: [
        {
          name: 'Kind of Blue',
          mbid: '0b0f2b3d',
          url: 'https://www.last.fm/music/Miles+Davis/Kind+of+Blue',
          artist: { name: 'Miles Davis', mbid: '561d854a' },
          image: [
            { '#text': 'https://img/small.png', size: 'small' },
            { '#text': 'https://img/extralarge.png', size: 'extralarge' },
            { '#text': '', size: 'mega' },
          ],
        },
        { name: 'Sin artista', image: [] },
      ],
    },
  };
  const out = mapTagAlbums(data);
  assert.equal(out.length, 1, 'descarta las entradas sin artista');
  assert.deepEqual(out[0], {
    artist: 'Miles Davis',
    album: 'Kind of Blue',
    mbid: '0b0f2b3d',
    url: 'https://www.last.fm/music/Miles+Davis/Kind+of+Blue',
    cover: 'https://img/extralarge.png', // la mayor CON contenido, no la vacía
  });
});

test('tolera una respuesta vacía o rara sin reventar', () => {
  assert.deepEqual(mapTagAlbums({}), []);
  assert.deepEqual(mapTagAlbums(null), []);
  assert.deepEqual(mapTagAlbums({ albums: { album: { name: 'X', artist: { name: 'Y' } } } }).length, 1);
});
