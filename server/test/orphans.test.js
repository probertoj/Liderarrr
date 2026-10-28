import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

// orphans.js arrastra db.js (abre SQLite en DATA_DIR). Temporal antes del import dinámico.
process.env.DATA_DIR = path.join(os.tmpdir(), `liderarr-orphans-${Date.now()}`);
const { db } = await import('../src/db.js');
const { contarHuerfanos, barrerHuerfanos, resumenHuerfanos } = await import('../src/orphans.js');

// Dos artistas y dos álbumes sanos, con todo lo que cuelga de ellos. Luego se borran a mano
// el artista 2 y el álbum 2 —como haría un borrado que se dejara cosas atrás— y la barrida
// tiene que recoger lo suyo sin tocar lo del 1.
const uno = db.prepare("INSERT INTO artists (id, name, sort_name) VALUES (?, ?, ?)");
uno.run(1, 'Artista Uno', 'Artista Uno');
uno.run(2, 'Artista Dos', 'Artista Dos');

const alb = db.prepare(
  "INSERT INTO albums (id, local_key, path, album_artist, title, artist_id, match_state) VALUES (?, ?, ?, ?, ?, ?, 'matched')"
);
alb.run(1, 'k1', '/data/1', 'Artista Uno', 'Disco Uno', 1);
alb.run(2, 'k2', '/data/2', 'Artista Dos', 'Disco Dos', 2);

db.prepare('INSERT INTO tracks (id, album_id, title, path) VALUES (1, 1, ?, ?)').run('a', '/data/1/a.flac');
db.prepare('INSERT INTO tracks (id, album_id, title, path) VALUES (2, 2, ?, ?)').run('b', '/data/2/b.flac');
db.prepare("INSERT INTO tags (id, type, name) VALUES (1, 'genre', 'rock')").run();
db.prepare('INSERT INTO album_tags (album_id, tag_id) VALUES (1, 1), (2, 1)').run();
db.prepare('INSERT INTO artist_stats (artist_id, studio_total) VALUES (1, 5), (2, 7)').run();
db.prepare(
  `INSERT INTO release_groups (rg_mbid, artist_id, title, is_owned, owned_album_id, fetched_at)
   VALUES ('rg-1', 1, 'Disco Uno', 1, 1, 0), ('rg-2', 1, 'Disco Dos', 1, 2, 0), ('rg-3', 2, 'Otro', 0, NULL, 0)`
).run();
db.prepare("INSERT INTO lyrics (track_id, state) VALUES (1, 'found'), (2, 'found')").run();
db.prepare("INSERT INTO challenges (id, name, source) VALUES (1, 'Reto', 'manual')").run();
db.prepare(
  "INSERT INTO challenge_items (challenge_id, position, artist, album, owned_album_id) VALUES (1, 1, 'Artista Uno', 'Disco Uno', 1), (1, 2, 'Artista Dos', 'Disco Dos', 2)"
).run();
db.prepare("INSERT INTO downloads (id, album_id, artist, album, status) VALUES (1, 2, 'Artista Dos', 'Disco Dos', 'importado')").run();
db.prepare('INSERT INTO tracked_artists (artist_id) VALUES (2)').run();

// el borrado «olvidadizo»: se van las fichas, se queda todo lo que colgaba
db.prepare('DELETE FROM albums WHERE id = 2').run();
db.prepare('DELETE FROM artists WHERE id = 2').run();

test('cuenta los restos sin tocarlos', () => {
  const antes = db.prepare('SELECT COUNT(*) AS n FROM tracks').get().n;
  const encontrados = contarHuerfanos();
  const porClave = Object.fromEntries(encontrados.map((e) => [`${e.hija}.${e.col}`, e.n]));
  assert.equal(porClave['tracks.album_id'], 1);
  assert.equal(porClave['artist_stats.artist_id'], 1);
  assert.equal(porClave['album_tags.album_id'], 1);
  assert.equal(porClave['lyrics.track_id'], undefined, 'la pista 2 sigue ahí: su letra no es huérfana todavía');
  assert.equal(porClave['release_groups.artist_id'], 1);
  assert.equal(porClave['release_groups.owned_album_id'], 1);
  assert.equal(porClave['challenge_items.owned_album_id'], 1);
  assert.equal(porClave['downloads.album_id'], 1);
  assert.equal(porClave['tracked_artists.artist_id'], 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tracks').get().n, antes, 'contar no borra');
});

test('barre lo que cuelga y deja en paz lo sano', () => {
  const r = barrerHuerfanos();
  assert.ok(r.borrados > 0);

  // lo del artista/álbum 1 sigue intacto
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tracks WHERE album_id = 1').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM album_tags WHERE album_id = 1').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM artist_stats WHERE artist_id = 1').get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM release_groups WHERE rg_mbid = 'rg-1'").get().n, 1);

  // y lo que colgaba del 2, fuera
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tracks WHERE album_id = 2').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM album_tags WHERE album_id = 2').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM artist_stats WHERE artist_id = 2').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tracked_artists').get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM release_groups WHERE rg_mbid = 'rg-3'").get().n, 0);
});

test('un lanzamiento que apuntaba a una copia borrada deja de contar como tuyo', () => {
  const rg = db.prepare("SELECT is_owned, owned_album_id FROM release_groups WHERE rg_mbid = 'rg-2'").get();
  assert.equal(rg.owned_album_id, null);
  assert.equal(rg.is_owned, 0, 'si se queda en 1, el completismo lo da por tuyo y nunca vuelve a pedirlo');
  // el lanzamiento NO se borra: existe igual, solo que ya no es tuyo
  assert.ok(rg);
  // y lo mismo con el reto y la descarga: la fila se queda, el puntero se suelta
  assert.equal(db.prepare('SELECT owned_album_id FROM challenge_items WHERE position = 2').get().owned_album_id, null);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM challenge_items').get().n, 2);
  assert.equal(db.prepare('SELECT album_id FROM downloads WHERE id = 1').get().album_id, null);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM downloads').get().n, 1);
});

test('tus álbumes no se borran aunque se quedaran sin ficha de artista', () => {
  // el álbum 3 es tuyo y su artista no existe: se avisa, no se toca
  db.prepare("INSERT INTO albums (id, local_key, path, album_artist, title, artist_id, match_state) VALUES (3, 'k3', '/data/3', 'X', 'Disco Tres', 99, 'matched')").run();
  const r = barrerHuerfanos();
  assert.equal(r.avisados, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM albums WHERE id = 3').get().n, 1, 'ahí están tus ficheros');
  assert.match(resumenHuerfanos(r), /sin ficha de artista/);
});

test('con la base limpia no dice nada', () => {
  db.prepare('DELETE FROM albums WHERE id = 3').run();
  const r = barrerHuerfanos();
  assert.equal(r.borrados + r.soltados + r.avisados, 0);
  assert.equal(resumenHuerfanos(r), null);
});
