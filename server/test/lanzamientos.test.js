import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

// Lanzamientos por intención: una fila por disco, fundiendo fuentes, y la fecha decide EN VIVO
// qué está por salir y qué ha salido.
process.env.DATA_DIR = path.join(os.tmpdir(), `liderarr-lanz-${Date.now()}`);
const { db } = await import('../src/db.js');
const { app } = await import('../src/index.js');
app.log.level = 'silent';
const { cuandoCae, tipoDe, esReedicion, fundir, lanzamientos, descartarLanzamiento, restaurarLanzamiento } = await import('../src/lanzamientos.js');
const { hoyLocal } = await import('../src/fechas.js');
const { upcoming } = await import('../src/discover.js');

const HOY = '2026-11-24';
const RG = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('«hoy» es la fecha del reloj local, no la de UTC', () => {
  // las 00:30 del 24 en Madrid son todavía el 23 en UTC
  const d = new Date(2026, 10, 24, 0, 30);
  assert.equal(hoyLocal(d), '2026-11-24');
});

test('una fecha a medias del año o del mes en curso no se da por publicada', () => {
  assert.equal(cuandoCae('2026-11-25', HOY), 'futuro');
  assert.equal(cuandoCae('2026-11-24', HOY), 'pasado', 'lo que sale hoy ya ha salido');
  assert.equal(cuandoCae('2026-11-06', HOY), 'pasado');
  assert.equal(cuandoCae('2027', HOY), 'futuro');
  assert.equal(cuandoCae('2025', HOY), 'pasado');
  assert.equal(cuandoCae('2026', HOY), 'sinfecha', 'antes «2026» < «2026-11-24» y contaba como ya publicado');
  assert.equal(cuandoCae('2026-11', HOY), 'sinfecha');
  assert.equal(cuandoCae('2026-12', HOY), 'futuro');
  assert.equal(cuandoCae(null, HOY), 'sinfecha');
});

test('tipos en cuatro cajones y reediciones por el título', () => {
  assert.equal(tipoDe({ primary_type: 'Album', secondary_types: '[]' }), 'album');
  assert.equal(tipoDe({ primary_type: 'Album', secondary_types: '["Live"]' }), 'otro');
  assert.equal(tipoDe({ primary_type: 'EP' }), 'ep');
  assert.equal(tipoDe({ record_type: 'single' }), 'single');
  assert.equal(tipoDe({ primary_type: 'Broadcast' }), 'otro');
  assert.equal(esReedicion('Wish (30th Anniversary Edition)'), true);
  assert.equal(esReedicion('Held (2026 Remaster)'), true);
  assert.equal(esReedicion('Master of Reality'), false);
});

test('el mismo disco desde tres fuentes es UNA fila, con todos sus motivos', () => {
  const filas = fundir(
    [
      { fuente: 'radar', artist: 'Liars', title: 'A Ban On Plastic Bag Bans', date: '2026-11-01', tipo: 'album', curador: 'calltheranger', url: 'https://x.bandcamp.com', ref: { tipo: 'radar', id: 7 } },
      { fuente: 'deezer', artist: 'Liars', title: 'A Ban on Plastic Bag Bans', date: '2027-03-05', tipo: 'album', cover: 'c.jpg', ahead: true, ref: { tipo: 'externo', id: 3 } },
      { fuente: 'mb', artist: 'Liars', title: 'A Ban On Plastic Bag Bans', date: '2027-03-05', tipo: 'album', rg_mbid: RG(1), artist_id: 5, sellos: ['Mute'], ref: { tipo: 'rg', rg_mbid: RG(1), title: 'x' } },
    ],
    { hoy: HOY }
  );
  assert.equal(filas.length, 1);
  const f = filas[0];
  assert.equal(f.date, '2027-03-05', 'manda la fecha de MusicBrainz, no la de la lista del curador');
  assert.equal(f.cuando, 'futuro');
  assert.deepEqual(f.fuentes.sort(), ['deezer', 'mb', 'radar']);
  assert.equal(f.rg_mbid, RG(1));
  assert.equal(f.cover, 'c.jpg');
  assert.deepEqual(f.sellos, ['Mute']);
  assert.deepEqual(f.curadores.map((c) => c.nombre), ['calltheranger']);
  assert.equal(f.sinMb, false, 'MusicBrainz sí lo tiene');
  assert.equal(f.refs.length, 3, 'descartarlo tiene que descartar las tres');
});

