import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { staleCacheSql, versionFor } from './cache-versions.js';
import { albumKey, splitRoots } from './libkey.js';

export const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'img'), { recursive: true });

// TODO lo persistente (ajustes, credenciales, biblioteca, caché) vive en este
// único fichero SQLite dentro de /data. Mientras /data sea un volumen montado, la
// configuración sobrevive a reinicios y actualizaciones de la imagen. En un NAS
// es fácil montarlo sin permiso de escritura para el usuario del contenedor; sin
// escritura los ajustes NO se guardarían, así que se comprueba pronto y con un
// mensaje claro, en vez de morir luego con un error críptico de SQLite.
try {
  const probe = path.join(DATA_DIR, '.write-test');
  fs.writeFileSync(probe, String(Date.now()));
  fs.unlinkSync(probe);
} catch (e) {
  console.error(
    `[Liderarrr] ⚠️  /data (${DATA_DIR}) NO es escribible: ${e.message}\n` +
      '           Los ajustes y la biblioteca NO se guardarán. Revisa el volumen montado\n' +
      '           y sus permisos (en Synology/UNRAID, el PUID/PGID del contenedor debe\n' +
      '           poder escribir en la carpeta que mapeas a /data).'
  );
}

export const DB_PATH = path.join(DATA_DIR, 'liderarrr.db');
const IMPORT_PATH = DB_PATH + '.import';

// RESTAURACIÓN de copia de seguridad (Ajustes → «Restaurar base de datos»). El endpoint
// deja el fichero subido y validado en liderarrr.db.import y reinicia el proceso; el
// intercambio REAL se hace AQUÍ, al arrancar, ANTES de abrir la base. Es el único momento
// en que nadie la tiene abierta, así que es seguro en cualquier sistema (no hay que
// sobrescribir un fichero abierto, que en Windows ni se puede y en Linux dejaría al
// proceso con la base vieja). Guarda un respaldo de la actual por si el import sale mal.
if (fs.existsSync(IMPORT_PATH)) {
  try {
    if (fs.existsSync(DB_PATH)) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      fs.copyFileSync(DB_PATH, `${DB_PATH}.bak-${stamp}`);
    }
    // Los sidecars WAL/SHM pertenecen a la base VIEJA: si sobreviven, SQLite los aplicaría
    // sobre la nueva al abrirla y la corromperían. Se eliminan.
    for (const ext of ['-wal', '-shm']) fs.rmSync(DB_PATH + ext, { force: true });
    fs.renameSync(IMPORT_PATH, DB_PATH);
    console.log('[Liderarrr] Base de datos restaurada desde la copia importada.');
  } catch (e) {
    console.error('[Liderarrr] No se pudo restaurar la BBDD importada:', e.message);
    // Se deja el .import para reintentar en el próximo arranque y se abre la base actual.
  }
}

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

