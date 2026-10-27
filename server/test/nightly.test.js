import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

// refresh.js arrastra db.js (abre SQLite en DATA_DIR). Temporal antes del import dinámico.
process.env.DATA_DIR = path.join(os.tmpdir(), `liderarr-nightly-${Date.now()}`);
const { setSetting } = await import('../src/db.js');
const { nightlyConfig, tocaRefresco } = await import('../src/refresh.js');

// Un «ahora» a la hora que se pida, y la última pasada SIEMPRE relativa a ese ahora: si se
// mezclan con el reloj real, el resultado depende de a qué hora se corran los tests.
const aLas = (hora) => {
  const d = new Date();
  d.setHours(hora, 15, 0, 0);
  return d;
};
const ultimaHace = (ahora, horas) => setSetting('nightly_last_run', String(ahora.getTime() - horas * 3600000));

test('sin tocar nada, el refresco es a las 3 de la madrugada', () => {
  setSetting('nightly_hour', null);
  assert.equal(nightlyConfig().hour, 3);
});

// El ajuste vale 0 (medianoche) y `Number(null) || 3` lo confundiría con «no puesto».
test('la medianoche es una hora válida, no un ajuste vacío', () => {
  setSetting('nightly_hour', '0');
  assert.equal(nightlyConfig().hour, 0);
});

test('una hora imposible se recorta y una basura vuelve al valor de fábrica', () => {
  setSetting('nightly_hour', '99');
  assert.equal(nightlyConfig().hour, 23);
  setSetting('nightly_hour', '-4');
  assert.equal(nightlyConfig().hour, 0);
  setSetting('nightly_hour', 'a las tantas');
  assert.equal(nightlyConfig().hour, 3);
  setSetting('nightly_hour', '');
  assert.equal(nightlyConfig().hour, 3);
});

test('instalación nueva: espera a su hora, no se lanza al arrancar', () => {
  setSetting('nightly_hour', '5');
  setSetting('nightly_last_run', null);
  assert.equal(tocaRefresco(aLas(4)), false);
  assert.equal(tocaRefresco(aLas(5)), true);
});

test('a su hora corre una vez al día, no una vez por minuto', () => {
  setSetting('nightly_hour', '5');
  const ahora = aLas(5);
  ultimaHace(ahora, 1);
  assert.equal(tocaRefresco(ahora), false); // acaba de correr
  ultimaHace(ahora, 24);
  assert.equal(tocaRefresco(ahora), true);
  const pasada = aLas(6);
  ultimaHace(pasada, 24);
  assert.equal(tocaRefresco(pasada), false); // ya pasó su hora: mañana será
});

// El fallo que esto arregla de paso: el contenedor arrancado a las 05:00:30 se saltaba el
// minuto en punto y se quedaba sin pasada nocturna. Con la red de 36 h, se da igual.
test('si se pasó su hora sin correr, a las 36 h se lanza de todas formas', () => {
  setSetting('nightly_hour', '5');
  const ahora = aLas(11);
  ultimaHace(ahora, 40);
  assert.equal(tocaRefresco(ahora), true);
  ultimaHace(ahora, 30);
  assert.equal(tocaRefresco(ahora), false);
});

test('cambiar la hora en Ajustes se nota en la siguiente comprobación, sin reiniciar', () => {
  const siete = aLas(7);
  ultimaHace(siete, 24);
  setSetting('nightly_hour', '7');
  assert.equal(tocaRefresco(siete), true);
  setSetting('nightly_hour', '22');
  assert.equal(tocaRefresco(siete), false);
  const diez = aLas(22);
  ultimaHace(diez, 24);
  assert.equal(tocaRefresco(diez), true);
});
