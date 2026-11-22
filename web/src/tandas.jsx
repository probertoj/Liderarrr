// Listas largas, de tanda en tanda.
//
// Artistas pintaba 5.000 fichas de golpe (85.000 nodos), Sin identificar 2.898 (168.000
// nodos y 6,5 segundos hasta poder tocar nada), Candidatos a upgrade 2.133. Los datos ya
// están en memoria —son listas que el servidor devuelve enteras—; lo caro es PINTARLOS.
// Esto enseña las primeras N y va añadiendo al bajar, igual que la Discoteca, y deja un
// botón para quien prefiera pedirlo a mano.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * @param lista   la lista entera (o null mientras carga)
 * @param tamano  cuántas se añaden de cada vez
 * @param clave   cuando cambia (otro filtro, otra búsqueda) se vuelve a la primera tanda.
 *                NO se reinicia porque la lista se recargue tras una acción: quien va por
 *                la ficha 900 y corrige una no quiere volver arriba.
 */
export function useTandas(lista, { tamano = 200, clave = '' } = {}) {
  const total = lista ? lista.length : 0;
  const [n, setN] = useState(tamano);
  const centinela = useRef(null);
  // Un cerrojo y no estado: un gesto de rueda suelta decenas de eventos de scroll antes de
  // que React pinte la tanda nueva, y sin él se encadenarían varias.
  const armado = useRef(true);

  useEffect(() => {
    setN(tamano);
    armado.current = true;
  }, [clave, tamano]);

  const verMas = useCallback(() => setN((v) => v + tamano), [tamano]);

  // Pintada la tanda, si el pie ya quedó lejos se rearma el cerrojo.
  useEffect(() => {
    const el = centinela.current;
    if (el && el.getBoundingClientRect().top - window.innerHeight >= 600) armado.current = true;
  }, [n, total]);

  useEffect(() => {
    if (n >= total) return undefined;
    const alBajar = () => {
      const el = centinela.current;
      if (!el) return;
      if (el.getBoundingClientRect().top - window.innerHeight >= 600) {
        armado.current = true;
        return;
      }
      if (!armado.current) return;
      armado.current = false;
      verMas();
    };
    window.addEventListener('scroll', alBajar, { passive: true });
    return () => window.removeEventListener('scroll', alBajar);
  }, [n, total, verMas]);

  const visibles = useMemo(() => (lista ? lista.slice(0, n) : []), [lista, n]);
  return { visibles, total, mostrados: Math.min(n, total), quedan: Math.max(0, total - n), verMas, centinela };
}

const miles = (n) => Number(n).toLocaleString('es-ES');

/** «200 de 2.898» mientras quede algo por enseñar; el total a secas cuando ya está todo. */
export function cuenta(tandas) {
  return tandas.quedan ? `${miles(tandas.mostrados)} de ${miles(tandas.total)}` : miles(tandas.total);
}

/** El pie de la lista: el botón y, a la vez, el punto que dispara la carga al bajar. */
export function VerMas({ tandas }) {
  if (!tandas.quedan) return null;
  return (
    <div ref={tandas.centinela} className="flex justify-center mt-4">
      <button
        type="button"
        onClick={tandas.verMas}
        className="text-sm px-3 py-1.5 rounded-lg border border-ink-700 bg-ink-850 hover:bg-ink-800"
      >
        Ver más (quedan {miles(tandas.quedan)})
      </button>
    </div>
  );
}
