import { useEffect, useState, useRef } from 'react';
import { Stethoscope, Copy, Check, RefreshCw } from 'lucide-react';
import { api, fmtBytes } from '../api.js';
import { PageTitle, Spinner, ErrorMsg, Button, StatCard } from '../components.jsx';

// Diagnóstico: todo lo que antes había que leer por `docker logs`, en la interfaz.
// El botón «Copiar» da un bloque de texto para pegar de una.
export default function Diagnostics() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [copied, setCopied] = useState(false);
  const [showText, setShowText] = useState(false);
  const timer = useRef(null);

  const load = () => api.diag().then(setD).catch((e) => setErr(e.message));
  useEffect(() => {
    load();
    // refresco en vivo mientras haya un escaneo en marcha
    timer.current = setInterval(async () => {
      const x = await api.diag().catch(() => null);
      if (x) setD(x);
    }, 2500);
    return () => clearInterval(timer.current);
  }, []);

  if (err) return <ErrorMsg>{err}</ErrorMsg>;
  if (!d) return <Spinner label="Recopilando diagnóstico…" />;

  const ok = () => {
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  // navigator.clipboard NO existe en HTTP (solo HTTPS/localhost), y el NAS se abre
  // por http://IP. Por eso el copiado directo fallaba en silencio. Se intenta, y si
  // no, execCommand con un textarea; y siempre se muestra el texto para copiar a mano.
  const copy = () => {
    const text = asText(d);
    setShowText(true);
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(ok).catch(() => execCopy(text) && ok());
    } else if (execCopy(text)) {
      ok();
    }
  };

  const scan = d.scan || {};
  const t = new Date();

  return (
    <div>
      <PageTitle icon={Stethoscope} title="Diagnóstico" sub={`Liderarrr v${d.version} · en marcha ${fmtUptime(d.uptimeSec)}`}>
        <Button onClick={load}>
          <span className="inline-flex items-center gap-1.5">
            <RefreshCw size={14} /> Refrescar
          </span>
        </Button>
        <Button variant="gold" onClick={copy}>
          <span className="inline-flex items-center gap-1.5">
            {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copiado' : 'Copiar diagnóstico'}
          </span>
        </Button>
      </PageTitle>

      {showText && (
        <div className="card p-3 mb-4">
          <div className="text-xs text-neutral-500 mb-1.5">
            {copied ? '✓ Copiado al portapapeles. ' : ''}Si no se copió (habitual por HTTP), selecciona todo aquí (clic dentro y Ctrl+A) y copia:
          </div>
          <textarea
            readOnly
            onFocus={(e) => e.target.select()}
            value={asText(d)}
            rows={8}
            className="w-full bg-ink-950 border border-ink-800 rounded-lg p-2 text-[11px] font-mono text-neutral-300"
          />
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard label="Álbumes" value={d.totals.albums.toLocaleString('es')} sub={`${d.totals.tracks.toLocaleString('es')} pistas`} />
        <StatCard label="Artistas" value={d.totals.artists.toLocaleString('es')} sub={d.unknownArtist ? `${d.unknownArtist} «desconocido»` : ''} />
        <StatCard label="Escuchas" value={d.totals.listens.toLocaleString('es')} />
        <StatCard label="Memoria (RSS)" value={fmtBytes(d.memory.rss)} sub={`heap ${fmtBytes(d.memory.heapUsed)}`} />
      </div>

      {/* escaneo */}
      <div className="card p-4 mb-4">
        <h2 className="text-sm text-neutral-400 mb-2">Escaneo</h2>
        {scan.running ? (
          <div className="text-sm text-gold-300">
            En marcha ({scan.phase}) · {n(scan.foldersFound)} carpetas · {n(scan.albumsDone)} nuevas · {n(scan.skipped)} sin cambios
            {scan.errors ? ` · ${n(scan.errors)} omitidas` : ''}
            {scan.current && <div className="text-[11px] text-neutral-600 mt-1 truncate">{scan.current}</div>}
          </div>
        ) : scan.lastScan ? (
          <div className="text-sm text-neutral-400">
            Último: {new Date(scan.lastScan.at).toLocaleString('es')} · {n(scan.lastScan.albums)} nuevas · {n(scan.lastScan.skipped)} sin cambios ·{' '}
            {n(scan.lastScan.errors)} omitidas · {n(scan.lastScan.folders)} carpetas
            {scan.lastScan.error ? <span className="text-red-400"> · error: {scan.lastScan.error}</span> : ''}
          </div>
        ) : (
          <div className="text-sm text-neutral-600">Aún no se ha escaneado.</div>
        )}
      </div>

      <div className="grid md:grid-cols-3 gap-4 mb-4">
        <div className="card p-4">
          <h2 className="text-sm text-neutral-400 mb-2">Álbumes por estado</h2>
          {Object.entries(d.states).map(([k, v]) => (
            <div key={k} className="flex justify-between text-sm py-0.5">
              <span className="text-neutral-300">{k}</span>
              <span className="text-neutral-500">{v.toLocaleString('es')}</span>
            </div>
          ))}
        </div>
        <div className="card p-4">
          <h2 className="text-sm text-neutral-400 mb-2">Formatos</h2>
          <div className="max-h-40 overflow-y-auto">
            {d.formats.map((f) => (
              <div key={f.name} className="flex justify-between text-sm py-0.5">
                <span className="text-neutral-300">{f.name}</span>
                <span className="text-neutral-500">{f.n.toLocaleString('es')}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card p-4">
          <h2 className="text-sm text-neutral-400 mb-2">Integraciones</h2>
          {Object.entries(d.settings)
            .filter(([k]) => k !== 'music_dirs')
            .map(([k, v]) => (
              <div key={k} className="flex justify-between text-sm py-0.5">
                <span className="text-neutral-300">{k}</span>
                <span className={v ? 'text-emerald-400' : 'text-neutral-600'}>{v ? '✓' : '—'}</span>
              </div>
            ))}
        </div>
      </div>

      {/* eventos */}
      <div className="card p-4">
        <h2 className="text-sm text-neutral-400 mb-2">Eventos recientes ({d.events.length})</h2>
        <div className="max-h-96 overflow-y-auto font-mono text-[11px] leading-relaxed">
          {d.events.length === 0 && <div className="text-neutral-600">Sin eventos.</div>}
          {d.events.map((e, i) => (
            <div key={i} className={levelColor(e.level)}>
              <span className="text-neutral-600">{new Date(e.t).toLocaleTimeString('es')} </span>
              {e.text}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Copiado alternativo para contextos no seguros (HTTP): textarea + execCommand.
function execCopy(text) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const okCmd = document.execCommand('copy');
    document.body.removeChild(ta);
    return okCmd;
  } catch {
    return false;
  }
}

const n = (x) => (x || 0).toLocaleString('es');
const fmtUptime = (s) => {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
};
const levelColor = (l) =>
  l === 'error' || l === 'fatal' ? 'text-red-400' : l === 'warn' ? 'text-amber-400' : l === 'slow' ? 'text-violet-400' : 'text-neutral-400';

function asText(d) {
  const lines = [];
  lines.push(`Liderarrr v${d.version} · uptime ${fmtUptime(d.uptimeSec)} · RSS ${fmtBytes(d.memory.rss)} / heap ${fmtBytes(d.memory.heapUsed)}`);
  lines.push(`Totales: ${d.totals.albums} álbumes · ${d.totals.artists} artistas · ${d.totals.tracks} pistas · ${d.totals.listens} escuchas · ${d.unknownArtist} artista-desconocido`);
  lines.push(`Estados: ${Object.entries(d.states).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  lines.push(`Formatos: ${d.formats.map((f) => `${f.name}=${f.n}`).join(' ')}`);
  lines.push(`Integraciones: ${Object.entries(d.settings).filter(([k]) => k !== 'music_dirs').map(([k, v]) => `${k}=${v ? 'sí' : 'no'}`).join(' ')}`);
  lines.push(`music_dirs: ${d.settings.music_dirs}`);
  const s = d.scan || {};
  lines.push(`Escaneo: running=${s.running} phase=${s.phase} carpetas=${s.foldersFound} nuevas=${s.albumsDone} sin_cambios=${s.skipped} omitidas=${s.errors}`);
  if (s.lastScan) lines.push(`Último escaneo: ${new Date(s.lastScan.at).toISOString()} nuevas=${s.lastScan.albums} sin_cambios=${s.lastScan.skipped} omitidas=${s.lastScan.errors} carpetas=${s.lastScan.folders}${s.lastScan.error ? ` error=${s.lastScan.error}` : ''}`);
  lines.push('');
  lines.push(`--- Eventos (${d.events.length}) ---`);
  for (const e of d.events) lines.push(`${new Date(e.t).toISOString()} [${e.level}] ${e.text}`);
  return lines.join('\n');
}
