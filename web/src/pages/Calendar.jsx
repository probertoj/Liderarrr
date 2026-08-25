import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, Plus, Check, Loader2, ExternalLink, Search, Star, Tag, X, RefreshCw, Radio } from 'lucide-react';
import { api, pollLidarrQueue } from '../api.js';
import { PageTitle, Spinner, ErrorMsg, SearchModal, useLidarrEnabled } from '../components.jsx';
import MonthCalendar from './MonthCalendar.jsx';

// Lanzamientos: cuatro vistas. «Próximos» (release groups por estrenar de tus artistas),
// «Estrenados recientemente» (ya estrenados dentro de una ventana; por defecto este año),
// «De tus sellos» (estrenos de sellos que sigues, aunque no sigas al artista, 0.6 fase 2)
// y «Radar» (novedades curadas de Bandcamp vía buymusic.club, 0.6 fase 3).
// Desde cada fila puedes seguir al artista, buscar/descargar la release o enviarla a Lidarr.

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const thisYearStart = () => `${new Date().getFullYear()}-01-01`;

function ReleaseRow({ r, added, busy, followed, onAdd, onFollow, onSearch, lidarrOn }) {
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
        <div className="truncate clamp-mobile" title={`${r.artist} — ${r.title}`}>
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
            <Check size={13} /> {lidarrOn ? 'Lidarr' : 'pedido'}
          </span>
        ) : lidarrOn && !r.artist_mbid ? null : (
          <button
            onClick={() => onAdd(r)}
            disabled={busy === r.rg_mbid}
            className="text-xs px-1.5 py-0.5 rounded border border-gold-500/40 bg-gold-500/10 text-gold-300 hover:bg-gold-500/20 inline-flex items-center gap-1 disabled:opacity-50"
          >
            {busy === r.rg_mbid ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} {lidarrOn ? 'Lidarr' : 'Descargar'}
          </button>
        )}
      </div>
    </div>
  );
}

