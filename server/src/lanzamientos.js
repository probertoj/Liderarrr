import { db } from './db.js';
import { matchKey, normName } from './matchkey.js';
import { ownedMatcher } from './discover.js';
import { excludeVariousSql } from './various.js';
import { activeRequestRgs } from './downloads.js';
import { labelReleases } from './followlabels.js';
import { radarFeed } from './radar.js';
import { externalNewReleases, externalNewSongs } from './newreleases.js';
import { globalReleases } from './globalradar.js';
import { hoyLocal } from './fechas.js';

// LANZAMIENTOS, POR LO QUE UNO SE PREGUNTA.
//
// La pantalla estaba organizada por DE DÓNDE viene cada dato: nueve pestañas (MusicBrainz por
// venir, MusicBrainz ya salido, Deezer discos, Deezer canciones, afines, sellos, curadores…),
// el mismo disco repetido en varias y cada una con su manera de decidir qué es «tuyo». Aquí
// se funden todas en UNA lista con una fila por disco, y la pantalla pregunta otra cosa:
//
//   · por venir   lo que aún no ha salido
//   · recientes   lo que ya salió y te falta
//   · descubrir   lo que te recomiendan de artistas que no tienes
//
// Cada fila dice POR QUÉ está ahí (sigues al artista, es de un sello que sigues, lo recomienda
// tal curador…), que es lo que antes había que deducir de la pestaña en la que estabas.
//
// Qué está por salir se decide comparando la fecha con HOY en cada consulta. Antes se leía
// una marca guardada (`release_groups.is_upcoming`) que solo se recalcula cada semana: un
// disco ya publicado seguía días en «Próximos» y faltaba en «Estrenados».

const DIA = 86400000;

// Una fecha de más de tres años vista es un error de la fuente (Deezer manda algún 4018).
const fechaSensata = (f, hoy) => typeof f === 'string' && /^\d{4}(-\d{2}(-\d{2})?)?$/.test(f) && f.slice(0, 4) <= String(Number(hoy.slice(0, 4)) + 3);

// ¿Cuándo cae una fecha respecto a hoy? 'futuro' · 'pasado' · 'sinfecha'.
// Las fechas de solo año o de año y mes («2026», «2026-11») se comparan por su tramo: si es
// el año o el mes en curso no se puede saber, y se dice («fecha por confirmar») en vez de
// darlo por publicado, que es lo que pasaba al comparar textos.
export function cuandoCae(fecha, hoy) {
  if (!fecha) return 'sinfecha';
  const tramo = hoy.slice(0, fecha.length);
  if (fecha.length === 10) return fecha > hoy ? 'futuro' : 'pasado';
  if (fecha > tramo) return 'futuro';
  if (fecha < tramo) return 'pasado';
  return 'sinfecha';
}

const REEDICION = /\b(re-?issue[d]?|re-?master(ed|izado)?|reedici[oó]n|anniversary|aniversario|deluxe|expanded|expandida|super deluxe|box ?set)\b/i;
export const esReedicion = (titulo) => REEDICION.test(String(titulo || ''));

// Tipo en cuatro cajones, que es lo que se filtra: álbum, EP, single y «otro» (directos,
// recopilatorios, bandas sonoras…: lo que MusicBrainz marca con tipos secundarios).
export function tipoDe({ primary_type, secondary_types, record_type, type } = {}) {
  const sec = String(secondary_types || '').toLowerCase();
  if (sec && sec !== '[]') return 'otro';
  const t = String(primary_type || record_type || type || '').toLowerCase();
  if (t === 'single' || t === 'track') return 'single';
  if (t === 'ep') return 'ep';
  if (t === 'album' || t === '') return 'album';
  return 'otro';
}

const primerArtista = (s) => String(s || '').split(/\s*(?:,|&| feat\.? | ft\.? | with | y | x )\s*/i)[0] || String(s || '');

