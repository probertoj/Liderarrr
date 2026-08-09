import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, Plus, Check, Loader2, ExternalLink, Search, Star, Tag, X, RefreshCw } from 'lucide-react';
import { api, pollLidarrQueue } from '../api.js';
import { PageTitle, Spinner, ErrorMsg, SearchModal } from '../components.jsx';

// Lanzamientos: tres vistas. «Próximos» (release groups por estrenar de tus artistas),
// «Estrenados recientemente» (ya estrenados dentro de una ventana; por defecto este año)
// y «De tus sellos» (estrenos de sellos que sigues, aunque no sigas al artista, 0.6 fase 2).
// Desde cada fila puedes seguir al artista, buscar/descargar la release o enviarla a Lidarr.

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const thisYearStart = () => `${new Date().getFullYear()}-01-01`;

function ReleaseRow({ r, added, busy, followed, onAdd, onFollow, onSearch }) {
  const done = added[r.rg_mbid] || r.in_lidarr;
  const followKey = r.artist_id || r.artist_mbid;
  const isFollowed = (followKey && followed[followKey]) || r.tracked;
  const canFollow = !!(r.artist_id || r.artist_mbid);
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
          {r.artist_id ? (
            <Link to={`/artista/${r.artist_id}`} className="hover:text-gold-400">
              {r.artist}
            </Link>
          ) : (
            <span>{r.artist}</span>
          )}
          <span className="text-neutral-500"> — {r.title}</span>
        </div>
        <div className="text-xs text-neutral-600 flex items-center gap-2 flex-wrap">
          <span>
            {r.first_release || 'fecha por confirmar'}
            {r.primary_type && r.primary_type !== 'Album' ? ` · ${r.primary_type}` : ''}
            {r.is_owned ? ' · ya lo tienes' : ''}
          </span>
          {r.labels && (
            <span className="inline-flex items-center gap-1 text-gold-400/80" title="De un sello que sigues">
              <Tag size={11} /> {r.labels.split(',').join(', ')}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {isFollowed ? (
          <span className="text-xs text-gold-400/80 inline-flex items-center gap-1">
            <Star size={12} /> siguiendo
          </span>
        ) : canFollow ? (
          <button
            onClick={() => onFollow(r)}
            className="text-xs px-1.5 py-0.5 rounded border border-ink-700 bg-ink-850 hover:bg-ink-800 inline-flex items-center gap-1"
          >
            <Star size={12} /> Seguir
          </button>
        ) : null}
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
        ) : r.artist_mbid ? (
          <button
            onClick={() => onAdd(r)}
            disabled={busy === r.rg_mbid}
            className="text-xs px-1.5 py-0.5 rounded border border-gold-500/40 bg-gold-500/10 text-gold-300 hover:bg-gold-500/20 inline-flex items-center gap-1 disabled:opacity-50"
          >
            {busy === r.rg_mbid ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Lidarr
          </button>
        ) : null}
      </div>
    </div>
  );
}

