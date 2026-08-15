import { useState, useEffect, useRef, Component } from 'react';
import { Link } from 'react-router-dom';
import { Disc3, ImageOff, Search, X, Download, Check, Copy, Trash2 } from 'lucide-react';
import { api, coverUrl, artistPhotoUrl, fmtBytes } from './api.js';

// ¿Lidarr configurado? La UI oculta sus caminos cuando no lo está (Lidarr es opcional:
// el flujo nativo —buscar/descargar, auto-descarga— es el que manda). Se consulta una
// sola vez y se cachea a nivel de módulo. Devuelve null mientras carga (no decidido).
let _lidarrEnabled;
export function useLidarrEnabled() {
  const [on, setOn] = useState(_lidarrEnabled === undefined ? null : _lidarrEnabled);
  useEffect(() => {
    if (_lidarrEnabled !== undefined) {
      setOn(_lidarrEnabled);
      return;
    }
    api
      .lidarrEnabled()
      .then((r) => {
        _lidarrEnabled = !!r.enabled;
        setOn(_lidarrEnabled);
      })
      .catch(() => {
        _lidarrEnabled = false;
        setOn(false);
      });
  }, []);
  return on;
}

// Red de seguridad: si una página lanza un error al pintar (o falla la carga de
// su código tras una actualización, o una petición revienta), muestra un aviso
// con recargar en vez de dejar TODA la app en blanco. Se remonta al cambiar de
// ruta (key en App), así navegar a otra sección recupera.
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="card p-6 max-w-lg mx-auto mt-10 text-center">
          <p className="text-neutral-200 mb-1">Algo ha fallado en esta sección.</p>
          <p className="text-xs text-neutral-500 mb-4 break-words">{String(this.state.error?.message || this.state.error)}</p>
          <button
            onClick={() => window.location.reload()}
            className="text-sm px-3 py-1.5 rounded-lg border border-gold-500/50 bg-gold-500/15 text-gold-300 hover:bg-gold-500/25"
          >
            Recargar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export function Spinner({ label }) {
  return (
    <div className="flex items-center gap-3 text-ink-700 py-10 justify-center text-neutral-400">
      <Disc3 className="animate-spin" size={20} />
      {label && <span>{label}</span>}
    </div>
  );
}

export function ErrorMsg({ children }) {
  return <div className="card p-4 text-red-300 border-red-900/60 bg-red-950/30">{children}</div>;
}

// El estado de emparejado, con color y sentido. orphan es de primera clase.
const STATE_META = {
  matched: { label: 'identificado', cls: 'bg-emerald-900/50 text-emerald-300 border-emerald-800/60' },
  pending: { label: 'pendiente', cls: 'bg-neutral-800 text-neutral-300 border-neutral-700' },
  unmatched: { label: 'sin identificar', cls: 'bg-amber-900/40 text-amber-300 border-amber-800/60' },
  orphan: { label: 'rareza', cls: 'bg-violet-900/40 text-violet-300 border-violet-800/60' },
  dismissed: { label: 'descartado', cls: 'bg-neutral-900 text-neutral-500 border-neutral-800' },
};
export function StateBadge({ state }) {
  const m = STATE_META[state] || STATE_META.pending;
  return <span className={`text-[11px] px-2 py-0.5 rounded-full border ${m.cls}`}>{m.label}</span>;
}