// Valida un fichero .db subido y, si es una base de Liderarr sana, lo deja como pendiente
// (liderarrr.db.import) para que el swap ocurra en el próximo arranque. Lanza si no vale.
export function stageDatabaseImport(tempPath) {
  const test = new Database(tempPath, { readonly: true, fileMustExist: true });
  try {
    if (test.pragma('integrity_check', { simple: true }) !== 'ok')
      throw new Error('el fichero está corrupto (integrity_check falló)');
    const hasTable = (n) => test.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(n);
    if (!hasTable('albums') || !hasTable('artists') || !hasTable('settings'))
      throw new Error('no parece una base de datos de Liderarr');
  } finally {
    test.close();
  }
  // Abrir un .db en modo WAL (aunque sea readonly) crea sidecars -wal/-shm junto al
  // temporal; se limpian para no dejar basura. La copia exportada ya viene con el WAL
  // volcado (checkpoint al exportar), así que el fichero principal está completo.
  for (const ext of ['-wal', '-shm']) fs.rmSync(tempPath + ext, { force: true });
  fs.rmSync(IMPORT_PATH, { force: true });
  fs.renameSync(tempPath, IMPORT_PATH);
}

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Artistas. La identidad es LOCAL (id autoincrement): un artista puede existir
-- sin estar en MusicBrainz (el grupo de tu amigo, una autoedición). El mbid es
-- opcional y se rellena cuando/si se identifica.
CREATE TABLE IF NOT EXISTS artists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  sort_name TEXT,
  mbid TEXT,                 -- MusicBrainz artist id (nullable)
  type TEXT,                 -- Person | Group | Orchestra | Choir | Character | Other
  country TEXT,
  began TEXT,
  ended TEXT,
  disambiguation TEXT,
  thumb TEXT,
  details_fetched_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_artists_name ON artists(name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_artists_mbid ON artists(mbid) WHERE mbid IS NOT NULL;

-- Álbum tal y como vive en tu disco. local_key = hash de la carpeta: estable
-- aunque no haya MBID. El release group de MusicBrainz (rg_mbid) es opcional.
CREATE TABLE IF NOT EXISTS albums (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  local_key TEXT UNIQUE,     -- sha1 de la ruta de la carpeta
  path TEXT,
  artist_id INTEGER,
  album_artist TEXT,         -- texto tal cual de las etiquetas
  title TEXT,
  year INTEGER,
  rg_mbid TEXT,              -- MusicBrainz release-group id (nullable)
  release_mbid TEXT,         -- MusicBrainz release id (nullable)
  primary_type TEXT,         -- Album | Single | EP | Broadcast | Other
  secondary_types TEXT,      -- JSON: [Compilation, Live, Remix, Soundtrack, Demo, ...]
  track_count INTEGER,       -- pistas que DEBERÍA tener (de las etiquetas o de MB)
  track_file_count INTEGER,  -- pistas que HAY en disco
  disc_count INTEGER DEFAULT 1,
  size_bytes INTEGER,
  duration_ms INTEGER,
  added_at INTEGER,          -- mtime de la carpeta
  scanned_at INTEGER,
  cover TEXT,                -- ruta relativa de la carátula encontrada
  -- estado de emparejado con una base de datos externa
  match_state TEXT DEFAULT 'pending',   -- matched | pending | unmatched | orphan | bootleg | dismissed
  match_source TEXT,                    -- tags | acoustid | musicbrainz | discogs | lastfm | manual
  match_confidence REAL,
  matched_at INTEGER,
  monitored INTEGER DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_albums_artist ON albums(artist_id);
CREATE INDEX IF NOT EXISTS idx_albums_rg ON albums(rg_mbid);
CREATE INDEX IF NOT EXISTS idx_albums_state ON albums(match_state);
CREATE INDEX IF NOT EXISTS idx_albums_year ON albums(year);

CREATE TABLE IF NOT EXISTS tracks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  album_id INTEGER,
  disc INTEGER DEFAULT 1,
  num INTEGER,
  title TEXT,
  artist TEXT,
  duration_ms INTEGER,
  path TEXT,
  format TEXT,               -- FLAC | MP3 | AAC | OGG | ALAC | WAV | ...
  codec TEXT,
  bitrate INTEGER,
  sample_rate INTEGER,
  bit_depth INTEGER,
  channels INTEGER,
  size_bytes INTEGER,
  lossless INTEGER DEFAULT 0,
  has_replaygain INTEGER DEFAULT 0,
  mb_recording_id TEXT,      -- MBID de grabación desde las etiquetas
  acoustid TEXT              -- huella resuelta (id de AcoustID)
);
CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album_id);