// Barra de gestión de sellos seguidos: buscar en MusicBrainz y seguir, listar los
// seguidos con su catálogo, refrescar o dejar de seguir.
function LabelManager({ labels, onChange }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const followedIds = new Set(labels.map((l) => l.label_mbid));

  const runSearch = async (e) => {
    e?.preventDefault();
    if (!q.trim()) return;
    setSearching(true);
    setErr(null);
    try {
      setResults(await api.searchLabels(q.trim()));
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setSearching(false);
    }
  };
  const follow = async (l) => {
    setBusy(l.mbid);
    try {
      await api.followLabel({ mbid: l.mbid, name: l.name, disambiguation: l.disambiguation, country: l.country });
      await onChange();
    } catch (e2) {
      alert(e2.message);
    } finally {
      setBusy(null);
    }
  };
  const unfollow = async (mbid) => {
    setBusy(mbid);
    try {
      await api.unfollowLabel(mbid);
      await onChange();
    } finally {
      setBusy(null);
    }
  };
  const refresh = async (mbid) => {
    setBusy(mbid);
    try {
      await api.refreshLabel(mbid);
      await onChange();
    } catch (e2) {
      alert(e2.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="card p-3 mb-4 space-y-3">
      <form onSubmit={runSearch} className="flex items-center gap-2">
        <Tag size={15} className="text-gold-400/70 shrink-0" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar un sello para seguir (Sub Pop, Merge, Elefant…)"
          className="flex-1 bg-ink-850 border border-ink-800 rounded px-2 py-1 text-sm"
        />
        <button
          type="submit"
          disabled={searching}
          className="text-xs px-2 py-1 rounded border border-gold-500/40 bg-gold-500/10 text-gold-300 hover:bg-gold-500/20 inline-flex items-center gap-1 disabled:opacity-50"
        >
          {searching ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />} Buscar
        </button>
      </form>

      {err && <ErrorMsg>{err}</ErrorMsg>}

      {results && (
        <div className="space-y-1">
          {results.length === 0 && <p className="text-xs text-neutral-500">Sin resultados en MusicBrainz.</p>}
          {results.map((l) => (
            <div key={l.mbid} className="flex items-center gap-2 text-sm px-2 py-1 rounded bg-ink-850/60">
              <div className="min-w-0 flex-1 truncate">
                {l.name}
                {l.disambiguation ? <span className="text-neutral-600"> · {l.disambiguation}</span> : ''}
                {l.country ? <span className="text-neutral-600"> · {l.country}</span> : ''}
              </div>
              {followedIds.has(l.mbid) ? (
                <span className="text-xs text-gold-400/80 inline-flex items-center gap-1">
                  <Check size={12} /> siguiendo
                </span>
              ) : (
                <button
                  onClick={() => follow(l)}
                  disabled={busy === l.mbid}
                  className="text-xs px-1.5 py-0.5 rounded border border-ink-700 bg-ink-850 hover:bg-ink-800 inline-flex items-center gap-1 disabled:opacity-50"
                >
                  {busy === l.mbid ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Seguir
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {labels.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {labels.map((l) => (
            <span
              key={l.label_mbid}
              className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border border-ink-700 bg-ink-850"
              title={
                l.too_big
                  ? 'Sello demasiado grande para catalogar (major)'
                  : l.refreshed_at
                    ? `${l.catalog} álbumes en caché`
                    : 'Aún sin actualizar'
              }
            >
              <Tag size={11} className="text-gold-400/70" />
              {l.name || l.label_mbid}
              <span className="text-neutral-600">{l.too_big ? '(demasiado grande)' : `· ${l.catalog}`}</span>
              <button onClick={() => refresh(l.label_mbid)} disabled={busy === l.label_mbid} className="hover:text-gold-400 disabled:opacity-50" title="Actualizar catálogo">
                {busy === l.label_mbid ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
              </button>
              <button onClick={() => unfollow(l.label_mbid)} className="hover:text-red-400" title="Dejar de seguir">
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Calendar() {
  const [view, setView] = useState('upcoming'); // upcoming | recent | labels
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  const [all, setAll] = useState(false);
  const [since, setSince] = useState(thisYearStart());
  const [added, setAdded] = useState({});
  const [followed, setFollowed] = useState({});
  const [busy, setBusy] = useState(null);
  const [queue, setQueue] = useState(null);
  const [search, setSearch] = useState(null);
  const [labels, setLabels] = useState([]);

  const loadLabels = () => api.trackedLabels().then(setLabels).catch(() => {});

  useEffect(() => {
    setRows(null);
    setErr(null);
    const load =
      view === 'recent'
        ? api.recentReleases(since, all)
        : view === 'labels'
          ? api.labelReleases(since)
          : api.upcoming(all);
    load.then(setRows).catch((e) => setErr(e.message));
    if (view === 'labels') loadLabels();
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
    const key = r.artist_id || r.artist_mbid;
    try {
      if (r.artist_id) await api.follow(r.artist_id);
      else if (r.artist_mbid) await api.followMbid(r.artist_mbid);
      else return;
      setFollowed((p) => ({ ...p, [key]: true }));
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
  const monthKeys = Object.keys(months).sort((a, b) => (view === 'upcoming' ? a.localeCompare(b) : b.localeCompare(a)));
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

  const showSince = view === 'recent' || view === 'labels';

  return (
    <div>
      <PageTitle
        icon={CalendarClock}
        title="Lanzamientos"
        sub={
          rows
            ? `${rows.length} ${view === 'upcoming' ? 'por estrenar' : view === 'labels' ? 'de tus sellos' : 'estrenados en la ventana'}`
            : ''
        }
      />

      <div className="flex flex-wrap items-center gap-2 mb-3">
        {tab('upcoming', 'Próximos')}
        {tab('recent', 'Estrenados recientemente')}
        {tab('labels', 'De tus sellos')}
        {view !== 'labels' && (
          <label className="flex items-center gap-2 text-sm text-neutral-400 ml-auto cursor-pointer">
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
            Todos los artistas (no solo los que sigo)
          </label>
        )}
      </div>

      {view === 'labels' && <LabelManager labels={labels} onChange={loadLabels} />}

      {showSince && (
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
          {view === 'labels'
            ? labels.length === 0
              ? 'Aún no sigues ningún sello. Busca uno arriba para empezar.'
              : 'Ningún estreno de tus sellos en esta ventana. Amplía el rango o sigue a más sellos.'
            : view === 'recent'
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