// Funde candidatos de varias fuentes en una fila por disco. Pura: se prueba con ejemplos.
// Cada candidato: { fuente, artist, title, date, tipo, rg_mbid?, artist_id?, artist_mbid?,
//   cover?, url?, sellos?: [], curador?, nota?, razon?, ahead?, ref: {tipo, …} }
export function fundir(candidatos, { hoy = hoyLocal() } = {}) {
  // Un mismo disco llega con MBID desde MusicBrainz y sin él desde Deezer o un curador. Si
  // para ese artista+título solo hay UN release group, los que no traen MBID son ese.
  const rgDeNombre = new Map();
  for (const c of candidatos) {
    if (!c.rg_mbid) continue;
    const n = matchKey(primerArtista(c.artist), c.title);
    if (!rgDeNombre.has(n)) rgDeNombre.set(n, new Set());
    rgDeNombre.get(n).add(c.rg_mbid);
  }
  // Prioridad de la fecha: MusicBrainz manda; luego la plataforma; un curador da a veces la
  // fecha de su lista, no la del disco, así que es la última.
  const PESO = { mb: 0, sello: 1, deezer: 2, cancion: 2, descubre: 3, radar: 4 };
  const grupos = new Map();
  for (const c of candidatos) {
    if (!c.artist || !c.title) continue;
    const n = matchKey(primerArtista(c.artist), c.title);
    const rgs = rgDeNombre.get(n);
    // un single y un álbum que se llaman igual son dos cosas
    const clave = `${c.rg_mbid || (rgs?.size === 1 ? [...rgs][0] : n)}${c.tipo === 'single' ? '#s' : ''}`;
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave).push(c);
  }
  const filas = [];
  for (const [clave, g] of grupos) {
    g.sort((a, b) => PESO[a.fuente] - PESO[b.fuente]);
    const base = g[0];
    const conFecha = g.find((c) => fechaSensata(c.date, hoy));
    const fecha = conFecha ? conFecha.date : null;
    // traía fecha pero era un disparate (año 4018): no es «fecha por confirmar», es un dato
    // malo de un disco que a saber cuándo salió. Mejor no enseñarlo que colocarlo mal.
    if (!fecha && g.some((c) => c.date)) continue;
    // una colaboración llega una vez por artista con el mismo MBID: se enseña una sola vez
    const artistas = [];
    for (const c of g) if (c.fuente === 'mb' && !artistas.some((a) => normName(a.name) === normName(c.artist))) artistas.push({ name: c.artist, id: c.artist_id || null });
    if (!artistas.length) artistas.push({ name: base.artist, id: g.find((c) => c.artist_id)?.artist_id || null });
    const fuentes = [...new Set(g.map((c) => c.fuente))];
    const sellos = [...new Set(g.flatMap((c) => c.sellos || []))];
    const curadores = [];
    for (const c of g) if (c.curador && !curadores.some((x) => x.nombre === c.curador)) curadores.push({ nombre: c.curador, nota: c.nota || null, url: c.url || null });
    const titulo = base.title;
    filas.push({
      clave,
      artist: artistas.map((a) => a.name).join(' & '),
      artistas,
      title: titulo,
      date: fecha,
      cuando: cuandoCae(fecha, hoy),
      tipo: g.find((c) => c.tipo && c.tipo !== 'album')?.tipo || base.tipo || 'album',
      reedicion: esReedicion(titulo),
      rg_mbid: g.find((c) => c.rg_mbid)?.rg_mbid || null,
      artist_mbid: g.find((c) => c.artist_mbid)?.artist_mbid || null,
      cover: g.find((c) => c.cover)?.cover || null,
      fuentes,
      sellos,
      curadores,
      razon: g.find((c) => c.razon)?.razon || null,
      sinMb: !g.some((c) => c.rg_mbid) && g.some((c) => c.ahead),
      enlaces: g.filter((c) => c.url).map((c) => ({ fuente: c.fuente, url: c.url })),
      refs: g.map((c) => c.ref).filter(Boolean),
    });
  }
  return filas;
}