-- Géneros y etiquetas varias, estilo (type,name) de PowaFlex.
CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT,                 -- genre | label | country
  name TEXT,
  UNIQUE (type, name)
);
CREATE TABLE IF NOT EXISTS album_tags (
  album_id INTEGER,
  tag_id INTEGER,
  PRIMARY KEY (album_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_album_tags_tag ON album_tags(tag_id);

-- Sellos discográficos (fase 4, pero la tabla nace ya para no migrar luego).
CREATE TABLE IF NOT EXISTS labels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE,
  mbid TEXT
);
CREATE TABLE IF NOT EXISTS album_labels (
  album_id INTEGER,
  label_id INTEGER,
  catalog_no TEXT,
  PRIMARY KEY (album_id, label_id)
);

-- Artistas que sigues, con faceta (fase 2). Igual que tracked_people de PowaFlex.
CREATE TABLE IF NOT EXISTS tracked_artists (
  artist_id INTEGER NOT NULL,
  facet TEXT NOT NULL DEFAULT 'artist',   -- artist | producer | label
  added_at INTEGER,
  PRIMARY KEY (artist_id, facet)
);

-- Sellos que sigues por su MBID de MusicBrainz (0.6 fase 2). A diferencia de
-- tracked_artists (clavado a un artist_id local), esto es un sello de MB con o sin
-- artistas tuyos: sirve para resaltar sus estrenos aunque no sigas al artista.
-- El catálogo del sello (label_release_groups) se cachea aparte y se refresca en
-- el ciclo de "Actualizar todo". too_big = major que supera el tope de MB (§labelReleaseGroups).
CREATE TABLE IF NOT EXISTS tracked_labels (
  label_mbid TEXT PRIMARY KEY,
  name TEXT,
  disambiguation TEXT,
  country TEXT,
  added_at INTEGER,
  refreshed_at INTEGER,
  too_big INTEGER DEFAULT 0
);
-- Caché del catálogo (álbumes de estudio) de cada sello seguido. Un mismo RG puede
-- salir en varios sellos → PK compuesta. artist_mbid es el primer crédito (puede faltar).
CREATE TABLE IF NOT EXISTS label_release_groups (
  rg_mbid TEXT NOT NULL,
  label_mbid TEXT NOT NULL,
  title TEXT,
  artist_credit TEXT,
  artist_mbid TEXT,
  first_release TEXT,
  fetched_at INTEGER,
  PRIMARY KEY (rg_mbid, label_mbid)
);
CREATE INDEX IF NOT EXISTS idx_lrg_rg ON label_release_groups(rg_mbid);
CREATE INDEX IF NOT EXISTS idx_lrg_label ON label_release_groups(label_mbid);

-- Radar de novedades curadas (0.6 fase 3). Sigues a curadores (hoy: usuarios de
-- buymusic.club, que publican semanalmente lo mejor de Bandcamp) y sus selecciones
-- alimentan un radar afín a tu gusto, sin el ruido del MB-por-fecha. Los ítems de
-- Bandcamp no traen MBID: se resuelve bajo demanda (rg_mbid/artist_mbid) para poder
-- enviar a Lidarr o seguir al artista.
CREATE TABLE IF NOT EXISTS curators (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL DEFAULT 'buymusicclub',
  username TEXT NOT NULL,
  name TEXT,
  added_at INTEGER,
  refreshed_at INTEGER,
  UNIQUE (source, username)
);
CREATE TABLE IF NOT EXISTS radar_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  curator_id INTEGER NOT NULL,
  source TEXT,
  external_id TEXT,           -- id del ítem en la fuente (dedup por curador)
  list_slug TEXT,
  list_title TEXT,            -- "New Releases Friday 31.07.2026"
  list_date TEXT,             -- published_at de la lista (YYYY-MM-DD)
  artist TEXT,
  title TEXT,
  label TEXT,
  release_date TEXT,          -- YYYY-MM-DD
  url TEXT,                   -- enlace Bandcamp
  image TEXT,
  type TEXT,                  -- album | track
  rg_mbid TEXT,               -- resuelto contra MB bajo demanda (caché)
  artist_mbid TEXT,
  resolved_at INTEGER,
  dismissed INTEGER DEFAULT 0,
  first_seen INTEGER,
  UNIQUE (curator_id, external_id)
);
CREATE INDEX IF NOT EXISTS idx_radar_curator ON radar_items(curator_id);
CREATE INDEX IF NOT EXISTS idx_radar_date ON radar_items(release_date);

-- Escuchas (fase 3): scrobbles de Last.fm y/o play counts locales.
CREATE TABLE IF NOT EXISTS listens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  artist TEXT,
  album TEXT,
  track TEXT,
  ts INTEGER,
  source TEXT,               -- lastfm | plex | local
  mbid TEXT
);
CREATE INDEX IF NOT EXISTS idx_listens_ts ON listens(ts);

-- Caché genérica de servicios externos (MusicBrainz, Discogs, Last.fm). La
-- versión permite invalidar por reglas (ver cache-versions.js).
CREATE TABLE IF NOT EXISTS ext_cache (
  key TEXT PRIMARY KEY,
  json TEXT,
  version INTEGER DEFAULT 0,
  fetched_at INTEGER
);

