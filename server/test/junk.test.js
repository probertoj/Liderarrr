import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

// scanner.js importa db.js (abre SQLite en DATA_DIR). Temporal antes del import dinámico.
process.env.DATA_DIR = path.join(os.tmpdir(), `liderarr-junk-${Date.now()}`);
const { isJunkEntry, pathSegments } = await import('../src/libkey.js');
const { db, setSetting } = await import('../src/db.js');
const { purgeJunkFromDb } = await import('../src/scanner.js');

test('isJunkEntry caza los ocultos de Mac y la basura del NAS', () => {
  assert.equal(isJunkEntry('._01 - Canción.flac'), true); // AppleDouble: la mitad invisible
  assert.equal(isJunkEntry('._cover.jpg'), true);
  assert.equal(isJunkEntry('.DS_Store'), true);
  assert.equal(isJunkEntry('.Trashes'), true);
  assert.equal(isJunkEntry('.Spotlight-V100'), true);
  assert.equal(isJunkEntry('.AppleDouble'), true);
  assert.equal(isJunkEntry('__MACOSX'), true);
  assert.equal(isJunkEntry('@eaDir'), true); // miniaturas de Synology
  assert.equal(isJunkEntry('$RECYCLE.BIN'), true);
});

test('isJunkEntry NO toca títulos de verdad (ni los que empiezan por puntos)', () => {
  assert.equal(isJunkEntry('...And Justice for All'), false);
  assert.equal(isJunkEntry('..Y entonces'), false);
  assert.equal(isJunkEntry('01 - Canción.flac'), false);
  assert.equal(isJunkEntry('cover.jpg'), false);
  assert.equal(isJunkEntry('Anderson .Paak'), false);
  assert.equal(isJunkEntry('Metallica'), false);
});

test('pathSegments parte por la barra que sea', () => {
  assert.deepEqual(pathSegments('/music/Metallica/One.flac'), ['music', 'Metallica', 'One.flac']);
  assert.deepEqual(pathSegments('C:\\music\\X\\._a.flac'), ['C:', 'music', 'X', '._a.flac']);
});

