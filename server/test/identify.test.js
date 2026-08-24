import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

// identify.js importa db.js (abre SQLite en DATA_DIR). Temporal antes del import dinámico.
process.env.DATA_DIR = path.join(os.tmpdir(), `liderarr-identify-${Date.now()}`);
const { isPlaceholderArtist, pickConsensusRg } = await import('../src/identify.js');

test('isPlaceholderArtist detecta comodines, no artistas reales', () => {
  for (const n of ['Artista desconocido', 'Various', 'Various Artists', 'Varios', 'Varios Artistas', 'VA', 'V/A', 'AA.VV.', 'Unknown', 'Unknown Artist', 'Sin artista'])
    assert.equal(isPlaceholderArtist(n), true, `debería ser comodín: ${n}`);
  for (const n of ['Prince', 'Various Cruelties', 'The Unknown', 'AC/DC', 'Va Va Voom', ''])
    assert.equal(isPlaceholderArtist(n), false, `NO debería ser comodín: ${n}`);
});

const rg = (id, studio = true) => ({ rg_mbid: id, title: id, primary_type: studio ? 'Album' : 'Single', secondary_types: [] });
const comp = (id) => ({ rg_mbid: id, title: id, primary_type: 'Album', secondary_types: ['Compilation'] });
const votes = (pairs) => new Map(pairs.map(([id, count, r]) => [id, { count, rg: r || rg(id), artist_mbid: 'a' }]));

test('consenso: gana el RG con más votos si hay ≥2 pistas de acuerdo', () => {
  const v = votes([['album', 3], ['compA', 1, comp('compA')], ['compB', 1, comp('compB')]]);
  assert.equal(pickConsensusRg(v, 4).rg.rg_mbid, 'album');
});

test('consenso: con ≥2 pistas escaneadas exige ≥2 votos (nada si todos tienen 1)', () => {
  const v = votes([['x', 1], ['y', 1], ['z', 1]]);
  assert.equal(pickConsensusRg(v, 3), null);
});

test('álbum de 1 pista: acepta el único voto (fallback need=1)', () => {
  const v = votes([['solo', 1]]);
  assert.equal(pickConsensusRg(v, 1)?.rg.rg_mbid, 'solo');
});

test('empate de votos: prefiere el álbum de estudio sobre el recopilatorio', () => {
  const v = votes([['comp', 2, comp('comp')], ['studio', 2, rg('studio')]]);
  assert.equal(pickConsensusRg(v, 2).rg.rg_mbid, 'studio');
});