-- Huellas AcoustID: inmutables, se calculan una vez con fpcalc y se guardan para
-- siempre (recalcularlas es caro y el audio no cambia).
CREATE TABLE IF NOT EXISTS acoustid_cache (
  path TEXT PRIMARY KEY,
  fingerprint TEXT,
  duration INTEGER,
  acoustid TEXT,             -- id devuelto por la API (nullable si no resolvió)
  mb_recording_id TEXT,
  computed_at INTEGER
);

-- Álbumes que el usuario marcó "no me interesa" en el flujo de huecos: fuera de
-- recuentos y sugerencias hasta que los recupere.
CREATE TABLE IF NOT EXISTS dismissed_albums (
  rg_mbid TEXT PRIMARY KEY,
  title TEXT,
  at INTEGER
);

-- Snapshot de lo que Lidarr ya tiene/monitoriza, para pintar "ya encargado" sin
-- machacar su API en cada página. Lidarr es actuador, no catálogo.
CREATE TABLE IF NOT EXISTS lidarr_albums (
  rg_mbid TEXT PRIMARY KEY,
  title TEXT,
  artist TEXT,
  monitored INTEGER,
  has_file INTEGER,
  synced_at INTEGER
);

CREATE TABLE IF NOT EXISTS sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at INTEGER,
  finished_at INTEGER,
  status TEXT,
  detail TEXT
);

-- Discografía de MusicBrainz por artista (fase 2, "la caza"). Cada release group
-- que MB conoce de un artista con MBID, marcado con si LO TIENES, si está por
-- estrenar y su tipo. Denormalizado a propósito: huecos, calendario y % de
-- completismo salen de aquí con SQL simple, sin repegar a MB en cada página.
-- Clave COMPUESTA (rg_mbid, artist_id): un release-group puede colgar de varios
-- artistas (splits, colaboraciones) y contar en el completismo de cada uno.
CREATE TABLE IF NOT EXISTS release_groups (
  rg_mbid TEXT NOT NULL,
  artist_id INTEGER NOT NULL,  -- fila local del artista
  artist_mbid TEXT,
  title TEXT,
  first_release TEXT,          -- YYYY-MM-DD (o parcial)
  primary_type TEXT,           -- Album | Single | EP | Broadcast | Other
  secondary_types TEXT,        -- JSON
  is_owned INTEGER DEFAULT 0,
  owned_album_id INTEGER,      -- álbum local que lo cubre (si lo tienes)
  is_upcoming INTEGER DEFAULT 0,
  fetched_at INTEGER,
  PRIMARY KEY (rg_mbid, artist_id)
);
CREATE INDEX IF NOT EXISTS idx_rg_artist ON release_groups(artist_id);
CREATE INDEX IF NOT EXISTS idx_rg_owned ON release_groups(is_owned);
CREATE INDEX IF NOT EXISTS idx_rg_upcoming ON release_groups(is_upcoming);

-- Artist-credit COMPLETO de un álbum local (splits/singles compartidos, colaboraciones):
-- al modo MusicBrainz, un álbum puede estar acreditado a varios artistas con su nexo
-- ("A / B", "A & B"). Solo se llena cuando hay 2+ artistas; con uno basta albums.artist_id.
-- albums.artist_id sigue siendo el artista PRINCIPAL (posición 0) por compatibilidad.
CREATE TABLE IF NOT EXISTS album_artists (
  album_id INTEGER NOT NULL,
  artist_id INTEGER NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,   -- 0 = principal
  join_phrase TEXT,                      -- nexo tras este artista (" / ", " & ", ", ")
  credit_name TEXT,                      -- nombre tal como aparece en el credit
  PRIMARY KEY (album_id, artist_id)
);
CREATE INDEX IF NOT EXISTS idx_aa_album ON album_artists(album_id);
CREATE INDEX IF NOT EXISTS idx_aa_artist ON album_artists(artist_id);

-- Completismo por artista (solo álbumes de estudio estrenados), para poder
-- listar y ordenar sin recalcular. Se rellena junto a release_groups.
CREATE TABLE IF NOT EXISTS artist_stats (
  artist_id INTEGER PRIMARY KEY,
  studio_total INTEGER,        -- álbumes de estudio estrenados que MB conoce
  studio_owned INTEGER,        -- de esos, los que tienes
  missing INTEGER,
  upcoming INTEGER,
  fetched_at INTEGER
);

