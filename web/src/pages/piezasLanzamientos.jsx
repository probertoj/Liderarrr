import { useEffect, useRef, useState } from 'react';
import { CalendarClock, Plus, Check, Loader2, ExternalLink, Search, Star, Tag, X, RefreshCw, Radio, Heart, ChevronDown, ChevronRight } from 'lucide-react';
import { api } from '../api.js';
import { Spinner, ErrorMsg, AddToChallengeButton } from '../components.jsx';
import { aviso } from '../avisos.jsx';

// Piezas de Lanzamientos que se usan desde más de un sitio: el gestor de sellos y el de
// curadores (panel «Fuentes») y la lista de deseos (página «Lo quiero»). Vivían dentro de la
// antigua pantalla de nueve pestañas (Calendar.jsx), que ya no existe.

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const thisYearStart = () => `${new Date().getFullYear()}-01-01`;

export function LabelManager({ labels, onChange }) {
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
      aviso(e2.message, 'error');
    } finally {
      setBusy(null);
    }
  };
  const unfollow = async (mbid) => {
    setBusy(mbid);
    try {
      await api.unfollowLabel(mbid);
      await onChange();
    } catch (e) {
      aviso(`No se pudo dejar de seguir el sello: ${e.message}`, 'error');
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
      aviso(e2.message, 'error');
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
              <button onClick={() => refresh(l.label_mbid)} disabled={busy === l.label_mbid} aria-label={`Actualizar el catálogo de ${l.name || 'este sello'}`} className="p-1 -m-1 hover:text-gold-400 disabled:opacity-50" title="Actualizar catálogo">
                {busy === l.label_mbid ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
              </button>
              <button
                onClick={() => unfollow(l.label_mbid)}
                disabled={busy === l.label_mbid}
                className="p-1 -m-1 hover:text-red-400 disabled:opacity-50"
                title="Dejar de seguir"
                aria-label={`Dejar de seguir ${l.name || 'este sello'}`}
              >
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

export function CuratorManager({ curators, onChange }) {
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
      aviso(e2.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id) => {
    setBusy(true);
    try {
      await api.unfollowCurator(id);
      await onChange();
    } catch (e) {
      aviso(`No se pudo quitar el curador: ${e.message}`, 'error');
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
              <button
                onClick={() => refresh(c.id)}
                disabled={busy}
                className="p-1 -m-1 hover:text-gold-400 disabled:opacity-50"
                title="Actualizar"
                aria-label={`Actualizar ${c.name || c.username}`}
              >
                <RefreshCw size={11} />
              </button>
              <button
                onClick={() => remove(c.id)}
                disabled={busy}
                className="p-1 -m-1 hover:text-red-400 disabled:opacity-50"
                title="Dejar de seguir"
                aria-label={`Dejar de seguir a ${c.name || c.username}`}
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// «Ya los tienes en disco», plegable y CERRADO por defecto. Criterio común a todas las
// listas de Lanzamientos: lo que ya está en tu disco no es noticia —la sección existe para
// enseñarte lo que te FALTA—, pero tampoco se esconde del todo: queda arriba, contado y a un
// clic, por si quieres comprobar que un estreno ya entró. El estado abierto/cerrado se
// recuerda entre pestañas y entre visitas (localStorage), como los filtros del calendario.


// Pestaña «Lo quiero»: la lista de deseos vigilada. Aquí ves qué está esperando Liderarr,
// por qué aún no lo ha pillado (no ha salido, sin release, ya pedido…) y puedes forzar un
// barrido. El trabajo de verdad lo hace el temporizador del servidor cada hora.
export function WantedPanel({ onSearch }) {
  const [data, setData] = useState(null);
  // Más de la mitad de la lista eran discos que YA tienes (el deseo cumplido se queda como
  // historial): van plegados, para que lo que se ve sea lo que aún se está buscando.
  const [verTuyos, setVerTuyos] = useState(false);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const poll = useRef(null);
  const load = () => api.wanted().then(setData).catch((e) => setErr(e.message));
  useEffect(() => {
    load();
    return () => clearInterval(poll.current);
  }, []);

  const buscarAhora = async () => {
    setBusy(true);
    try {
      await api.wantedRun();
    } catch (e) {
      setErr(e.message);
      setBusy(false);
      return;
    }
    clearInterval(poll.current);
    poll.current = setInterval(async () => {
      let d;
      try {
        d = await api.wanted();
      } catch {
        return;
      }
      setData(d);
      if (!d.status?.running) {
        clearInterval(poll.current);
        setBusy(false);
      }
    }, 2500);
  };

  const quitar = async (w) => {
    try {
      await api.unwantAlbum({ id: w.id });
      load();
    } catch (e) {
      aviso(e.message, 'error');
    }
  };

  if (err) return <ErrorMsg>{err}</ErrorMsg>;
  if (!data) return <Spinner />;
  const { items: todos, counts, status } = data;
  const cumplidos = todos.filter((w) => w.status === 'owned').length;
  const items = verTuyos ? todos : todos.filter((w) => w.status !== 'owned');

  return (
    <div>
      <div className="card p-3 mb-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs text-neutral-500 min-w-0 flex-1">
            Los discos que marcas con <span className="text-rose-300">♥ Lo quiero</span> quedan vigilados: cada hora (y
            en el refresco nocturno) Liderarr los busca en tus indexers y agarra la mejor release en cuanto aparece. Un
            estreno del viernes se empieza a vigilar el jueves por la mañana, que es cuando suele aparecer. Tú te enteras
            por la notificación.
            {!data.enabled && <span className="text-amber-400/90"> · La vigilancia está desactivada en Ajustes.</span>}
          </p>
          <button
            onClick={buscarAhora}
            disabled={busy || !items.length}
            className="text-xs px-2.5 py-1.5 rounded-lg border border-gold-500/40 bg-gold-500/10 text-gold-300 hover:bg-gold-500/20 inline-flex items-center gap-1.5 disabled:opacity-60 shrink-0"
          >
            <RefreshCw size={13} className={busy ? 'animate-spin' : ''} /> {busy ? 'Buscando…' : 'Buscar ahora'}
          </button>
        </div>
        <p className="text-xs text-neutral-600 mt-2">
          {counts.watching} vigilando · {counts.grabbed} pedidos · {counts.owned} ya en tu disco
          {status?.lastRun ? ` · último barrido ${new Date(status.lastRun).toLocaleString('es')}` : ''}
        </p>
        {busy && status?.log?.length > 0 && (
          <div className="text-[11px] text-neutral-500 mt-2 max-h-32 overflow-y-auto space-y-0.5">
            {status.log.map((l, i) => (
              <div key={i} className="truncate" title={l}>
                {l}
              </div>
            ))}
          </div>
        )}
      </div>

      {cumplidos > 0 && (
        <button
          type="button"
          onClick={() => setVerTuyos((v) => !v)}
          aria-pressed={verTuyos}
          className="mb-3 text-xs px-2.5 py-1 rounded-lg border border-ink-800 text-neutral-400 hover:bg-ink-850"
        >
          {verTuyos ? 'Ocultar' : 'Ver'} los {cumplidos} que ya están en tu disco
        </button>
      )}
      {todos.length === 0 ? (
        <div className="card p-6 text-center text-neutral-400">
          Tu lista está vacía. Pulsa <span className="text-rose-300">♥ Lo quiero</span> en cualquier disco —al buscarlo,
          en el calendario, en el radar o en la brecha de streaming— y aparecerá aquí, vigilado hasta que se pueda
          descargar.
        </div>
      ) : (
        <div className="space-y-1.5">
          {items.map((w) => (
            <div key={w.id} className="card px-3 py-2 release-row text-sm">
              <div className="release-main">
                <img
                  src={w.cover || ''}
                  alt=""
                  loading="lazy"
                  onError={(e) => {
                    e.currentTarget.style.visibility = 'hidden';
                  }}
                  className="w-10 h-10 rounded object-cover bg-ink-850 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate clamp-mobile" title={`${w.artist} — ${w.title}`}>
                    {w.artist}
                    <span className="text-neutral-500"> — {w.title}</span>
                  </div>
                  <div className="text-xs text-neutral-600 flex items-center gap-2 flex-wrap">
                    {w.status === 'owned' ? (
                      <span className="text-emerald-400/80">✓ ya está en tu disco</span>
                    ) : w.status === 'grabbed' ? (
                      <span className="text-emerald-400/80">✓ {w.pending}</span>
                    ) : (
                      <span>{w.pending}</span>
                    )}
                    {w.tries > 0 && w.status === 'watching' && <span className="text-neutral-500">{w.tries} intentos</span>}
                    {w.origin && <span className="text-neutral-500">desde {w.origin}</span>}
                  </div>
                </div>
              </div>
              <div className="release-actions">
                <button
                  onClick={() => onSearch(`${w.artist} ${w.title}`)}
                  className="text-xs px-1.5 py-0.5 rounded border border-ink-700 bg-ink-850 hover:bg-ink-800 inline-flex items-center gap-1"
                >
                  <Search size={12} /> Buscar
                </button>
                <AddToChallengeButton artist={w.artist} title={w.title} />
                <button onClick={() => quitar(w)} className="text-neutral-600 hover:text-rose-400" title="Quitar de «Lo quiero»">
                  <X size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

