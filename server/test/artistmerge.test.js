import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

// queries.js importa db.js (abre SQLite en DATA_DIR). Temporal antes del import dinámico.
process.env.DATA_DIR = path.join(os.tmpdir(), `liderarr-artistmerge-${Date.now()}`);
const { db } = await import('../src/db.js');
const q = await import('../src/queries.js');
const { artistCompleteness } = await import('../src/discography.js');

const MBID = '2fb4db11-8349-47ab-b1a6-f04f011699ff'; // The Go-Betweens, el del informe

const insArtist = db.prepare('INSERT INTO artists (name, sort_name, mbid, thumb) VALUES (?, ?, ?, ?)');
const insAlbum = db.prepare(
  "INSERT INTO albums (local_key, path, artist_id, album_artist, title, match_state) VALUES (?, ?, ?, ?, ?, 'matched')"
);
const insTracked = db.prepare('INSERT INTO tracked_artists (artist_id, facet, added_at) VALUES (?, ?, ?)');
const insRg = db.prepare(
  `INSERT INTO release_groups (rg_mbid, artist_id, title, first_release, primary_type, is_owned, is_upcoming, fetched_at)
   VALUES (?, ?, ?, '1982-01-01', 'Album', 0, 0, 0)`
);
const insAa = db.prepare('INSERT INTO album_artists (album_id, artist_id, position) VALUES (?, ?, 0)');

// El informe: enlazar «The Go-Betweens» a mano moría con «UNIQUE constraint failed:
// artists.mbid», porque ese MBID ya lo tenía otra ficha del mismo grupo. Ahora se funden.
test('enlazar con un MBID que ya tiene otra ficha funde las dos, no revienta', () => {
  const mia = Number(insArtist.run('The Go-Betweens', 'Go-Betweens, The', null, null).lastInsertRowid);
  const otra = Number(insArtist.run('Go-Betweens', 'Go-Betweens', MBID, 'foto.jpg').lastInsertRowid);

  const a1 = Number(insAlbum.run('k1', '/music/The Go-Betweens/16 Lovers Lane', mia, 'The Go-Betweens', '16 Lovers Lane').lastInsertRowid);
  const a2 = Number(insAlbum.run('k2', '/music/Go-Betweens/Liberty Belle', otra, 'Go-Betweens', 'Liberty Belle').lastInsertRowid);
  insAa.run(a1, mia);
  insAa.run(a2, otra);
  insTracked.run(mia, 'artist', 1);
  insTracked.run(otra, 'artist', 1); // las DOS seguidas: la clave compuesta chocaría
  insRg.run('rg-16-lovers', otra, '16 Lovers Lane');
  insRg.run('rg-tallulah', otra, 'Tallulah');

  const r = q.setArtistMbid(mia, MBID);
  assert.equal(r.ok, true);
  assert.equal(r.mbid, MBID);
  assert.equal(r.merged.name, 'Go-Betweens');
  assert.equal(r.merged.albums, 1); // el disco que colgaba de la ficha duplicada

  // queda UNA ficha, la que el usuario tenía delante, ya con su MBID
  const vivas = db.prepare("SELECT id, name, mbid, thumb FROM artists WHERE name LIKE '%Go-Betweens%'").all();
  assert.equal(vivas.length, 1);
  assert.equal(vivas[0].id, mia);
  assert.equal(vivas[0].mbid, MBID);
  assert.equal(vivas[0].thumb, 'foto.jpg'); // la foto de la que se fue, que esta no tenía

  // y todo lo suyo cuelga ya de ella
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM albums WHERE artist_id = ?').get(mia).n, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM album_artists WHERE artist_id = ?').get(mia).n, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM release_groups WHERE artist_id = ?').get(mia).n, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tracked_artists WHERE artist_id = ?').get(mia).n, 1);
  for (const t of ['albums', 'album_artists', 'release_groups', 'tracked_artists']) {
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE artist_id = ?`).get(otra).n, 0, t);
  }
});

test('un MBID que no tiene nadie se enlaza tal cual, sin fundir nada', () => {
  const id = Number(insArtist.run('Los Planetas', 'Planetas, Los', null, null).lastInsertRowid);
  const r = q.setArtistMbid(id, '11111111-2222-3333-4444-555555555555');
  assert.equal(r.merged, null);
  assert.equal(db.prepare('SELECT mbid FROM artists WHERE id = ?').get(id).mbid, '11111111-2222-3333-4444-555555555555');
});

test('el MBID sigue teniendo que ser un UUID', () => {
  const id = Number(insArtist.run('Family', 'Family', null, null).lastInsertRowid);
  assert.throws(() => q.setArtistMbid(id, 'no-soy-un-mbid'), /MBID no válido/);
});

// Al fundir, los discos que llegan traen la grafía del artista de SUS etiquetas («Go-Betweens»)
// mientras la ficha se llama de otra manera («The Go-Betweens»): el completismo los daba por
// NO tenidos y los listaba en «te faltan» estando ahí mismo en la colección.
test('el completismo cuenta como tuyo el disco cuya etiqueta usa otra grafía del artista', () => {
  const id = Number(insArtist.run('The Chills', 'Chills, The', '99999999-8888-7777-6666-555555555555', null).lastInsertRowid);
  insAlbum.run('k-chills', '/music/Chills/Submarine Bells', id, 'Chills', 'Submarine Bells');
  insRg.run('rg-submarine', id, 'Submarine Bells');

  const comp = artistCompleteness(id);
  assert.equal(comp.stats.studio_total, 1);
  assert.equal(comp.stats.studio_owned, 1);
  assert.equal(comp.missing.length, 0);
});