-- Retos (fase 3): listas de álbumes "que hay que tener/oír" (1001 Albums, RS500,
-- o cualquier lista que pegues). Se cruzan con tu biblioteca y con tus escuchas:
-- anillos de "lo que tengo" vs "lo que he escuchado". Equivale a custom_canons
-- + retos de Letterboxd de PowaFlex.
CREATE TABLE IF NOT EXISTS challenges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  source TEXT,               -- paste | builtin
  item_count INTEGER,
  hidden INTEGER DEFAULT 0,
  added_at INTEGER
);
CREATE TABLE IF NOT EXISTS challenge_items (
  challenge_id INTEGER,
  position INTEGER,
  artist TEXT,
  album TEXT,
  year INTEGER,
  rg_mbid TEXT,
  owned_album_id INTEGER,    -- resuelto contra tu biblioteca
  PRIMARY KEY (challenge_id, position)
);
CREATE INDEX IF NOT EXISTS idx_ci_challenge ON challenge_items(challenge_id);
-- Importaciones por hardlink (Prowlarr -> biblioteca): registro de descargas ya
-- enlazadas, para no reimportarlas. NUNCA borra el origen.
CREATE TABLE IF NOT EXISTS imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_dir TEXT UNIQUE,
  dest_dir TEXT,
  imported_at INTEGER
);

-- Registro nativo de descargas/pedidos (0.6.x, independencia de Lidarr). Cuando Liderarr
-- agarra una release, apunta aquí el pedido con el contexto del álbum; el auto-import casa
-- el torrent terminado (por hash o nombre) con la petición para llevarlo a su carpeta y
-- marcar el estado. Sustituye al snapshot de Lidarr para pintar "pedido/descargando".
CREATE TABLE IF NOT EXISTS downloads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  album_id INTEGER,
  rg_mbid TEXT,
  artist TEXT,
  album TEXT,
  year INTEGER,
  release_title TEXT,
  infohash TEXT,
  source TEXT,                -- jackett | prowlarr
  status TEXT DEFAULT 'requested',  -- requested | importing | imported | error
  dest TEXT,
  requested_at INTEGER,
  updated_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_downloads_status ON downloads(status);
CREATE INDEX IF NOT EXISTS idx_downloads_infohash ON downloads(infohash);
CREATE INDEX IF NOT EXISTS idx_downloads_rg ON downloads(rg_mbid);

-- Carpetas que el usuario oculta de la lista «Importar» («ya la tengo» / no me interesa).
-- No se importan ni las coge el auto-import; solo dejan de aparecer. Reversible (deshacer).
CREATE TABLE IF NOT EXISTS import_ignored (
  source_dir TEXT UNIQUE,
  ignored_at INTEGER
);

-- Sugerencias de artistas para SEGUIR (Last.fm artist.getSimilar sobre tus seeds), que
-- aún no tienes ni sigues. Se recalculan en el refresco; las descartadas no vuelven.
CREATE TABLE IF NOT EXISTS artist_suggestions (
  key TEXT PRIMARY KEY,      -- normName(name), para dedup y descarte estable
  name TEXT,
  mbid TEXT,
  score REAL,
  reasons TEXT,              -- JSON: nombres de seeds que lo recomiendan
  image TEXT,                -- foto Deezer (URL), opcional
  updated_at INTEGER,
  dismissed INTEGER DEFAULT 0
);

-- Novedades detectadas en Deezer/Spotify que MusicBrainz AÚN no lista (se adelanta al
-- retraso de MB). Por artista seguido, álbumes recientes que no tienes ni MB conoce.
CREATE TABLE IF NOT EXISTS external_releases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT,               -- deezer | spotify
  artist_id INTEGER,         -- artista local seguido
  artist TEXT,
  title TEXT,
  match_key TEXT,            -- matchKey(artist,title): dedup y cruce con MB/biblioteca
  release_date TEXT,         -- YYYY-MM-DD
  record_type TEXT,          -- album | ep | single
  cover TEXT,
  url TEXT,                  -- enlace externo (Deezer/Spotify)
  ahead INTEGER DEFAULT 1,   -- 1 = MB aún no lo lista («adelantada»); 0 = MB ya lo tiene
  first_seen INTEGER,
  dismissed INTEGER DEFAULT 0,
  UNIQUE(artist_id, match_key)
);
CREATE INDEX IF NOT EXISTS idx_extrel_artist ON external_releases(artist_id);

