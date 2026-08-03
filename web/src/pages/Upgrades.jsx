import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpCircle, Plus, Check, Loader2 } from 'lucide-react';
import { api, fmtBytes } from '../api.js';
import { PageTitle, Cover, Spinner, ErrorMsg } from '../components.jsx';

// Cola de upgrades: álbumes que tienes SIN ninguna pista sin pérdida. Desde aquí
// se actúa: pides a Lidarr que busque una versión mejor (lo monitoriza y lanza la
// búsqueda; si tu perfil de calidad permite upgrades, la cambiará). También puedes
// abrir la ficha para ver las ediciones concretas en Discogs.
export default function Upgrades() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(null);
  const [done, setDone] = useState({});

  useEffect(() => {
    api.upgrades().then(setRows).catch((e) => setErr(e.message));
  }, []);

  const search = async (a) => {
    setBusy(a.id);
    try {
      const r = await api.lidarrAdd(a.rg_mbid, a.artist_mbid);
      if (r.pending) {
        alert(r.note);
        return;
      }
      setDone((p) => ({ ...p, [a.id]: true }));
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
              <div className="text-right shrink-0 text-sm">
                <div className="text-amber-400">{a.formats}</div>
                <div className="text-xs text-neutral-600">
                  {a.max_kbps ? `${a.max_kbps} kbps · ` : ''}
                  {fmtBytes(a.size_bytes)}
                </div>
              </div>
              <div className="shrink-0 w-40 text-right">
                {done[a.id] ? (
                  <span className="text-emerald-400 text-xs inline-flex items-center gap-1">
                    <Check size={14} /> búsqueda lanzada
                  </span>
                ) : a.can_upgrade ? (
                  <button
                    onClick={() => search(a)}
                    disabled={busy === a.id}
                    className="text-xs px-2 py-1 rounded border border-gold-500/40 bg-gold-500/10 text-gold-300 hover:bg-gold-500/20 inline-flex items-center gap-1 disabled:opacity-50"
                  >
                    {busy === a.id ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                    {busy === a.id ? 'Buscando…' : 'Buscar upgrade'}
                  </button>
                ) : (
                  <span className="text-xs text-neutral-600" title="Identifícalo primero para poder mandarlo a Lidarr">
                    sin identificar
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
