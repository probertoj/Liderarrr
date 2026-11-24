import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

// El botón «Discografía» tiene que PREGUNTAR a MusicBrainz. Releía la copia guardada (30 días)
// y un disco recién publicado no aparecía por mucho que se pulsara; el refresco nocturno,
// igual. Aquí MusicBrainz es un doble: lo que importa es cuándo se le pregunta y cuándo no.
process.env.DATA_DIR = path.join(os.tmpdir(), `liderarr-fresca-${Date.now()}`);
const { db } = await import('../src/db.js');
const { app } = await import('../src/index.js');
app.log.level = 'silent';
const { enrichArtistDiscography, artistasPorActualizar, artistCompleteness } = await import('../src/discography.js');
const { FRESCURA } = await import('../src/cache-versions.js');

const MB = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const HORA = 3600 * 1000;
const DIA = 24 * HORA;

// --- MusicBrainz de mentira: una discografía por artista, y la cuenta de preguntas
const discografias = new Map();
let preguntas = 0;
const fetchDeVerdad = globalThis.fetch;
globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  if (u.hostname !== 'musicbrainz.org') throw new Error(`petición inesperada a ${u.hostname}`);
  preguntas++;
  const lista = discografias.get(u.searchParams.get('artist')) || [];
  return new Response(JSON.stringify({ 'release-group-count': lista.length, 'release-groups': lista }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
after(() => {
  globalThis.fetch = fetchDeVerdad;
});

const rg = (n, title, date, tipo = 'EP') => ({ id: MB(n), title, 'first-release-date': date, 'primary-type': tipo, 'secondary-types': [] });
const envejecerCopia = (ms) => db.prepare("UPDATE ext_cache SET fetched_at = fetched_at - ? WHERE key LIKE 'mb:artist-rgs:%'").run(ms);

db.prepare('INSERT INTO artists (id, name, mbid) VALUES (?, ?, ?)').run(1, 'Blackhaine', MB(1));
const EPS = [rg(101, 'Armour', '2020-11-27'), rg(102, 'And Salford Falls Apart', '2021-11-19'), rg(103, 'Armour II', '2022-06-10')];
const DISCO_NUEVO = rg(104, 'Saints in the Wethouse', '2026-11-13', 'Album');

test('la primera vez no hay «nuevos»: es todo lo que hay', async () => {
  discografias.set(MB(1), EPS);
  const r = await enrichArtistDiscography(1);
  assert.equal(r.total, 3);
  assert.deepEqual(r.nuevos, []);
});

test('un artista sin álbumes de estudio está calculado, aunque no tenga porcentaje', () => {
  const c = artistCompleteness(1);
  assert.equal(c.pct, null, 'sin álbumes de estudio no hay porcentaje');
  assert.equal(c.calculada, true, 'la ficha decía «aún no se ha calculado la discografía»');
  assert.ok(c.visto > 0);
  assert.equal(c.missingEps.length, 3);
});

test('sin pedir frescura se sigue tirando de la copia guardada', async () => {
  discografias.set(MB(1), [...EPS, DISCO_NUEVO]); // MusicBrainz ya tiene el disco nuevo
  envejecerCopia(2 * DIA); // la copia es de hace dos días
  const antes = preguntas;
  const r = await enrichArtistDiscography(1);
  assert.equal(preguntas, antes, 'no se pregunta: la copia vale 30 días');
  assert.equal(r.total, 3);
});

test('el botón «Discografía» pregunta a MusicBrainz y dice qué hay nuevo', async () => {
  const antes = preguntas;
  const res = await app.inject({ method: 'POST', url: '/api/artists/1/refresh-discography' });
  assert.equal(res.statusCode, 200);
  const r = res.json();
  assert.equal(preguntas, antes + 1, 'una pregunta de verdad');
  assert.equal(r.total, 4);
  assert.deepEqual(r.nuevos.map((n) => n.title), ['Saints in the Wethouse']);
  const c = artistCompleteness(1);
  assert.deepEqual(c.missing.map((m) => m.title), ['Saints in the Wethouse'], 'el disco nuevo ya sale en «te faltan»');
  assert.equal(c.pct, 0);
});

test('pulsar dos veces seguidas no pregunta dos veces', async () => {
  const antes = preguntas;
  const r = (await app.inject({ method: 'POST', url: '/api/artists/1/refresh-discography' })).json();
  assert.equal(preguntas, antes, 'la copia tiene segundos: vale');
  assert.deepEqual(r.nuevos, [], 'y lo de antes ya no es nuevo');
});

test('la frescura de los seguidos pregunta cada noche; la del resto, cada semana', async () => {
  envejecerCopia(13 * HORA);
  let antes = preguntas;
  await enrichArtistDiscography(1, { maxAge: FRESCURA.resto });
  assert.equal(preguntas, antes, 'para un artista cualquiera, 13 horas es reciente');
  await enrichArtistDiscography(1, { maxAge: FRESCURA.seguidos });
  assert.equal(preguntas, antes + 1, 'para uno que sigues, toca preguntar');
  envejecerCopia(6 * DIA + HORA);
  antes = preguntas;
  await enrichArtistDiscography(1, { maxAge: FRESCURA.resto });
  assert.equal(preguntas, antes + 1);
});

test('a quién le toca: seguidos cada noche, el resto cada semana y repartido', () => {
  const AHORA = Date.UTC(2026, 10, 24, 3, 0, 0);
  const art = db.prepare('INSERT INTO artists (id, name, mbid) VALUES (?, ?, ?)');
  const visto = db.prepare(
    `INSERT INTO artist_stats (artist_id, studio_total, studio_owned, missing, upcoming, fetched_at) VALUES (?, 0, 0, 0, 0, ?)
     ON CONFLICT(artist_id) DO UPDATE SET fetched_at = excluded.fetched_at`
  );
  const seguir = db.prepare("INSERT INTO tracked_artists (artist_id, facet, added_at) VALUES (?, 'artist', 0)");

  visto.run(1, AHORA - 2 * HORA); // el de las pruebas de arriba: recién visto, no seguido
  art.run(10, 'Seguido de anoche', MB(10)); seguir.run(10); visto.run(10, AHORA - 24 * HORA);
  art.run(11, 'Seguido de hace un rato', MB(11)); seguir.run(11); visto.run(11, AHORA - 2 * HORA);
  art.run(12, 'Seguido sin calcular', MB(12)); seguir.run(12);
  art.run(20, 'De la colección, hace 8 días', MB(20)); visto.run(20, AHORA - 8 * DIA);
  art.run(21, 'De la colección, hace 3 días', MB(21)); visto.run(21, AHORA - 3 * DIA);
  art.run(22, 'De la colección, sin calcular', MB(22));
  db.prepare('INSERT INTO artists (id, name) VALUES (?, ?)').run(23, 'Sin MusicBrainz');

  const ids = (o) => artistasPorActualizar({ ahora: AHORA, ...o }).map((p) => p.id);
  assert.deepEqual(ids({ onlyTracked: true }).sort(), [10, 12]);
  assert.deepEqual(ids({}), [10, 12, 22, 20], 'primero los seguidos, luego lo nunca calculado, luego lo caducado');

  // Con 300 artistas caducados, el refresco nocturno no los pide todos la misma noche.
  for (let i = 0; i < 300; i++) {
    art.run(1000 + i, `Relleno ${i}`, MB(1000 + i));
    visto.run(1000 + i, AHORA - 30 * DIA + i * 1000); // el 1000 es el más antiguo
  }
  assert.equal(ids({}).length, 4 + 300, 'a mano («Actualizar todo») van todos');
  const noche = ids({ repartir: true });
  assert.equal(noche.length, 3 + 200, 'de noche: los seguidos, lo nunca calculado y un tope de caducados');
  assert.deepEqual(noche.slice(0, 3), [10, 12, 22]);
  assert.equal(noche[3], 1000, 'los más antiguos primero');
  assert.ok(!noche.includes(20), 'el de hace 8 días espera a otra noche: hay 200 más antiguos');
});