// La carátula se sirve al instante si está en local/caché; si el backend la está
// resolviendo en 2º plano (fichero/online), la primera carga da 404. Se reintenta con
// backoff (al resolverse aparece sola) y, MIENTRAS, se muestra un placeholder de fondo
// —icono atenuado y pulsante— en vez de un hueco en blanco. Si tras los reintentos no
// hay carátula, el icono queda estático (estado "sin carátula").
const COVER_RETRIES = 3;
export function Cover({ id, size = 'full', className = '', noRetry = false, bust }) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    setAttempt(0);
    setFailed(false);
    setLoaded(false);
    return () => clearTimeout(timer.current);
  }, [id, bust]);

  // noRetry (parrillas grandes, p. ej. Artistas): sin reintentos con ?r=N — cada carátula
  // es una sola petición cacheable; si falta, se muestra el placeholder y punto. Evita la
  // tormenta de reintentos que ralentizaba la lista.
  const onError = () => {
    if (noRetry || attempt >= COVER_RETRIES) {
      setFailed(true);
      return;
    }
    timer.current = setTimeout(() => setAttempt((a) => a + 1), 2500 * (attempt + 1));
  };

  return (
    <div className={`relative bg-ink-850 aspect-square overflow-hidden ${className}`}>
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center text-neutral-700">
          <ImageOff size={size === 'full' ? 32 : 18} className={failed ? '' : 'opacity-30 animate-pulse'} />
        </div>
      )}
      {id && !failed && (
        <img
          src={
            attempt
              ? `${coverUrl(id)}?r=${attempt}${bust ? `&v=${bust}` : ''}`
              : bust
                ? `${coverUrl(id)}?v=${bust}`
                : coverUrl(id)
          }
          onLoad={() => setLoaded(true)}
          onError={onError}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity ${loaded ? 'opacity-100' : 'opacity-0'}`}
          alt=""
        />
      )}
    </div>
  );
}

// Foto de artista (Deezer + manual), circular, con iniciales de respaldo. Sin id, o
// si la imagen falla/no existe, muestra las iniciales. `retry` reintenta una vez tras
// un momento (útil en la ficha del artista, donde la resolución llega en 2º plano).
function artistInitials(name) {
  return String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

export function ArtistPhoto({ id, name, size = 40, className = '', bust, retry = false }) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const timer = useRef(null);
  useEffect(() => {
    setFailed(false);
    setAttempt(0);
    return () => clearTimeout(timer.current);
  }, [id, bust]);

  const onError = () => {
    if (retry && attempt < 2) {
      timer.current = setTimeout(() => setAttempt((a) => a + 1), 2500 * (attempt + 1));
    } else {
      setFailed(true);
    }
  };

  const showImg = id && !failed;
  const q = [attempt ? `r=${attempt}` : '', bust ? `v=${bust}` : ''].filter(Boolean).join('&');
  const src = q ? `${artistPhotoUrl(id)}?${q}` : artistPhotoUrl(id);
  return (
    <div
      className={`shrink-0 rounded-full overflow-hidden bg-ink-800 border border-ink-700 flex items-center justify-center text-neutral-400 ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.32) }}
    >
      {showImg ? (
        <img src={src} onError={onError} className="h-full w-full object-cover" alt="" />
      ) : (
        <span>{artistInitials(name)}</span>
      )}
    </div>
  );
}

// Tarjeta de álbum para las parrillas. `selectable` la pone en modo selección (para
// combinar multidiscos en lote): muestra una marca y, al pinchar, alterna en vez de navegar.
export function AlbumCard({ album, onClick, selectable = false, selected = false, onSelectToggle }) {
  const incomplete = album.track_file_count < album.track_count;
  const body = (
    <>
      <div className={`relative rounded-lg overflow-hidden card ${selected ? 'ring-2 ring-gold-500' : ''}`}>
        <Cover id={album.id} />
        {selectable ? (
          <span
            className={`absolute top-1.5 right-1.5 w-5 h-5 rounded-full border-2 flex items-center justify-center ${
              selected ? 'bg-gold-500 border-gold-500 text-black' : 'bg-black/40 border-white/70 text-transparent'
            }`}
          >
            <Check size={13} />
          </span>
        ) : (
          <>
            {incomplete && (
              <span className="absolute top-1.5 right-1.5 text-[10px] px-1.5 py-0.5 rounded bg-amber-600/90 text-amber-50">
                {album.track_file_count}/{album.track_count}
              </span>
            )}
            {(album.dup || album.match_state === 'orphan') && (
              <div className="absolute top-1.5 left-1.5 flex flex-col items-start gap-1">
                {album.dup && (
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded bg-sky-600/90 text-sky-50"
                    title={`${album.dup.copies} copias de este disco en tu colección`}
                  >
                    ×{album.dup.copies}
                  </span>
                )}
                {album.match_state === 'orphan' && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-600/90 text-violet-50">rareza</span>
                )}
              </div>
            )}
          </>
        )}
        {album.discs > 1 && (
          <span className="absolute bottom-1.5 left-1.5 text-[10px] px-1.5 py-0.5 rounded bg-ink-900/85 text-neutral-200 border border-ink-700">
            {album.discs} discos
          </span>
        )}
      </div>
      <div className="mt-1.5 px-0.5">
        <div className="text-sm truncate group-hover:text-gold-400" title={album.title}>
          {album.title}
        </div>
        <div className="text-xs text-neutral-500 truncate">
          {album.album_artist}
          {album.year ? ` · ${album.year}` : ''}
        </div>
      </div>
    </>
  );
  // modo selección: alterna. Con onClick (desplegar duplicados): botón. Si no: enlace.
  if (selectable) {
    return (
      <button type="button" onClick={onSelectToggle} className="group block w-full text-left">
        {body}
      </button>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className="group block w-full text-left">
        {body}
      </button>
    );
  }
  return (
    <Link to={`/album/${album.id}`} className="group block">
      {body}
    </Link>
  );
}