test('una colaboración sale una vez; un single y un álbum homónimos, dos', () => {
  const filas = fundir(
    [
      { fuente: 'mb', artist: 'Aesop Rock', title: 'Trouble Mountain', date: '2026-11-13', tipo: 'album', rg_mbid: RG(2), artist_id: 1 },
      { fuente: 'mb', artist: 'Blockhead', title: 'Trouble Mountain', date: '2026-11-13', tipo: 'album', rg_mbid: RG(2), artist_id: 2 },
      { fuente: 'deezer', artist: 'Tindersticks', title: 'Dog Roses', date: '2027-03-12', tipo: 'album', ahead: true },
      { fuente: 'cancion', artist: 'Tindersticks', title: 'Dog Roses', date: '2026-11-20', tipo: 'single' },
    ],
    { hoy: HOY }
  );
  assert.equal(filas.length, 3);
  const colab = filas.find((f) => f.title === 'Trouble Mountain');
  assert.equal(colab.artist, 'Aesop Rock & Blockhead');
  assert.equal(colab.artistas.length, 2);
  const tinder = filas.filter((f) => f.artist === 'Tindersticks');
  assert.deepEqual(tinder.map((f) => f.tipo).sort(), ['album', 'single']);
  assert.equal(tinder.find((f) => f.tipo === 'album').sinMb, true);
});

test('una fecha disparatada no coloca el disco en ningún sitio; la nota del curador se conserva', () => {
  const filas = fundir(
    [
      { fuente: 'deezer', artist: 'Snow Patrol', title: "When It's All Over We Still Have to Clear Up", date: '4018-05-11', tipo: 'album' },
      { fuente: 'radar', artist: 'Nadie', title: 'Disco flojo', date: '2026-11-10', tipo: 'album', curador: 'Hipersónica · Tier List', nota: 'Meh' },
    ],
    { hoy: HOY }
  );
  assert.deepEqual(filas.map((f) => f.artist), ['Nadie']);
  assert.deepEqual(filas[0].curadores, [{ nombre: 'Hipersónica · Tier List', nota: 'Meh', url: null }]);
});

