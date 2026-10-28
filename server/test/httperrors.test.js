import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';

// httperrors.js no arrastra db.js a propósito, así que aquí no hace falta DATA_DIR.
import { motivoDeError, codigoDeError, errorPayload, installErrorHandler } from '../src/httperrors.js';

function appDePrueba() {
  const app = Fastify({ logger: false });
  installErrorHandler(app);
  app.get('/api/revienta', async () => {
    throw new Error('no existe la carpeta /data/media');
  });
  app.get('/api/explicado', async () => {
    const e = new Error('Ese disco ya está en la cola');
    e.statusCode = 409;
    throw e;
  });
  app.post(
    '/api/valida',
    { schema: { body: { type: 'object', required: ['hora'], properties: { hora: { type: 'number' } } } } },
    async () => ({ ok: true })
  );
  return app;
}

test('el motivo que llega a la interfaz es el de verdad, no el nombre del estado HTTP', () => {
  assert.equal(motivoDeError(new Error('no existe la carpeta /data/media')), 'no existe la carpeta /data/media');
  assert.equal(motivoDeError(new Error('Internal Server Error')), 'Error inesperado en el servidor (mira Diagnóstico)');
  assert.equal(motivoDeError(new Error('Bad Request')), 'Error inesperado en el servidor (mira Diagnóstico)');
});

test('un error sin mensaje no deja a la interfaz con un aviso vacío', () => {
  assert.equal(motivoDeError(new Error('')), 'Error inesperado en el servidor (mira Diagnóstico)');
  assert.equal(motivoDeError(undefined), 'Error inesperado en el servidor (mira Diagnóstico)');
  assert.equal(motivoDeError('se cayó la red'), 'se cayó la red');
});

test('un fallo sin motivo por debajo de 500 no le echa la culpa al servidor', () => {
  // @fastify/static rechaza las rutas con «..» con un 403 pelado, sin más texto que «Forbidden».
  assert.equal(motivoDeError(new Error('Forbidden'), 403), 'La petición no se pudo atender (403)');
  assert.equal(motivoDeError(new Error(''), 404), 'La petición no se pudo atender (404)');
  assert.equal(motivoDeError(new Error('Internal Server Error'), 500), 'Error inesperado en el servidor (mira Diagnóstico)');
});

test('los dos mensajes de Fastify que un usuario puede provocar van en español', () => {
  assert.equal(motivoDeError(new Error('request file too large')), 'El archivo es demasiado grande');
  assert.equal(
    motivoDeError(new Error("Body cannot be empty when content-type is set to 'application/json'")),
    'La petición llegó sin datos'
  );
});

test('un mensaje kilométrico se corta antes de llegar al navegador', () => {
  assert.equal(motivoDeError(new Error('x'.repeat(900))).length, 500);
});

test('el código solo se respeta si es un estado de error de verdad', () => {
  assert.equal(codigoDeError(Object.assign(new Error('a'), { statusCode: 404 })), 404);
  assert.equal(codigoDeError(new Error('a')), 500);
  // better-sqlite3 y compañía traen números raros en otras propiedades; nada por debajo de 400 vale.
  assert.equal(codigoDeError(Object.assign(new Error('a'), { statusCode: 200 })), 500);
  assert.equal(codigoDeError(Object.assign(new Error('a'), { statusCode: 'cinco' })), 500);
});

test('`error` y `message` dicen lo mismo, así que da igual cuál lea el cliente', () => {
  const { code, body } = errorPayload(new Error('se perdió la conexión con Lidarr'));
  assert.equal(code, 500);
  assert.equal(body.error, 'se perdió la conexión con Lidarr');
  assert.equal(body.message, body.error);
  assert.equal(body.statusCode, 500);
});

test('una excepción que escapa de una ruta ya no responde «Internal Server Error»', async () => {
  const app = appDePrueba();
  const errores = [];
  const orig = console.error;
  console.error = (...a) => errores.push(a.map(String).join(' '));
  try {
    const res = await app.inject({ method: 'GET', url: '/api/revienta' });
    assert.equal(res.statusCode, 500);
    const j = res.json();
    assert.equal(j.error, 'no existe la carpeta /data/media');
    assert.notEqual(j.error, 'Internal Server Error');
    // el fallo tiene que quedar en el log, que es por donde diag.js lo sube a Diagnóstico
    assert.ok(errores.some((l) => l.includes('[api] GET /api/revienta')));
  } finally {
    console.error = orig;
    await app.close();
  }
});

test('un error con su propio código lo conserva', async () => {
  const app = appDePrueba();
  const orig = console.warn;
  console.warn = () => {};
  try {
    const res = await app.inject({ method: 'GET', url: '/api/explicado' });
    assert.equal(res.statusCode, 409);
    assert.equal(res.json().error, 'Ese disco ya está en la cola');
  } finally {
    console.warn = orig;
    await app.close();
  }
});

test('un cuerpo que no cuadra con el esquema explica qué falta', async () => {
  const app = appDePrueba();
  const orig = console.warn;
  console.warn = () => {};
  try {
    const res = await app.inject({ method: 'POST', url: '/api/valida', payload: {} });
    assert.equal(res.statusCode, 400);
    assert.match(res.json().error, /hora/);
  } finally {
    console.warn = orig;
    await app.close();
  }
});