-- Radar de descubrimiento (0.9.20): novedades GLOBALES del feed editorial de Spotify, de
-- CUALQUIER artista (no solo los tuyos). La afinidad (si el artista es tuyo o parecido a lo
-- que te gusta) se calcula EN VIVO al leer, no se guarda; aquí solo el crudo del feed. artist
-- = artista principal; artists_json = todos los acreditados (para cruzar afinidad).
CREATE TABLE IF NOT EXISTS global_releases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT,               -- spotify
  artist TEXT,               -- artista principal (para mostrar)
  artists_json TEXT,         -- JSON: todos los artistas acreditados
  title TEXT,
  match_key TEXT,            -- matchKey(artista principal, título): dedup
  release_date TEXT,         -- YYYY-MM-DD
  record_type TEXT,          -- album | ep | single
  cover TEXT,
  url TEXT,
  first_seen INTEGER,
  dismissed INTEGER DEFAULT 0,
  UNIQUE(source, match_key)
);
CREATE INDEX IF NOT EXISTS idx_globalrel_date ON global_releases(release_date);
`);

// --- migraciones ligeras ----------------------------------------------------

function ensureColumn(table, column, decl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${decl}`);
  }
}
// Reservado para cuando el esquema evolucione entre versiones.
// novedades externas: marca de «adelantada» (MB aún no la lista) para las que ya existían
ensureColumn('external_releases', 'ahead', 'ahead INTEGER DEFAULT 1');
ensureColumn('albums', 'disc_count', 'disc_count INTEGER DEFAULT 1');
// multidiscos: marca qué álbumes son DISCOS de una misma caja, para que las vistas
// los cuenten como un solo álbum (lo rellena discgroup.js; nullable = álbum normal).
ensureColumn('albums', 'disc_group', 'disc_group TEXT');
db.exec('CREATE INDEX IF NOT EXISTS idx_albums_discgroup ON albums(disc_group)');
// fecha de alta en Lidarr, para «últimas peticiones» del dashboard
ensureColumn('lidarr_albums', 'added', 'added TEXT');
// ámbito de completismo por artista (0.6.1): 'albums' (por defecto, solo álbumes de
// estudio) o 'all' (además EPs y singles). Decisión consciente por artista: de unos
// quieres "todo", de otros solo los discos.
ensureColumn('artists', 'completism_scope', "completism_scope TEXT DEFAULT 'albums'");
// artista corregido a mano desde la UI (0.6.2): protege album_artist/artist_id de que
// un reescaneo posterior los machaque con lo que digan las etiquetas del fichero.
ensureColumn('albums', 'artist_manual', 'artist_manual INTEGER DEFAULT 0');
// título corregido a mano desde la UI (0.6.3): igual que artist_manual, protege el
// título de que un reescaneo lo pise con la etiqueta del fichero.
ensureColumn('albums', 'title_manual', 'title_manual INTEGER DEFAULT 0');
// (0.8) agrupación de multidiscos DECIDIDA A MANO: cuando el usuario combina o separa
// discos en la UI, se marca para que la heurística de discgroup.js (regroupDiscs) no lo
// pise en el siguiente escaneo. 1 = disc_group fijado a mano (aunque sea NULL = separado).
ensureColumn('albums', 'disc_group_manual', 'disc_group_manual INTEGER DEFAULT 0');
// (0.9.16) «Copias de este disco»: copia elegida A MANO como la mejor. Gana sobre el
// copyScore automático. 1 = la marcaste tú (útil cuando las copias empatan en calidad).
ensureColumn('albums', 'preferred_copy', 'preferred_copy INTEGER DEFAULT 0');

