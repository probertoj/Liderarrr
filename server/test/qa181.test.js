import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Los flecos que quedaban del QA de la 1.7.3.
const RAIZ = path.join(os.tmpdir(), `liderarr-qa181-${Date.now()}`);
fs.mkdirSync(RAIZ, { recursive: true });
process.env.DATA_DIR = RAIZ;

const { app } = await import('../src/index.js');
app.log.level = 'silent';
const { renderPath } = await import('../src/importer.js');

test('una etiqueta rara no puede sacar el disco de su carpeta ni esconderlo', () => {
  const p = (meta) => renderPath('{artist}/{album} ({year})', meta).split(path.sep).join('/');
  assert.equal(p({ artist: '..', album: 'Disco', year: 2000 }), 'Disco (2000)');
  assert.equal(p({ artist: '.', album: '..', year: null }), 'Desconocido');
  // un punto inicial hace la carpeta oculta y el escáner no la vería
  assert.equal(p({ artist: '.Hidden', album: 'Disco', year: null }), 'Hidden/Disco');
  // punto + cifra y los puntos suspensivos son nombres de verdad
  assert.equal(p({ artist: '.38 Special', album: 'Tour de Force', year: 1983 }), '.38 Special/Tour de Force (1983)');
  assert.equal(p({ artist: 'Metallica', album: '...And Justice for All', year: 1988 }), 'Metallica/...And Justice for All (1988)');
});

test('«Mover todos» no mueve nada sin confirmación expresa', async () => {
  const sin = await app.inject({ method: 'POST', url: '/api/corrections/refile-all', payload: {} });
  assert.equal(sin.statusCode, 400);
  assert.match(sin.json().error, /no confirmado/);
});

test('exportar la base da una instantánea válida y no deja el temporal', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/backup/database' });
  assert.equal(r.statusCode, 200);
  assert.equal(r.rawPayload.subarray(0, 15).toString('latin1'), 'SQLite format 3');
  await new Promise((ok) => setTimeout(ok, 200)); // el borrado va al cerrarse el flujo
  assert.deepEqual(
    fs.readdirSync(RAIZ).filter((n) => n.startsWith('exportar-')),
    []
  );
});
