import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

// Los módulos arrastran db.js (abre SQLite en DATA_DIR). Temporal antes del import dinámico.
process.env.DATA_DIR = path.join(os.tmpdir(), `liderarr-various-${Date.now()}`);
const { db } = await import('../src/db.js');
const { isVariousArtists, variousArtistIds, purgeVariousArtists, VA_MBID } = await import('../src/various.js');
const { upcoming, gaps } = await import('../src/discover.js');
const { artistCompleteness } = await import('../src/discography.js');
const { followArtist } = await import('../src/tracked.js');

const insArtist = db.prepare('INSERT INTO artists (name, sort_name, mbid) VALUES (?, ?, ?)');
const insRg = db.prepare(
  `INSERT INTO release_groups (rg_mbid, artist_id, title, first_release, primary_type, is_owned, is_upcoming, fetched_at)
   VALUES (?, ?, ?, ?, 'Album', 0, ?, 0)`
);

const manana = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

test('reconoce el cajón por MBID y por los comodines de las etiquetas', () => {
  assert.equal(isVariousArtists({ name: 'Various Artists' }), true);
  assert.equal(isVariousArtists({ name: 'various artists' }), true);
  assert.equal(isVariousArtists({ name: 'VA' }), true);
  assert.equal(isVariousArtists({ name: 'V/A' }), true);
  assert.equal(isVariousArtists({ name: 'AA.VV.' }), true);
  assert.equal(isVariousArtists({ name: 'Varios Artistas' }), true);
  assert.equal(isVariousArtists({ name: 'Recopilatorio' }), true);
  // por MBID, aunque la ficha se llame de otra manera
  assert.equal(isVariousArtists({ name: 'Artistas Varios', mbid: VA_MBID }), true);
  assert.equal(isVariousArtists({ name: 'Cualquier Cosa', mbid: VA_MBID.toUpperCase() }), true);
});

// Lo que NO puede pasar: cargarse artistas de verdad cuyo nombre empieza igual.
test('no confunde a artistas de verdad con el cajón', () => {
  for (const name of ['Various Production', 'Vanilla Fudge', 'Compilation Blues Band', 'VA Underground', 'Varios Sonidos']) {
    assert.equal(isVariousArtists({ name }), false, name);
  }
  assert.equal(isVariousArtists({ name: 'The Go-Betweens' }), false);
  assert.equal(isVariousArtists(null), false);
});

test('encuentra sus fichas en la base, se llame como se llame', () => {
  insArtist.run('Various Artists', 'Various Artists', VA_MBID);
  insArtist.run('AA.VV.', 'AA.VV.', null);
  insArtist.run('Vanilla Fudge', 'Vanilla Fudge', null); // no es el cajón
  const ids = variousArtistIds();
  assert.equal(ids.size, 2);
});

// El informe: estrenos de recopilatorios llenando el calendario de quien no sigue a nadie.
test('sus estrenos no salen en el calendario, ni pidiendo todos los artistas', () => {
  const va = db.prepare('SELECT id FROM artists WHERE mbid = ?').get(VA_MBID).id;
  const real = Number(insArtist.run('Andy Stott', 'Stott, Andy', '11111111-1111-1111-1111-111111111111').lastInsertRowid);
  insRg.run('rg-va-room02', va, 'Room 02', manana, 1);
  insRg.run('rg-va-nowyear', va, 'NOW Yearbook 1994', manana, 1);
  insRg.run('rg-stott', real, 'Late Loop', manana, 1);

  const todos = upcoming({ onlyTracked: false }).map((r) => r.title);
  assert.deepEqual(todos, ['Late Loop']);
});

test('tampoco cuentan como huecos que te faltan', () => {
  const va = db.prepare('SELECT id FROM artists WHERE mbid = ?').get(VA_MBID).id;
  insRg.run('rg-va-viejo', va, 'Nebline Vol.4', '1994-01-01', 0);
  const r = gaps({ onlyTracked: false });
  assert.equal(
    r.artists.some((a) => a.artist_id === va),
    false
  );
});

test('su ficha no tiene completismo: ni porcentaje ni discos que faltan', () => {
  const va = db.prepare('SELECT id FROM artists WHERE mbid = ?').get(VA_MBID).id;
  const comp = artistCompleteness(va);
  assert.equal(comp.is_various, true);
  assert.equal(comp.pct, null);
  assert.equal(comp.stats.studio_total, 0);
  assert.deepEqual(comp.missing, []);
});

test('no se puede seguir al cajón, y lo dice', () => {
  const va = db.prepare('SELECT id FROM artists WHERE mbid = ?').get(VA_MBID).id;
  assert.throws(() => followArtist(va), /no un artista/);
  const porNombre = db.prepare("SELECT id FROM artists WHERE name = 'AA.VV.'").get().id;
  assert.throws(() => followArtist(porNombre), /no un artista/);
  // y a un artista de verdad se le sigue igual que siempre
  const real = db.prepare("SELECT id FROM artists WHERE name = 'Vanilla Fudge'").get().id;
  assert.deepEqual(followArtist(real), { ok: true });
});

// Lo que ya está guardado de antes: fuera, sin tocar ni la ficha ni los discos.
test('la limpieza se lleva su discografía pero deja la ficha y tus discos', () => {
  const va = db.prepare('SELECT id FROM artists WHERE mbid = ?').get(VA_MBID).id;
  db.prepare(
    "INSERT INTO albums (local_key, path, artist_id, album_artist, title, match_state) VALUES ('k-va', '/music/VA/Nebline', ?, 'Various Artists', 'Nebline Vol.4', 'matched')"
  ).run(va);
  db.prepare('INSERT INTO tracked_artists (artist_id, facet, added_at) VALUES (?, ?, ?)').run(va, 'artist', 1);

  const r = purgeVariousArtists();
  assert.equal(r.rgs >= 3, true);
  assert.equal(r.tracked, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM release_groups WHERE artist_id = ?').get(va).n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tracked_artists WHERE artist_id = ?').get(va).n, 0);
  // la ficha y el disco siguen ahí: son tuyos
  assert.ok(db.prepare('SELECT 1 FROM artists WHERE id = ?').get(va));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM albums WHERE artist_id = ?').get(va).n, 1);
  // y lo del artista de verdad no se toca
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM release_groups WHERE rg_mbid = 'rg-stott'").get().n, 1);
});
