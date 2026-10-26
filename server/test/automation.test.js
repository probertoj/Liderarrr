import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

// automation.js importa db.js (abre SQLite en DATA_DIR). Temporal antes del import dinámico.
process.env.DATA_DIR = path.join(os.tmpdir(), `liderarr-automation-${Date.now()}`);
const { db } = await import('../src/db.js');
const { runAutoLidarr } = await import('../src/automation.js');

const hoy = new Date().toISOString().slice(0, 10);

const insArtist = db.prepare('INSERT INTO artists (name, sort_name, mbid) VALUES (?, ?, ?)');
const insTracked = db.prepare('INSERT INTO tracked_artists (artist_id, facet, added_at) VALUES (?, ?, ?)');
const insRg = db.prepare(
  `INSERT INTO release_groups (rg_mbid, artist_id, artist_mbid, title, first_release, primary_type,
     secondary_types, is_owned, is_upcoming, fetched_at)
   VALUES (?, ?, ?, ?, ?, 'Album', NULL, ?, 0, 0)`
);
const insAlbum = db.prepare(
  `INSERT INTO albums (local_key, path, artist_id, album_artist, title, rg_mbid, match_state)
   VALUES (?, ?, ?, ?, ?, ?, 'matched')`
);

const artista = (nombre, mbid) => {
  const id = Number(insArtist.run(nombre, nombre, mbid).lastInsertRowid);
  insTracked.run(id, 'artist', Date.now());
  return id;
};

// El auto-Lidarr leía release_groups.is_owned, un flag que solo se refresca al
// re-enriquecer la discografía: pedía otra vez discos ya importados (y se saltaba huecos
// de verdad si el flag se había quedado en 1). Ahora cruza la biblioteca en vivo, como
// autograb.js y el calendario.
test('auto-Lidarr: pide el hueco aunque el flag guardado diga que ya lo tienes', async () => {
  const id = artista('Los Planetas', 'mb-artista-1');
  insRg.run('rg-hueco', id, 'mb-artista-1', 'Una Ópera Egipcia', hoy, 1); // is_owned = 1, pero NO está

  const st = await runAutoLidarr({ dryRun: true });
  assert.equal(st.considered, 1);
  assert.match(st.log.join('\n'), /Una Ópera Egipcia/);
});

test('auto-Lidarr: NO vuelve a pedir lo que ya está en la biblioteca (por MBID)', async () => {
  const id = artista('Triángulo de Amor Bizarro', 'mb-artista-2');
  insRg.run('rg-tenido', id, 'mb-artista-2', 'Salve Discordia', hoy, 0); // is_owned = 0, pero SÍ está
  insAlbum.run('k-salve', '/music/TAB/Salve Discordia', id, 'Triángulo de Amor Bizarro', 'Salve Discordia', 'rg-tenido');

  const st = await runAutoLidarr({ dryRun: true });
  assert.equal(st.considered, 1); // solo el hueco del test anterior
  assert.doesNotMatch(st.log.join('\n'), /Salve Discordia/);
});

test('auto-Lidarr: tampoco si lo tienes sin MBID, casando por artista y título', async () => {
  const id = artista('La Buena Vida', 'mb-artista-3');
  insRg.run('rg-sin-mbid', id, 'mb-artista-3', 'Panorama', hoy, 0);
  // el álbum local no está identificado (sin rg_mbid): tiene que casar por matchKey
  insAlbum.run('k-panorama', '/music/La Buena Vida/Panorama', id, 'La Buena Vida', 'Panorama', null);

  const st = await runAutoLidarr({ dryRun: true });
  assert.equal(st.considered, 1);
  assert.doesNotMatch(st.log.join('\n'), /Panorama/);
});
