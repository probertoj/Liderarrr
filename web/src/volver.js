// De dónde venías, para que el enlace de volver de una ficha no se lo invente.
//
// La ficha de disco llevaba un «← Discoteca» fijo. Eso fallaba de dos maneras: si llegabas
// desde Lanzamientos o desde la página de un artista te mandaba a un sitio donde no habías
// estado, y si venías de la Discoteca con un filtro puesto lo perdía — mientras que el atrás
// del navegador sí lo conservaba, así que había dos «atrás» que no hacían lo mismo.
//
// La lista se apunta sola desde App.jsx en cada cambio de ruta: las páginas no se tocan.

const LISTAS = [
  [/^\/discoteca$/, 'Discoteca'],
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

const CLAVE = 'volver_a';
const POR_DEFECTO = { to: '/discoteca', label: 'Discoteca' };

/** Llamado en cada cambio de ruta. Si es una lista, se recuerda CON sus filtros. */
export function recordarLista(pathname, search) {
  const encontrada = LISTAS.find(([re]) => re.test(pathname));
  if (!encontrada) return;
  const dato = { to: pathname + (search || ''), label: encontrada[1] };
  try {
    // sessionStorage y no localStorage: es por pestaña y muere con ella, que es justo lo que
    // significa «de dónde vengo». Y sobrevive al recargar la ficha, que el módulo no.
    sessionStorage.setItem(CLAVE, JSON.stringify(dato));
  } catch {
    /* navegación privada o almacenamiento bloqueado: se usará el valor por defecto */
  }
}

/** A dónde debe llevar el enlace de volver, y cómo se llama ese sitio. */
export function deDondeVienes() {
  try {
    const crudo = sessionStorage.getItem(CLAVE);
    if (!crudo) return POR_DEFECTO;
    const d = JSON.parse(crudo);
    return d && typeof d.to === 'string' && typeof d.label === 'string' ? d : POR_DEFECTO;
  } catch {
    return POR_DEFECTO;
  }
}
