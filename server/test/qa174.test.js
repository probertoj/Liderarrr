import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Lo que salió del QA de la 1.7.3. Cada prueba es un fallo que se vio con la base real o
// leyendo el código, y que no debe volver.
const RAIZ = path.join(os.tmpdir(), `liderarr-qa174-${Date.now()}`);
const MUSICA = path.join(RAIZ, 'musica');
const DESCARGAS = path.join(RAIZ, 'torrents');
fs.mkdirSync(MUSICA, { recursive: true });
fs.mkdirSync(DESCARGAS, { recursive: true });
process.env.DATA_DIR = RAIZ;
delete process.env.LIDERARRR_SECRET;

const { db, getSetting, setSetting } = await import('../src/db.js');
const { app } = await import('../src/index.js');
app.log.level = 'silent';
const { normName, matchKey } = await import('../src/matchkey.js');
const { normalizeForDup } = await import('../src/queries.js');
const { nombraElAlbum, pickBestRelease, ordenarCandidatos, REINTENTO_GRAB_DIAS } = await import('../src/autograb.js');
const { deducirDeCarpeta, resolverMeta, importFolder } = await import('../src/importer.js');
const { reemplazarPistas } = await import('../src/scanner.js');
const { separarDelTorrent } = await import('../src/tagwriter.js');
const { isJunkEntry } = await import('../src/libkey.js');
const { sinClave } = await import('../src/jackett.js');
const { notifyTest } = await import('../src/notify.js');
const { refileAlbum } = await import('../src/refile.js');

setSetting('music_dirs', MUSICA);
setSetting('allow_import', '1');
setSetting('import_source_dir', DESCARGAS);
setSetting('import_dest_dir', MUSICA);

// --- nombres en otros alfabetos ------------------------------------------------------
test('un título en cirílico, en japonés o de solo símbolos ya no se queda en nada', () => {
  for (const t of ['Кино', '無罪モラトリアム', '>>>>', '♡', '( )', '@']) assert.notEqual(normName(t), '', t);
  assert.notEqual(normName('Кино'), normName('Корвет'));
  assert.notEqual(normName('>>>>'), normName('♡'));
  assert.notEqual(matchKey('Manta Ray', 'Корвет'), matchKey('Manta Ray', 'Кино'));
  // mezclado: antes «Кино 2» y «Корвет 2» daban los dos «2»
  assert.notEqual(normName('Кино 2'), normName('Корвет 2'));
});

test('los nombres en alfabeto latino dan EXACTAMENTE lo mismo que antes', () => {
  // de esto depende que las claves ya guardadas (lo quiero, retos) sigan casando
  const antes = (s) => String(s || '').normalize('NFD').toLowerCase().replace(/[^a-z0-9]+/g, '');
  for (const t of ['Sigur Rós', 'Motörhead', 'MØ', 'Beyoncé', 'AC/DC', 'Kid A (Deluxe)', '¡Tré!', "Guns N' Roses", 'Straße', '1989', ''])
    assert.equal(normName(t), antes(t), t);
});

test('dos discos distintos con título no latino no salen como copias uno del otro', () => {
  assert.notEqual(normalizeForDup('Корвет'), '');
  assert.notEqual(normalizeForDup('Корвет'), normalizeForDup('Кино'));
  assert.equal(normalizeForDup('Kid A (Deluxe Edition)'), normalizeForDup('Kid A'));
});

// --- elegir release ------------------------------------------------------------------
test('un título corto tiene que aparecer como palabra, no dentro de un año o un formato', () => {
  assert.equal(nombraElAlbum('The Beatles - 1 [2000] [Album] FLAC / Lossless', '1'), true);
  assert.equal(nombraElAlbum('The Beatles - 1962-1966 [2001] FLAC 16bit', '1'), false);
  assert.equal(nombraElAlbum('R.E.M. - Automatic for the People [1992] FLAC', 'Up'), false);
  assert.equal(nombraElAlbum('R.E.M. - Up [1998] FLAC', 'Up'), true);
  // los largos siguen como estaban
  assert.equal(nombraElAlbum('Radiohead - OK Computer OKNOTOK [2017] FLAC', 'OK Computer'), true);
  const elegida = pickBestRelease(
    [
      { title: 'The Beatles - 1962-1966 [2001] FLAC 24bit', seeders: 90, indexer: 'X' },
      { title: 'The Beatles - 1 [2000] MP3 320', seeders: 5, indexer: 'X' },
    ],
    { artist: 'The Beatles', album: '1' }
  );
  assert.match(elegida.title, /- 1 \[2000\]/);
});

