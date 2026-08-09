import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, Plus, Check, Loader2, ExternalLink, Search, Star } from 'lucide-react';
import { api, pollLidarrQueue } from '../api.js';
import { PageTitle, Spinner, ErrorMsg, SearchModal } from '../components.jsx';

// Lanzamientos: dos vistas. «Próximos» (release groups por estrenar de tus artistas) y
// «Estrenados recientemente» (ya estrenados dentro de una ventana; por defecto este año).
// Desde cada fila puedes seguir al artista, buscar/descargar la release o enviarla a Lidarr.

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const thisYearStart = () => `${new Date().getFullYear()}-01-01`;

function ReleaseRow({ r, added, busy, followed, onAdd, onFollow, onSearch }) {
  const done = added[r.rg_mbid] || r.in_lidarr;
  const isFollowed = followed[r.artist_id] || r.tracked;
  return (
    <div className="card px-3 py-2 flex items-center gap-3 text-sm">
      <img
        src={`https://coverartarchive.org/release-group/${r.rg_mbid}/front-250`}
        alt=""
        loading="lazy"
        onError={(e) => {
          e.currentTarget.style.visibility = 'hidden';
        }}
        className="w-10 h-10 rounded object-cover bg-ink-850 shrink-0"
      />
      <div className="min-w-0 flex-1">
        <div className="truncate">
          <Link to={`/artista/${r.artist_id}`} className="hover:text-gold-400">
            {r.artist}
          </Link>
          <span className="text-neutral-500"> — {r.title}</span>
        </div>
        <div className="text-xs text-neutral-600">
          {r.first_release || 'fecha por confirmar'}
          {r.primary_type && r.primary_type !== 'Album' ? ` · ${r.primary_type}` : ''}
          {r.is_owned ? ' · ya lo tienes' : ''}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {isFollowed ? (
          <span className="text-xs text-gold-400/80 inline-flex items-center gap-1">
            <Star size={12} /> siguiendo
          </span>
        ) : (
          <button
            onClick={() => onFollow(r)}
            className="text-xs px-1.5 py-0.5 rounded border border-ink-700 bg-ink-850 hover:bg-ink-800 inline-flex items-center gap-1"
          >
            <Star size={12} /> Seguir
          </button>
        )}
        <button
          onClick={() => onSearch(`${r.artist} ${r.title}`)}
          className="text-xs px-1.5 py-0.5 rounded border border-ink-700 bg-ink-850 hover:bg-ink-800 inline-flex items-center gap-1"
        >
          <Search size={12} /> Buscar
        </button>
        <a
          href={`https://musicbrainz.org/release-group/${r.rg_mbid}`}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-gold-400 hover:underline inline-flex items-center gap-0.5"
        >
          MB <ExternalLink size={11} />
        </a>
        {r.is_owned ? (
          <span className="text-emerald-400/80 text-xs inline-flex items-center gap-1">
            <Check size={13} /> en disco
          </span>
        ) : done ? (
          <span className="text-emerald-400 text-xs inline-flex items-center gap-1">
            <Check size={13} /> Lidarr
          </span>
        ) : (
          <button
            onClick={() => onAdd(r)}
            disabled={busy === r.rg_mbid}
            className="text-xs px-1.5 py-0.5 rounded border border-gold-500/40 bg-gold-500/10 text-gold-300 hover:bg-gold-500/20 inline-flex items-center gap-1 disabled:opacity-50"
          >
            {busy === r.rg_mbid ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Lidarr
          </button>
        )}
      </div>
    </div>
  );
}

export default function Calendar() {
  const [view, setView] = useState('upcoming'); // upcoming | recent
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  const [all, setAll] = useState(false);
  const [since, setSince] = useState(thisYearStart());
  const [added, setAdded] = useState({});
  const [followed, setFollowed] = useState({});
  const [busy, setBusy] = useState(null);
  const [queue, setQueue] = useState(null);
  const [search, setSearch] = useState(null);

  useEffect(() => {
    setRows(null);
    setErr(null);
    const load = view === 'recent' ? api.recentReleases(since, all) : api.upcoming(all);
    load.then(setRows).catch((e) => setErr(e.message));
  }, [view, all, since]);

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
  const follow = async (r) => {
    try {
      await api.follow(r.artist_id);
      setFollowed((p) => ({ ...p, [r.artist_id]: true }));
    } catch (e) {
      alert(e.message);
    }
  };

  const SINCE_PRESETS = [
    { label: 'Este año', value: thisYearStart() },
    { label: 'Últimos 90 días', value: daysAgo(90) },
    { label: 'Últimos 30 días', value: daysAgo(7 * 4 + 2) },
    { label: 'Últimos 7 días', value: daysAgo(7) },
  ];

  const months = {};
  for (const r of rows || []) {
    const key = (r.first_release || '????').slice(0, 7);
    (months[key] ||= []).push(r);
  }
  const monthKeys = Object.keys(months).sort((a, b) => (view === 'recent' ? b.localeCompare(a) : a.localeCompare(b)));
  const fmtMonth = (k) => {
    if (!/^\d{4}-\d{2}$/.test(k)) return 'Fecha por confirmar';
    const [y, m] = k.split('-');
    return new Date(y, m - 1).toLocaleDateString('es', { month: 'long', year: 'numeric' });
  };

  const tab = (id, label) => (
    <button
      onClick={() => setView(id)}
      className={`px-3 py-1.5 rounded-lg text-sm border ${
        view === id ? 'border-gold-500/50 bg-gold-500/15 text-gold-300' : 'border-ink-800 bg-ink-850 text-neutral-400'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div>
      <PageTitle
        icon={CalendarClock}
        title="Lanzamientos"
        sub={rows ? `${rows.length} ${view === 'recent' ? 'estrenados en la ventana' : 'por estrenar'}` : ''}
      />

      <div className="flex flex-wrap items-center gap-2 mb-3">
        {tab('upcoming', 'Próximos')}
        {tab('recent', 'Estrenados recientemente')}
        <label className="flex items-center gap-2 text-sm text-neutral-400 ml-auto cursor-pointer">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
          Todos los artistas (no solo los que sigo)
        </label>
      </div>

      {view === 'recent' && (
        <div className="flex flex-wrap gap-2 mb-4">
          {SINCE_PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => setSince(p.value)}
              className={`text-xs px-2 py-1 rounded-lg border ${
                since === p.value ? 'border-gold-500/50 bg-gold-500/10 text-gold-300' : 'border-ink-800 bg-ink-850 text-neutral-500'
              }`}
            >
              {p.label}
            </button>
          ))}
          <label className="text-xs text-neutral-500 inline-flex items-center gap-1 ml-1">
            desde
            <input
              type="date"
              value={since}
              onChange={(e) => setSince(e.target.value)}
              className="bg-ink-850 border border-ink-800 rounded px-1.5 py-0.5 text-xs"
            />
          </label>
        </div>
      )}

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

      {err && <ErrorMsg>{err}</ErrorMsg>}
      {!rows && !err ? (
        <Spinner />
      ) : rows && rows.length === 0 ? (
        <div className="card p-6 text-center text-neutral-400">
          {view === 'recent'
            ? 'Nada estrenado en esa ventana entre tus artistas. Amplía el rango o sigue a más artistas.'
            : 'Nada anunciado por ahora. Sigue a más artistas o recalcula discografías en «Huecos».'}
        </div>
      ) : (
        <div className="space-y-6">
          {monthKeys.map((month) => (
            <div key={month}>
              <h2 className="text-sm text-gold-400/80 mb-2 capitalize">{fmtMonth(month)}</h2>
              <div className="space-y-1.5">
                {months[month].map((r) => (
                  <ReleaseRow
                    key={r.rg_mbid}
                    r={r}
                    added={added}
                    busy={busy}
                    followed={followed}
                    onAdd={add}
                    onFollow={follow}
                    onSearch={setSearch}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {search != null && <SearchModal initialQuery={search} onClose={() => setSearch(null)} />}
    </div>
  );
}
