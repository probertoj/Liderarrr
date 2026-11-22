import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = path.join(os.tmpdir(), `liderarr-mbid-${Date.now()}`);
const { db } = await import('../src/db.js');
const { unMbid, esMbid, limpiarMbidInvalidos } = await import('../src/mbid.js');

const CONWAY = 'a633ebb5-b81a-400f-b5df-0e625ea81fe9';
const JAE = '7e96ec65-78ee-413d-b3ab-da8061a5bbd3';

test('de una etiqueta solo se acepta un MBID de verdad', () => {
  assert.equal(unMbid(CONWAY), CONWAY);
  assert.equal(unMbid(CONWAY.toUpperCase()), CONWAY);
  assert.equal(unMbid([CONWAY, JAE]), CONWAY, 'de una lista, el primero');
  // los cuatro casos reales que MusicBrainz rechazaba con un 400 cada noche
  assert.equal(unMbid(`${CONWAY} ${JAE}`), CONWAY, 'dos pegados: el primero, no la cadena entera');
  assert.equal(unMbid('476414'), null, 'un número de Discogs');
  assert.equal(unMbid('28077'), null);
  assert.equal(unMbid('1jzmHk0SLhAJjEw6NqvaLs'), null, 'un id de Spotify');
  assert.equal(unMbid(''), null);
  assert.equal(unMbid(null), null);
  assert.equal(unMbid(undefined), null);
  assert.equal(esMbid(`${CONWAY} ${JAE}`), false);
});

test('lo que ya estaba mal guardado se limpia, y lo bueno no se toca', () => {
  const art = db.prepare('INSERT INTO artists (id, name, mbid) VALUES (?, ?, ?)');
  art.run(1, 'Conway the Machine', CONWAY);
  art.run(2, 'Conway the Machine & Jae Skeese', `${CONWAY} ${JAE}`);
  art.run(3, 'Skyzoo, The Other Guys', '476414');
  art.run(4, 'No Pressure', '1jzmHk0SLhAJjEw6NqvaLs');
  art.run(5, 'Sin identificar', null);
  const alb = db.prepare("INSERT INTO albums (id, local_key, title, rg_mbid, release_mbid, match_state) VALUES (?, ?, ?, ?, ?, 'pending')");
  alb.run(10, 'a', 'Bueno', CONWAY, JAE);
  alb.run(11, 'b', 'Pegados', `${CONWAY} ${JAE}`, '12345');
  db.prepare('INSERT INTO tracks (id, album_id, title, path, mb_recording_id) VALUES (?, ?, ?, ?, ?)').run(100, 11, 't', '/x/1.flac', 'no-es-un-mbid');
  db.prepare('INSERT INTO tracks (id, album_id, title, path, mb_recording_id) VALUES (?, ?, ?, ?, ?)').run(101, 10, 't', '/x/2.flac', JAE);

  assert.deepEqual(limpiarMbidInvalidos(db), { artistas: 3, albumes: 1, pistas: 1 });
  const mbid = (id) => db.prepare('SELECT mbid FROM artists WHERE id = ?').get(id).mbid;
  assert.equal(mbid(1), CONWAY, 'el válido sigue');
  // a la colaboración NO se le pone el de Conway: ese ya es de la ficha de Conway
  assert.equal(mbid(2), null);
  assert.equal(mbid(3), null);
  assert.equal(mbid(4), null);
  assert.deepEqual(db.prepare('SELECT rg_mbid, release_mbid FROM albums WHERE id = 11').get(), { rg_mbid: CONWAY, release_mbid: null });
  assert.deepEqual(db.prepare('SELECT rg_mbid, release_mbid FROM albums WHERE id = 10').get(), { rg_mbid: CONWAY, release_mbid: JAE });
  assert.equal(db.prepare('SELECT mb_recording_id m FROM tracks WHERE id = 100').get().m, null);
  assert.equal(db.prepare('SELECT mb_recording_id m FROM tracks WHERE id = 101').get().m, JAE);
  // y pasarla otra vez no cambia nada
  assert.deepEqual(limpiarMbidInvalidos(db), { artistas: 0, albumes: 0, pistas: 0 });
});