// --- tope de búsquedas de la auto-descarga ---------------------------------------------
test('lo que se buscó hace poco no se vuelve a buscar, y lo publicado va antes que lo que viene', () => {
  const DIA = 24 * 3600 * 1000;
  const ahora = Date.parse('2026-11-22T03:00:00Z');
  const candidatos = [
    { rg_mbid: 'viejo', first_release: '2026-10-30' },
    { rg_mbid: 'nuevo', first_release: '2026-11-20' },
    { rg_mbid: 'futuro', first_release: '2027-02-01' },
    { rg_mbid: 'recien-buscado', first_release: '2026-11-21' },
    { rg_mbid: 'buscado-hace-mucho', first_release: '2026-11-01' },
  ];
  const intentos = { 'recien-buscado': ahora - DIA, 'buscado-hace-mucho': ahora - (REINTENTO_GRAB_DIAS + 1) * DIA };
  const cola = ordenarCandidatos(candidatos, intentos, '2026-11-22', ahora).map((c) => c.rg_mbid);
  assert.deepEqual(cola, ['nuevo', 'buscado-hace-mucho', 'viejo', 'futuro']);
});

// --- importar ------------------------------------------------------------------------
test('el artista sale del nombre de la carpeta cuando las etiquetas no lo dicen', () => {
  // nombres reales de descargas que acabaron en «Artista desconocido»
  assert.deepEqual(deducirDeCarpeta('Negu Gorriak - Gora Herria (1996-10-01) [FLAC]'), { artist: 'Negu Gorriak', album: 'Gora Herria', year: 1996 });
  assert.deepEqual(deducirDeCarpeta('Nubiyan Twist - Siren Song - 2016 [FLAC]'), { artist: 'Nubiyan Twist', album: 'Siren Song', year: 2016 });
  assert.deepEqual(deducirDeCarpeta('Claustrofobia - Un Chien Andaluz - 1989 (WEB-FLAC)'), { artist: 'Claustrofobia', album: 'Un Chien Andaluz', year: 1989 });
  assert.deepEqual(deducirDeCarpeta('Joe Glass - Snakewards (2026)'), { artist: 'Joe Glass', album: 'Snakewards', year: 2026 });
  // un guion sin espacios es parte del nombre: no se parte «The Go-Betweens»
  assert.equal(deducirDeCarpeta('The Go-Betweens-Bright Yellow Bright Orange').artist, null);
  // «año - álbum» no es «artista - álbum»
  assert.deepEqual(deducirDeCarpeta('1994 - I Hope You\'re Sitting Down'), { artist: null, album: "I Hope You're Sitting Down", year: 1994 });
});

test('un dato vacío del registro de descargas no pisa el de las etiquetas', () => {
  const tags = { artist: 'Lambchop', album: 'Nixon', year: 2000 };
  assert.deepEqual(resolverMeta(tags, { artist: null, album: null, year: null }, 'lo que sea'), tags);
  assert.deepEqual(resolverMeta(tags, { artist: '', album: '' }, 'lo que sea'), tags);
  // ni las palabras «undefined»/«null», que es como nació la carpeta «undefined»
  assert.equal(resolverMeta(tags, { artist: 'undefined', album: 'null' }, 'x').artist, 'Lambchop');
  assert.equal(resolverMeta({}, { artist: 'undefined' }, 'Negu Gorriak - Gora Herria (1996)').artist, 'Negu Gorriak');
  // lo que tecleas o dice el pedido sí manda
  assert.equal(resolverMeta(tags, { artist: 'Kurt Wagner' }, 'x').artist, 'Kurt Wagner');
  // carpeta dentro de la del artista: «The Vaccines/Melody Calling»
  assert.equal(resolverMeta({}, {}, 'Melody Calling', 'The Vaccines').artist, 'The Vaccines');
});

test('importar de verdad: carpeta del artista, sin «undefined», y sin mezclar con otra copia', async () => {
  const origen = path.join(DESCARGAS, 'Negu Gorriak - Gora Herria (1996-10-01) [FLAC]');
  fs.mkdirSync(origen, { recursive: true });
  fs.writeFileSync(path.join(origen, '01 - Gora Herria.flac'), 'no es audio de verdad: las etiquetas no se leen');
  // el pedido registrado sin artista, como 47 de los 155 de la base real
  const r = await importFolder(origen, { artist: null, album: null, year: null });
  assert.equal(path.relative(MUSICA, r.dest).split(path.sep).join('/'), 'Negu Gorriak/Gora Herria (1996)');
  assert.ok(fs.existsSync(path.join(r.dest, '01 - Gora Herria.flac')));
  assert.ok(!fs.existsSync(path.join(MUSICA, 'undefined')));
  assert.ok(!fs.existsSync(path.join(MUSICA, 'Artista desconocido')));

  // llega la versión en MP3 del mismo disco: no se mete en la misma carpeta
  const origen2 = path.join(DESCARGAS, 'Negu Gorriak - Gora Herria (1996) [MP3]');
  fs.mkdirSync(origen2, { recursive: true });
  fs.writeFileSync(path.join(origen2, '01 - Gora Herria.mp3'), 'otra copia');
  const r2 = await importFolder(origen2, {});
  assert.notEqual(r2.dest, r.dest);
  assert.match(path.basename(r2.dest), /\[MP3\]$/);
  assert.deepEqual(fs.readdirSync(r.dest), ['01 - Gora Herria.flac'], 'la primera carpeta no se ha tocado');

  // y repetir la primera importación no inventa una tercera carpeta
  db.prepare('DELETE FROM imports').run();
  const r3 = await importFolder(origen, {});
  assert.equal(r3.dest, r.dest);
});

