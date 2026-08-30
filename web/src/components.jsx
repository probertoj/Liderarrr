import { useState, useEffect, useRef, Component } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Disc3, ImageOff, Search, X, Download, Check, Copy, Trash2, Trophy, Star, User, Loader2, ExternalLink } from 'lucide-react';
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

// El estado de emparejado, con color y sentido. orphan y bootleg son de primera clase.
const STATE_META = {
  matched: { label: 'identificado', cls: 'bg-emerald-900/50 text-emerald-300 border-emerald-800/60' },
  pending: { label: 'pendiente', cls: 'bg-neutral-800 text-neutral-300 border-neutral-700' },
  unmatched: { label: 'sin identificar', cls: 'bg-amber-900/40 text-amber-300 border-amber-800/60' },
  orphan: { label: 'rareza', cls: 'bg-violet-900/40 text-violet-300 border-violet-800/60' },
  bootleg: { label: 'bootleg', cls: 'bg-rose-900/40 text-rose-300 border-rose-800/60' },
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
  const [inView, setInView] = useState(false);
  const timer = useRef(null);
  const boxRef = useRef(null);

  useEffect(() => {
    setAttempt(0);
    setFailed(false);
    setLoaded(false);
    return () => clearTimeout(timer.current);
  }, [id, bust]);

  // LAZY FIABLE con IntersectionObserver: la imagen solo se pide cuando el hueco entra (o
  // ya está) en el viewport. Se re-observa en CADA montaje, así que al volver a la
  // Discoteca (botón atrás incluido) las carátulas visibles vuelven a cargar — a diferencia
  // de loading="lazy", que a veces no se disparaba. Y no se piden las ~470 fuera de pantalla,
  // que es lo que saturaba y ralentizaba la navegación.
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    // ¿ya visible (o casi) al montar? getBoundingClientRect es fiable en el acto —incluso
    // cuando el observer tarda en disparar—, así lo que se ve al volver atrás carga ya.
    const near = () => {
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight || document.documentElement.clientHeight || 0;
      const vw = window.innerWidth || document.documentElement.clientWidth || 0;
      return r.top < vh + 300 && r.bottom > -300 && r.left < vw + 300 && r.right > -300;
    };
    if (near()) {
      setInView(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          obs.disconnect();
        }
      },
      { rootMargin: '300px' }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [id]);

  // Reintentos para las carátulas que aún se están resolviendo online (404 = "pendiente").
  // noRetry (parrillas muy grandes, p. ej. Artistas): sin reintentos, placeholder y punto.
  const onError = () => {
    if (noRetry || attempt >= COVER_RETRIES) {
      setFailed(true);
      return;
    }
    timer.current = setTimeout(() => setAttempt((a) => a + 1), 1200 * (attempt + 1));
  };

  return (
    <div ref={boxRef} className={`relative bg-ink-850 aspect-square overflow-hidden ${className}`}>
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center text-neutral-700">
          <ImageOff size={size === 'full' ? 32 : 18} className={failed ? '' : 'opacity-30 animate-pulse'} />
        </div>
      )}
      {id && inView && !failed && (
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
        <img src={src} onError={onError} className="h-full w-full object-cover" alt="" loading="lazy" />
      ) : (
        <span>{artistInitials(name)}</span>
      )}
    </div>
  );
}