// Fila de NOVEDAD externa (Deezer/Spotify que MusicBrainz aún no lista). Distinta de
// ReleaseRow: no hay rg_mbid (ni carátula de MB ni «enviar a Lidarr» por rg), así que la
// carátula viene de la fuente y la descarga es siempre nativa (grabBest por texto).
function ExternalReleaseRow({ r, added, busy, onAdd, onSearch, onDismiss }) {
  const done = added[`ext${r.id}`];
  return (
    <div className="card px-3 py-2 flex items-center gap-3 text-sm">
      <img
        src={r.cover || ''}
        alt=""
        loading="lazy"
        onError={(e) => {
          e.currentTarget.style.visibility = 'hidden';
        }}
        className="w-10 h-10 rounded object-cover bg-ink-850 shrink-0"
      />
      <div className="min-w-0 flex-1">
        <div className="truncate clamp-mobile" title={`${r.artist} — ${r.title}`}>
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
            {r.release_date}
            {r.record_type && r.record_type !== 'album' ? ` · ${r.record_type.toUpperCase()}` : ''}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-ink-700 text-neutral-500 uppercase">{r.source}</span>
          {r.ahead && (
            <span className="text-amber-400/80" title="MusicBrainz aún no lo lista">⚡ MB no lo tiene</span>
          )}
          {r.owned && <span className="text-emerald-400/70">ya lo tienes</span>}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={() => onSearch(`${r.artist} ${r.title}`)}
          className="text-xs px-1.5 py-0.5 rounded border border-ink-700 bg-ink-850 hover:bg-ink-800 inline-flex items-center gap-1"
        >
          <Search size={12} /> Buscar
        </button>
        {done ? (
          <span className="text-emerald-400 text-xs inline-flex items-center gap-1">
            <Check size={13} /> pedido
          </span>
        ) : (
          <button
            onClick={() => onAdd(r)}
            disabled={busy === `ext${r.id}`}
            className="text-xs px-1.5 py-0.5 rounded border border-gold-500/40 bg-gold-500/10 text-gold-300 hover:bg-gold-500/20 inline-flex items-center gap-1 disabled:opacity-50"
          >
            {busy === `ext${r.id}` ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Descargar
          </button>
        )}
        {r.url && (
          <a href={r.url} target="_blank" rel="noreferrer" className="text-xs text-gold-400 hover:underline inline-flex items-center gap-0.5">
            <ExternalLink size={12} />
          </a>
        )}
        <button onClick={() => onDismiss(r)} className="text-neutral-600 hover:text-neutral-300" aria-label="Descartar">
          <X size={14} />
        </button>
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

// Color del badge de nivel de Hipersónica (de mejor a peor).
const TIER_STYLE = {
  'Directo al Excel': 'border-gold-500/50 bg-gold-500/15 text-gold-300',
  Sí: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  OK: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
  Meh: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  No: 'border-red-500/40 bg-red-500/10 text-red-300',
};

// Fila del radar: un ítem de Bandcamp curado. No trae MBID; el botón Lidarr lo
// resuelve contra MusicBrainz al vuelo (artista+título) y, si acierta, lo envía.
function RadarRow({ r, onSearch, onFollowMbid, onQueue, lidarrOn }) {
  const [state, setState] = useState('idle'); // idle | resolving | added | notfound
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  // Con Lidarr → resuelve el MBID y se lo manda. Sin Lidarr → descarga nativa por
  // artista+título (no necesita MBID); el auto-import la coloca en la biblioteca.
  const sendGrab = async () => {
    setState('resolving');
    try {
      if (lidarrOn) {
        const res = await api.radarResolve(r.id);
        if (!res.rg_mbid) {
          setState('notfound');
          return;
        }
        await api.lidarrAdd(res.rg_mbid, res.artist_mbid);
        onQueue();
      } else {
        const res = await api.grabBest(`${r.artist} ${r.title}`, { artist: r.artist, album: r.title });
        if (!res.grabbed) {
          setState('notfound');
          return;
        }
      }
      setState('added');
    } catch (e) {
      alert(e.message);
      setState('idle');
    }
  };
  const followArtist = async () => {
    setState('resolving');
    try {
      const res = await api.radarResolve(r.id);
      if (!res.artist_mbid) {
        setState('notfound');
        return;
      }
      await onFollowMbid(res.artist_mbid);
      setState('idle');
    } catch (e) {
      alert(e.message);
      setState('idle');
    }
  };
  const dismiss = async () => {
    setDismissed(true);
    api.radarDismiss(r.id).catch(() => {});
  };

  return (
    <div className="card px-3 py-2 flex items-center gap-3 text-sm">
      <img
        src={r.image}
        alt=""
        loading="lazy"
        onError={(e) => {
          e.currentTarget.style.visibility = 'hidden';
        }}
        className="w-10 h-10 rounded object-cover bg-ink-850 shrink-0"
      />
      <div className="min-w-0 flex-1">
        <div className="truncate flex items-center gap-1.5" title={`${r.artist} — ${r.title}`}>
          {r.source === 'hipersonica' && r.type && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full border shrink-0 ${TIER_STYLE[r.type] || 'border-ink-700 text-neutral-400'}`}>
              {r.type}
            </span>
          )}
          <span className="truncate clamp-mobile">
            <span>{r.artist}</span>
            <span className="text-neutral-500"> — {r.title}</span>
          </span>
        </div>
        <div className="text-xs text-neutral-600 flex items-center gap-2 flex-wrap">
          <span>
            {r.release_date}
            {r.type && r.type !== 'album' && r.source !== 'hipersonica' ? ` · ${r.type}` : ''}
            {r.label ? ` · ${r.label}` : ''}
          </span>
          <span className="text-neutral-700">vía {r.curator}</span>
          {r.tracked_artist && (
            <span className="inline-flex items-center gap-1 text-gold-400/80">
              <Star size={11} /> sigues al artista
            </span>
          )}
          {r.tracked_label && (
            <span className="inline-flex items-center gap-1 text-gold-400/80">
              <Tag size={11} /> sello seguido
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {!r.tracked_artist && (
          <button
            onClick={followArtist}
            disabled={state === 'resolving'}
            className="text-xs px-1.5 py-0.5 rounded border border-ink-700 bg-ink-850 hover:bg-ink-800 inline-flex items-center gap-1 disabled:opacity-50"
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
        {r.url && (
          <a
            href={r.url}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-gold-400 hover:underline inline-flex items-center gap-0.5"
          >
            Bandcamp <ExternalLink size={11} />
          </a>
        )}
        {r.is_owned ? (
          <span className="text-emerald-400/80 text-xs inline-flex items-center gap-1">
            <Check size={13} /> en disco
          </span>
        ) : state === 'added' ? (
          <span className="text-emerald-400 text-xs inline-flex items-center gap-1">
            <Check size={13} /> {lidarrOn ? 'Lidarr' : 'pedido'}
          </span>
        ) : state === 'notfound' ? (
          <span className="text-neutral-500 text-xs" title={lidarrOn ? 'MusicBrainz no lo reconoce con confianza' : 'Sin release válida en tus indexers'}>
            {lidarrOn ? 'sin match MB' : 'sin release'}
          </span>
        ) : (
          <button
            onClick={sendGrab}
            disabled={state === 'resolving'}
            className="text-xs px-1.5 py-0.5 rounded border border-gold-500/40 bg-gold-500/10 text-gold-300 hover:bg-gold-500/20 inline-flex items-center gap-1 disabled:opacity-50"
          >
            {state === 'resolving' ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} {lidarrOn ? 'Lidarr' : 'Descargar'}
          </button>
        )}
        <button onClick={dismiss} className="text-neutral-600 hover:text-red-400" title="Descartar del radar">
          <X size={13} />
        </button>
      </div>
    </div>
  );
}

// Gestión de curadores: seguir por nombre de usuario de buymusic.club, listar,
// actualizar y dejar de seguir. Análogo a LabelManager.
function CuratorManager({ curators, onChange }) {
  const [u, setU] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [hsOpen, setHsOpen] = useState(false);
  const [hsText, setHsText] = useState('');
  const [hsDate, setHsDate] = useState('');
  const [hsMsg, setHsMsg] = useState(null);
  const [hsToCh, setHsToCh] = useState(true); // enviar niveles a un reto ampliable
  const [hsTiers, setHsTiers] = useState(['Directo al Excel', 'Sí']);
  const hsYear = (hsDate || new Date().toISOString()).slice(0, 4);
  const [hsChName, setHsChName] = useState('');
  const chName = hsChName || `Los Excels ${hsYear} de Hipersónica`;
  const toggleTier = (t) => setHsTiers((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t]));
  const addHs = async () => {
    if (!hsText.trim()) return;
    setBusy(true);
    setErr(null);
    setHsMsg(null);
    try {
      const toChallenge = hsToCh && hsTiers.length ? { name: chName, tiers: hsTiers } : undefined;
      const r = await api.addHipersonicaTierList(hsText, hsDate || undefined, toChallenge);
      setHsMsg(
        `Añadidos ${r.items} discos al radar${r.challenge ? `; ${r.challenge.added} al reto «${chName}»` : ''}.`
      );
      setHsText('');
      await onChange();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  };

  const follow = async (e) => {
    e?.preventDefault();
    if (!u.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await api.followCurator(u.trim());
      setU('');
      await onChange();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  };
  // Fuentes con curador FIJO (no un usuario variable): un clic las sigue.
  const followPreset = async (source) => {
    setBusy(true);
    setErr(null);
    try {
      await api.followCurator('', source);
      await onChange();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  };
  const hasRosy = curators.some((c) => c.source === 'rosyoverdrive');
  const hasRaven = curators.some((c) => c.source === 'ravensingstheblues');
  const refresh = async (id) => {
    setBusy(true);
    try {
      await api.refreshCurator(id);
      await onChange();
    } catch (e2) {
      alert(e2.message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id) => {
    setBusy(true);
    try {
      await api.unfollowCurator(id);
      await onChange();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card p-3 mb-4 space-y-3">
      <form onSubmit={follow} className="flex items-center gap-2">
        <Radio size={15} className="text-gold-400/70 shrink-0" />
        <input
          value={u}
          onChange={(e) => setU(e.target.value)}
          placeholder="Usuario de buymusic.club a seguir (p. ej. calltheranger)"
          className="flex-1 bg-ink-850 border border-ink-800 rounded px-2 py-1 text-sm"
        />
        <button
          type="submit"
          disabled={busy}
          className="text-xs px-2 py-1 rounded border border-gold-500/40 bg-gold-500/10 text-gold-300 hover:bg-gold-500/20 inline-flex items-center gap-1 disabled:opacity-50"
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Seguir
        </button>
      </form>
      {(!hasRosy || !hasRaven) && (
        <div className="flex flex-wrap gap-2">
          {!hasRosy && (
            <button
              type="button"
              onClick={() => followPreset('rosyoverdrive')}
              disabled={busy}
              className="text-xs px-2 py-1 rounded border border-ink-700 bg-ink-850 text-neutral-300 hover:border-gold-500/50 hover:text-gold-300 inline-flex items-center gap-1 disabled:opacity-50"
              title="Sigue la columna «Pressing Concerns» de Rosy Overdrive (reseñas de novedades)"
            >
              <Plus size={12} /> Rosy Overdrive · Pressing Concerns
            </button>
          )}
          {!hasRaven && (
            <button
              type="button"
              onClick={() => followPreset('ravensingstheblues')}
              disabled={busy}
              className="text-xs px-2 py-1 rounded border border-ink-700 bg-ink-850 text-neutral-300 hover:border-gold-500/50 hover:text-gold-300 inline-flex items-center gap-1 disabled:opacity-50"
              title="Sigue las reseñas de Raven Sings the Blues"
            >
              <Plus size={12} /> Raven Sings the Blues · Reseñas
            </button>
          )}
        </div>
      )}
      <div>
        <button
          type="button"
          onClick={() => setHsOpen((o) => !o)}
          className="text-xs text-neutral-400 hover:text-gold-300 inline-flex items-center gap-1"
          title="Pega el texto de una tier list de música de Hipersónica (de pago, no se puede sondear)"
        >
          <Plus size={12} /> Pegar tier list de Hipersónica
        </button>
        {hsOpen && (
          <div className="mt-2 space-y-2">
            <textarea
              value={hsText}
              onChange={(e) => setHsText(e.target.value)}
              rows={5}
              placeholder="Pega aquí el texto de la tier list (con «DIRECTO AL EXCEL», «DISCOS QUE SÍ»… y las líneas «género:»)…"
              className="w-full bg-ink-850 border border-ink-800 rounded px-2 py-1 text-sm"
            />
            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="date"
                value={hsDate}
                onChange={(e) => setHsDate(e.target.value)}
                className="bg-ink-850 border border-ink-800 rounded px-2 py-1 text-xs text-neutral-300"
                title="Fecha de la tier list (por defecto, hoy)"
              />
              <button
                type="button"
                onClick={addHs}
                disabled={busy || !hsText.trim()}
                className="text-xs px-2 py-1 rounded border border-gold-500/40 bg-gold-500/10 text-gold-300 hover:bg-gold-500/20 disabled:opacity-50"
              >
                Añadir al radar
              </button>
              {hsMsg && <span className="text-xs text-emerald-400">{hsMsg}</span>}
            </div>
            <div className="rounded border border-ink-800 bg-ink-900/40 p-2 space-y-2">
              <label className="flex items-center gap-2 text-xs text-neutral-300 cursor-pointer">
                <input type="checkbox" checked={hsToCh} onChange={(e) => setHsToCh(e.target.checked)} />
                También añadir estos niveles a un reto ampliable
              </label>
              {hsToCh && (
                <div className="space-y-2 pl-5">
                  <div className="flex items-center gap-2 flex-wrap">
                    {['Directo al Excel', 'Sí', 'OK', 'Meh', 'No'].map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => toggleTier(t)}
                        className={`text-[11px] px-2 py-0.5 rounded-full border ${
                          hsTiers.includes(t)
                            ? 'border-gold-500/50 bg-gold-500/15 text-gold-300'
                            : 'border-ink-700 bg-ink-850 text-neutral-500'
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                  <input
                    value={hsChName}
                    onChange={(e) => setHsChName(e.target.value)}
                    placeholder={`Los Excels ${hsYear} de Hipersónica`}
                    className="w-full bg-ink-850 border border-ink-800 rounded px-2 py-1 text-xs text-neutral-200"
                    title="Nombre del reto. Si ya existe, se le añaden los discos nuevos (sin duplicar)."
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      {err && <ErrorMsg>{err}</ErrorMsg>}
      {curators.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {curators.map((c) => (
            <span
              key={c.id}
              className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border border-ink-700 bg-ink-850"
              title={`${c.items} novedades en caché`}
            >
              <Radio size={11} className="text-gold-400/70" />
              <a
                href={
                  c.source === 'rosyoverdrive'
                    ? 'https://rosyoverdrive.com/tag/pressing-concerns/'
                    : c.source === 'ravensingstheblues'
                      ? 'https://ravensingstheblues.com/category/reviews/'
                      : c.source === 'hipersonica'
                        ? 'https://www.hipersonica.com/s/tier-list/'
                        : `https://www.buymusic.club/user/${c.username}`
                }
                target="_blank"
                rel="noreferrer"
                className="hover:text-gold-400"
              >
                {c.name || c.username}
              </a>
              <span className="text-neutral-600">· {c.items}</span>
              <button onClick={() => refresh(c.id)} disabled={busy} className="hover:text-gold-400 disabled:opacity-50" title="Actualizar">
                <RefreshCw size={11} />
              </button>
              <button onClick={() => remove(c.id)} className="hover:text-red-400" title="Dejar de seguir">
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
  const [view, setView] = useState('upcoming'); // upcoming | recent | labels | radar
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
  const [curators, setCurators] = useState([]);
  const [unowned, setUnowned] = useState(false);
  const [novIncludeOwned, setNovIncludeOwned] = useState(false);

  const loadLabels = () => api.trackedLabels().then(setLabels).catch(() => {});
  const loadCurators = () => api.curators().then(setCurators).catch(() => {});

  useEffect(() => {
    setRows(null);
    setErr(null);
    if (view === 'mes') return; // la vista mes carga sus propias fuentes (MonthCalendar)
    const load =
      view === 'recent'
        ? api.recentReleases(since, all)
        : view === 'labels'
          ? api.labelReleases(since)
          : view === 'radar'
            ? api.radar(since, unowned)
            : view === 'novedades'
              ? api.newReleases(novIncludeOwned)
              : api.upcoming(all);
    load.then(setRows).catch((e) => setErr(e.message));
    if (view === 'labels') loadLabels();
    if (view === 'radar') loadCurators();
  }, [view, all, since, unowned, novIncludeOwned]);

  const lidarrOn = useLidarrEnabled();

  // Con Lidarr → se lo mandamos (como siempre). Sin Lidarr (opcional) → descarga
  // nativa: agarra la mejor release por Prowlarr/Jackett y el auto-import la coloca.
  const add = async (r) => {
    setBusy(r.rg_mbid);
    try {
      if (lidarrOn) {
        await api.lidarrAdd(r.rg_mbid, r.artist_mbid);
        pollLidarrQueue(setQueue);
      } else {
        const res = await api.grabBest(`${r.artist} ${r.title}`, { rg_mbid: r.rg_mbid, artist: r.artist, album: r.title });
        if (!res.grabbed) {
          alert(`No se pudo agarrar: ${res.reason || 'sin release'}`);
          return;
        }
      }
      setAdded((p) => ({ ...p, [r.rg_mbid]: true }));
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
  // Novedad externa (sin rg_mbid): descarga SIEMPRE nativa (grabBest por texto).
  const addExternal = async (r) => {
    setBusy(`ext${r.id}`);
    try {
      const res = await api.grabBest(`${r.artist} ${r.title}`, { artist: r.artist, album: r.title });
      if (!res.grabbed) {
        alert(`No se pudo agarrar: ${res.reason || 'sin release'}`);
        return;
      }
      setAdded((p) => ({ ...p, [`ext${r.id}`]: true }));
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(null);
    }
  };
  const dismissExternal = async (r) => {
    setRows((p) => (p || []).filter((x) => x.id !== r.id));
    api.dismissNewRelease(r.id).catch(() => {});
  };

  const SINCE_PRESETS = [
    { label: 'Este año', value: thisYearStart() },
    { label: 'Últimos 90 días', value: daysAgo(90) },
    { label: 'Últimos 30 días', value: daysAgo(7 * 4 + 2) },
    { label: 'Últimos 7 días', value: daysAgo(7) },
  ];

  // En el Radar, los pre-pedidos / futuros van a su propia sección arriba (no
  // mezclados con lo ya estrenado dentro de la ventana), ordenados por fecha de
  // estreno ascendente (lo que sale antes, primero).
  const radarUpcoming =
    view === 'radar'
      ? (rows || [])
          .filter((r) => r.is_upcoming)
          .sort((a, b) => (a.release_date || '').localeCompare(b.release_date || ''))
      : [];

  // En «Novedades» agrupamos por SEMANA (feed semana a semana); en el resto, por mes.
  const weekKey = (dateStr) => {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return '????';
    const day = (d.getUTCDay() + 6) % 7; // 0 = lunes
    d.setUTCDate(d.getUTCDate() - day);
    return d.toISOString().slice(0, 10);
  };
  const months = {};
  for (const r of rows || []) {
    if (view === 'radar' && r.is_upcoming) continue; // van en radarUpcoming
    const key =
      view === 'novedades' ? weekKey(r.release_date) : (r.first_release || r.release_date || '????').slice(0, 7);
    (months[key] ||= []).push(r);
  }
  const monthKeys = Object.keys(months).sort((a, b) => (view === 'upcoming' ? a.localeCompare(b) : b.localeCompare(a)));
  const fmtMonth = (k) => {
    if (!/^\d{4}-\d{2}$/.test(k)) return 'Fecha por confirmar';
    const [y, m] = k.split('-');
    return new Date(y, m - 1).toLocaleDateString('es', { month: 'long', year: 'numeric' });
  };
  const fmtWeek = (k) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) return 'Fecha por confirmar';
    return `Semana del ${new Date(k + 'T00:00:00Z').toLocaleDateString('es', { day: 'numeric', month: 'long', timeZone: 'UTC' })}`;
  };
  const fmtGroup = (k) => (view === 'novedades' ? fmtWeek(k) : fmtMonth(k));

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

  const showSince = view === 'recent' || view === 'labels' || view === 'radar';
  const reloadRadar = async () => {
    await loadCurators();
    try {
      setRows(await api.radar(since, unowned));
    } catch (e) {
      setErr(e.message);
    }
  };
  // Novedades de Spotify: se llenan en el refresco, pero se pueden buscar al momento aquí,
  // con feedback (cuántas y de cuántos artistas), para no tener que lanzar el ciclo entero.
  const [novBusy, setNovBusy] = useState(false);
  const [novMsg, setNovMsg] = useState(null);
  const refreshNov = async () => {
    setNovBusy(true);
    setNovMsg(null);
    try {
      const r = await api.refreshNewReleases();
      setRows(await api.newReleases(novIncludeOwned));
      setNovMsg(
        r.seeds === 0
          ? 'No sigues a ningún artista todavía: sigue a alguien para ver sus novedades.'
          : `${r.count} novedades de ${r.seeds} artistas seguidos${r.count === 0 ? ' (nada reciente que no tengas ya)' : ''}.`
      );
    } catch (e) {
      setErr(e.message);
    } finally {
      setNovBusy(false);
    }
  };

  return (
    <div>
      <PageTitle
        icon={CalendarClock}
        title="Lanzamientos"
        sub={
          rows && view !== 'mes'
            ? `${rows.length} ${
                view === 'upcoming'
                  ? 'por estrenar'
                  : view === 'labels'
                    ? 'de tus sellos'
                    : view === 'radar'
                      ? 'en el radar'
                      : view === 'novedades'
                        ? 'novedades de tus artistas (⚡ = MusicBrainz aún no las tiene)'
                        : 'estrenados en la ventana'
              }`
            : ''
        }
      />

      <div className="flex flex-wrap items-center gap-2 mb-3">
        {tab('mes', '📅 Mes')}
        {tab('upcoming', 'Próximos')}
        {tab('recent', 'Estrenados recientemente')}
        {tab('novedades', 'Novedades de Spotify')}
        {tab('labels', 'De tus sellos')}
        {tab('radar', 'Radar')}
        {(view === 'upcoming' || view === 'recent') && (
          <label className="flex items-center gap-2 text-sm text-neutral-400 ml-auto cursor-pointer">
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
            Todos los artistas (no solo los que sigo)
          </label>
        )}
        {view === 'radar' && (
          <label className="flex items-center gap-2 text-sm text-neutral-400 ml-auto cursor-pointer">
            <input type="checkbox" checked={unowned} onChange={(e) => setUnowned(e.target.checked)} />
            Ocultar lo que ya tengo
          </label>
        )}
        {view === 'novedades' && (
          <label className="flex items-center gap-2 text-sm text-neutral-400 ml-auto cursor-pointer">
            <input type="checkbox" checked={novIncludeOwned} onChange={(e) => setNovIncludeOwned(e.target.checked)} />
            Mostrar también los que ya tengo
          </label>
        )}
      </div>

      {view === 'mes' && <MonthCalendar onSearch={setSearch} />}

      {view !== 'mes' && (
        <>
      {view === 'labels' && <LabelManager labels={labels} onChange={loadLabels} />}
      {view === 'radar' && <CuratorManager curators={curators} onChange={reloadRadar} />}
      {view === 'novedades' && (
        <div className="card p-3 mb-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-xs text-neutral-500 min-w-0 flex-1">
              Estrenos recientes (últimos ~6 meses) de tus artistas seguidos en Deezer/Spotify que no tienes, semana a
              semana. Se llenan solos en el refresco; búscalos ahora si quieres.
            </p>
            <button
              onClick={refreshNov}
              disabled={novBusy}
              className="text-xs px-2.5 py-1.5 rounded-lg border border-gold-500/40 bg-gold-500/10 text-gold-300 hover:bg-gold-500/20 inline-flex items-center gap-1.5 disabled:opacity-60 shrink-0"
            >
              <RefreshCw size={13} className={novBusy ? 'animate-spin' : ''} /> {novBusy ? 'Buscando…' : 'Buscar novedades ahora'}
            </button>
          </div>
          {novMsg && <p className="text-xs text-gold-300/90 mt-2">{novMsg}</p>}
        </div>
      )}

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
          {view === 'radar'
            ? curators.length === 0
              ? 'Aún no sigues ningún curador. Añade uno arriba (p. ej. calltheranger) para empezar.'
              : 'Nada en el radar en esta ventana. Amplía el rango o sigue a más curadores.'
            : view === 'novedades'
              ? 'Sin novedades. Se buscan estrenos recientes de tus artistas seguidos en Deezer/Spotify en el refresco: pulsa «Identificar y sincronizar» (o espera al ciclo nocturno). Requiere seguir a algún artista.'
              : view === 'labels'
                ? labels.length === 0
                  ? 'Aún no sigues ningún sello. Busca uno arriba para empezar.'
                  : 'Ningún estreno de tus sellos en esta ventana. Amplía el rango o sigue a más sellos.'
                : view === 'recent'
                ? 'Nada estrenado en esa ventana entre tus artistas. Amplía el rango o sigue a más artistas.'
                : 'Nada anunciado por ahora. Sigue a más artistas o recalcula discografías en «Huecos».'}
        </div>
      ) : (
        <div className="space-y-6">
          {view === 'radar' && radarUpcoming.length > 0 && (
            <div>
              <h2 className="text-sm text-gold-400/80 mb-2">Próximos / pre-pedidos</h2>
              <div className="space-y-1.5">
                {radarUpcoming.map((r) => (
                  <RadarRow
                    key={r.id}
                    r={r}
                    lidarrOn={lidarrOn}
                    onSearch={setSearch}
                    onFollowMbid={api.followMbid}
                    onQueue={() => pollLidarrQueue(setQueue)}
                  />
                ))}
              </div>
            </div>
          )}
          {monthKeys.map((month) => (
            <div key={month}>
              <h2 className="text-sm text-gold-400/80 mb-2 capitalize">{fmtGroup(month)}</h2>
              <div className="space-y-1.5">
                {view === 'radar'
                  ? months[month].map((r) => (
                      <RadarRow
                        key={r.id}
                        r={r}
                        lidarrOn={lidarrOn}
                        onSearch={setSearch}
                        onFollowMbid={api.followMbid}
                        onQueue={() => pollLidarrQueue(setQueue)}
                      />
                    ))
                  : view === 'novedades'
                    ? months[month].map((r) => (
                        <ExternalReleaseRow
                          key={r.id}
                          r={r}
                          added={added}
                          busy={busy}
                          onAdd={addExternal}
                          onSearch={setSearch}
                          onDismiss={dismissExternal}
                        />
                      ))
                    : months[month].map((r) => (
                        <ReleaseRow
                          key={r.rg_mbid}
                          r={r}
                          added={added}
                          busy={busy}
                          followed={followed}
                          onAdd={add}
                          onFollow={follow}
                          onSearch={setSearch}
                          lidarrOn={lidarrOn}
                        />
                      ))}
              </div>
            </div>
          ))}
        </div>
      )}
        </>
      )}

      {search != null && <SearchModal initialQuery={search} onClose={() => setSearch(null)} />}
    </div>
  );
}