// Relación del disco contigo, de más a menos: lo sigues (al artista o a su sello), es de un
// artista de tu colección, o te lo proponen. Decide en qué vista cae.
function relacionDe(fila, idx) {
  const nombres = fila.artistas.map((a) => normName(a.name));
  const sigues = nombres.some((n) => idx.seguidos.has(n));
  if (sigues || fila.sellos.length) return sigues ? 'sigo' : 'sello';
  if (nombres.some((n) => idx.coleccion.has(n))) return 'coleccion';
  return 'descubrir';
}

function indices() {
  const seguidos = new Set(
    db.prepare("SELECT ar.name FROM tracked_artists t JOIN artists ar ON ar.id = t.artist_id WHERE t.facet = 'artist'").all().map((r) => normName(r.name))
  );
  const coleccion = new Set(
    db
      .prepare("SELECT DISTINCT ar.name FROM artists ar JOIN albums a ON a.artist_id = ar.id WHERE a.match_state != 'dismissed'")
      .all()
      .map((r) => normName(r.name))
  );
  return { seguidos, coleccion };
}

// Reúne los candidatos de todas las fuentes desde `desde` (YYYY-MM-DD) en adelante.
export function candidatos({ desde, hoy = hoyLocal() } = {}) {
  const out = [];
  const anio = desde.slice(0, 4);
  for (const r of db
    .prepare(
      `SELECT rg.rg_mbid, rg.title, rg.first_release, rg.primary_type, rg.secondary_types, rg.artist_id, rg.artist_mbid,
              ar.name AS artist,
              (SELECT GROUP_CONCAT(DISTINCT tl.name) FROM label_release_groups lrg
                 JOIN tracked_labels tl ON tl.label_mbid = lrg.label_mbid WHERE lrg.rg_mbid = rg.rg_mbid) AS labels
       FROM release_groups rg JOIN artists ar ON ar.id = rg.artist_id
       WHERE rg.first_release >= @anio
         AND rg.rg_mbid NOT IN (SELECT rg_mbid FROM dismissed_albums)
         ${excludeVariousSql()}`
    )
    .all({ anio })) {
    // de las fechas completas, solo la ventana; las parciales del año se dejan pasar
    if (r.first_release.length === 10 && r.first_release < desde) continue;
    out.push({
      fuente: 'mb',
      artist: r.artist,
      title: r.title,
      date: r.first_release,
      tipo: tipoDe(r),
      rg_mbid: r.rg_mbid,
      artist_id: r.artist_id,
      artist_mbid: r.artist_mbid,
      sellos: r.labels ? r.labels.split(',') : [],
      ref: { tipo: 'rg', rg_mbid: r.rg_mbid, title: r.title },
    });
  }
  for (const r of labelReleases({ since: desde })) {
    out.push({
      fuente: 'sello',
      artist: r.artist,
      title: r.title,
      date: r.first_release,
      tipo: tipoDe(r),
      rg_mbid: r.rg_mbid,
      artist_id: r.artist_id || null,
      artist_mbid: r.artist_mbid,
      sellos: r.labels ? String(r.labels).split(',') : [],
      ref: { tipo: 'rg', rg_mbid: r.rg_mbid, title: r.title },
    });
  }
  const externos = [...externalNewReleases({ limit: 100000, includeOwned: true }), ...externalNewSongs({ days: 60, includeOwned: true, limit: 100000 })];
  for (const r of externos) {
    if (fechaSensata(r.release_date, hoy) && r.release_date < desde) continue;
    out.push({
      fuente: r.record_type === 'single' ? 'cancion' : 'deezer',
      artist: r.artist,
      title: r.title,
      date: r.release_date,
      tipo: tipoDe(r),
      artist_id: r.artist_id,
      cover: r.cover,
      url: r.url,
      ahead: !!r.ahead,
      ref: { tipo: 'externo', id: r.id },
    });
  }
  for (const r of globalReleases({ days: Math.ceil((Date.parse(hoy) - Date.parse(desde)) / DIA), includeOwned: true, limit: 100000 })) {
    out.push({
      fuente: 'descubre',
      artist: r.artist,
      title: r.title,
      date: r.release_date,
      tipo: tipoDe(r),
      cover: r.cover,
      url: r.url,
      razon: r.reason || null,
      ref: { tipo: 'global', id: r.id },
    });
  }
  const TIPOS_RADAR = new Set(['album', 'track', 'ep', 'single', '']);
  for (const r of radarFeed({ since: desde })) {
    const t = String(r.type || '').toLowerCase();
    out.push({
      fuente: 'radar',
      artist: r.artist,
      title: r.title,
      date: r.release_date,
      tipo: t === 'track' || t === 'single' ? 'single' : t === 'ep' ? 'ep' : 'album',
      rg_mbid: r.rg_mbid || null,
      artist_mbid: r.artist_mbid || null,
      cover: r.image || null,
      url: r.url || null,
      curador: r.curator,
      // la columna `type` de una tier list no es un tipo: es el veredicto del curador
      // («Sí», «Meh», «No»…). Se enseñaba el disco como recomendación sin decir cuál.
      nota: TIPOS_RADAR.has(t) ? null : r.type,
      sellos: r.tracked_label && r.label ? [r.label] : [],
      ref: { tipo: 'radar', id: r.id },
    });
  }
  return out;
}