const insAlbum = db.prepare(
  `INSERT INTO albums (local_key, path, album_artist, title, track_count, track_file_count,
     size_bytes, duration_ms, scanned_at, cover)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
const insTrack = db.prepare(
  'INSERT INTO tracks (album_id, num, title, path, size_bytes, duration_ms) VALUES (?, ?, ?, ?, ?, ?)'
);
const idOf = (key) => db.prepare('SELECT id FROM albums WHERE local_key = ?').get(key).id;

test('purgeJunkFromDb limpia lo ya escaneado sin tocar el disco', () => {
  setSetting('music_dirs', '/music');

  // un álbum bueno con su mitad invisible al lado: 2 pistas de verdad y 2 AppleDouble.
  // Encima el título empieza por puntos, que NO es lo mismo que estar oculto.
  const dir = '/music/Metallica/...And Justice for All';
  insAlbum.run('k-justice', dir, 'Metallica', '...And Justice for All', 4, 4, 400, 4000, 123, `${dir}/._cover.jpg`);
  const id = idOf('k-justice');
  insTrack.run(id, 1, 'Blackened', `${dir}/01 Blackened.flac`, 100, 1000);
  insTrack.run(id, 2, 'One', `${dir}/02 One.flac`, 100, 1000);
  insTrack.run(id, null, null, `${dir}/._01 Blackened.flac`, 100, 1000);
  insTrack.run(id, null, null, `${dir}/._02 One.flac`, 100, 1000);

  // un «álbum» que en realidad vive en la papelera del Mac: se va entero
  insAlbum.run('k-trash', '/music/.Trashes/501/Algo', 'X', 'Algo', 1, 1, 10, 10, 1, null);
  insTrack.run(idOf('k-trash'), 1, 'x', '/music/.Trashes/501/Algo/01 x.flac', 10, 10);

  // y uno que solo tenía basura dentro: al quedarse sin pistas, también
  insAlbum.run('k-solo', '/music/Varios/Caja', 'Varios', 'Caja', 1, 1, 10, 10, 1, null);
  insTrack.run(idOf('k-solo'), null, null, '/music/Varios/Caja/._pista.flac', 10, 10);

  const r = purgeJunkFromDb();
  assert.equal(r.tracks, 3); // 2 del bueno + 1 del que era solo basura
  assert.equal(r.albums, 2); // el de la papelera y el que se quedó sin pistas
  assert.equal(r.covers, 1);

  const a = db.prepare('SELECT * FROM albums WHERE id = ?').get(id);
  assert.equal(a.track_file_count, 2);
  assert.equal(a.track_count, 2); // el «debería tener» lo había inflado la basura
  assert.equal(a.size_bytes, 200);
  assert.equal(a.duration_ms, 2000);
  assert.equal(a.scanned_at, null); // pendiente de reescaneo
  assert.equal(a.cover, null); // el `._cover.jpg` no era una imagen
  assert.deepEqual(
    db.prepare('SELECT path FROM tracks WHERE album_id = ? ORDER BY num').all(id).map((t) => t.path),
    [`${dir}/01 Blackened.flac`, `${dir}/02 One.flac`]
  );
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM albums WHERE local_key = 'k-trash'").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM albums WHERE local_key = 'k-solo'").get().n, 0);
});

test('purgeJunkFromDb no se lleva nada que esté fuera de la biblioteca configurada', () => {
  setSetting('music_dirs', '/music');
  // misma pinta de carpeta oculta, pero cuelga de otro sitio: no es asunto nuestro.
  // (La raíz la elige el usuario: una biblioteca en /volumen/.musica es legítima.)
  insAlbum.run('k-fuera', '/otro/.Trashes/Algo', 'Y', 'Algo', 1, 1, 10, 10, 1, null);
  const id = idOf('k-fuera');
  insTrack.run(id, 1, 'y', '/otro/.Trashes/Algo/01 y.flac', 10, 10);

  const r = purgeJunkFromDb();
  assert.equal(r.albums, 0);
  assert.equal(r.tracks, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tracks WHERE album_id = ?').get(id).n, 1);
});

// Prueba de verdad contra el sistema de ficheros: el escáner recorriendo una carpeta
// sembrada de ocultos como la deja un Mac. Los .flac son de pega (las etiquetas fallan
// y se cae al nombre del fichero), que es justo lo que interesa aquí: contar pistas.
test('el escáner no mete los ocultos de Mac en la biblioteca', async () => {
  const fs = await import('node:fs');
  const { runScan } = await import('../src/scanner.js');
  const root = path.join(os.tmpdir(), `liderarr-scan-${Date.now()}`);
  const dir = path.join(root, 'Metallica', '...And Justice for All');
  fs.mkdirSync(path.join(dir, '@eaDir'), { recursive: true });
  fs.mkdirSync(path.join(root, '.Trashes', 'Algo'), { recursive: true });
  fs.writeFileSync(path.join(dir, '01 Blackened.flac'), 'no es audio de verdad');
  fs.writeFileSync(path.join(dir, '02 One.flac'), 'no es audio de verdad');
  fs.writeFileSync(path.join(dir, '._01 Blackened.flac'), 'AppleDouble');
  fs.writeFileSync(path.join(dir, '._02 One.flac'), 'AppleDouble');
  fs.writeFileSync(path.join(dir, '.DS_Store'), 'basura');
  fs.writeFileSync(path.join(dir, 'cover.jpg'), 'imagen');
  fs.writeFileSync(path.join(dir, '._cover.jpg'), 'AppleDouble');
  fs.writeFileSync(path.join(dir, '@eaDir', 'thumb.flac'), 'miniatura');
  fs.writeFileSync(path.join(root, '.Trashes', 'Algo', 'borrado.flac'), 'en la papelera');

  setSetting('music_dirs', root);
  await runScan({ roots: root, force: true });

  const albums = db.prepare('SELECT id, path, title, track_file_count, cover FROM albums WHERE path LIKE ?').all(`${root}%`);
  assert.equal(albums.length, 1); // ni @eaDir ni .Trashes son álbumes
  const [a] = albums;
  assert.equal(a.path, dir); // el título con tres puntos se escanea igual
  assert.equal(a.track_file_count, 2); // no 4: los `._` se quedaron fuera
  assert.equal(path.basename(a.cover), 'cover.jpg'); // no `._cover.jpg`
  assert.deepEqual(
    db.prepare('SELECT path FROM tracks WHERE album_id = ?').all(a.id).map((t) => path.basename(t.path)).sort(),
    ['01 Blackened.flac', '02 One.flac']
  );
  fs.rmSync(root, { recursive: true, force: true });
});
