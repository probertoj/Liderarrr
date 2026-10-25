import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

// backups.js importa db.js, que abre una SQLite en DATA_DIR al cargarse.
const DATA_DIR = path.join(os.tmpdir(), `liderarr-test-copias-${Date.now()}`);
process.env.DATA_DIR = DATA_DIR;
const { db, setSetting } = await import('../src/db.js');
const { runBackup, listBackups, backupPath, backupConfig, tocaCopia, dbBytes, stageRestore } =
  await import('../src/backups.js');

const DIR = path.join(DATA_DIR, 'backups');

test('la copia es una base sana, no un calco byte a byte', async () => {
  db.prepare("INSERT INTO settings (key, value) VALUES ('prueba_copias', 'hola') ON CONFLICT(key) DO UPDATE SET value = 'hola'").run();

  const r = await runBackup('test');
  const copia = path.join(DIR, r.name);
  assert.ok(fs.existsSync(copia), 'la copia tiene que existir');

  // Lo que importa no es que el fichero esté, sino que sea una base ABRIBLE, íntegra y con
  // los datos dentro. VACUUM INTO la reconstruye, así que esto es lo que de verdad valida.
  const c = new Database(copia, { readonly: true });
  assert.equal(c.pragma('quick_check', { simple: true }), 'ok');
  assert.equal(c.prepare("SELECT value FROM settings WHERE key = 'prueba_copias'").get().value, 'hola');
  c.close();
});

test('no deja ficheros a medias si algo sale mal', () => {
  const sobras = fs.readdirSync(DIR).filter((n) => n.endsWith('.parcial'));
  assert.deepEqual(sobras, [], 'un .parcial superviviente sería una copia falsa esperando a confundirte');
});

test('la rotación se queda con las más nuevas y tira las viejas', async () => {
  setSetting('backup_keep', '3');
  assert.equal(backupConfig().keep, 3);

  // Copias antiguas de mentira: el nombre es lo que las hace copias, y la fecha de
  // modificación lo que las ordena.
  const hace = (dias) => Date.now() - dias * 86400000;
  for (let i = 1; i <= 5; i++) {
    const n = `liderarrr-2026-01-0${i}-0400.db`;
    fs.writeFileSync(path.join(DIR, n), 'vieja');
    fs.utimesSync(path.join(DIR, n), new Date(hace(10 + i)), new Date(hace(10 + i)));
  }
  assert.equal(listBackups().length, 6);

  await runBackup('test');

  const quedan = listBackups().map((x) => x.name);
  assert.equal(quedan.length, 3, 'deberían quedar exactamente las 3 configuradas');
  // Las que caen son las MÁS VIEJAS, no las primeras que se encuentren.
  assert.ok(!quedan.includes('liderarrr-2026-01-05-0400.db'), 'la más vieja es la primera en caer');
  assert.ok(!quedan.includes('liderarrr-2026-01-04-0400.db'));
  assert.ok(!quedan.includes('liderarrr-2026-01-03-0400.db'));
  assert.ok(quedan.includes('liderarrr-2026-01-01-0400.db'), 'la más nueva de las viejas sobrevive');
});

test('un nombre de copia no puede salirse de su carpeta', () => {
  for (const malo of ['../../liderarrr.db', 'liderarrr.db', 'otra-cosa.db', '../backups/liderarrr-2026-01-01-0400.db']) {
    assert.throws(() => backupPath(malo), /no válido/, `debería rechazar «${malo}»`);
  }
  assert.ok(backupPath('liderarrr-2026-01-01-0400.db').startsWith(DIR));
});

test('restaurar deja la copia pendiente, no pisa la base en caliente', () => {
  const copia = listBackups()[0].name;
  stageRestore(copia);
  assert.ok(
    fs.existsSync(path.join(DATA_DIR, 'liderarrr.db.import')),
    'el cambio real lo hace db.js al arrancar; aquí solo se deja preparada'
  );
  fs.rmSync(path.join(DATA_DIR, 'liderarrr.db.import'), { force: true });
});

test('toca copia una vez al día, y se recupera si el equipo estuvo apagado', () => {
  const { hour } = backupConfig();
  const aLaHora = new Date();
  aLaHora.setHours(hour, 0, 0, 0);

  // Los tiempos se miden contra el instante que se evalúa, no contra «ahora»: si no, el
  // resultado del test dependería de la hora a la que lo ejecutes.
  setSetting('backup_last_run', String(aLaHora.getTime()));
  assert.equal(tocaCopia(aLaHora), false, 'recién hecha, no toca');

  setSetting('backup_last_run', String(aLaHora.getTime() - 25 * 3600000));
  assert.equal(tocaCopia(aLaHora), true, 'un día después y a su hora, toca');

  const aDestiempo = new Date(aLaHora.getTime() + 5 * 3600000);
  setSetting('backup_last_run', String(aDestiempo.getTime() - 25 * 3600000));
  assert.equal(tocaCopia(aDestiempo), false, 'a deshora no se adelanta');

  // El NAS apagado a las 4 de la mañana no puede significar quedarse sin copias nunca.
  setSetting('backup_last_run', String(aDestiempo.getTime() - 40 * 3600000));
  assert.equal(tocaCopia(aDestiempo), true, 'si se perdió la ventana, se hace en cuanto pueda');

  setSetting('backup_enabled', '0');
  assert.equal(tocaCopia(aLaHora), false, 'apagado es apagado');
  setSetting('backup_enabled', '1');
});

test('dbBytes cuenta también el WAL', () => {
  assert.ok(dbBytes() >= fs.statSync(path.join(DATA_DIR, 'liderarrr.db')).size);
});

test.after(() => {
  try {
    db.close();
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
  } catch {
    /* en Windows el fichero puede seguir agarrado un instante; es un temporal */
  }
});
