import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users } from 'lucide-react';
import { api } from '../api.js';
import { PageTitle, Spinner, ErrorMsg } from '../components.jsx';

export default function Artists() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('albums');

  useEffect(() => {
    const t = setTimeout(() => {
      api
        .artists({ q, sort, limit: 300 })
        .then(setRows)
        .catch((e) => setErr(e.message));
    }, 200);
    return () => clearTimeout(t);
  }, [q, sort]);

  return (
    <div>
      <PageTitle icon={Users} title="Artistas" sub={rows ? `${rows.length} en tu colección` : ''} />
      <div className="flex gap-2 mb-5">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar artista…"
          className="bg-ink-850 border border-ink-800 rounded-lg px-2.5 py-1.5 text-sm flex-1"
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className="bg-ink-850 border border-ink-800 rounded-lg px-2.5 py-1.5 text-sm"
        >
          <option value="albums">Más álbumes</option>
          <option value="tracks">Más pistas</option>
          <option value="name">Nombre</option>
        </select>
      </div>

      {err && <ErrorMsg>{err}</ErrorMsg>}
      {!rows && !err && <Spinner />}
      {rows && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {rows.map((a) => (
            <Link
              key={a.id}
              to={`/artista/${a.id}`}
              className="card px-4 py-3 hover:border-gold-500/40 flex items-center justify-between"
            >
              <div className="min-w-0">
                <div className="truncate">{a.name}</div>
                <div className="text-xs text-neutral-600">
                  {a.mbid ? 'en MusicBrainz' : 'artista local'}
                  {a.country ? ` · ${a.country}` : ''}
                </div>
              </div>
              <div className="text-sm text-neutral-500 shrink-0 ml-3 text-right">
                <div>{a.albums} álb</div>
                <div className="text-xs text-neutral-600">{a.tracks} pistas</div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