// Tarjeta de álbum para las parrillas.
// - `selectable`: modo selección (combinar multidiscos en lote); toda la tarjeta alterna.
// - La CARÁTULA y el TÍTULO llevan a la ficha del disco. El nombre del ARTISTA a su ficha.
// - Si el disco tiene varias copias, se pasa `onClick`: la insignia ×N es un botón que abre
//   el panel de copias (borrado rápido); el resto de la tarjeta sigue yendo a la ficha.
export function AlbumCard({ album, onClick, selectable = false, selected = false, onSelectToggle }) {
  const incomplete = album.track_file_count < album.track_count;
  const [menu, setMenu] = useState(null); // menú contextual (clic derecho) → añadir a reto
  const coverInner = (
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
          {(album.dup || album.match_state === 'orphan' || album.match_state === 'bootleg') && (
            <div className="absolute top-1.5 left-1.5 flex flex-col items-start gap-1">
              {album.dup &&
                (onClick ? (
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onClick();
                    }}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-sky-600/90 hover:bg-sky-500 text-sky-50 cursor-pointer"
                    title={`${album.dup.copies} copias — pincha para ver y limpiar las copias`}
                  >
                    ×{album.dup.copies}
                  </button>
                ) : (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-600/90 text-sky-50">×{album.dup.copies}</span>
                ))}
              {album.match_state === 'orphan' && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-600/90 text-violet-50">rareza</span>
              )}
              {album.match_state === 'bootleg' && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-600/90 text-rose-50">bootleg</span>
              )}
            </div>
          )}
          {/* «Añadir a reto» visible al pasar el ratón (además del clic derecho en la tarjeta) */}
          <div className="absolute bottom-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <AddToChallengeButton
              artist={album.album_artist}
              title={album.title}
              label=""
              className="p-1 rounded bg-ink-900/85 border border-ink-700 text-neutral-200 hover:text-gold-400 hover:border-gold-500/40 inline-flex items-center"
            />
          </div>
        </>
      )}
      {album.discs > 1 && (
        <span className="absolute bottom-1.5 left-1.5 text-[10px] px-1.5 py-0.5 rounded bg-ink-900/85 text-neutral-200 border border-ink-700">
          {album.discs} discos
        </span>
      )}
    </div>
  );

  // modo selección: toda la tarjeta alterna.
  if (selectable) {
    return (
      <button type="button" onClick={onSelectToggle} className="group block w-full text-left">
        {coverInner}
        <div className="mt-1.5 px-0.5">
          <div className="text-sm truncate" title={album.title}>
            {album.title}
          </div>
          <div className="text-xs text-neutral-500 truncate">
            {album.album_artist}
            {album.year ? ` · ${album.year}` : ''}
          </div>
        </div>
      </button>
    );
  }

  return (
    <div
      className="group block"
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      <Link to={`/album/${album.id}`} className="block">
        {coverInner}
      </Link>
      <div className="mt-1.5 px-0.5">
        <Link to={`/album/${album.id}`} className="text-sm truncate block hover:text-gold-400" title={album.title}>
          {album.title}
        </Link>
        <div className="text-xs text-neutral-500 truncate">
          {album.artist_id ? (
            <Link to={`/artista/${album.artist_id}`} className="hover:text-gold-400">
              {album.album_artist}
            </Link>
          ) : (
            <span>{album.album_artist}</span>
          )}
          {album.year ? ` · ${album.year}` : ''}
        </div>
      </div>
      {menu && (
        <ChallengeContextMenu
          x={menu.x}
          y={menu.y}
          artist={album.album_artist}
          title={album.title}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

// Botón compacto «Reto» que abre el menú de retos anclado donde pulsas. Para tener el mismo
// «Añadir a reto» EN TODAS PARTES donde aparece un disco (Lanzamientos, calendario, etc.),
// no solo en la ficha y el clic derecho de la Discoteca. Reutiliza ChallengeContextMenu.
export function AddToChallengeButton({ artist, title, label = 'Reto', className }) {
  const [menu, setMenu] = useState(null);
  return (
    <>
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
        title={`Añadir «${title}» a un reto`}
        className={
          className ||
          'text-xs px-1.5 py-0.5 rounded border border-ink-700 bg-ink-850 hover:bg-ink-800 inline-flex items-center gap-1'
        }
      >
        <Trophy size={12} /> {label}
      </button>
      {menu && (
        <ChallengeContextMenu x={menu.x} y={menu.y} artist={artist} title={title} onClose={() => setMenu(null)} />
      )}
    </>
  );
}

// Menú contextual (clic derecho en una tarjeta) para añadir el disco a un reto. Anclado en
// el cursor, con un fondo invisible que lo cierra. Carga tus retos al abrir y añade
// «Artista - Álbum» al que elijas (el servidor deduplica y avisa si ya estaba).
export function ChallengeContextMenu({ x, y, artist, title, onClose }) {
  const [list, setList] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.challenges().then(setList).catch(() => setList([]));
  }, []);
  const add = async (ch) => {
    setBusy(true);
    try {
      const r = await api.addChallengeItems(ch.id, `${artist} - ${title}`);
      setMsg(r.added > 0 ? `Añadido a «${ch.name}»` : `Ya estaba en «${ch.name}»`);
      setTimeout(onClose, 1000);
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  };
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1000;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const left = Math.min(x, vw - 236);
  const top = Math.min(y, vh - 300);
  return (
    <>
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div className="fixed z-50 w-56 card p-1 shadow-xl border border-ink-700 max-h-72 overflow-y-auto" style={{ left, top }}>
        <div className="px-2.5 py-1.5 text-[11px] uppercase tracking-wide text-neutral-600 truncate">
          Añadir a reto · {title}
        </div>
        {list === null ? (
          <div className="px-2.5 py-2 text-sm text-neutral-500">Cargando…</div>
        ) : msg ? (
          <div className="px-2.5 py-2 text-sm text-emerald-400">{msg}</div>
        ) : list.length === 0 ? (
          <div className="px-2.5 py-2 text-sm text-neutral-500">
            No tienes retos.{' '}
            <Link to="/retos" className="text-gold-400 hover:underline">
              Crear uno →
            </Link>
          </div>
        ) : (
          list.map((ch) => (
            <button
              key={ch.id}
              onClick={() => add(ch)}
              disabled={busy}
              className="w-full text-left px-2.5 py-1.5 rounded text-sm text-neutral-300 hover:bg-ink-800 inline-flex items-center gap-2 disabled:opacity-50"
            >
              <Trophy size={13} className="text-neutral-500 shrink-0" />
              <span className="truncate">{ch.name}</span>
              <span className="text-xs text-neutral-600 ml-auto shrink-0">{ch.item_count}</span>
            </button>
          ))
        )}
      </div>
    </>
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
  const [broadened, setBroadened] = useState(null); // consulta que sí dio resultados si se amplió

  const search = async () => {
    if (!q.trim()) return;
    setLoading(true);
    setErr(null);
    setMsg(null);
    setResults(null);
    setBroadened(null);
    try {
      const r = await api.search(q);
      setEngine(r.engine);
      setResults(r.results);
      // el servidor amplía la búsqueda (suelta el artista) si la cadena entera no da nada
      if (r.query && r.query.trim() !== q.trim() && r.results?.length) setBroadened(r.query);
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
        {broadened && (
          <p className="text-xs text-neutral-500 mt-3">
            Sin resultados para la búsqueda completa; mostrando los de <span className="text-neutral-300">«{broadened}»</span>.
          </p>
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
// Lista de copias de un disco con acciones (descartar / descartar y borrar). Reutilizable:
// en el panel modal (al pinchar la insignia ×N en las parrillas) y como sección dentro de
// la propia ficha del álbum. `onChange` avisa al contenedor tras una acción (para recargar).
export function DuplicateCopies({ copies, onChange, reason, pinned }) {
  const [busy, setBusy] = useState(null);
  const [dismissed, setDismissed] = useState({}); // id -> true (descartados esta sesión)
  const [deleted, setDeleted] = useState({}); // id -> true (borrados del disco, sin vuelta atrás)

  // Marca a mano una copia como la mejor (o vuelve a la automática). Recarga al terminar.
  const prefer = async (id, clear = false) => {
    setBusy(id ?? 'auto');
    try {
      await (clear ? api.preferCopyAuto(id) : api.preferCopy(id));
      onChange?.();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(null);
    }
  };

  // Una copia puede ser una CAJA (varios discos): las acciones aplican a TODOS sus miembros.
  const idsOf = (c) => (c.member_ids && c.member_ids.length ? c.member_ids : [c.id]);

  const dismiss = async (c) => {
    setBusy(c.id);
    try {
      for (const id of idsOf(c)) await api.albumState(id, 'dismissed');
      setDismissed((p) => ({ ...p, [c.id]: true }));
      onChange?.();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(null);
    }
  };
  const undo = async (c) => {
    setBusy(c.id);
    try {
      for (const id of idsOf(c)) await api.restoreAlbum(id);
      setDismissed((p) => {
        const n = { ...p };
        delete n[c.id];
        return n;
      });
      onChange?.();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(null);
    }
  };
  // Borrado de disco: IRREVERSIBLE. Confirmación dura con la ruta y el aviso de seeding.
  const del = async (c) => {
    const ids = idsOf(c);
    const ok = window.confirm(
      `BORRAR DEL DISCO de forma permanente:\n\n${c.title}${c.year ? ` (${c.year})` : ''}` +
        `${ids.length > 1 ? `\n(${ids.length} discos de la caja)` : ''}\n${c.path || ''}\n\n` +
        'Se eliminan los ficheros de tu biblioteca. Es IRREVERSIBLE (no va a la Papelera) y, si esa copia está ' +
        'seedeando en qBittorrent, puede romper el torrent.\n\n¿Borrar de verdad?'
    );
    if (!ok) return;
    setBusy(c.id);
    try {
      for (const id of ids) await api.deleteAlbum(id);
      setDeleted((p) => ({ ...p, [c.id]: true }));
      onChange?.();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(null);
    }
  };

  const bestId = copies.find((c) => c.best)?.id;

  return (
    <div className="space-y-1.5">
      {reason && (
        <p className="text-xs text-neutral-500">
          <span className="text-emerald-400/90">★ mejor</span>: {reason}
          {pinned && bestId != null && (
            <button
              onClick={() => prefer(bestId, true)}
              disabled={busy != null}
              className="ml-2 underline hover:text-gold-400 disabled:opacity-50"
            >
              usar la automática
            </button>
          )}
        </p>
      )}
      {copies.map((c) => (
        <div
          key={c.id}
          className={`flex items-start gap-3 text-sm rounded px-2 py-1.5 ${
            c.best ? 'bg-emerald-950/20 border border-emerald-900/40' : 'bg-ink-850/40'
          } ${dismissed[c.id] ? 'opacity-45' : ''}`}
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {c.best && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-600/90 text-emerald-50 shrink-0">★ mejor</span>
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
              {c.discs > 0 && <span className="text-sky-400/80">caja de {c.discs} discos</span>}
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
              <button onClick={() => undo(c)} disabled={busy === c.id} className="underline hover:text-gold-400 disabled:opacity-50">
                deshacer
              </button>
            </span>
          ) : (
            !c.best && (
              <div className="flex flex-col items-end gap-1 shrink-0">
                {!c.discs && (
                  <button
                    onClick={() => prefer(c.id)}
                    disabled={busy != null}
                    title="Marcar esta copia como la mejor (se conserva y las demás se pueden descartar)"
                    className="text-[11px] px-2 py-1 rounded border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50 inline-flex items-center gap-1"
                  >
                    <Star size={12} /> Marcar como la mejor
                  </button>
                )}
                <Button variant="default" disabled={busy === c.id} onClick={() => dismiss(c)}>
                  <span className="inline-flex items-center gap-1.5">
                    <X size={13} /> {busy === c.id ? '…' : c.discs ? 'Descartar caja' : 'Descartar'}
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
  );
}

export function DuplicateGroupPanel({ group, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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
        <DuplicateCopies copies={group.copies} reason={group.bestReason} pinned={group.pinned} />
      </div>
    </div>
  );
}

// Enlace a MusicBrainz para desambiguar resultados externos (hay muchos «Beef» o «La Bohème»
// distintos; el MBID te dice cuál es cuál). stopPropagation por si va dentro de una fila.
const MbLink = ({ url }) => (
  <a
    href={url}
    target="_blank"
    rel="noreferrer"
    onClick={(e) => e.stopPropagation()}
    className="text-[11px] text-neutral-600 hover:text-gold-400 inline-flex items-center gap-0.5 shrink-0"
    title="Ver en MusicBrainz"
  >
    MB <ExternalLink size={10} />
  </a>
);

// Buscador rápido: el punto de entrada de la app. Busca al instante en tu colección
// (artista/disco → su ficha) y, debajo, fuera de ella en MusicBrainz (seguir artista /
// descargar disco). La app va de lo que tienes y, sobre todo, de lo que aún no tienes. Se
// usa en el Dashboard y, para tenerlo siempre a mano, en Huecos, Lanzamientos, Escuchas,
// Resumen y Retos.
export function QuickSearch() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [local, setLocal] = useState(null);
  const [ext, setExt] = useState(null);
  const [extLoading, setExtLoading] = useState(false);
  const [busy, setBusy] = useState(null);
  const [search, setSearch] = useState(null);

  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setLocal(null);
      setExt(null);
      return;
    }
    const t1 = setTimeout(() => api.findLocal(term).then(setLocal).catch(() => {}), 180);
    setExtLoading(true);
    setExt(null);
    const t2 = setTimeout(
      () =>
        api
          .findExternal(term)
          .then(setExt)
          .catch(() => setExt(null))
          .finally(() => setExtLoading(false)),
      550
    );
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [q]);

  const follow = async (a) => {
    setBusy(a.mbid);
    try {
      const r = await api.followMbid(a.mbid, 'artist');
      setQ('');
      navigate(`/artista/${r.artist_id}`);
    } catch (e) {
      alert(e.message);
      setBusy(null);
    }
  };

  const close = () => setQ('');
  const localHas = local && (local.artists.length || local.albums.length);
  const extArtistsNew = ext?.artists?.filter((a) => !a.artist_id) || [];
  const extArtistsOwned = ext?.artists?.filter((a) => a.artist_id) || [];
  const open = q.trim() && (local || ext || extLoading);

  return (
    <div className="relative mb-6">
      <div className="flex items-center gap-2 bg-ink-850 border border-ink-800 rounded-xl px-3 focus-within:border-gold-500/50">
        <Search size={18} className="text-neutral-500 shrink-0" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setQ('')}
          placeholder="Buscar un disco o un artista… (los tuyos y los que aún no tienes)"
          className="flex-1 bg-transparent py-2.5 outline-none text-sm"
        />
        {q && (
          <button onClick={close} className="text-neutral-600 hover:text-neutral-300" title="Limpiar">
            <X size={16} />
          </button>
        )}
      </div>

      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={close} />
          <div className="absolute z-30 mt-1.5 w-full card p-2 shadow-xl border border-ink-700 max-h-[70vh] overflow-y-auto">
            {localHas ? (
              <div className="mb-1">
                <div className="text-[11px] uppercase tracking-wider text-neutral-600 px-2 py-1">En tu colección</div>
                {local.artists.map((a) => (
                  <Link key={`a${a.id}`} to={`/artista/${a.id}`} onClick={close} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-ink-800 text-sm">
                    <User size={14} className="text-neutral-500 shrink-0" />
                    <span className="flex-1 truncate">{a.name}</span>
                    <span className="text-xs text-neutral-600 shrink-0">{a.albums} discos</span>
                  </Link>
                ))}
                {local.albums.map((al) => (
                  <Link key={`al${al.id}`} to={`/album/${al.id}`} onClick={close} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-ink-800 text-sm">
                    <Disc3 size={14} className="text-neutral-500 shrink-0" />
                    <span className="flex-1 truncate">
                      {al.title} <span className="text-neutral-600">· {al.album_artist}</span>
                    </span>
                    {al.year ? <span className="text-xs text-neutral-600 shrink-0">{al.year}</span> : null}
                  </Link>
                ))}
              </div>
            ) : null}

            <div className="text-[11px] uppercase tracking-wider text-neutral-600 px-2 py-1 flex items-center gap-2">
              Fuera de tu colección {extLoading && <Loader2 size={11} className="animate-spin" />}
            </div>
            {extArtistsOwned.map((a) => (
              <div key={`mao${a.mbid}`} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-ink-800 text-sm">
                <User size={14} className="text-neutral-500 shrink-0" />
                <Link to={`/artista/${a.artist_id}`} onClick={close} className="flex-1 truncate hover:text-gold-400">
                  {a.name}
                </Link>
                {a.mbid && <MbLink url={`https://musicbrainz.org/artist/${a.mbid}`} />}
                <span className="text-xs text-emerald-400/70 shrink-0">lo sigues/tienes</span>
              </div>
            ))}
            {extArtistsNew.map((a) => (
              <div key={`ma${a.mbid}`} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-ink-800 text-sm">
                <User size={14} className="text-neutral-500 shrink-0" />
                <span className="flex-1 truncate">
                  {a.name}
                  {a.disambiguation ? <span className="text-neutral-600"> · {a.disambiguation}</span> : ''}
                </span>
                {a.mbid && <MbLink url={`https://musicbrainz.org/artist/${a.mbid}`} />}
                <button
                  onClick={() => follow(a)}
                  disabled={busy === a.mbid}
                  className="text-xs px-2 py-0.5 rounded border border-gold-500/40 bg-gold-500/10 text-gold-300 hover:bg-gold-500/20 inline-flex items-center gap-1 shrink-0 disabled:opacity-50"
                >
                  {busy === a.mbid ? <Loader2 size={12} className="animate-spin" /> : <Star size={12} />} Seguir
                </button>
              </div>
            ))}
            {(ext?.albums || []).map((al) => (
              <div key={`mal${al.rg_mbid}`} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-ink-800 text-sm">
                <Disc3 size={14} className="text-neutral-500 shrink-0" />
                <span className="flex-1 truncate">
                  {al.title} <span className="text-neutral-600">· {al.artist}{al.year ? ` · ${al.year}` : ''}</span>
                </span>
                {al.rg_mbid && <MbLink url={`https://musicbrainz.org/release-group/${al.rg_mbid}`} />}
                {al.owned ? (
                  <span className="text-xs text-emerald-400/70 shrink-0">lo tienes</span>
                ) : (
                  <button
                    onClick={() => setSearch(`${al.artist} ${al.title}`)}
                    className="text-xs px-2 py-0.5 rounded border border-gold-500/40 bg-gold-500/10 text-gold-300 hover:bg-gold-500/20 inline-flex items-center gap-1 shrink-0"
                  >
                    <Download size={12} /> Descargar
                  </button>
                )}
              </div>
            ))}

            {!extLoading && ext && !ext.artists.length && !ext.albums.length && !localHas && (
              <div className="text-sm text-neutral-600 px-2 py-2">Nada en tu colección ni en MusicBrainz.</div>
            )}
          </div>
        </>
      )}

      {search != null && <SearchModal initialQuery={search} onClose={() => setSearch(null)} />}
    </div>
  );
}