// --- reescanear no pierde las letras ---------------------------------------------------
test('reescanear una carpeta conserva las letras y las huellas de sus pistas', () => {
  db.prepare("INSERT INTO albums (id, local_key, path, album_artist, title, match_state) VALUES (500, 'k500', '/m/a', 'A', 'B', 'matched')").run();
  db.prepare("INSERT INTO tracks (id, album_id, title, path, size_bytes, acoustid) VALUES (5001, 500, 'Uno', '/m/a/01.flac', 111, 'huella-1')").run();
  db.prepare("INSERT INTO tracks (id, album_id, title, path, size_bytes) VALUES (5002, 500, 'Dos', '/m/a/02.flac', 222)").run();
  db.prepare("INSERT INTO lyrics (track_id, state, plain, fetched_at) VALUES (5001, 'found', 'letra de la uno', 1)").run();
  db.prepare("INSERT INTO lyrics (track_id, state, plain, fetched_at) VALUES (5002, 'found', 'letra de la dos', 1)").run();

  const pista = (num, ruta, size) => ({
    album_id: 500, disc: 1, num, title: `t${num}`, artist: 'A', duration_ms: 1000, path: ruta, format: 'FLAC', codec: 'FLAC',
    bitrate: 900, sample_rate: 44100, bit_depth: 16, channels: 2, size_bytes: size, lossless: 1, has_replaygain: 0, mb_recording_id: null,
  });
  // la 02 ya no está en la carpeta; la 01 sigue, y aparece una 03
  reemplazarPistas(500, [pista(1, '/m/a/01.flac', 111), pista(3, '/m/a/03.flac', 333)]);

  const nuevas = db.prepare('SELECT id, path, acoustid FROM tracks WHERE album_id = 500 ORDER BY num').all();
  assert.equal(nuevas.length, 2);
  assert.ok(nuevas.every((t) => t.id !== 5001 && t.id !== 5002), 'las pistas tienen id nuevo');
  const letra = db.prepare('SELECT plain FROM lyrics WHERE track_id = ?').get(nuevas[0].id);
  assert.equal(letra?.plain, 'letra de la uno', 'la letra sigue pegada a su pista');
  assert.equal(nuevas[0].acoustid, 'huella-1');
  assert.equal(db.prepare('SELECT count(*) n FROM lyrics WHERE track_id = ?').get(nuevas[1].id).n, 0);
});

// --- escribir etiquetas no toca lo que se siembra --------------------------------------
test('un fichero enlazado a la descarga se separa antes de escribirle nada', () => {
  const torrent = path.join(DESCARGAS, 'sembrando.flac');
  const biblioteca = path.join(MUSICA, 'en-la-biblioteca.flac');
  fs.writeFileSync(torrent, 'bytes que el tracker tiene verificados');
  fs.linkSync(torrent, biblioteca);
  const inodoTorrent = fs.statSync(torrent).ino;
  assert.equal(fs.statSync(biblioteca).ino, inodoTorrent);

  assert.equal(separarDelTorrent(biblioteca), true);
  assert.notEqual(fs.statSync(biblioteca).ino, inodoTorrent, 'la copia de la biblioteca es ya otro fichero');
  fs.appendFileSync(biblioteca, ' + etiquetas');
  assert.equal(fs.readFileSync(torrent, 'utf8'), 'bytes que el tracker tiene verificados', 'la descarga no ha cambiado');
  assert.equal(fs.statSync(torrent).ino, inodoTorrent);
  assert.ok(!fs.existsSync(`${biblioteca}.liderarrr-tmp`));
  // uno que no está enlazado no se copia
  assert.equal(separarDelTorrent(biblioteca), false);
});

