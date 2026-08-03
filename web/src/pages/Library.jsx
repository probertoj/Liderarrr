import { useEffect, useState } from 'react';
import { Disc } from 'lucide-react';
import { api } from '../api.js';
import { PageTitle, AlbumCard, Spinner, ErrorMsg } from '../components.jsx';

export default function Library() {
  const [filters, setFilters] = useState(null);
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [f, setF] = useState({ q: '', genre: '', decade: '', format: '', lossless: '', state: '', sort: 'added' });

  useEffect(() => {
    api.libraryFilters().then(setFilters).catch(() => {});
  }, []);

  useEffect(() => {
    const clean = Object.fromEntries(Object.entries(f).filter(([, v]) => v));
    const t = setTimeout(() => {
      api
        .library({ ...clean, limit: 500 })
        .then(setData)
        .catch((e) => setErr(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [f]);

  const set = (k) => (e) => setF((prev) => ({ ...prev, [k]: e.target.value }));
  const sel = 'bg-ink-850 border border-ink-800 rounded-lg px-2.5 py-1.5 text-sm';

  return (
    <div>
      <PageTitle icon={Disc} title="Discoteca" sub={data ? `${data.total} álbumes` : 'Toda tu colección'} />

      <div className="flex flex-wrap gap-2 mb-5">
        <input
          value={f.q}
          onChange={set('q')}
          placeholder="Buscar álbum o artista…"
          className={`${sel} flex-1 min-w-[180px]`}
        />
        <select value={f.genre} onChange={set('genre')} className={sel}>
          <option value="">Género</option>
          {filters?.genres.map((g) => (
            <option key={g.name} value={g.name}>
              {g.name} ({g.n})
            </option>
          ))}
        </select>
        <select value={f.decade} onChange={set('decade')} className={sel}>
          <option value="">Década</option>
          {filters?.decades.map((d) => (
            <option key={d} value={d}>
              {d}s
            </option>
          ))}
        </select>
        <select value={f.format} onChange={set('format')} className={sel}>
          <option value="">Formato</option>
          {filters?.formats.map((fm) => (
            <option key={fm} value={fm}>
              {fm}
            </option>
          ))}
        </select>
        <select value={f.lossless} onChange={set('lossless')} className={sel}>
          <option value="">Calidad</option>
          <option value="1">Sin pérdida</option>
          <option value="0">Con pérdida</option>
        </select>
        <select value={f.state} onChange={set('state')} className={sel}>
          <option value="">Estado</option>
          <option value="matched">Identificado</option>
          <option value="orphan">Rareza</option>
          <option value="unmatched">Sin identificar</option>
        </select>
        <select value={f.sort} onChange={set('sort')} className={sel}>
          <option value="added">Recientes</option>
          <option value="artist">Artista</option>
          <option value="title">Título</option>
          <option value="year">Año</option>
          <option value="size">Tamaño</option>
          <option value="random">Aleatorio</option>
        </select>
      </div>

      {err && <ErrorMsg>{err}</ErrorMsg>}
      {!data && !err && <Spinner label="Cargando…" />}
      {data && data.albums.length === 0 && <p className="text-neutral-500">Nada que coincida.</p>}

      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {data.albums.map((a) => (
            <AlbumCard key={a.id} album={a} />
          ))}
        </div>
      )}
    </div>
  );
}
