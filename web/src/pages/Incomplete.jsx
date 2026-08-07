import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PackageOpen } from 'lucide-react';
import { api } from '../api.js';
import { PageTitle, Cover, Spinner, ErrorMsg } from '../components.jsx';

// La feature estrella: álbumes a los que les falta alguna pista, ordenados por
// cuántas. El dolor real de una discoteca digital.
export default function Incomplete() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    api.incomplete().then(setRows).catch((e) => setErr(e.message));
  }, []);

  if (err) return <ErrorMsg>{err}</ErrorMsg>;
  if (!rows) return <Spinner />;

  return (
    <div>
      <PageTitle
        icon={PackageOpen}
        title="Álbumes incompletos"
        sub={rows.length ? `${rows.length} álbumes a los que les falta alguna pista` : ''}
      />
      {rows.length === 0 ? (
        <div className="card p-8 text-center text-neutral-400">
          Ningún álbum incompleto. Toda tu colección tiene todas sus pistas. 🎉
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((a) => (
            <Link
              key={a.id}
              to={`/album/${a.id}`}
              className="card flex items-center gap-3 p-2.5 hover:border-gold-500/40"
            >
              <div className="w-12 h-12 rounded overflow-hidden shrink-0">
                <Cover id={a.id} size="sm" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate flex items-center gap-2">
                  <span className="truncate">{a.title}</span>
                  {a.discs > 1 && (
                    <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-ink-800 border border-ink-700 text-neutral-400">
                      caja · {a.discs} discos
                    </span>
                  )}
                </div>
                <div className="text-xs text-neutral-500 truncate">
                  {a.album_artist}
                  {a.year ? ` · ${a.year}` : ''}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-amber-400 font-medium">faltan {a.missing}</div>
                <div className="text-xs text-neutral-600">
                  {a.track_file_count} / {a.track_count}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
