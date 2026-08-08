import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpCircle, Plus, Check, Loader2, ExternalLink } from 'lucide-react';
import { api, fmtBytes, pollLidarrQueue } from '../api.js';
import { PageTitle, Cover, Spinner, ErrorMsg, SearchModal } from '../components.jsx';

// Cola de upgrades: álbumes que tienes SIN ninguna pista sin pérdida. Por cada uno,
// las dos vías de siempre: enviarlo a Lidarr (que busque una versión mejor) o
// buscarlo tú a mano en Prowlarr (para elegir el rip lossless que quieras).
export default function Upgrades() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(null);
  const [done, setDone] = useState({});
  const [queue, setQueue] = useState(null);
  const [search, setSearch] = useState(null); // query del modal de búsqueda manual

  useEffect(() => {
    api.upgrades().then(setRows).catch((e) => setErr(e.message));
  }, []);

  const sendLidarr = async (a) => {
    setBusy(a.id);
    try {
      await api.lidarrAdd(a.rg_mbid, a.artist_mbid);
      setDone((p) => ({ ...p, [a.id]: true }));
      pollLidarrQueue(setQueue);
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(null);
    }
  };

  if (err) return <ErrorMsg>{err}</ErrorMsg>;
  if (!rows) return <Spinner />;

  return (
    <div>
      <PageTitle
        icon={ArrowUpCircle}
        title="Candidatos a upgrade"
        sub={rows.length ? `${rows.length} álbumes sin ninguna pista sin pérdida` : ''}
      />
      {queue &&
        (queue.running ? (
          <p className="text-xs text-gold-300/90 mb-3">Lidarr: procesando {queue.done}/{queue.total}…</p>
        ) : (
          <p className="text-xs text-neutral-500 mb-3">
            Lidarr: {queue.added} enviados
            {queue.pending ? ` · ${queue.pending} pendientes de importar` : ''}
            {queue.errors?.length ? ` · ${queue.errors.length} con error` : ''}.
          </p>
        ))}

      {rows.length === 0 ? (
        <div className="card p-8 text-center text-neutral-400">
          Nada que mejorar: todos tus álbumes tienen al menos una pista sin pérdida. 🎉
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((a) => (
            <div key={a.id} className="card flex items-center gap-3 p-2.5">
              <Link to={`/album/${a.id}`} className="w-12 h-12 rounded overflow-hidden shrink-0">
                <Cover id={a.id} size="sm" />
              </Link>
              <Link to={`/album/${a.id}`} className="min-w-0 flex-1 hover:text-gold-400">
                <div className="truncate">{a.title}</div>
                <div className="text-xs text-neutral-500 truncate">
                  {a.album_artist}
                  {a.year ? ` · ${a.year}` : ''}
                </div>
              </Link>
              <div className="text-right shrink-0 text-sm hidden sm:block">
                <div className="text-amber-400">{a.formats}</div>
                <div className="text-xs text-neutral-600">
                  {a.max_kbps ? `${a.max_kbps} kbps · ` : ''}
                  {fmtBytes(a.size_bytes)}
                </div>
              </div>
              <div className="shrink-0 flex items-center gap-2">
                {a.rg_mbid && (
                  <a
                    href={`https://musicbrainz.org/release-group/${a.rg_mbid}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-gold-400 hover:underline inline-flex items-center gap-0.5"
                  >
                    MB <ExternalLink size={11} />
                  </a>
                )}
                <button
                  onClick={() => setSearch(`${a.album_artist || ''} ${a.title}`.trim())}
                  className="text-xs px-2 py-1 rounded border border-ink-700 bg-ink-850 hover:bg-ink-800"
                >
                  Buscar
                </button>
                {done[a.id] ? (
                  <span className="text-emerald-400 text-xs inline-flex items-center gap-1">
                    <Check size={14} /> Lidarr
                  </span>
                ) : a.can_upgrade ? (
                  <button
                    onClick={() => sendLidarr(a)}
                    disabled={busy === a.id}
                    className="text-xs px-2 py-1 rounded border border-gold-500/40 bg-gold-500/10 text-gold-300 hover:bg-gold-500/20 inline-flex items-center gap-1 disabled:opacity-50"
                  >
                    {busy === a.id ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                    Lidarr
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      {search != null && <SearchModal initialQuery={search} onClose={() => setSearch(null)} />}
    </div>
  );
}