// --- con base de datos ----------------------------------------------------------------
const art = db.prepare('INSERT INTO artists (id, name, mbid) VALUES (?, ?, ?)');
art.run(1, 'Seguido', RG(901));
art.run(2, 'En Colección', RG(902));
art.run(3, 'Sin Discos', RG(903));
db.prepare("INSERT INTO tracked_artists (artist_id, facet, added_at) VALUES (1, 'artist', 0)").run();
const alb = db.prepare("INSERT INTO albums (id, local_key, artist_id, album_artist, title, rg_mbid, match_state) VALUES (?, ?, ?, ?, ?, ?, 'matched')");
alb.run(1, 'a', 1, 'Seguido', 'Uno Viejo', RG(10));
alb.run(2, 'b', 2, 'En Colección', 'Otro Viejo', RG(20));
alb.run(3, 'c', 1, 'Seguido', 'Ya Lo Tengo', RG(13));
const rg = db.prepare('INSERT INTO release_groups (rg_mbid, artist_id, artist_mbid, title, first_release, primary_type, secondary_types, is_upcoming) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
// la marca guardada dice «por salir» de uno que YA salió, y al revés: no hay que fiarse de ella
rg.run(RG(11), 1, RG(901), 'Sale Pronto', '2026-12-04', 'Album', '[]', 0);
rg.run(RG(12), 1, RG(901), 'Salió La Semana Pasada', '2026-11-17', 'Album', '[]', 1);
rg.run(RG(13), 1, RG(901), 'Ya Lo Tengo', '2026-11-10', 'Album', '[]', 0);
rg.run(RG(14), 1, RG(901), 'Single Nuevo', '2026-12-01', 'Single', '[]', 1);
rg.run(RG(15), 1, RG(901), 'En Directo', '2026-12-02', 'Album', '["Live"]', 1);
rg.run(RG(16), 1, RG(901), 'Clásico (Deluxe Edition)', '2026-12-03', 'Album', '[]', 1);
rg.run(RG(17), 1, RG(901), 'Algún Día De 2026', '2026', 'Album', '[]', 0);
rg.run(RG(21), 2, RG(902), 'De Uno De Mi Colección', '2026-12-10', 'Album', '[]', 1);
rg.run(RG(31), 3, RG(903), 'De Uno Que No Tengo', '2026-12-11', 'Album', '[]', 1);

const titulos = (r) => r.items.map((f) => f.title);

test('por venir: lo que sigo, por fecha real, sin lo que ya tengo, singles ni reediciones', () => {
  const r = lanzamientos({ vista: 'porvenir', hoy: HOY });
  assert.deepEqual(titulos(r), ['Sale Pronto', 'Algún Día De 2026']);
  assert.equal(r.items[0].relacion, 'sigo');
  assert.equal(r.items[1].cuando, 'sinfecha', 'la fecha de solo año va al final, como «por confirmar»');
  assert.deepEqual(r.cuentas, { porvenir: 2, recientes: 1, descubrir: 0 });
});

test('los filtros abren la mano: toda la colección, singles, otros y reediciones', () => {
  assert.deepEqual(titulos(lanzamientos({ vista: 'porvenir', alcance: 'coleccion', hoy: HOY })), ['Sale Pronto', 'De Uno De Mi Colección', 'Algún Día De 2026']);
  assert.deepEqual(
    titulos(lanzamientos({ vista: 'porvenir', tipos: ['album', 'ep', 'single', 'otro'], reediciones: true, hoy: HOY })),
    ['Single Nuevo', 'En Directo', 'Clásico (Deluxe Edition)', 'Sale Pronto', 'Algún Día De 2026']
  );
  // un artista del que no tienes nada ni sigues no es «tuyo» en ningún alcance
  assert.ok(!titulos(lanzamientos({ vista: 'porvenir', alcance: 'coleccion', hoy: HOY })).includes('De Uno Que No Tengo'));
});

test('recién salido: lo que ya salió y falta; lo que tienes se cuenta aparte', () => {
  const r = lanzamientos({ vista: 'recientes', hoy: HOY });
  assert.deepEqual(titulos(r), ['Salió La Semana Pasada']);
  assert.equal(r.yaTienes, 1);
  assert.deepEqual(titulos(lanzamientos({ vista: 'recientes', conTuyos: true, hoy: HOY })), ['Salió La Semana Pasada', 'Ya Lo Tengo']);
});

test('el widget de próximos del Dashboard también va por fecha, no por la marca guardada', () => {
  const t = upcoming({ onlyTracked: true }).map((x) => x.title);
  // con el reloj real estas fechas pueden haber pasado: lo que importa es que la marca
  // is_upcoming=1 de un disco con fecha pasada NO lo cuele
  assert.ok(!t.includes('Salió La Semana Pasada') || hoyLocal() < '2026-11-17');
});

test('descartar una fila quita todo lo que la compone, y se puede deshacer', async () => {
  db.prepare("INSERT INTO external_releases (id, source, artist_id, artist, title, release_date, record_type, match_key, dismissed) VALUES (50, 'deezer', 1, 'Seguido', 'Sale Pronto', '2026-12-04', 'album', 'k50', 0)").run();
  const fila = lanzamientos({ vista: 'porvenir', hoy: HOY }).items.find((f) => f.title === 'Sale Pronto');
  assert.deepEqual(fila.fuentes.sort(), ['deezer', 'mb']);
  assert.equal(fila.refs.length, 2);

  const r = await app.inject({ method: 'POST', url: '/api/lanzamientos/descartar', payload: { refs: fila.refs } });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().n, 2);
  assert.ok(!titulos(lanzamientos({ vista: 'porvenir', hoy: HOY })).includes('Sale Pronto'));

  restaurarLanzamiento(fila.refs);
  assert.ok(titulos(lanzamientos({ vista: 'porvenir', hoy: HOY })).includes('Sale Pronto'));

  const mala = await app.inject({ method: 'POST', url: '/api/lanzamientos/descartar', payload: { refs: [{ tipo: 'inventado', id: 1 }] } });
  assert.equal(mala.statusCode, 400);
  assert.throws(() => descartarLanzamiento([]), /qué descartar/);
});

test('por HTTP: la ruta contesta con las tres cuentas y respeta los filtros', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/lanzamientos?vista=porvenir&alcance=coleccion&tipos=album,ep,single' });
  assert.equal(r.statusCode, 200);
  const j = r.json();
  assert.equal(j.vista, 'porvenir');
  assert.equal(j.alcance, 'coleccion');
  assert.equal(typeof j.cuentas.descubrir, 'number');
  assert.ok(Array.isArray(j.items));
  // un valor raro no rompe: cae a lo de por defecto
  assert.equal((await app.inject({ method: 'GET', url: '/api/lanzamientos?vista=loquesea&tipos=zzz' })).json().vista, 'porvenir');
});