// (0.9.19) Radar de singles de TODA la colección (no solo seguidos): para no re-buscar el
// id de Deezer de cada artista en cada refresco, se cachea aquí. -1 = buscado y no hallado
// (se reintenta pasado un tiempo). ext_checked_at = última vez que se sondeó su discografía
// externa (Deezer/Spotify): permite un barrido rotatorio de la colección, sondeando primero
// a los que llevan más tiempo sin mirarse, sin machacar la API en una sola pasada.
ensureColumn('artists', 'deezer_id', 'deezer_id INTEGER');
ensureColumn('artists', 'deezer_checked_at', 'deezer_checked_at INTEGER');
ensureColumn('artists', 'ext_checked_at', 'ext_checked_at INTEGER');

// Identidad de CAJA multidisco en MusicBrainz: una fila por disc_group identificado. Permite
// tratar la caja como una unidad (un release-group / release) y medir el completismo a nivel
// de caja (discos presentes / disc_total). disc_total viene del release de MB (nº de medios)
// o, si no, del DISCTOTAL de las etiquetas. Se rellena bajo demanda (identifyBox).
db.exec(`
CREATE TABLE IF NOT EXISTS disc_boxes (
  disc_group TEXT PRIMARY KEY,
  rg_mbid TEXT,
  release_mbid TEXT,
  disc_total INTEGER,
  title TEXT,
  artist TEXT,
  identified_at INTEGER
);`);

// (0.8) release_groups pasa de clave rg_mbid único a clave COMPUESTA (rg_mbid, artist_id):
// un mismo release-group puede estar acreditado a varios artistas (splits, colaboraciones)
// y debe contar en el completismo de CADA uno. Antes el UNIQUE(rg_mbid) lo colapsaba a un
// solo artista. Rebuild de tabla (SQLite no permite cambiar la PK in situ); conserva datos.
(function migrateReleaseGroupsPk() {
  const info = db.prepare('PRAGMA table_info(release_groups)').all();
  if (!info.length) return; // aún no existe (primer arranque): ya se crea con la PK nueva
  const pkCols = info.filter((c) => c.pk > 0).map((c) => c.name);
  const alreadyComposite = pkCols.includes('rg_mbid') && pkCols.includes('artist_id');
  if (alreadyComposite) return;
  db.exec(`
    CREATE TABLE release_groups_new (
      rg_mbid TEXT NOT NULL,
      artist_id INTEGER NOT NULL,
      artist_mbid TEXT,
      title TEXT,
      first_release TEXT,
      primary_type TEXT,
      secondary_types TEXT,
      is_owned INTEGER DEFAULT 0,
      owned_album_id INTEGER,
      is_upcoming INTEGER DEFAULT 0,
      fetched_at INTEGER,
      PRIMARY KEY (rg_mbid, artist_id)
    );
    INSERT OR IGNORE INTO release_groups_new
      (rg_mbid, artist_id, artist_mbid, title, first_release, primary_type,
       secondary_types, is_owned, owned_album_id, is_upcoming, fetched_at)
      SELECT rg_mbid, artist_id, artist_mbid, title, first_release, primary_type,
             secondary_types, is_owned, owned_album_id, is_upcoming, fetched_at
      FROM release_groups WHERE artist_id IS NOT NULL;
    DROP TABLE release_groups;
    ALTER TABLE release_groups_new RENAME TO release_groups;
    CREATE INDEX IF NOT EXISTS idx_rg_artist ON release_groups(artist_id);
    CREATE INDEX IF NOT EXISTS idx_rg_owned ON release_groups(is_owned);
    CREATE INDEX IF NOT EXISTS idx_rg_upcoming ON release_groups(is_upcoming);
  `);
  console.log('[db] release_groups -> clave compuesta (rg_mbid, artist_id)');
})();

// Evita reimportar el mismo scrobble: sin esto, cada importación reinsertaba
// desde cero. Los scrobbles "sonando ahora" (sin ts) se descartan al importar.
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_listens_uniq ON listens(source, ts, artist, track)');

// Al arrancar, fuera lo cacheado con reglas ya superadas (por versión o edad).
db.prepare(`DELETE FROM ext_cache WHERE ${staleCacheSql()}`).run();

// --- ajustes con cifrado opcional -------------------------------------------

const getStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
const setStmt = db.prepare(
  'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
);

