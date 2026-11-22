// De dónde venías, para que el enlace de volver de una ficha no se lo invente.
//
// La ficha de disco llevaba un «← Discoteca» fijo. Eso fallaba de dos maneras: si llegabas
// desde Lanzamientos o desde la página de un artista te mandaba a un sitio donde no habías
// estado, y si venías de la Discoteca con un filtro puesto lo perdía — mientras que el atrás
// del navegador sí lo conservaba, así que había dos «atrás» que no hacían lo mismo.
//
// La lista se apunta sola desde App.jsx en cada cambio de ruta: las páginas no se tocan.

const LISTAS = [
  [/^\/$/, 'Dashboard'],
  [/^\/discoteca$/, 'Discoteca'],
  [/^\/artistas$/, 'Artistas'],
  [/^\/resumen$/, 'Resumen'],
  [/^\/proximos$/, 'Lanzamientos'],
  [/^\/huecos$/, 'Huecos'],
  [/^\/incompletos$/, 'Álbumes incompletos'],
  [/^\/calidad$/, 'Calidad y disco'],
  [/^\/upgrades$/, 'Candidatos a upgrade'],
  [/^\/rarezas$/, 'Rarezas'],
  [/^\/bootlegs$/, 'Bootlegs'],
  [/^\/papelera$/, 'Papelera'],
  [/^\/sin-identificar$/, 'Sin identificar'],
  [/^\/correcciones$/, 'Correcciones'],
  [/^\/seguidos$/, 'Seguidos'],
  [/^\/sellos$/, 'Sellos'],
  [/^\/retos/, 'Retos'],
  [/^\/escuchas$/, 'Escuchas'],
  [/^\/streaming$/, 'Streaming'],
  [/^\/artista\//, 'Artista'],
  [/^\/generos\//, 'Género'],
  [/^\/generos$/, 'Géneros'],
];

// La ficha de un artista y la de un género son a la vez destino («← Artista» desde un disco)
// y fichas con su propio enlace de volver. Para ese segundo papel no valen ellas mismas: se
// guarda aparte la última lista que NO es una ficha.
const FICHAS = [/^\/artista\//, /^\/generos\/./];

const CLAVE = 'volver_a';
const CLAVE_LISTA = 'volver_a_lista';
const POR_DEFECTO = { to: '/discoteca', label: 'Discoteca' };

function guardar(clave, dato) {
  try {
    // sessionStorage y no localStorage: es por pestaña y muere con ella, que es justo lo que
    // significa «de dónde vengo». Y sobrevive al recargar la ficha, que el módulo no.
    sessionStorage.setItem(clave, JSON.stringify(dato));
  } catch {
    /* navegación privada o almacenamiento bloqueado: se usará el valor por defecto */
  }
}

function leer(clave, porDefecto) {
  try {
    const crudo = sessionStorage.getItem(clave);
    if (!crudo) return porDefecto;
    const d = JSON.parse(crudo);
    return d && typeof d.to === 'string' && typeof d.label === 'string' ? d : porDefecto;
  } catch {
    return porDefecto;
  }
}

/** Llamado en cada cambio de ruta. Si es una lista, se recuerda CON sus filtros. */
export function recordarLista(pathname, search) {
  const encontrada = LISTAS.find(([re]) => re.test(pathname));
  if (!encontrada) return;
  const dato = { to: pathname + (search || ''), label: encontrada[1] };
  guardar(CLAVE, dato);
  if (!FICHAS.some((re) => re.test(pathname))) guardar(CLAVE_LISTA, dato);
}

// --- por dónde ibas -----------------------------------------------------------
// Las listas largas (la Discoteca pagina de 500 en 500) se remontan al volver de una ficha:
// sin esto regresabas a los primeros 500 y arriba del todo, aunque estuvieras en el disco
// 1.200. Se guarda en memoria, no en sessionStorage: son miles de discos y solo sirve
// mientras dure la pestaña.
const posiciones = new Map(); // clave → { dato, y, cuando }
const CADUCA_MS = 15 * 60 * 1000;

export function guardarPosicion(clave, dato, y) {
  posiciones.delete(clave); // para que quede la última en el orden de inserción
  posiciones.set(clave, { dato, y, cuando: Date.now() });
  while (posiciones.size > 4) posiciones.delete(posiciones.keys().next().value);
}

export function posicionGuardada(clave) {
  const p = posiciones.get(clave);
  if (!p) return null;
  if (Date.now() - p.cuando > CADUCA_MS) {
    posiciones.delete(clave);
    return null;
  }
  return p;
}

/** Tras borrar, descartar o reclasificar un disco: lo guardado ya no es verdad. */
export function olvidarPosiciones() {
  posiciones.clear();
}

/** A dónde debe llevar el enlace de volver de un DISCO, y cómo se llama ese sitio. */
export function deDondeVienes() {
  return leer(CLAVE, POR_DEFECTO);
}

/**
 * Lo mismo para las fichas de artista y de género: la última lista de verdad por la que
 * pasaste (nunca otra ficha). `porDefecto` es a dónde ir si se llegó por un enlace directo.
 */
export function listaDeOrigen(porDefecto = POR_DEFECTO) {
  return leer(CLAVE_LISTA, porDefecto);
}
