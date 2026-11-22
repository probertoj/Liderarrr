// Tres tareas de mantenimiento que salieron de mirar una base real, cada una con su panel:
//
//  · Carátulas de antemano: 3 de cada 4 discos no tienen imagen en su carpeta; la carátula se
//    saca del audio o de fuera la primera vez que se pide, y esa primera vez se ve el hueco.
//  · Carpetas que ya no están: discos de la base cuya carpeta se movió o renombró fuera.
//  · Fichas de artista repetidas: el mismo nombre dos veces, con los discos repartidos.
//
// Viven aquí y no en una página para poder colgarlos donde tocan (Calidad, Artistas).

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ImageDown, FolderX, Users, Loader2, ChevronDown, ChevronRight } from 'lucide-react';
import { api } from './api.js';
import { Button } from './components.jsx';
import { aviso, confirmar } from './avisos.jsx';

const miles = (n) => Number(n || 0).toLocaleString('es-ES');

// ----------------------------------------------------------------------------- carátulas
export function CaratulasPendientes() {
  const [st, setSt] = useState(null);
  const vivo = useRef(true);
  const reloj = useRef(null);

  const leer = async () => {
    try {
      const s = await api.coversWarm();
      if (!vivo.current) return;
      setSt(s);
      // mientras trabaja se vuelve a mirar; al acabar se mira una vez más para el recuento
      clearTimeout(reloj.current);
      if (s.running) reloj.current = setTimeout(leer, 2000);
    } catch {
      /* es un panel secundario: si no se puede leer, no se pinta */
    }
  };
  useEffect(() => {
    vivo.current = true;
    leer();
    return () => {
      vivo.current = false;
      clearTimeout(reloj.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const empezar = async () => {
    try {
      await api.coversWarmStart(1000);
      setTimeout(leer, 400);
    } catch (e) {
      aviso(e.message, 'error');
    }
  };
  const parar = async () => {
    try {
      await api.coversWarmCancel();
      aviso('Se para al terminar la que está en curso.', 'info');
    } catch (e) {
      aviso(e.message, 'error');
    }
  };

  if (!st) return null;
  if (!st.running && !st.pendientes && !st.finishedAt) return null; // nada que hacer ni que contar

  const pct = st.total ? Math.round((st.done / st.total) * 100) : 0;
  return (
    <div className="card p-4 mb-4">
      <div className="flex items-start gap-3 flex-wrap">
        <ImageDown size={18} className="text-gold-400 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm text-neutral-200">Carátulas de antemano</h2>
          {st.running ? (
            <p className="text-xs text-neutral-500 mt-1">
              Preparando {miles(st.done)} de {miles(st.total)} · {miles(st.found)} encontradas, {miles(st.none)} sin carátula en ningún sitio
            </p>
          ) : (
            <p className="text-xs text-neutral-500 mt-1">
              {st.pendientes
                ? `${miles(st.pendientes)} discos sin imagen en su carpeta todavía no tienen la carátula preparada: se saca del propio audio o se busca fuera la primera vez que los abres, y hasta entonces se ve el hueco.`
                : 'Todas las carátulas que se podían preparar están listas.'}
              {st.finishedAt ? ` Última tanda: ${miles(st.found)} encontradas de ${miles(st.done)}.` : ''} Cada noche se preparan hasta 1.500.
            </p>
          )}
          {st.running && (
            <div className="h-1.5 rounded-full bg-ink-800 mt-2 overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full bg-gold-400" style={{ width: `${pct}%` }} />
            </div>
          )}
        </div>
        <div className="shrink-0">
          {st.running ? (
            <Button onClick={parar}>Parar</Button>
          ) : st.pendientes ? (
            <Button variant="gold" onClick={empezar}>
              Preparar {miles(Math.min(st.pendientes, 1000))} ahora
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- carpetas que no están
export function CarpetasPerdidas({ onChange }) {
  const [lista, setLista] = useState(null);
  const [abierto, setAbierto] = useState(false);
  const [ocupado, setOcupado] = useState(null); // id en curso, 'todos' o 'mirar'

  const cargar = () =>
    api
      .missing()
      .then(setLista)
      .catch(() => setLista([]));
  useEffect(() => {
    cargar();
  }, []);

  const mirar = async () => {
    setOcupado('mirar');
    try {
      const r = await api.missingCheck();
      await cargar();
      if (r.dudosas?.length) aviso('Una carpeta de música no responde o le falta demasiado de golpe: no se ha marcado nada de ella.', 'info');
      else aviso(r.recuperados ? `${r.recuperados} carpeta(s) han vuelto a aparecer.` : 'Comprobado: sin cambios.', 'ok');
    } catch (e) {
      aviso(e.message, 'error');
    } finally {
      setOcupado(null);
    }
  };

  const quitar = async (a) => {
    const ok = await confirmar(
      `¿Quitar «${a.album_artist} — ${a.title}» de la app?\n\nSu carpeta ya no está en ${a.path}. Solo se quita la ficha: no se borra ningún fichero. Si el disco sigue en otra carpeta, ya tiene su propia ficha.`,
      { aceptar: 'Quitar de la app', peligro: true }
    );
    if (!ok) return;
    setOcupado(a.id);
    try {
      await api.missingForget(a.id);
      aviso('Ficha quitada.', 'ok');
    } catch (e) {
      aviso(e.message, 'error');
    } finally {
      setOcupado(null);
      await cargar();
      onChange?.();
    }
  };

  const quitarTodos = async () => {
    const ok = await confirmar(
      `¿Quitar de la app los ${lista.length} discos cuya carpeta ya no está?\n\nSolo se quitan las fichas: no se borra ningún fichero. Antes de quitar cada una se vuelve a mirar, y la que haya reaparecido se queda.`,
      { aceptar: `Quitar ${lista.length} fichas`, peligro: true }
    );
    if (!ok) return;
    setOcupado('todos');
    try {
      const r = await api.missingForgetAll();
      aviso(`${r.quitados} fichas quitadas${r.vueltos ? ` · ${r.vueltos} carpetas habían vuelto y se quedan` : ''}.`, 'ok');
    } catch (e) {
      aviso(e.message, 'error');
    } finally {
      setOcupado(null);
      await cargar();
      onChange?.();
    }
  };

  if (!lista || lista.length === 0) return null;

  return (
    <div className="card p-4 mb-4">
      <div className="flex items-start gap-3 flex-wrap">
        <FolderX size={18} className="text-amber-400 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm text-neutral-200">
            {miles(lista.length)} {lista.length === 1 ? 'disco apunta' : 'discos apuntan'} a una carpeta que ya no está
          </h2>
          <p className="text-xs text-neutral-500 mt-1">
            Pasa cuando mueves o renombras una carpeta con otra herramienta: aparece un disco nuevo y el viejo se queda aquí, contando como
            tuyo. No se quita nada por su cuenta, por si es un volumen que no ha montado.
          </p>
        </div>
        <div className="flex gap-2 shrink-0 flex-wrap">
          <Button onClick={mirar} disabled={!!ocupado}>
            {ocupado === 'mirar' ? 'Mirando…' : 'Volver a mirar'}
          </Button>
          <button type="button" onClick={quitarTodos} disabled={!!ocupado} className="boton-peligro text-sm px-3 py-1.5 rounded-lg border disabled:opacity-40">
            {ocupado === 'todos' ? 'Quitando…' : 'Quitar todos de la app'}
          </button>
        </div>
      </div>
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        className="mt-3 text-xs text-neutral-400 hover:text-gold-400 inline-flex items-center gap-1"
      >
        {abierto ? <ChevronDown size={13} /> : <ChevronRight size={13} />} {abierto ? 'Ocultar la lista' : 'Ver cuáles son'}
      </button>
      {abierto && (
        <ul className="mt-2 space-y-1 max-h-80 overflow-y-auto">
          {lista.map((a) => (
            <li key={a.id} className="flex items-center gap-2 text-sm bg-ink-850/50 rounded px-2.5 py-1.5">
              <div className="min-w-0 flex-1">
                <Link to={`/album/${a.id}`} className="block truncate hover:text-gold-400">
                  {a.album_artist} — {a.title}
                  {a.year ? <span className="text-neutral-500"> · {a.year}</span> : null}
                </Link>
                <div className="text-[11px] text-neutral-500 truncate" title={a.path}>
                  {a.path}
                </div>
              </div>
              <Button onClick={() => quitar(a)} disabled={!!ocupado} className="shrink-0">
                {ocupado === a.id ? <Loader2 size={13} className="animate-spin" /> : 'Quitar'}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------- fichas repetidas
export function FichasRepetidas({ onChange }) {
  const [grupos, setGrupos] = useState(null);
  const [abierto, setAbierto] = useState(false);
  const [ocupado, setOcupado] = useState(null);

  const cargar = () =>
    api
      .artistDuplicates()
      .then(setGrupos)
      .catch(() => setGrupos([]));
  useEffect(() => {
    cargar();
  }, []);

  // La que se queda: la que tiene MBID (ya vienen ordenadas así) y, a igualdad, más discos.
  const fundir = async (g) => {
    const [queda, ...sobran] = g.fichas;
    const discos = sobran.reduce((s, f) => s + (f.albums || 0), 0);
    const ok = await confirmar(
      `¿Fundir las ${g.fichas.length} fichas de «${g.name}» en una?\n\nSe queda la ${queda.mbid ? 'que está identificada en MusicBrainz' : 'que tiene más discos'} y pasan a ella ${discos} disco(s), el seguimiento y la discografía de la otra. Solo cambia la base: no se toca ningún fichero. No se puede deshacer.`,
      { aceptar: 'Fundir en una', peligro: true }
    );
    if (!ok) return;
    setOcupado(g.name);
    try {
      for (const f of sobran) await api.artistMerge(f.id, queda.id);
      aviso(`«${g.name}» ya es una sola ficha.`, 'ok');
    } catch (e) {
      aviso(e.message, 'error');
    } finally {
      setOcupado(null);
      await cargar();
      onChange?.();
    }
  };

  if (!grupos || grupos.length === 0) return null;

  return (
    <div className="card p-3 mb-4">
      <button type="button" onClick={() => setAbierto((v) => !v)} aria-expanded={abierto} className="w-full flex items-center gap-2 text-sm text-left">
        <Users size={15} className="text-amber-400 shrink-0" />
        <span className="min-w-0 flex-1">
          {grupos.length === 1 ? 'Hay 1 artista con dos fichas' : `Hay ${grupos.length} artistas con dos fichas`}
          <span className="text-neutral-500"> · sus discos están repartidos entre ellas</span>
        </span>
        {abierto ? <ChevronDown size={15} className="shrink-0" /> : <ChevronRight size={15} className="shrink-0" />}
      </button>
      {abierto && (
        <ul className="mt-3 space-y-2">
          {grupos.map((g) => (
            <li key={g.name} className="flex items-start gap-3 flex-wrap bg-ink-850/50 rounded px-2.5 py-2">
              <div className="min-w-0 flex-1 text-sm">
                <div className="truncate">{g.name}</div>
                <div className="text-xs text-neutral-500 flex gap-x-3 gap-y-0.5 flex-wrap mt-0.5">
                  {g.fichas.map((f) => (
                    <Link key={f.id} to={`/artista/${f.id}`} className="hover:text-gold-400 underline underline-offset-2">
                      {f.albums} disco{f.albums === 1 ? '' : 's'} · {f.mbid ? 'en MusicBrainz' : 'sin identificar'}
                      {f.seguido ? ' · seguido' : ''}
                    </Link>
                  ))}
                </div>
              </div>
              <Button onClick={() => fundir(g)} disabled={!!ocupado} className="shrink-0">
                {ocupado === g.name ? 'Fundiendo…' : 'Fundir en una'}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