// --- ajustes ---------------------------------------------------------------------------
test('guardar Ajustes no puede rebobinar el estado interno de la app', async () => {
  setSetting('nightly_last_run', '2000');
  setSetting('lidarr_add_queue', '[]');
  setSetting('auto_grab_tried', '{"x":1}');
  const r = await app.inject({
    method: 'PUT',
    url: '/api/settings',
    payload: { nightly_last_run: '1000', lidarr_add_queue: '[{"viejo":1}]', wanted_last_run: '5', last_scan: 'x', lastfm_user: 'alguien' },
  });
  assert.equal(r.statusCode, 200);
  assert.equal(getSetting('nightly_last_run'), '2000');
  assert.equal(getSetting('lidarr_add_queue'), '[]');
  assert.equal(getSetting('wanted_last_run'), null);
  assert.equal(getSetting('last_scan'), null);
  assert.equal(getSetting('lastfm_user'), 'alguien', 'los ajustes de verdad sí se guardan');
});

test('el token de Spotify no sale por la API de ajustes', async () => {
  setSetting('spotify_refresh_token', 'token-secretisimo');
  setSetting('prowlarr_key', 'clave-de-prowlarr');
  const cuerpo = (await app.inject({ method: 'GET', url: '/api/settings' })).body;
  assert.ok(!cuerpo.includes('token-secretisimo'));
  assert.ok(!cuerpo.includes('clave-de-prowlarr'));
  assert.ok(!cuerpo.includes('auto_grab_tried'));
  // y el marcador que devuelve la página no pisa la clave guardada
  await app.inject({ method: 'PUT', url: '/api/settings', payload: { prowlarr_key: '••••••••' } });
  assert.equal(getSetting('prowlarr_key'), 'clave-de-prowlarr');
});

test('la página de retorno de Spotify no pinta lo que venga en la URL como HTML', async () => {
  setSetting('spotify_client_id', 'id');
  setSetting('spotify_client_secret', 'secreto');
  const r = await app.inject({ method: 'GET', url: '/callback?error=%3Cscript%3Ealert(1)%3C%2Fscript%3E' });
  assert.ok(!r.body.includes('<script>alert'), 'no hay etiqueta script viva');
  assert.ok(r.body.includes('&lt;script&gt;'));
  setSetting('spotify_client_id', null);
  setSetting('spotify_client_secret', null);
});

test('«Enviar prueba» sin webhook dice que falta, no que la ha enviado', async () => {
  setSetting('notify_url', null);
  await assert.rejects(() => notifyTest(), /Falta la URL del webhook/);
});

// --- varios ----------------------------------------------------------------------------
test('«.38 Special» no es basura, «.DS_Store» sí', () => {
  assert.equal(isJunkEntry('.38 Special'), false);
  assert.equal(isJunkEntry('.5 The Gray Chapter (2014)'), false);
  assert.equal(isJunkEntry('.DS_Store'), true);
  assert.equal(isJunkEntry('._pista.flac'), true);
  assert.equal(isJunkEntry('@eaDir'), true);
});

test('la clave de Jackett se tacha de cualquier mensaje de error', () => {
  const sucio = 'Failed to parse URL from 192.168.1.5:9117/api/v2.0/indexers/all/results/torznab/api?apikey=abc123SECRETO&t=search&q=x';
  assert.ok(!sinClave(sucio).includes('abc123SECRETO'));
  assert.match(sinClave(sucio), /apikey=•••&t=search/);
});

test('ordenar en su carpeta se niega si dentro viven otros discos', () => {
  const artista = path.join(MUSICA, 'Artista Mal Escrito');
  const otro = path.join(artista, 'Otro Disco (2001)');
  fs.mkdirSync(otro, { recursive: true });
  fs.writeFileSync(path.join(artista, '01.flac'), 'x');
  fs.writeFileSync(path.join(otro, '01.flac'), 'y');
  const p = (x) => x.split(path.sep).join('/');
  db.prepare("INSERT INTO albums (id, local_key, path, album_artist, title, year, match_state) VALUES (700, 'k700', ?, 'Artista Bien', 'Suelto', 1999, 'matched')").run(p(artista));
  db.prepare("INSERT INTO albums (id, local_key, path, album_artist, title, year, match_state) VALUES (701, 'k701', ?, 'Artista Bien', 'Otro Disco', 2001, 'matched')").run(p(otro));
  assert.throws(() => refileAlbum(700, { confirm: true }), /hay 1 disco\(s\) más/);
  assert.ok(fs.existsSync(path.join(otro, '01.flac')), 'no se ha movido nada');
  // el que no tiene a nadie dentro sí se mueve
  const r = refileAlbum(701, { confirm: true });
  assert.equal(r.moved, true);
  assert.ok(fs.existsSync(path.join(MUSICA, 'Artista Bien', 'Otro Disco (2001)', '01.flac')));
});
