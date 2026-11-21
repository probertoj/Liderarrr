import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

// prowlarr.js arrastra db.js (abre SQLite en DATA_DIR). Temporal antes del import dinámico.
process.env.DATA_DIR = path.join(os.tmpdir(), `liderarr-indexers-${Date.now()}`);
const { diagnosticarIndexer } = await import('../src/prowlarr.js');

// Con la forma que devuelve Prowlarr en GET /api/v1/indexer: los ajustes del indexer van en
// `fields`, con nombre en camelCase y los anidados con prefijo («baseSettings.queryLimit»).
const AUDIO = { categories: [{ id: 3000, name: 'Audio', subCategories: [{ id: 3040, name: 'Audio/Lossless' }] }] };
const indexer = (extra = {}, campos = []) => ({
  id: 1,
  name: 'Redacted',
  enable: true,
  supportsSearch: true,
  capabilities: AUDIO,
  fields: [{ name: 'apikey', value: 'secreto' }, { name: 'useFreeleechToken', value: 0 }, { name: 'freeloadOnly', value: false }, ...campos],
  ...extra,
});
const AHORA = Date.parse('2026-11-21T12:00:00Z');

test('un indexer sano sale en verde y sin reproches', () => {
  const d = diagnosticarIndexer(indexer(), null, AHORA);
  assert.equal(d.estado, 'ok');
  assert.equal(d.nombre, 'Redacted');
  assert.match(d.texto, /sin nada raro/);
});

test('«Freeload Only» es grave: se queda sin casi ningún resultado', () => {
  const d = diagnosticarIndexer({ ...indexer(), fields: [{ name: 'freeloadOnly', value: true }] }, null, AHORA);
  assert.equal(d.estado, 'mal');
  assert.match(d.texto, /Freeload Only/);
});

test('los tokens en Required y el tope de consultas son avisos, con su número', () => {
  const tokens = diagnosticarIndexer({ ...indexer(), fields: [{ name: 'useFreeleechToken', value: 2 }] }, null, AHORA);
  assert.equal(tokens.estado, 'aviso');
  assert.match(tokens.texto, /Required/);
  // 1 = Preferred: eso no descarta nada
  assert.equal(diagnosticarIndexer({ ...indexer(), fields: [{ name: 'useFreeleechToken', value: 1 }] }, null, AHORA).estado, 'ok');

  const tope = diagnosticarIndexer(
    { ...indexer(), fields: [{ name: 'baseSettings.queryLimit', value: 50 }, { name: 'baseSettings.limitsUnit', value: 1 }] },
    null,
    AHORA
  );
  assert.equal(tope.estado, 'aviso');
  assert.match(tope.texto, /50 consultas por hora/);
  // sin tope (null o 0) no se dice nada
  assert.equal(diagnosticarIndexer({ ...indexer(), fields: [{ name: 'baseSettings.queryLimit', value: null }] }, null, AHORA).estado, 'ok');
});

test('apartado por fallos: grave mientras dure, aviso cuando ya pasó', () => {
  const apartado = diagnosticarIndexer(indexer(), { indexerId: 1, disabledTill: '2026-11-21T14:30:00Z', mostRecentFailure: '2026-11-21T11:00:00Z' }, AHORA);
  assert.equal(apartado.estado, 'mal');
  assert.match(apartado.texto, /apartado por fallos/);

  const yaPaso = diagnosticarIndexer(indexer(), { indexerId: 1, disabledTill: '2026-11-21T10:00:00Z', mostRecentFailure: '2026-11-21T09:00:00Z' }, AHORA);
  assert.equal(yaPaso.estado, 'aviso');
  assert.match(yaPaso.texto, /falló hace poco/);
});

test('desactivado, solo RSS o sin categoría de música: los tres son graves', () => {
  assert.match(diagnosticarIndexer(indexer({ enable: false }), null, AHORA).texto, /desactivado/);
  assert.match(diagnosticarIndexer(indexer({ supportsSearch: false }), null, AHORA).texto, /solo RSS/);
  const sinMusica = diagnosticarIndexer(indexer({ capabilities: { categories: [{ id: 2000, name: 'Movies' }] } }), null, AHORA);
  assert.equal(sinMusica.estado, 'mal');
  assert.match(sinMusica.texto, /categoría de música/);
});

test('si Prowlarr no manda las categorías no se acusa a nadie', () => {
  assert.equal(diagnosticarIndexer(indexer({ capabilities: undefined }), null, AHORA).estado, 'ok');
  assert.equal(diagnosticarIndexer(indexer({ capabilities: { categories: [] } }), null, AHORA).estado, 'ok');
  // y una subcategoría de audio cuenta como música
  const soloSub = indexer({ capabilities: { categories: [{ id: 100000, name: 'Custom', subCategories: [{ id: 3010, name: 'Audio/MP3' }] }] } });
  assert.equal(diagnosticarIndexer(soloSub, null, AHORA).estado, 'ok');
});

test('el informe nunca lleva la API key', () => {
  const d = diagnosticarIndexer(indexer({}, [{ name: 'freeloadOnly', value: true }]), null, AHORA);
  assert.ok(!JSON.stringify(d).includes('secreto'));
});

test('varios problemas a la vez salen todos, lo grave primero', () => {
  const d = diagnosticarIndexer(
    { ...indexer(), fields: [{ name: 'freeloadOnly', value: true }, { name: 'baseSettings.queryLimit', value: 10 }] },
    null,
    AHORA
  );
  assert.equal(d.estado, 'mal');
  assert.ok(d.texto.indexOf('Freeload Only') < d.texto.indexOf('tope de 10'));
});
