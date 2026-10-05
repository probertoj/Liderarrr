import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

// ratelimit.js importa db.js (lee los ajustes), que abre una SQLite en DATA_DIR al cargarse.
process.env.DATA_DIR = path.join(os.tmpdir(), `liderarr-test-rate-${Date.now()}`);
const { acquire, resetRate, indexerRateConfig, rateStats } = await import('../src/ratelimit.js');

// Esto nació de un bloqueo real en RED por pasarse de peticiones, así que conviene tenerlo
// clavado. Los tests usan un RELOJ SIMULADO: comprueban la política, no la paciencia.

function relojFalso() {
  let t = 0;
  const dormidas = [];
  return {
    now: () => t,
    sleep: async (ms) => {
      dormidas.push(ms);
      t += ms;
    },
    avanzar: (ms) => {
      t += ms;
    },
    dormidas,
  };
}

const cfg = { limit: 6, windowMs: 10000 }; // 6 cada 10 s → una cada 1667 ms

test('nunca deja pasar más peticiones de las permitidas en la ventana', async () => {
  resetRate('t1');
  const reloj = relojFalso();
  const momentos = [];
  for (let i = 0; i < 12; i++) {
    // eslint-disable-next-line no-await-in-loop
    await acquire('t1', cfg, reloj);
    momentos.push(reloj.now());
  }
  // en CUALQUIER ventana de 10 s no puede haber más de 6
  for (const t of momentos) {
    const dentro = momentos.filter((x) => x >= t && x < t + cfg.windowMs).length;
    assert.ok(dentro <= cfg.limit, `${dentro} peticiones en una ventana de 10 s (máximo ${cfg.limit})`);
  }
});

test('las reparte en el tiempo en vez de soltarlas de golpe', async () => {
  // Una ráfaga de 6 seguidas y luego 10 s parado cumple «6 cada 10 s» sobre el papel, pero es
  // justo lo que hace saltar las alarmas de un tracker. Deben ir separadas.
  resetRate('t2');
  const reloj = relojFalso();
  const momentos = [];
  for (let i = 0; i < 5; i++) {
    // eslint-disable-next-line no-await-in-loop
    await acquire('t2', cfg, reloj);
    momentos.push(reloj.now());
  }
  const separacionMinima = Math.ceil(cfg.windowMs / cfg.limit);
  for (let i = 1; i < momentos.length; i++) {
    assert.ok(
      momentos[i] - momentos[i - 1] >= separacionMinima,
      `solo ${momentos[i] - momentos[i - 1]} ms entre la ${i} y la ${i + 1} (mínimo ${separacionMinima})`
    );
  }
});

test('la primera petición no espera', async () => {
  resetRate('t3');
  const reloj = relojFalso();
  const esperado = await acquire('t3', cfg, reloj);
  assert.equal(esperado, 0, 'buscar algo a mano tiene que salir al momento');
});

test('si ha pasado el tiempo suficiente, vuelve a salir sin esperar', async () => {
  resetRate('t4');
  const reloj = relojFalso();
  await acquire('t4', cfg, reloj);
  reloj.avanzar(cfg.windowMs + 1000); // nadie ha pedido nada en todo ese rato
  const esperado = await acquire('t4', cfg, reloj);
  assert.equal(esperado, 0, 'no debe penalizar a quien llega descansado');
});

test('las peticiones concurrentes se reparten el turno, no se pisan', async () => {
  // Varios bucles a la vez (auto-descarga + «Lo quiero» + tú buscando a mano) es el caso que
  // provocó el bloqueo: si cada uno mirase el reloj por su cuenta, verían el mismo hueco libre.
  resetRate('t5');
  const reloj = relojFalso();
  await Promise.all(Array.from({ length: 8 }, () => acquire('t5', cfg, reloj)));
  // se miran los turnos que APUNTÓ el limitador, no la hora a la que resolvió cada promesa:
  // el reloj simulado avanza mientras otras peticiones esperan su turno
  const orden = [...rateStats('t5').recent].sort((a, b) => a - b);
  for (const t of orden) {
    const dentro = orden.filter((x) => x >= t && x < t + cfg.windowMs).length;
    assert.ok(dentro <= cfg.limit, `${dentro} peticiones simultáneas en una ventana (máximo ${cfg.limit})`);
  }
});

test('por defecto deja aire bajo el tope típico de un tracker privado', () => {
  const c = indexerRateConfig();
  assert.ok(c.limit <= 10 && c.windowMs >= 10000, 'el valor de fábrica no puede rozar el límite de RED');
  assert.ok(c.limit > 0);
});
