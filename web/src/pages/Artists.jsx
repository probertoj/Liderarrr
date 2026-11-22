import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Users, Star } from 'lucide-react';
import { api } from '../api.js';
import { PageTitle, Spinner, ErrorMsg, Cover } from '../components.jsx';
import { useTandas, VerMas, cuenta } from '../tandas.jsx';
import { FichasRepetidas } from '../mantenimiento.jsx';

// Se piden TODOS: son unas pocas filas por artista y el servidor las da de una vez. Antes
// se pedían 5.000 justos, así que con 5.149 artistas la lista se cortaba sin avisar y la
// cabecera decía «5000 en tu colección». Lo caro no es traerlos sino pintarlos, y eso va
// por tandas.
const TOPE = 100000;
const ORDENES = ['albums', 'tracks', 'missing', 'added', 'tracked', 'name', 'name_desc', 'random'];

export default function Artists() {
  // Búsqueda, orden y filtros viven en la URL: al abrir un artista y volver, sigues donde
  // estabas en vez de en la lista entera.
  const [sp, setSp] = useSearchParams();
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  const [q, setQ] = useState(() => sp.get('q') || '');
  const [sort, setSort] = useState(() => (ORDENES.includes(sp.get('sort')) ? sp.get('sort') : 'albums'));
  const [onlyTracked, setOnlyTracked] = useState(() => sp.get('seguidos') === '1');
  const [onlyMissing, setOnlyMissing] = useState(() => sp.get('faltan') === '1');
  const [vuelta, setVuelta] = useState(0); // sube al fundir dos fichas: recarga la lista

  useEffect(() => {
    let cancelado = false;
    const t = setTimeout(() => {
      const params = { q, sort, limit: TOPE };
      if (onlyTracked) params.tracked = 1;
      if (onlyMissing) params.missing = 1;
      setRows(null);
      setErr(null);
      api
        .artists(params)
        // sin esta guardia, la respuesta de «ra» podía llegar después que la de
        // «radiohead» y pisarla
        .then((r) => !cancelado && setRows(r))
        .catch((e) => !cancelado && setErr(e.message));
    }, 200);
    return () => {
      cancelado = true;
      clearTimeout(t);
    };
  }, [q, sort, onlyTracked, onlyMissing, vuelta]);

  useEffect(() => {
    const next = {};
    if (q) next.q = q;
    if (sort !== 'albums') next.sort = sort;
    if (onlyTracked) next.seguidos = '1';
    if (onlyMissing) next.faltan = '1';
    setSp(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, sort, onlyTracked, onlyMissing]);

  const tandas = useTandas(rows, { tamano: 300, clave: `${q}|${sort}|${onlyTracked}|${onlyMissing}` });

  const chip = (on) =>
    `px-3 py-1.5 rounded-lg text-sm border inline-flex items-center gap-1.5 transition-colors ${
      on
        ? 'border-gold-500/60 bg-gold-500/15 text-gold-300'
        : 'border-ink-800 bg-ink-850 text-neutral-400 hover:border-gold-500/40'
    }`;

  const filtrando = q || onlyTracked || onlyMissing;
  let sub = '';
  if (rows) {
    // si aun así vinieran justo los del tope, es que hay más y no se están viendo
    const cortada = rows.length >= TOPE;
    sub = `${cuenta(tandas)} ${filtrando ? 'con ese filtro' : 'en tu colección'}${cortada ? ' (solo los primeros: hay más)' : ''}`;
  }

  return (
    <div>
      <PageTitle icon={Users} title="Artistas" sub={sub} />
      <FichasRepetidas onChange={() => setVuelta((v) => v + 1)} />
      <div className="flex gap-2 mb-3 flex-wrap">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar artista…"
          aria-label="Buscar artista"
          className="bg-ink-850 border border-ink-800 rounded-lg px-2.5 py-1.5 text-sm flex-1 min-w-[10rem]"
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          aria-label="Ordenar artistas"
          className="bg-ink-850 border border-ink-800 rounded-lg px-2.5 py-1.5 text-sm"
        >
          <option value="albums">Más álbumes</option>
          <option value="tracks">Más pistas</option>
          <option value="missing">Más discos por completar</option>
          <option value="added">Recientes</option>
          <option value="tracked">Seguidos primero</option>
          <option value="name">Nombre (A-Z)</option>
          <option value="name_desc">Nombre (Z-A)</option>
          <option value="random">Aleatorio</option>
        </select>
      </div>
      <div className="flex gap-2 mb-5 flex-wrap">
        <button type="button" onClick={() => setOnlyTracked((v) => !v)} className={chip(onlyTracked)} title="Solo artistas que sigues">
          <Star size={13} className={onlyTracked ? 'fill-current' : ''} /> Seguidos
        </button>
        <button
          type="button"
          onClick={() => setOnlyMissing((v) => !v)}
          className={chip(onlyMissing)}
          title="Solo artistas de los que faltan discos (según el último cruce de discografía con MusicBrainz)"
        >
          Faltan discos
        </button>
        {(onlyTracked || onlyMissing) && (
          <button
            type="button"
            onClick={() => {
              setOnlyTracked(false);
              setOnlyMissing(false);
            }}
            className="px-2.5 py-1.5 rounded-lg text-sm text-neutral-500 hover:text-neutral-300"
          >
            Limpiar filtros
          </button>
        )}
      </div>

      {err && <ErrorMsg>{err}</ErrorMsg>}
      {!rows && !err && <Spinner />}
      {rows && rows.length === 0 && (
        <div className="text-sm text-neutral-500">{filtrando ? 'Ningún artista con ese filtro.' : 'Aún no hay artistas: escanea tu música en Ajustes.'}</div>
      )}
      {rows && rows.length > 0 && (
        // grid-cols-1 a propósito: sin él la columna única del móvil es `auto` y se
        // ensancha hasta el nombre más largo de la lista (las fichas medían 866 px en una
        // pantalla de 375 y el contador de discos quedaba fuera).
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {tandas.visibles.map((a) => (
            <Link
              key={a.id}
              to={`/artista/${a.id}`}
              className="card p-2.5 flex items-center gap-3 min-w-0 hover:border-gold-500/40"
              title={a.tracked ? 'Sigues a este artista' : undefined}
            >
              <div className="w-11 h-11 rounded-md overflow-hidden shrink-0">
                <Cover id={a.cover_album_id} size="sm" noRetry />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  {a.tracked ? <Star size={12} className="fill-current text-gold-400 shrink-0" /> : null}
                  <span className="truncate">{a.name}</span>
                </div>
                <div className="text-xs text-neutral-600 truncate">
                  {a.mbid ? 'en MusicBrainz' : 'artista local'}
                  {a.country ? ` · ${a.country}` : ''}
                </div>
              </div>
              <div className="text-sm text-neutral-500 shrink-0 text-right">
                <div>{a.albums} álb</div>
                {a.missing > 0 ? (
                  <div className="text-xs text-amber-400" title="Álbumes de estudio que faltan">faltan {a.missing}</div>
                ) : (
                  <div className="text-xs text-neutral-600">{a.tracks} pistas</div>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
      <VerMas tandas={tandas} />
    </div>
  );
}
