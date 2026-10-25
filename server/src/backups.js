import fs from 'node:fs';
import path from 'node:path';
import { db, DATA_DIR, DB_PATH, getSetting, setSetting, stageDatabaseImport } from './db.js';
import { pushEvent } from './diag.js';
import { sendNotification } from './notify.js';

// Copias de seguridad automáticas de la base.
//
// Nacen de un incidente real: el volumen del NAS se quedó sin sitio, SQLite partió la base a
// mitad de una escritura nocturna y la única copia que había era una exportación manual de
// dos meses antes. Se salvó por los pelos con `.recover`. Una app que guarda el trabajo de
// años de catalogación no puede depender de que te acuerdes de exportarla a mano.

const DIR = path.join(DATA_DIR, 'backups');
const PATRON = /^liderarrr-\d{4}-\d{2}-\d{2}-\d{4}\.db$/;

export const backupStatus = { running: false, lastRun: null, lastOk: null, lastError: null };

let ultimoAvisoFallo = 0;
let proximoIntento = 0;

// getSetting devuelve null cuando el ajuste no existe, y Number(null) es 0 —que es finito—,
// así que el clásico `Number(x) || pordefecto` convertiría un «0» legítimo en el valor de
// fábrica. Se mira el crudo antes de convertir.
function numAjuste(clave, pordefecto, min, max) {
  const crudo = getSetting(clave);
  if (crudo == null || crudo === '') return pordefecto;
  const n = Number(crudo);
  if (!Number.isFinite(n)) return pordefecto;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function backupConfig() {
  return {
    // De fábrica ENCENDIDO. Una copia que hay que acordarse de activar no protege a nadie.
    enabled: getSetting('backup_enabled') !== '0',
    keep: numAjuste('backup_keep', 7, 1, 30),
    hour: numAjuste('backup_hour', 4, 0, 23),
    minFreeGb: numAjuste('backup_min_free_gb', 20, 0, 1000),
  };
}

/** Espacio del volumen donde vive /data, o null si el sistema no sabe decirlo. */
export function espacioLibre() {
  try {
    const st = fs.statfsSync(DATA_DIR);
    // bavail, no bfree: lo que de verdad puede usar quien no es root.
    return { free: st.bavail * st.bsize, total: st.blocks * st.bsize };
  } catch {
    return null;
  }
}

/** Lo que ocupa la base ahora mismo, contando el WAL (que puede ser decenas de MB). */
export function dbBytes() {
  let total = 0;
  for (const ext of ['', '-wal']) {
    try {
      total += fs.statSync(DB_PATH + ext).size;
    } catch {
      /* el -wal puede no existir */
    }
  }
  return total;
}

export function listBackups() {
  let nombres = [];
  try {
    nombres = fs.readdirSync(DIR);
  } catch {
    return [];
  }
  return nombres
    .filter((n) => PATRON.test(n))
    .map((n) => {
      const st = fs.statSync(path.join(DIR, n));
      return { name: n, bytes: st.size, mtime: st.mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

/** Ruta de una copia validando el nombre: nada que venga de fuera debe poder salir de DIR. */
export function backupPath(nombre) {
  if (!PATRON.test(String(nombre))) throw new Error('nombre de copia no válido');
  return path.join(DIR, String(nombre));
}

function nombreNuevo(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `liderarrr-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.db`;
}

export async function runBackup(motivo = 'manual') {
  if (backupStatus.running) throw new Error('ya hay una copia en marcha');
  fs.mkdirSync(DIR, { recursive: true });

  // Antes de nada, sitio. Llenar el volumen guardando copias sería repetir exactamente el
  // accidente del que esta función viene a protegernos.
  const necesario = Math.round(dbBytes() * 1.2);
  const libre = espacioLibre();
  if (libre && libre.free < necesario) {
    const gb = (x) => (x / 1024 ** 3).toFixed(1);
    throw new Error(`no hay sitio para la copia: hacen falta ~${gb(necesario)} GB y quedan ${gb(libre.free)} GB`);
  }

  backupStatus.running = true;
  const t0 = Date.now();
  try {
    const destino = path.join(DIR, nombreNuevo());
    // Se escribe a un nombre provisional y se renombra al final. Así una copia que falla a
    // medias NUNCA destruye la que ya había (dos copias en el mismo minuto comparten nombre),
    // y un fichero a medio escribir no se parece a una copia válida: el patrón no lo acepta.
    const parcial = `${destino}.parcial`;
    fs.rmSync(parcial, { force: true });
    // VACUUM INTO es la primitiva correcta, y no un `cp`: al ser una transacción de LECTURA
    // saca una instantánea coherente de una base EN USO —con su WAL incluido— sin parar la
    // app. Y además la reconstruye desde las tablas, rehaciendo los índices, así que una
    // copia que termina bien es sana por definición: si la base estuviera dañada esto falla
    // aquí, en vez de guardar la corrupción para el día en que haga falta restaurarla.
    try {
      db.prepare('VACUUM INTO ?').run(parcial);
      fs.rmSync(destino, { force: true });
      fs.renameSync(parcial, destino);
    } catch (e) {
      fs.rmSync(parcial, { force: true });
      throw e;
    }
    const bytes = fs.statSync(destino).size;

    const { keep } = backupConfig();
    const borradas = [];
    for (const vieja of listBackups().slice(keep)) {
      fs.rmSync(path.join(DIR, vieja.name), { force: true });
      borradas.push(vieja.name);
    }

    const name = path.basename(destino);
    setSetting('backup_last_run', String(Date.now()));
    backupStatus.lastRun = Date.now();
    backupStatus.lastOk = { name, bytes, ms: Date.now() - t0, motivo };
    backupStatus.lastError = null;
    const mb = (bytes / 1024 ** 2).toFixed(0);
    const sobras = borradas.length ? ` · ${borradas.length} antigua(s) fuera` : '';
    console.log(`[copias] ${name} (${mb} MB, ${Date.now() - t0} ms)${sobras}`);
    return { name, bytes, ms: Date.now() - t0, deleted: borradas };
  } catch (e) {
    const texto = String(e.message || e);
    backupStatus.lastError = { at: Date.now(), error: texto };
    // Una copia que falla no se reintenta en bucle: el temporizador pasa cada minuto y un
    // fallo persistente llenaría el registro de diagnóstico con la misma línea.
    proximoIntento = Date.now() + 60 * 60 * 1000;
    pushEvent('error', `Copia de seguridad fallida: ${texto}`);
    // Una copia que falla en silencio es peor que no tenerla: da la ilusión de estar a salvo.
    // Pero el aviso va UNA vez al día: un fallo persistente (el disco lleno, por ejemplo) lo
    // reintenta el temporizador cada minuto, y recibir eso sesenta veces por hora solo sirve
    // para que acabes silenciando las notificaciones el día que más falta te hacen.
    if (Date.now() - ultimoAvisoFallo > 24 * 60 * 60 * 1000) {
      ultimoAvisoFallo = Date.now();
      sendNotification('Liderarrr: la copia de seguridad ha fallado', texto).catch(() => {});
    }
    throw e;
  } finally {
    backupStatus.running = false;
  }
}

export function deleteBackup(nombre) {
  fs.rmSync(backupPath(nombre), { force: true });
  return { ok: true };
}

/**
 * Deja una copia preparada para sustituir a la base actual. El cambio REAL lo hace db.js al
 * arrancar, que es el único momento en que nadie tiene la base abierta; aquí solo se valida y
 * se deja como `liderarrr.db.import`. Quien llame debe reiniciar el proceso después.
 */
export function stageRestore(nombre) {
  const origen = backupPath(nombre);
  const tmp = path.join(DATA_DIR, `liderarrr.db.desde-copia-${Date.now()}`);
  try {
    fs.copyFileSync(origen, tmp);
    stageDatabaseImport(tmp); // integrity_check + que tenga las tablas de Liderarr
  } catch (e) {
    for (const ext of ['', '-wal', '-shm']) fs.rmSync(tmp + ext, { force: true });
    throw e;
  }
  return { ok: true, from: nombre };
}

// --- vigilancia del espacio -------------------------------------------------
//
// La otra mitad del problema. De nada sirve copiar si el volumen se llena sin que nadie se
// entere: eso es justo lo que rompió la base. Se avisa una vez al día como mucho, porque un
// aviso que se repite cada minuto se ignora igual que si no existiera.
let ultimoAvisoEspacio = 0;

export function estadoEspacio() {
  const libre = espacioLibre();
  if (!libre) return null;
  const { minFreeGb } = backupConfig();
  const umbral = minFreeGb * 1024 ** 3;
  return { ...libre, umbral, bajo: minFreeGb > 0 && libre.free < umbral };
}

export async function vigilarEspacio() {
  const est = estadoEspacio();
  if (!est || !est.bajo) return;
  if (Date.now() - ultimoAvisoEspacio < 24 * 60 * 60 * 1000) return;
  ultimoAvisoEspacio = Date.now();
  const gb = (x) => (x / 1024 ** 3).toFixed(1);
  const texto = `Quedan ${gb(est.free)} GB libres donde vive la base de datos. Sin espacio, SQLite puede corromperla a mitad de una escritura.`;
  console.warn(`[copias] AVISO: ${texto}`);
  pushEvent('warn', texto);
  await sendNotification('Liderarrr: poco espacio en disco', texto).catch(() => {});
}

/**
 * ¿Toca copia? Se mide contra la última hecha —guardada en ajustes, no en una variable—, así
 * reiniciar el contenedor ni se salta ni duplica la copia del día. Y si el equipo estuvo
 * apagado a la hora señalada, se hace en cuanto pueda en vez de perderla.
 */
export function tocaCopia(ahora = new Date()) {
  const cfg = backupConfig();
  if (!cfg.enabled) return false;
  if (ahora.getTime() < proximoIntento) return false; // una falló hace poco: no insistir cada minuto
  const ultima = Number(getSetting('backup_last_run')) || 0;
  const horas = (ahora.getTime() - ultima) / 3600000;
  if (horas < 20) return false;
  return ahora.getHours() === cfg.hour || horas >= 36;
}
