import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Copy, RefreshCw } from 'lucide-react';
import { Spinner } from '../components.jsx';
import { confirmar } from '../avisos.jsx';

// Listados de calidad («¿cuáles son?») y estado de la sincronización automática. Es un
// componente aparte para no tocar nada de lo que ya hay en la página de Calidad: Quality.jsx
// solo lo coloca. Habla con sus propias rutas nuevas (/api/quality/list*, /api/autosync*).

async function getJson(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = `Error ${res.status}`;
    try {
      msg = (await res.json()).error || msg;
    } catch {
      /* noop */
    }
    throw new Error(msg);
  }
  return res.json();
}

const fmtRate = (hz) => `${(hz / 1000).toLocaleString('es', { maximumFractionDigits: 1 })} kHz`;
const PAGE = 200; // filas por «mostrar más»: miles de enlaces de golpe harían lenta la página

// ───────────────────────────── listados ─────────────────────────────

export default function QualityLists() {
  const [summary, setSummary] = useState(null);
  const [err, setErr] = useState(null);
  const [tab, setTab] = useState('rate:44100');
  const [list, setList] = useState(null); // null = cargando
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    getJson('/quality/lists')
      .then(setSummary)
      .catch((e) => setErr(e.message));
  }, []);

  const tabs = useMemo(() => {
    if (!summary) return [];
    const counts = new Map(summary.sampleRates.map((r) => [r.rate, r.albums]));
    const main = [44100, 48000].map((hz) => ({
      key: `rate:${hz}`,
      label: fmtRate(hz),
      n: counts.get(hz) || 0,
      kind: 'samplerate',
      rate: hz,
    }));
    const others = summary.sampleRates
      .filter((r) => r.rate !== 44100 && r.rate !== 48000)
      .sort((a, b) => a.rate - b.rate)
      .map((r) => ({ key: `rate:${r.rate}`, label: fmtRate(r.rate), n: r.albums, kind: 'samplerate', rate: r.rate }));
    return [
      ...main,
      { key: 'replaygain', label: 'Sin ReplayGain', n: summary.noReplaygain, kind: 'replaygain' },
      { key: 'cover', label: 'Sin carátula', n: summary.noCover, kind: 'cover' },
      ...others,
    ];
  }, [summary]);

  const current = tabs.find((t) => t.key === tab);

  useEffect(() => {
    if (!current) return undefined;
    let alive = true;
    setList(null);
    setQ('');
    setLimit(PAGE);
    const qs = `kind=${current.kind}${current.rate ? `&rate=${current.rate}` : ''}`;
    getJson(`/quality/list?${qs}`)
      .then((r) => alive && setList(r.albums))
      .catch((e) => alive && setErr(e.message));
    return () => {
      alive = false;
    };
  }, [current?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    if (!list) return [];
    const needle = q.trim().toLowerCase();
    if (!needle) return list;
    return list.filter((a) => `${a.album_artist} ${a.title} ${a.path || ''}`.toLowerCase().includes(needle));
  }, [list, q]);

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(filtered.map((a) => `${a.album_artist} — ${a.title}`).join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* sin permiso de portapapeles: no pasa nada */
    }
  };

  const detail = (a) => {
    if (current.kind === 'samplerate')
      return a.rates.length > 1 ? (
        <span className="text-amber-400/80">mixto · {a.rates.map(fmtRate).join(' + ')}</span>
      ) : (
        <span className="text-neutral-500">{a.at_rate} {a.at_rate === 1 ? 'pista' : 'pistas'}</span>
      );
    if (current.kind === 'replaygain')
      return (
        <span className="text-neutral-500">
          {a.without === a.total ? `${a.total} pistas sin RG` : `${a.without} de ${a.total} sin RG`}
        </span>
      );
    return <span className="text-neutral-500">{a.track_file_count} pistas</span>;
  };

  if (err) return <div className="card p-4 mb-6 text-sm text-red-400">No se pudieron cargar los listados: {err}</div>;
  if (!summary) return <Spinner />;

  return (
    <div className="card p-4 mb-6">
      <h2 className="text-sm text-neutral-400 mb-3">¿Qué álbumes son?</h2>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`text-sm px-3 py-1.5 rounded-lg border transition ${
              tab === t.key
                ? 'border-gold-500/40 bg-gold-500/15 text-gold-300'
                : 'border-ink-800 text-neutral-300 hover:bg-ink-850'
            }`}
          >
            {t.label} <span className="text-neutral-500">· {t.n.toLocaleString('es')}</span>
          </button>
        ))}
      </div>

      {current?.kind === 'samplerate' && (
        <p className="text-xs text-neutral-600 mb-3">
          Álbumes con al menos una pista a {current.label}. Si un álbum mezcla frecuencias, sale en cada lista y lo indica.
        </p>
      )}
      {current?.kind === 'replaygain' && (
        <p className="text-xs text-neutral-600 mb-3">Álbumes con alguna pista sin etiqueta ReplayGain (volumen sin normalizar).</p>
      )}

      {!list ? (
        <Spinner />
      ) : list.length === 0 ? (
        <p className="text-neutral-600 text-sm">Ninguno. Nada que mostrar en esta lista.</p>
      ) : (
        <>
          <div className="flex items-center gap-2 mb-2">
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setLimit(PAGE);
              }}
              placeholder="Filtrar por artista, álbum o carpeta…"
              className="flex-1 min-w-0 text-sm px-3 py-1.5 rounded-lg bg-ink-900 border border-ink-800 placeholder:text-neutral-600"
            />
            <button
              onClick={copyAll}
              className="shrink-0 inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-ink-800 text-neutral-400 hover:bg-ink-850"
              title="Copia «Artista — Álbum» de lo que se ve, una línea por álbum"
            >
              <Copy size={13} /> {copied ? 'Copiado' : 'Copiar lista'}
            </button>
          </div>
          <p className="text-xs text-neutral-600 mb-2">
            {filtered.length.toLocaleString('es')} {filtered.length === 1 ? 'álbum' : 'álbumes'}
            {q.trim() ? ` de ${list.length.toLocaleString('es')}` : ''}
          </p>
          <div className="space-y-0.5 max-h-[32rem] overflow-y-auto">
            {filtered.slice(0, limit).map((a) => (
              <Link key={a.id} to={`/album/${a.id}`} className="block px-2 py-1.5 -mx-2 rounded hover:bg-ink-850/60">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="truncate hover:text-gold-400">
                    {a.album_artist} — {a.title}
                    {a.year ? <span className="text-neutral-500"> ({a.year})</span> : null}
                  </span>
                  <span className="text-xs shrink-0">{detail(a)}</span>
                </div>
                {a.path && <div className="text-[11px] text-neutral-600 truncate">{a.path}</div>}
              </Link>
            ))}
            {filtered.length > limit && (
              <button
                onClick={() => setLimit((l) => l + PAGE)}
                className="w-full text-xs text-neutral-400 hover:text-gold-400 py-2"
              >
                Mostrar {Math.min(PAGE, filtered.length - limit)} más ({(filtered.length - limit).toLocaleString('es')} restantes)
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ───────────────────── sincronización automática ─────────────────────

const INTERVALS = [
  [15, 'cada 15 min'],
  [30, 'cada 30 min'],
  [60, 'cada hora'],
  [180, 'cada 3 horas'],
  [360, 'cada 6 horas'],
  [720, 'cada 12 horas'],
  [1440, 'una vez al día'],
];

export function AutoSyncCard() {
  const [info, setInfo] = useState(null);
  const [err, setErr] = useState(null);

  const load = useCallback(
    () =>
      getJson('/autosync')
        .then((i) => {
          setInfo(i);
          setErr(null);
        })
        .catch((e) => setErr(e.message)),
    []
  );
  useEffect(() => {
    load();
  }, [load]);

  const running = !!info?.status?.running;
  useEffect(() => {
    if (!running) return undefined;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [running, load]);

  const run = async (body) => {
    try {
      await getJson('/autosync/run', { method: 'POST', body });
    } catch (e) {
      setErr(e.message);
    }
    load();
  };
  const saveConfig = async (body) => {
    try {
      setInfo(await getJson('/autosync/config', { method: 'POST', body }));
    } catch (e) {
      setErr(e.message);
    }
  };

  if (err && !info) return <div className="card p-4 mb-6 text-sm text-red-400">Sincronización automática: {err}</div>;
  if (!info) return null;

  const last = info.last;
  const blocked = !running && last?.blocked;
  const fmtDate = (ms) => new Date(ms).toLocaleString('es');
  const st = info.status;

  return (
    <div className="card p-4 mb-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm text-neutral-400">Sincronización automática</h2>
          <p className="text-xs text-neutral-600 mt-0.5">
            Escanea la biblioteca y quita de la base los álbumes cuyos ficheros ya no están en disco. No borra ningún fichero.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-2 text-sm text-neutral-300">
            <input
              type="checkbox"
              checked={info.enabled}
              onChange={(e) => saveConfig({ enabled: e.target.checked })}
            />
            Activada
          </label>
          <select
            value={info.intervalMin}
            onChange={(e) => saveConfig({ intervalMin: Number(e.target.value) })}
            disabled={!info.enabled}
            className="text-sm px-2 py-1.5 rounded-lg bg-ink-900 border border-ink-800 disabled:opacity-50"
          >
            {INTERVALS.some(([m]) => m === info.intervalMin) ? null : (
              <option value={info.intervalMin}>cada {info.intervalMin} min</option>
            )}
            {INTERVALS.map(([m, label]) => (
              <option key={m} value={m}>
                {label}
              </option>
            ))}
          </select>
          <button
            onClick={() => run({})}
            disabled={running}
            className="inline-flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg border border-gold-500/40 bg-gold-500/10 text-gold-300 hover:bg-gold-500/20 disabled:opacity-60"
          >
            <RefreshCw size={14} className={running ? 'animate-spin' : ''} />
            {running ? (st.phase === 'scanning' ? 'Escaneando…' : 'Comprobando…') : 'Sincronizar ahora'}
          </button>
        </div>
      </div>

      {err && <p className="text-xs text-red-400 mt-2">{err}</p>}

      {last && !running && (
        <p className="text-xs text-neutral-500 mt-3">
          Última pasada: {fmtDate(last.at)} ({last.trigger === 'auto' ? 'automática' : 'manual'}) ·{' '}
          {last.removed > 0
            ? `${last.removed.toLocaleString('es')} ${last.removed === 1 ? 'álbum quitado' : 'álbumes quitados'} de la base (${last.removedTracks.toLocaleString('es')} pistas)`
            : 'nada que quitar'}
          {last.error ? ` · error: ${last.error}` : ''}
        </p>
      )}
      {!last && <p className="text-xs text-neutral-600 mt-3">Todavía no se ha hecho ninguna pasada.</p>}

      {last?.removed > 0 && last.removedSample?.length > 0 && !running && (
        <details className="mt-2 text-xs text-neutral-500">
          <summary className="cursor-pointer hover:text-neutral-300">Ver cuáles</summary>
          <ul className="mt-1 space-y-0.5">
            {last.removedSample.map((s, i) => (
              <li key={i} className="truncate">{s}</li>
            ))}
            {last.removed > last.removedSample.length && <li>…y {last.removed - last.removedSample.length} más</li>}
          </ul>
        </details>
      )}

      {last?.skippedRoots?.length > 0 && !running && (
        <p className="text-xs text-amber-400/80 mt-2">
          No se pudo leer la carpeta de música ({last.skippedRoots.join(', ')}): se ha omitido para no borrar nada por error.
        </p>
      )}

      {blocked && (
        <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <div className="flex items-start gap-2 text-amber-300">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            <div className="min-w-0">
              Pasada detenida por seguridad: {last.blocked.count.toLocaleString('es')} de{' '}
              {last.blocked.evaluated.toLocaleString('es')} álbumes parecen haber desaparecido. Eso es mucho de golpe
              y suele ser una unidad de red sin montar, no un borrado real. Comprueba que tu música está accesible. Si
              los has quitado tú a propósito, confírmalo.
              <ul className="mt-1.5 text-xs text-amber-200/70 space-y-0.5">
                {last.blocked.sample.map((s, i) => (
                  <li key={i} className="truncate">{s}</li>
                ))}
                {last.blocked.count > last.blocked.sample.length && <li>…y más</li>}
              </ul>
              <button
                onClick={async () => {
                  const ok = await confirmar(
                    `¿Quitar de la base de datos ${last.blocked.count} álbumes que ya no están en disco? (No se borra ningún fichero.)`,
                    { aceptar: 'Quitarlos de la base', peligro: true }
                  );
                  if (ok) run({ force: true, scan: false });
                }}
                className="mt-2 text-xs px-3 py-1.5 rounded-lg border border-amber-500/50 text-amber-200 hover:bg-amber-500/20"
              >
                Quitarlos de la base igualmente
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