export function Stat({ label, value, sub }) {
  return (
    <div className="card p-4">
      <div className="text-2xl font-display text-gold-400">{value}</div>
      <div className="text-sm text-neutral-300 mt-0.5">{label}</div>
      {sub && <div className="text-xs text-neutral-500 mt-1">{sub}</div>}
    </div>
  );
}

// Cabecera editorial estilo PowaFlex: antetítulo pequeño en dorado + título grande.
export function PageHeader({ eyebrow, title, action, sub }) {
  return (
    <header className="mb-7">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          {eyebrow && (
            <p className="text-[11px] font-semibold tracking-[0.2em] uppercase text-gold-400/80 mb-1">{eyebrow}</p>
          )}
          <h1 className="font-display text-3xl md:text-4xl text-neutral-100 leading-tight">{title}</h1>
        </div>
        {action}
      </div>
      {sub && <p className="text-sm text-neutral-500 mt-2">{sub}</p>}
    </header>
  );
}

// Sección con título y acción opcional a la derecha.
export function Section({ title, action, children, className = '' }) {
  return (
    <section className={`mb-8 ${className}`}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-medium text-neutral-300">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

// Tarjeta de estadística: número grande en la tipografía de display.
export function StatCard({ label, value, sub }) {
  return (
    <div className="card p-4">
      <div className="font-display text-3xl text-neutral-100 leading-none">{value}</div>
      <div className="text-sm text-neutral-400 mt-2">{label}</div>
      {sub && <div className="text-xs text-neutral-600 mt-1">{sub}</div>}
    </div>
  );
}

export function PageTitle({ icon: Icon, title, sub, children }) {
  return (
    <div className="flex items-start justify-between gap-4 mb-5">
      <div className="flex items-center gap-3">
        {Icon && <Icon className="text-gold-400" size={22} />}
        <div>
          <h1 className="text-xl font-display">{title}</h1>
          {sub && <p className="text-sm text-neutral-500 mt-0.5">{sub}</p>}
        </div>
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}

// Barra de completismo: cuánto tienes de lo que MusicBrainz conoce.
export function ProgressBar({ pct, label }) {
  if (pct == null)
    return <div className="text-xs text-neutral-600">{label || 'Sin datos de MusicBrainz'}</div>;
  const color = pct >= 90 ? 'bg-emerald-500' : pct >= 50 ? 'bg-gold-400' : 'bg-amber-500';
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-neutral-400">{label || 'Completismo (estudio)'}</span>
        <span className="text-neutral-300">{pct}%</span>
      </div>
      <div className="h-2 rounded-full bg-ink-800 overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function Button({ children, onClick, variant = 'default', disabled, className = '' }) {
  const base = 'text-sm px-3 py-1.5 rounded-lg border transition disabled:opacity-40 disabled:cursor-not-allowed';
  const styles = {
    default: 'border-ink-700 bg-ink-850 hover:bg-ink-800',
    gold: 'border-gold-500/50 bg-gold-500/15 text-gold-300 hover:bg-gold-500/25',
    ghost: 'border-transparent hover:bg-ink-850',
  };
  return (
    <button onClick={onClick} disabled={disabled} className={`${base} ${styles[variant]} ${className}`}>
      {children}
    </button>
  );
}

// Búsqueda manual en Prowlarr (modal reutilizable). Para pedir un disco que FALTA
// desde donde sea (huecos, discografía de artista, completismo de sello): busca en
// todos los indexers por texto y descarga la release que elijas. Es la alternativa
// a "enviar a Lidarr": o lo delegas en Lidarr, o lo buscas y descargas tú al momento.
export function SearchModal({ initialQuery, onClose }) {
  const [q, setQ] = useState(initialQuery || '');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [grabbing, setGrabbing] = useState(null);
  const [grabbed, setGrabbed] = useState({});
  const [msg, setMsg] = useState(null);
  const [engine, setEngine] = useState(null);

  const search = async () => {
    if (!q.trim()) return;
    setLoading(true);
    setErr(null);
    setMsg(null);
    setResults(null);
    try {
      const r = await api.search(q);
      setEngine(r.engine);
      setResults(r.results);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    search();
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const grab = async (r) => {
    setGrabbing(r.guid);
    setErr(null);
    try {
      const res = await api.searchGrab({
        engine,
        guid: r.guid,
        indexerId: r.indexerId,
        downloadUrl: r.downloadUrl,
        context: { release_title: r.title || null },
      });
      setGrabbed((p) => ({ ...p, [r.guid]: true }));
      setMsg(res?.via === 'qbittorrent' ? 'Enviado a qBittorrent.' : 'Enviado a tu cliente de descarga.');
    } catch (e) {
      setErr(e.message);
    } finally {
      setGrabbing(null);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-black/60" onClick={onClose}>
      <div className="card p-4 w-full max-w-2xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 mb-1">
          <h2 className="text-sm text-neutral-300 flex items-center gap-2">
            <Search size={15} /> Buscar y descargar
            {engine && (
              <span className="text-xs text-neutral-500">
                ({engine === 'jackett' ? 'Jackett → qBittorrent' : 'Prowlarr'})
              </span>
            )}
          </h2>
          <button onClick={onClose} className="text-neutral-500 hover:text-neutral-200 shrink-0" aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>
        <div className="flex gap-2 mt-2">
          <input
            className="flex-1 bg-ink-850 border border-ink-800 rounded px-2 py-1.5 text-sm outline-none focus:border-gold-500/60"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search()}
            placeholder="Artista y álbum…"
          />
          <Button variant="gold" onClick={search} disabled={loading}>
            <span className="inline-flex items-center gap-1.5">
              <Search size={14} /> {loading ? 'Buscando…' : 'Buscar'}
            </span>
          </Button>
        </div>
        {msg && <p className="text-sm text-emerald-400 mt-3">{msg}</p>}
        {err && <p className="text-sm text-red-400 mt-3">{err}</p>}
        {results && results.length === 0 && !loading && (
          <p className="text-sm text-neutral-600 mt-3">Sin resultados en tus indexers.</p>
        )}
        {results && results.length > 0 && (
          <div className="mt-3 divide-y divide-ink-850/60">
            {results.map((r) => (
              <div key={`${r.indexerId}:${r.guid}`} className="py-2 flex items-start gap-3 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="truncate" title={r.title}>
                    {r.title}
                  </div>
                  <div className="text-xs text-neutral-600 flex flex-wrap gap-x-2 mt-0.5">
                    <span className="text-neutral-400">{r.indexer}</span>
                    <span>{fmtBytes(r.size)}</span>
                    {r.seeders != null && (
                      <span className={r.seeders > 0 ? 'text-emerald-400/70' : 'text-red-400/70'}>{r.seeders} seeders</span>
                    )}
                    {r.protocol && <span>{r.protocol}</span>}
                    {r.freeleech && <span className="text-emerald-400" title="No cuenta para el ratio">freeleech</span>}
                  </div>
                </div>
                {grabbed[r.guid] ? (
                  <span className="text-emerald-400 text-xs inline-flex items-center gap-1 shrink-0 self-center">
                    <Check size={14} /> enviado
                  </span>
                ) : (
                  <Button variant="gold" disabled={grabbing === r.guid} onClick={() => grab(r)}>
                    <span className="inline-flex items-center gap-1.5">
                      <Download size={14} /> {grabbing === r.guid ? '…' : 'Descargar'}
                    </span>
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Panel (modal) de UN grupo de duplicados: se abre al pinchar la carátula con ×N (en
// la página de artista o en la Discoteca). Recomienda la copia ★ mejor y deja
// descartar/deshacer las demás. Descartar solo oculta y quita de los recuentos:
// nunca borra el fichero (música en solo lectura).
export function DuplicateGroupPanel({ group, onClose }) {
  const [busy, setBusy] = useState(null);
  const [dismissed, setDismissed] = useState({}); // id -> true (descartados esta sesión)
  const [deleted, setDeleted] = useState({}); // id -> true (borrados del disco, sin vuelta atrás)

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const dismiss = async (id) => {
    setBusy(id);
    try {
      await api.albumState(id, 'dismissed');
      setDismissed((p) => ({ ...p, [id]: true }));
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(null);
    }
  };
  const undo = async (id) => {
    setBusy(id);
    try {
      await api.restoreAlbum(id);
      setDismissed((p) => {
        const n = { ...p };
        delete n[id];
        return n;
      });
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(null);
    }
  };
  // Borrado de disco: IRREVERSIBLE. Confirmación dura con la ruta y el aviso de seeding.
  const del = async (c) => {
    const ok = window.confirm(
      `BORRAR DEL DISCO de forma permanente:\n\n${c.title}${c.year ? ` (${c.year})` : ''}\n${c.path || ''}\n\n` +
        'Se eliminan los ficheros de tu biblioteca. Es IRREVERSIBLE (no va a la Papelera) y, si esa copia está ' +
        'seedeando en qBittorrent, puede romper el torrent.\n\n¿Borrar de verdad?'
    );
    if (!ok) return;
    setBusy(c.id);
    try {
      await api.deleteAlbum(c.id);
      setDeleted((p) => ({ ...p, [c.id]: true }));
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-black/60" onClick={onClose}>
      <div className="card p-4 w-full max-w-2xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-1">
          <h2 className="text-sm text-neutral-300 flex items-center gap-2">
            <Copy size={15} className="text-sky-400" /> {group.title}
            <span className="text-neutral-600">· {group.copies.length} copias</span>
          </h2>
          <button onClick={onClose} className="text-neutral-500 hover:text-neutral-200 shrink-0" aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>
        <p className="text-xs text-neutral-600 mb-3">
          La copia <span className="text-emerald-400/90">★ mejor</span> es la más completa y de mejor calidad. «Descartar»
          oculta una copia y la saca de los recuentos — <b className="font-normal text-neutral-500">no borra el fichero</b>
          {' '}(puedes deshacerlo aquí o desde la Papelera). «Descartar y borrar» sí{' '}
          <b className="font-normal text-red-400/90">elimina los ficheros del disco</b>: es irreversible, no va a la Papelera
          y, si esa copia está seedeando, puede romper el torrent.
        </p>
        <div className="space-y-1.5">
          {group.copies.map((c) => (
            <div
              key={c.id}
              className={`flex items-start gap-3 text-sm rounded px-2 py-1.5 ${
                c.best ? 'bg-emerald-950/20 border border-emerald-900/40' : 'bg-ink-850/40'
              } ${dismissed[c.id] ? 'opacity-45' : ''}`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {c.best && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-600/90 text-emerald-50 shrink-0">
                      ★ mejor
                    </span>
                  )}
                  <Link to={`/album/${c.id}`} className="truncate hover:text-gold-400">
                    {c.title}
                    {c.year ? <span className="text-neutral-600"> · {c.year}</span> : ''}
                  </Link>
                </div>
                <div className="text-xs text-neutral-600 flex flex-wrap gap-x-2 mt-0.5">
                  {c.format && (
                    <span className={c.lossless ? 'text-emerald-400/80' : ''}>
                      {c.format}
                      {c.lossless ? ' · lossless' : ''}
                    </span>
                  )}
                  <span className={c.track_file_count < c.track_count ? 'text-amber-400/80' : ''}>
                    {c.track_file_count}/{c.track_count} pistas
                  </span>
                  <span>{fmtBytes(c.size_bytes)}</span>
                  {!c.matched && <span className="text-neutral-500">sin identificar</span>}
                </div>
                <div className="text-[11px] text-neutral-700 truncate mt-0.5" title={c.path}>
                  {c.path}
                </div>
              </div>
              {deleted[c.id] ? (
                <span className="text-xs text-red-400/80 inline-flex items-center gap-1 shrink-0 self-center">
                  <Trash2 size={13} /> borrado del disco
                </span>
              ) : dismissed[c.id] ? (
                <span className="text-xs text-neutral-500 inline-flex items-center gap-2 shrink-0 self-center">
                  descartado
                  <button
                    onClick={() => undo(c.id)}
                    disabled={busy === c.id}
                    className="underline hover:text-gold-400 disabled:opacity-50"
                  >
                    deshacer
                  </button>
                </span>
              ) : (
                !c.best && (
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <Button variant="default" disabled={busy === c.id} onClick={() => dismiss(c.id)}>
                      <span className="inline-flex items-center gap-1.5">
                        <X size={13} /> {busy === c.id ? '…' : 'Descartar'}
                      </span>
                    </Button>
                    <button
                      onClick={() => del(c)}
                      disabled={busy === c.id}
                      title="Elimina los ficheros del disco (irreversible)"
                      className="text-[11px] px-2 py-1 rounded border border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20 disabled:opacity-50 inline-flex items-center gap-1"
                    >
                      <Trash2 size={12} /> Descartar y borrar
                    </button>
                  </div>
                )
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
