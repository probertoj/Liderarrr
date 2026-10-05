import { getSetting } from './db.js';

// LÍMITE DE PETICIONES A LOS INDEXERS.
//
// Los trackers privados imponen un máximo de peticiones por ventana de tiempo. RED, por
// ejemplo: «no más de 10 peticiones cada 10 segundos». Liderarr no habla con el tracker
// directamente —habla con Prowlarr o Jackett—, pero cada búsqueda suya se convierte en una
// petición al tracker, y cada «grab» en otra. Así que el límite es cosa nuestra.
//
// Esto nació de un bloqueo REAL en RED. Los culpables eran los bucles: la auto-descarga
// nocturna podía disparar ~60 peticiones seguidas (20 discos × búsqueda + respaldo + grab) tan
// rápido como respondiera el indexer, y el barrido de «Lo quiero» otras tantas. Ninguno
// esperaba entre una y otra.
//
// Por eso el freno va AQUÍ, en el cuello de botella por el que pasan todas (prowlarr.js y
// jackett.js), y no en cada bucle: así ninguna función nueva puede saltárselo por olvido.
//
// Dos reglas a la vez:
//   1. VENTANA DESLIZANTE: nunca más de N peticiones en los últimos T segundos.
//   2. SEPARACIÓN MÍNIMA: al menos T/N entre una petición y la siguiente.
// La segunda es la que de verdad protege: sin ella, 10 peticiones de golpe y 10 segundos
// parados cumplen «10 cada 10 s» en el papel, pero son justo la ráfaga que hace saltar las
// alarmas de un tracker.

const colas = new Map(); // nombre → estado de la cola

function estado(nombre) {
  let c = colas.get(nombre);
  if (!c) {
    c = { hechas: [], cadena: Promise.resolve(), esperando: 0, totalEsperaMs: 0, peticiones: 0 };
    colas.set(nombre, c);
  }
  return c;
}

// Config del usuario. Por defecto 6 cada 10 s, NO 10: el tope del tracker lo gasta también
// Prowlarr por su cuenta (sincronización RSS, comprobaciones de salud), así que conviene
// dejarle aire. Quien quiera apurar puede subirlo hasta el límite real de su tracker.
export function indexerRateConfig() {
  const n = Number(getSetting('indexer_rate_requests'));
  const s = Number(getSetting('indexer_rate_seconds'));
  return {
    limit: Number.isFinite(n) && n > 0 ? Math.min(n, 60) : 6,
    windowMs: (Number.isFinite(s) && s > 0 ? Math.min(s, 600) : 10) * 1000,
  };
}

// Resto de servicios externos. Mismo mecanismo, un cubo por servicio: lo que gaste Last.fm no
// debe frenar a Deezer. Los números salen de lo que pide cada uno, siempre por debajo:
//   last.fm      — recomienda no pasar de ~5/s por IP
//   listenbrainz — publica su cupo en cabeceras; importar escuchas son cientos de páginas
//   acoustid     — pide no pasar de 3/s
//   deezer       — sin API oficial documentada; se asume ~50 cada 5 s y se va holgado
// MusicBrainz NO está aquí: tiene su propia cola de 1,1 s en musicbrainz.js (su norma es 1/s
// y además con dos carriles de prioridad), y meterlo aquí sería frenarlo dos veces.
const SERVICIOS = {
  lastfm: { limit: 4, windowMs: 1000 },
  listenbrainz: { limit: 3, windowMs: 1000 },
  acoustid: { limit: 2, windowMs: 1000 },
  deezer: { limit: 5, windowMs: 1000 },
};

// Pide turno para un servicio externo por su nombre. Para los indexers se usa acquire() con
// la config del usuario; para el resto, estos valores fijos.
export function servicio(nombre) {
  return SERVICIOS[nombre] || { limit: 5, windowMs: 1000 };
}

export function limitesExternos() {
  return Object.entries(SERVICIOS).map(([name, c]) => ({ name, limit: c.limit, windowSeconds: c.windowMs / 1000 }));
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// Separación mínima entre peticiones, con un 10% de MARGEN sobre el reparto exacto.
// Medido con un Jackett de pruebas: repartiendo justo (ventana/límite) llegaban 7 peticiones
// en una ventana de 10 s en vez de 6. La causa es que el limitador controla cuándo Liderarr
// INICIA cada petición, pero con Jackett quien va al tracker es qBittorrent un instante
// después, y ese desfase junta llegadas. Sin margen, quien pusiera «10 cada 10 s» creyendo que
// es exacto se comería un bloqueo por un puñado de milisegundos.
function minGap(cfg) {
  return Math.ceil((cfg.windowMs / cfg.limit) * 1.1);
}

// Pide turno. Devuelve cuánto ha tenido que esperar (ms), por si interesa contarlo.
export async function acquire(nombre = 'indexer', cfg = indexerRateConfig(), { now = () => Date.now(), sleep = dormir } = {}) {
  const c = estado(nombre);
  const t0 = now();
  c.esperando++;
  // Se encadena para que los turnos se repartan en ORDEN y sin solaparse: si cada petición
  // mirase el reloj por su cuenta, varias concurrentes verían el mismo hueco y saldrían juntas.
  const turno = c.cadena.then(async () => {
    for (;;) {
      const ahora = now();
      c.hechas = c.hechas.filter((t) => ahora - t < cfg.windowMs);
      const separacion = minGap(cfg);
      const ultima = c.hechas.length ? c.hechas[c.hechas.length - 1] : -Infinity;
      const esperaPorSeparacion = Math.max(0, separacion - (ahora - ultima));
      const esperaPorVentana = c.hechas.length >= cfg.limit ? cfg.windowMs - (ahora - c.hechas[0]) : 0;
      const espera = Math.max(esperaPorSeparacion, esperaPorVentana);
      if (espera <= 0) {
        c.hechas.push(ahora);
        c.peticiones++;
        return;
      }
      // eslint-disable-next-line no-await-in-loop
      await sleep(espera);
    }
  });
  c.cadena = turno.catch(() => {});
  await turno;
  c.esperando--;
  const esperado = now() - t0;
  c.totalEsperaMs += esperado;
  return esperado;
}

// Para enseñar en Diagnóstico que esto está funcionando (y poder contestar al tracker si
// pregunta qué límite aplicas).
export function rateStats(nombre = 'indexer', cfg = nombre === 'indexer' ? indexerRateConfig() : servicio(nombre)) {
  const c = estado(nombre);
  const ahora = Date.now();
  const enVentana = c.hechas.filter((t) => ahora - t < cfg.windowMs).length;
  return {
    limit: cfg.limit,
    windowSeconds: cfg.windowMs / 1000,
    minGapMs: minGap(cfg),
    inWindow: enVentana,
    // cuándo se concedió cada turno reciente: sirve para Diagnóstico y es lo único fiable
    // que puede mirar un test (el reloj de fuera avanza mientras otras peticiones esperan)
    recent: [...c.hechas],
    waiting: c.esperando,
    totalRequests: c.peticiones,
    totalWaitMs: c.totalEsperaMs,
  };
}

// Solo para los tests: deja la cola como recién nacida.
export function resetRate(nombre = 'indexer') {
  colas.delete(nombre);
}
