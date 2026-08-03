import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Disc3, ImageOff } from 'lucide-react';
import { coverUrl } from './api.js';

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

export function Cover({ id, size = 'full', className = '' }) {
  const [err, setErr] = useState(false);
  if (err || !id) {
    return (
      <div className={`flex items-center justify-center bg-ink-850 text-neutral-700 aspect-square ${className}`}>
        <ImageOff size={size === 'full' ? 32 : 18} />
      </div>
    );
  }
  return (
    <img
      src={coverUrl(id)}
      onError={() => setErr(true)}
      loading="lazy"
      className={`object-cover aspect-square w-full ${className}`}
      alt=""
    />
  );
}

// Tarjeta de álbum para las parrillas.
export function AlbumCard({ album }) {
  const incomplete = album.track_file_count < album.track_count;
  return (
    <Link to={`/album/${album.id}`} className="group block">
      <div className="relative rounded-lg overflow-hidden card">
        <Cover id={album.id} />
        {incomplete && (
          <span className="absolute top-1.5 right-1.5 text-[10px] px-1.5 py-0.5 rounded bg-amber-600/90 text-amber-50">
            {album.track_file_count}/{album.track_count}
          </span>
        )}
        {album.match_state === 'orphan' && (
          <span className="absolute top-1.5 left-1.5 text-[10px] px-1.5 py-0.5 rounded bg-violet-600/90 text-violet-50">
            rareza
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
