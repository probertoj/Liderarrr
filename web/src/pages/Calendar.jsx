import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, Plus, Check, Loader2, ExternalLink } from 'lucide-react';
import { api, pollLidarrQueue } from '../api.js';
import { PageTitle, Spinner, ErrorMsg } from '../components.jsx';

// Próximos lanzamientos: release groups por estrenar de tus artistas seguidos.
// MusicBrainz sí tiene fechas futuras. Agrupados por mes.
export default function Calendar() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  const [all, setAll] = useState(false);
  const [added, setAdded] = useState({});
  const [busy, setBusy] = useState(null);
  const [queue, setQueue] = useState(null);

  useEffect(() => {
    setRows(null);
    api.upcoming(all).then(setRows).catch((e) => setErr(e.message));
  }, [all]);

  // Lidarr es lento: el envío se ENCOLA y responde al instante; se sondea el progreso.
  const add = async (r) => {
    setBusy(r.rg_mbid);
    try {
      await api.lidarrAdd(r.rg_mbid, r.artist_mbid);
      setAdded((p) => ({ ...p, [r.rg_mbid]: true }));
      pollLidarrQueue(setQueue);
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(null);
    }
  };

  if (err) return <ErrorMsg>{err}</ErrorMsg>;
  if (!rows) return <Spinner />;

  const months = {};
  for (const r of rows) {
    const key = (r.first_release || '????').slice(0, 7);
    (months[key] ||= []).push(r);
  }
  const fmtMonth = (k) => {
    if (!/^\d{4}-\d{2}$/.test(k)) return 'Fecha por confirmar';
    const [y, m] = k.split('-');
    return new Date(y, m - 1).toLocaleDateString('es', { month: 'long', year: 'numeric' });
  };

  return (
    <div>
      <PageTitle icon={CalendarClock} title="Próximos lanzamientos" sub={`${rows.length} álbumes por estrenar`} />
      <label className="flex items-center gap-2 text-sm text-neutral-400 mb-4 cursor-pointer">
        <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
        Incluir todos los artistas (no solo los que sigo)
      </label>

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
        <div className="card p-6 text-center text-neutral-400">
          Nada anunciado por ahora. Sigue a más artistas o recalcula discografías en «Huecos».
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(months).map(([month, items]) => (
            <div key={month}>
              <h2 className="text-sm text-gold-400/80 mb-2 capitalize">{fmtMonth(month)}</h2>
              <div className="space-y-1.5">
                {items.map((r) => {
                  const done = added[r.rg_mbid] || r.in_lidarr;
                  return (
                    <div key={r.rg_mbid} className="card px-3 py-2 flex items-center justify-between text-sm">
                      <div className="min-w-0">
                        <Link to={`/artista/${r.artist_id}`} className="hover:text-gold-400">
                          {r.artist}
                        </Link>
                        <span className="text-neutral-500"> — {r.title}</span>
                        <span className="text-neutral-600 text-xs ml-2">{r.primary_type}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-3">
                        <a
                          href={`https://musicbrainz.org/release-group/${r.rg_mbid}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-gold-400 hover:underline inline-flex items-center gap-0.5"
                        >
                          MB <ExternalLink size={11} />
                        </a>
                        <span className="text-neutral-600 text-xs">{r.first_release}</span>
                        {done ? (
                          <span className="text-emerald-400 text-xs inline-flex items-center gap-1">
                            <Check size={13} /> Lidarr
                          </span>
                        ) : (
                          <button
                            onClick={() => add(r)}
                            disabled={busy === r.rg_mbid}
                            className="text-xs px-1.5 py-0.5 rounded border border-gold-500/40 bg-gold-500/10 text-gold-300 hover:bg-gold-500/20 inline-flex items-center gap-1 disabled:opacity-50"
                          >
                            {busy === r.rg_mbid ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                            {busy === r.rg_mbid ? 'Enviando…' : 'Lidarr'}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