const VENTANA = { porvenir: 0, recientes: 90, descubrir: 30, todo: 400 };

// La lista de una vista. `alcance`: 'sigo' (artistas y sellos que sigues) o 'coleccion'
// (además, cualquier artista del que tengas algo). `tipos`: los que se quieren ver.
export function lanzamientos({ vista = 'porvenir', alcance = 'sigo', tipos = ['album', 'ep'], reediciones = false, dias = null, conTuyos = false, hoy = hoyLocal() } = {}) {
  const ventana = Math.max(1, Number(dias) || VENTANA[vista] || 90);
  // se pide siempre la ventana más ancha que hace falta para contar las tres vistas
  const atras = Math.max(ventana, VENTANA.recientes, VENTANA.descubrir);
  const desde = new Date(Date.parse(hoy) - atras * DIA).toISOString().slice(0, 10);
  const corte = (d) => new Date(Date.parse(hoy) - d * DIA).toISOString().slice(0, 10);
  const idx = indices();
  const tuyo = ownedMatcher();
  const pedidos = activeRequestRgs();
  const quiere = new Set(tipos);

  const filas = fundir(candidatos({ desde, hoy }), { hoy }).map((f) => ({
    ...f,
    relacion: relacionDe(f, idx),
    owned: f.artistas.some((a) => tuyo(f.rg_mbid, a.name, f.title)),
    requested: !!f.rg_mbid && pedidos.has(f.rg_mbid),
  }));

  const pasa = (f) => quiere.has(f.tipo) && (reediciones || !f.reedicion);
  const tuya = (f) => (alcance === 'coleccion' ? f.relacion !== 'descubrir' : f.relacion === 'sigo' || f.relacion === 'sello');
  const dentro = (f, d) => f.date && (f.date.length === 10 ? f.date >= corte(d) : f.date >= corte(d).slice(0, f.date.length));

  const enVista = {
    porvenir: (f) => tuya(f) && f.cuando !== 'pasado' && !f.owned,
    recientes: (f, d = VENTANA.recientes) => tuya(f) && f.cuando === 'pasado' && dentro(f, d),
    // descubrir es lo que alguien te PROPONE: tiene que venir de un curador o de afines
    descubrir: (f, d = VENTANA.descubrir) =>
      f.relacion === 'descubrir' && !f.owned && (f.curadores.length > 0 || !!f.razon) && (f.cuando === 'futuro' || dentro(f, d)),
  };
  const validas = filas.filter(pasa);
  const cuentas = {
    porvenir: validas.filter((f) => enVista.porvenir(f)).length,
    recientes: validas.filter((f) => enVista.recientes(f) && !f.owned).length,
    descubrir: validas.filter((f) => enVista.descubrir(f)).length,
  };

  let items;
  if (vista === 'todo') items = validas.filter((f) => tuya(f) && f.date && f.date.length === 10 && f.date >= corte(ventana));
  else if (vista === 'recientes') items = validas.filter((f) => enVista.recientes(f, ventana) && (conTuyos || !f.owned));
  else if (vista === 'descubrir') items = validas.filter((f) => enVista.descubrir(f, ventana));
  else items = validas.filter((f) => enVista.porvenir(f));

  // las fechas a medias («2026», «2026-11») van al final de su tramo, no al principio
  const orden = (f) => (!f.date ? '9999' : f.date.length === 10 ? f.date : f.date + '~');
  const porFecha = (a, b) => orden(a).localeCompare(orden(b)) || a.artist.localeCompare(b.artist, 'es');
  items.sort(vista === 'porvenir' || vista === 'todo' ? porFecha : (a, b) => porFecha(b, a));
  const yaTienes = vista === 'recientes' ? validas.filter((f) => enVista.recientes(f, ventana) && f.owned).length : 0;
  return { vista, alcance, hoy, dias: ventana, total: items.length, yaTienes, cuentas, items };
}

