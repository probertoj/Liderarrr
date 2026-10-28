import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = path.join(os.tmpdir(), `liderarr-reintento-${Date.now()}`);
const { db } = await import('../src/db.js');
const { colaDeReintento, pendientesDeReintento, apuntarIntentoFallido } = await import('../src/identify.js');

const DIA = 86400000;
const hace = (dias) => Date.now() - dias * DIA;

const ins = db.prepare(
  `INSERT INTO albums (id, local_key, path, album_artist, title, match_state, matched_at, added_at)
   VALUES (@id, @k, @p, @artista, @titulo, @estado, @intento, @added)`
);
const sembrar = (id, artista, estado, intento) =>
  ins.run({ id, k: `k${id}`, p: `/data/${id}`, artista, titulo: `Disco ${id}`, estado, intento, added: id });

db.transaction(() => {
  sembrar(1, 'Artista desconocido', 'unmatched', hace(100));
  sembrar(2, 'Artista desconocido', 'unmatched', hace(30));
  sembrar(3, 'Can', 'unmatched', hace(200));
  sembrar(4, 'Neu!', 'unmatched', hace(1)); // mirado anteayer: aún no le toca
  sembrar(5, 'Faust', 'unmatched', null); // nunca se apuntó un intento
  sembrar(6, 'Rareza', 'orphan', hace(500));
  sembrar(7, 'Directo', 'bootleg', hace(500));
  sembrar(8, 'Fuera', 'dismissed', hace(500));
  sembrar(9, 'Bowie', 'matched', hace(500));
  sembrar(10, 'Eno', 'pending', null);
  sembrar(11, '', 'unmatched', hace(50)); // sin artista, pero con la cadena vacía
})();

test('primero los que no tienen artista, y dentro de cada grupo el más olvidado', () => {
  // sin artista por antigüedad (1 → 11 → 2) y luego con artista (5, que nunca se intentó, → 3)
  assert.deepEqual(colaDeReintento().map((a) => a.id), [1, 11, 2, 5, 3]);
});

test('un disco mirado hace nada no vuelve a la cola', () => {
  const ids = colaDeReintento().map((a) => a.id);
  assert.ok(!ids.includes(4), 'el 4 se intentó ayer: le toca dentro de dos semanas');
  // y con una cadencia más corta, sí entra
  assert.ok(colaDeReintento(300, 0.5).map((a) => a.id).includes(4));
});

test('lo que has decidido tú a mano no se toca nunca', () => {
  const ids = colaDeReintento(300, 0).map((a) => a.id);
  for (const id of [6, 7, 8, 9]) assert.ok(!ids.includes(id), `el ${id} no debería estar en la cola`);
  assert.ok(!ids.includes(10), 'los pendientes van por su propia vía, no por la de reintentos');
});

test('la tanda tiene techo', () => {
  assert.equal(colaDeReintento(2).length, 2);
  assert.deepEqual(colaDeReintento(2).map((a) => a.id), [1, 11]);
  assert.equal(pendientesDeReintento(), 5, 'esperan cinco, aunque la tanda sea de dos');
});

test('apuntar el intento saca al disco de la cola: así rota', () => {
  assert.ok(colaDeReintento().map((a) => a.id).includes(3));
  const cambios = apuntarIntentoFallido(3);
  assert.equal(cambios, 1);
  assert.ok(!colaDeReintento().map((a) => a.id).includes(3), 'ya le ha tocado: al final de la cola');
  assert.equal(pendientesDeReintento(), 4);
});

test('apuntar un intento no resucita lo que tú marcaste', () => {
  for (const id of [6, 7, 8, 9]) {
    const antes = db.prepare('SELECT match_state, matched_at FROM albums WHERE id = ?').get(id);
    assert.equal(apuntarIntentoFallido(id), 0);
    const despues = db.prepare('SELECT match_state, matched_at FROM albums WHERE id = ?').get(id);
    assert.deepEqual(despues, antes, `el ${id} no se ha tocado`);
  }
});

test('un pendiente que falla pasa a sin identificar, con su fecha', () => {
  assert.equal(apuntarIntentoFallido(10), 1);
  const a = db.prepare('SELECT match_state, matched_at FROM albums WHERE id = 10').get();
  assert.equal(a.match_state, 'unmatched');
  assert.ok(a.matched_at > hace(1), 'queda apuntado que acaba de intentarse');
  // y no vuelve a la cola hasta que pase la cadencia
  assert.ok(!colaDeReintento().map((x) => x.id).includes(10));
});
