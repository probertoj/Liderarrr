import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpCircle } from 'lucide-react';
import { api, fmtBytes } from '../api.js';
import { PageTitle, Cover, Spinner, ErrorMsg } from '../components.jsx';

// Cola de upgrades: álbumes que tienes SIN ninguna pista sin pérdida (todo con
// pérdida), candidatos naturales a buscar una edición mejor. Desde cada uno
// puedes abrir su ficha y mirar las ediciones de Discogs.
export default function Upgrades() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    api.upgrades().then(setRows).catch((e) => setErr(e.message));
  }, []);

  if (err) return <ErrorMsg>{err}</ErrorMsg>;
  if (!rows) return <Spinner />;

  return (
    <div>
      <PageTitle
        icon={ArrowUpCircle}
        title="Candidatos a upgrade"
        sub={rows.length ? `${rows.length} álbumes sin ninguna pista sin pérdida` : ''}
      />
      {rows.length === 0 ? (
        <div className="card p-8 text-center text-neutral-400">
          Nada que mejorar: todos tus álbumes tienen al menos una pista sin pérdida. 🎉
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((a) => (
            <Link key={a.id} to={`/album/${a.id}`} className="card flex items-center gap-3 p-2.5 hover:border-gold-500/40">
              <div className="w-12 h-12 rounded overflow-hidden shrink-0">
                <Cover id={a.id} size="sm" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate">{a.title}</div>
                <div className="text-xs text-neutral-500 truncate">
                  {a.album_artist}
                  {a.year ? ` · ${a.year}` : ''}
                </div>
              </div>
              <div className="text-right shrink-0 text-sm">
                <div className="text-amber-400">{a.formats}</div>
                <div className="text-xs text-neutral-600">
                  {a.max_kbps ? `${a.max_kbps} kbps · ` : ''}
                  {fmtBytes(a.size_bytes)}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