// Descartar una fila es descartar TODO lo que la compone (el release group de MusicBrainz,
// la fila de Deezer, la del curador…): si no, reaparecería por la otra fuente. Y se puede
// deshacer, que antes no.
const ACCIONES = {
  rg: {
    quitar: (r) => db.prepare('INSERT OR REPLACE INTO dismissed_albums (rg_mbid, title, at) VALUES (?, ?, ?)').run(r.rg_mbid, r.title || null, Date.now()),
    poner: (r) => db.prepare('DELETE FROM dismissed_albums WHERE rg_mbid = ?').run(r.rg_mbid),
    vale: (r) => typeof r.rg_mbid === 'string' && r.rg_mbid.length === 36,
  },
  externo: {
    quitar: (r) => db.prepare('UPDATE external_releases SET dismissed = 1 WHERE id = ?').run(r.id),
    poner: (r) => db.prepare('UPDATE external_releases SET dismissed = 0 WHERE id = ?').run(r.id),
    vale: (r) => Number.isInteger(r.id),
  },
  radar: {
    quitar: (r) => db.prepare('UPDATE radar_items SET dismissed = 1 WHERE id = ?').run(r.id),
    poner: (r) => db.prepare('UPDATE radar_items SET dismissed = 0 WHERE id = ?').run(r.id),
    vale: (r) => Number.isInteger(r.id),
  },
  global: {
    quitar: (r) => db.prepare('UPDATE global_releases SET dismissed = 1 WHERE id = ?').run(r.id),
    poner: (r) => db.prepare('UPDATE global_releases SET dismissed = 0 WHERE id = ?').run(r.id),
    vale: (r) => Number.isInteger(r.id),
  },
};

function aplicar(refs, que) {
  if (!Array.isArray(refs) || !refs.length) throw new Error('No se ha dicho qué descartar');
  const buenas = refs.filter((r) => r && ACCIONES[r.tipo]?.vale(r));
  if (!buenas.length) throw new Error('Nada de lo indicado se puede descartar');
  db.transaction(() => {
    for (const r of buenas) ACCIONES[r.tipo][que](r);
  })();
  return { ok: true, n: buenas.length };
}
export const descartarLanzamiento = (refs) => aplicar(refs, 'quitar');
export const restaurarLanzamiento = (refs) => aplicar(refs, 'poner');
