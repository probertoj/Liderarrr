import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

// Una base corrupta mataba el arranque en la primera consulta, y con el contenedor
// puesto a reiniciarse eso son miles de vueltas tirando del disco con el mismo stack
// de SQLite en el log y ninguna pista de qué hacer (pasó de verdad: 1701 reinicios).
// Lo que se vigila aquí es que el proceso AVISE y SE QUEDE QUIETO.

const aqui = path.dirname(fileURLToPath(import.meta.url));
const DB_JS = pathToFileURL(path.join(aqui, '..', 'src', 'db.js')).href;

/** Arranca db.js una vez en limpio, para que la base tenga el esquema entero de verdad. */
function arrancaDbJs(dir) {
  return spawnSync(process.execPath, ['--input-type=module', '-e', 'await import(process.env.DB_JS)'], {
    env: { ...process.env, DATA_DIR: dir, DB_JS },
    encoding: 'utf8',
  });
}

function baseCorrupta() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'liderarr-corrupta-'));
  assert.equal(arrancaDbJs(dir).status, 0, 'la base de partida tiene que crearse bien');
  const archivo = path.join(dir, 'liderarrr.db');
  // El WAL al fichero principal: lo que se machaque después tiene que ser lo que se lea.
  const db = new Database(archivo);
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.close();
  // De la página 2 al final, basura. Es lo que deja un volumen sin espacio a mitad de
  // escritura: el fichero sigue ahí y con su cabecera, pero los datos ya no se leen.
  const tam = fs.statSync(archivo).size;
  assert.ok(tam > 8192, 'la base de partida debería tener varias páginas');
  const f = fs.openSync(archivo, 'r+');
  fs.writeSync(f, Buffer.alloc(tam - 4096, 0xab), 0, tam - 4096, 4096);
  fs.closeSync(f);
  return dir;
}
/** Arranca db.js sobre esa carpeta y devuelve {texto, seMurio} sin esperar a que acabe. */
async function arrancaYMira(dir) {
  const hijo = spawn(process.execPath, ['--input-type=module', '-e', 'await import(process.env.DB_JS)'], {
    env: { ...process.env, DATA_DIR: dir, DB_JS },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const trozos = [];
  let murio = null;
  hijo.stdout.on('data', (d) => trozos.push(String(d)));
  hijo.stderr.on('data', (d) => trozos.push(String(d)));
  hijo.on('exit', (code) => {
    murio = code;
  });

  const t0 = Date.now();
  while (Date.now() - t0 < 20000 && murio === null && !trozos.join('').includes('CORRUPTA')) {
    await new Promise((r) => setTimeout(r, 50));
  }
  const salida = { texto: trozos.join(''), seMurio: murio };
  hijo.kill('SIGKILL');
  // En Windows el hijo recién matado puede seguir agarrando el .db un instante; la
  // carpeta es temporal, así que si no se deja borrar no es asunto del test.
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* noop */
  }
  return salida;
}

test('con la base corrupta avisa y se queda parado, no muere en bucle', async () => {
  const { texto, seMurio } = await arrancaYMira(baseCorrupta());

  assert.equal(seMurio, null, 'el proceso se murió: eso es justo el bucle de reinicios a evitar');
  assert.match(texto, /CORRUPTA/, 'el log tiene que decir en claro qué ha pasado');
  assert.match(texto, /integrity_check/, 'y cómo recuperarla');
  assert.match(texto, /\.import/, 'y cómo restaurar una copia sin pelearse');
});

// Caso distinto y peor: el fichero ya no es ni una base de datos. Ahí revienta el propio
// new Database(), antes de la primera consulta, así que la guarda tiene que estar puesta
// desde antes de abrirla.
test('un fichero que ya no es una base de datos tampoco provoca el bucle', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'liderarr-nobase-'));
  fs.writeFileSync(path.join(dir, 'liderarrr.db'), Buffer.alloc(16384, 0xab));

  const { texto, seMurio } = await arrancaYMira(dir);

  assert.equal(seMurio, null, 'tampoco aquí puede morirse y reiniciarse sin parar');
  assert.match(texto, /CORRUPTA/);
});