// Claves sensibles: se guardan como AES-256-GCM si hay LIDERARRR_SECRET; si no,
// en claro (compatible) y se avisa una vez. La lectura es transparente.
const SECRET_SETTING_KEYS = new Set([
  'lidarr_key',
  'lastfm_key',
  'lastfm_secret',
  'acoustid_key',
  'discogs_token',
  'plex_token',
  'prowlarr_key',
  'jackett_key',
  'qbittorrent_pass',
  'spotify_client_secret',
  'notify_url',
  'listenbrainz_token',
]);
const secretKey = process.env.LIDERARRR_SECRET
  ? crypto.createHash('sha256').update(process.env.LIDERARRR_SECRET).digest()
  : null;
let warnedPlaintext = false;

function encryptValue(v) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', secretKey, iv);
  const ct = Buffer.concat([cipher.update(String(v), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

function decryptValue(v) {
  if (typeof v !== 'string' || !v.startsWith('enc:v1:') || !secretKey) return v;
  try {
    const [, , ivB, tagB, ctB] = v.split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', secretKey, Buffer.from(ivB, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ctB, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return v;
  }
}

export function getSetting(key, fallback = null) {
  const row = getStmt.get(key);
  return row ? decryptValue(row.value) : fallback;
}

export function setSetting(key, value) {
  if (value == null) return setStmt.run(key, null);
  let stored = String(value);
  if (SECRET_SETTING_KEYS.has(key) && stored && !stored.startsWith('enc:v1:')) {
    if (secretKey) stored = encryptValue(stored);
    else if (!warnedPlaintext) {
      warnedPlaintext = true;
      console.warn('[Liderarrr] Credenciales guardadas en claro. Define LIDERARRR_SECRET para cifrarlas en disco.');
    }
  }
  return setStmt.run(key, stored);
}

export function getAllSettings() {
  const out = {};
  for (const row of db.prepare('SELECT key, value FROM settings').all()) out[row.key] = row.value;
  return out;
}

// Migración one-shot: pasar local_key de ruta ABSOLUTA a RELATIVA al root de la
// biblioteca (ver libkey.js). Con esto la identidad de los álbumes es estable entre
// montajes, así que se puede pasar al mount único /data (necesario para hardlinks
// del layout TRaSH) SIN reescanear ni perder la identificación. No toca match_state
// ni las relaciones (album_id no cambia): solo recalcula el valor de local_key.
if (getSetting('lk_relative') !== '1') {
  try {
    const roots = splitRoots(getSetting('music_dirs'));
    if (roots.length) {
      const rows = db.prepare('SELECT id, path, local_key FROM albums WHERE path IS NOT NULL').all();
      const upd = db.prepare('UPDATE albums SET local_key = ? WHERE id = ?');
      const used = new Set(db.prepare('SELECT local_key FROM albums').all().map((r) => r.local_key));
      let migrated = 0;
      db.transaction(() => {
        for (const a of rows) {
          const nk = albumKey(a.path, roots);
          if (nk === a.local_key || used.has(nk)) continue; // ya correcto, o colisión: no tocar
          used.delete(a.local_key);
          used.add(nk);
          upd.run(nk, a.id);
          migrated++;
        }
      })();
      if (migrated) console.log(`[db] identidad de álbum -> ruta relativa: ${migrated} migrados`);
    }
    setSetting('lk_relative', '1');
  } catch (e) {
    console.warn('[db] migración local_key relativo falló (se reintentará):', String(e.message || e));
  }
}

// --- caché de servicios externos --------------------------------------------

const cacheGet = db.prepare('SELECT json, fetched_at FROM ext_cache WHERE key = ?');
const cacheSet = db.prepare(
  `INSERT INTO ext_cache (key, json, version, fetched_at) VALUES (?, ?, ?, ?)
   ON CONFLICT(key) DO UPDATE SET json = excluded.json, version = excluded.version, fetched_at = excluded.fetched_at`
);

export function cacheRead(key, maxAgeMs) {
  const row = cacheGet.get(key);
  if (!row) return null;
  if (maxAgeMs != null && Date.now() - row.fetched_at > maxAgeMs) return null;
  try {
    return JSON.parse(row.json);
  } catch {
    return null;
  }
}

export function cacheWrite(key, value) {
  cacheSet.run(key, JSON.stringify(value), versionFor(key), Date.now());
}
