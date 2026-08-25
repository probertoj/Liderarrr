import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

// discgroup.js importa db.js (abre SQLite en DATA_DIR). Temporal antes del import dinámico.
process.env.DATA_DIR = path.join(os.tmpdir(), `liderarr-discgroup-${Date.now()}`);
const { isCleanDiscSet } = await import('../src/discgroup.js');

test('isCleanDiscSet: caja limpia con discos distintos → agrupa', () => {
  assert.equal(isCleanDiscSet([1, 2, 3]), true);
  assert.equal(isCleanDiscSet([1, 2]), true);
  assert.equal(isCleanDiscSet([2, 1]), true); // orden da igual
});

test('isCleanDiscSet: hueco (falta un disco) sigue siendo válido si los presentes son distintos', () => {
  assert.equal(isCleanDiscSet([1, 3]), true);
  assert.equal(isCleanDiscSet([2, 4]), true);
});

test('isCleanDiscSet: números duplicados (copias del mismo disco) → NO agrupa', () => {
  assert.equal(isCleanDiscSet([1, 1]), false); // dos «disc 1» = duplicados
  assert.equal(isCleanDiscSet([1, 2, 2]), false);
  assert.equal(isCleanDiscSet([5, 5]), false);
});

test('isCleanDiscSet: casos borde', () => {
  assert.equal(isCleanDiscSet([1]), false); // hace falta ≥2
  assert.equal(isCleanDiscSet([]), false);
  assert.equal(isCleanDiscSet([0, 1]), false); // disco <1 no es válido
});
