import { useState, useEffect, useRef, Component } from 'react';
import { Link } from 'react-router-dom';
import { Disc3, ImageOff } from 'lucide-react';
import { coverUrl } from './api.js';

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
// resolviendo en 2º plano (fichero/online), la primera carga da 404. Por eso se
// reintenta con backoff: al resolverse, aparece sola sin recargar la página.
const COVER_RETRIES = 3;
export function Cover({ id, size = 'full', className = '' }) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    setAttempt(0);
    setFailed(false);
    return () => clearTimeout(timer.current);
  }, [id]);

  if (failed || !id) {
    return (
      <div className={`flex items-center justify-center bg-ink-850 text-neutral-700 aspect-square ${className}`}>
        <ImageOff size={size === 'full' ? 32 : 18} />
      </div>
    );
  }

  const onError = () => {
    if (attempt >= COVER_RETRIES) {
      setFailed(true);
      return;
    }
    timer.current = setTimeout(() => setAttempt((a) => a + 1), 2500 * (attempt + 1));
  };

  return (
    <img
      src={attempt ? `${coverUrl(id)}?r=${attempt}` : coverUrl(id)}
      onError={onError}
      loading="lazy"
      className={`object-cover aspect-square w-full ${className}`}
      alt=""
    />
  );
}

// Tarjeta de álbum para las parrillas.
export function AlbumCard({ album, onClick }) {
  const incomplete = album.track_file_count < album.track_count;
  const body = (
    <>
      <div className="relative rounded-lg overflow-hidden card">
        <Cover id={album.id} />
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
  // con onClick (p. ej. desplegar duplicados) es un botón; si no, enlaza al álbum
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
