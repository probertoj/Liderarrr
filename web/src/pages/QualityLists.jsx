import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Copy } from 'lucide-react';
import { api } from '../api.js';
import { copyText } from '../clipboard.js';
import { Spinner } from '../components.jsx';

const fmtRate = (hz) => `${(hz / 1000).toLocaleString('es', { maximumFractionDigits: 1 })} kHz`;
const PAGE = 200; // filas por «mostrar más»: miles de enlaces de golpe harían lenta la página

// Qué álbumes son: por frecuencia de muestreo, sin ReplayGain o sin imagen en la carpeta, con
// buscador y «Copiar lista». Viene del fork de tinker-net (github.com/tinker-net/Liderarrr).

export default function QualityLists() {
  const [summary, setSummary] = useState(null);
  const [err, setErr] = useState(null);
  const [listError, setListError] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [tab, setTab] = useState('rate:44100');
  const [list, setList] = useState(null); // null = cargando
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [copyResult, setCopyResult] = useState(null);

  useEffect(() => {
    api.qualityLists()
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
      { key: 'cover', label: 'Sin imagen en la carpeta', n: summary.noCover, kind: 'cover' },
      ...others,
    ];
  }, [summary]);

  const current = tabs.find((t) => t.key === tab);

  useEffect(() => {
    if (!current) return undefined;
    let alive = true;
    setList(null);
    setListError(null);
    setQ('');
    setLimit(PAGE);
    api.qualityList(current.kind, current.rate)
      .then((r) => alive && setList(r.albums))
      .catch((e) => alive && setListError(e.message));
    return () => {
      alive = false;
    };
  }, [current?.key, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    if (!list) return [];
    const needle = q.trim().toLowerCase();
    if (!needle) return list;
    return list.filter((a) => `${a.album_artist} ${a.title} ${a.path || ''}`.toLowerCase().includes(needle));
  }, [list, q]);

  const result = copyResult?.albums === filtered ? copyResult : null;
  const copyAll = async () => {
    if (!filtered.length) return;
    const text = filtered.map((a) => `${a.album_artist} — ${a.title}`).join('\n');
    const copied = await copyText(text);
    setCopyResult({ albums: filtered, copied, text });
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
            onClick={() => {
                if (t.key === tab) return;
                setList(null);
                setListError(null);
                setTab(t.key);
              }}
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
      {current?.kind === 'cover' && (
        <p className="text-xs text-neutral-600 mb-3">
          Álbumes sin ningún fichero de imagen en su carpeta. La carátula puede salir igual, del propio audio o de fuera.
        </p>
      )}

      {listError ? (
        <div className="text-sm text-red-400">
          <p>{listError}</p>
          <button className="mt-2 underline" onClick={() => setAttempt((n) => n + 1)}>Reintentar</button>
        </div>
      ) : !list ? (
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
              aria-label="Filtrar la lista"
              className="flex-1 min-w-0 text-sm px-3 py-1.5 rounded-lg bg-ink-900 border border-ink-800 placeholder:text-neutral-600"
            />
            <button
              onClick={copyAll}
              disabled={!filtered.length}
              className="shrink-0 inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-ink-800 text-neutral-400 hover:bg-ink-850 disabled:opacity-50"
              title="Copia todos los resultados del filtro, una línea por álbum"
            >
              <Copy size={13} /> Copiar lista
            </button>
          </div>
          {result?.copied && (
            <p role="status" className="mb-2 text-xs text-emerald-400">
              {result.albums.length === 1 ? '1 álbum copiado' : `${result.albums.length.toLocaleString('es')} álbumes copiados`}
            </p>
          )}
          {result && !result.copied && (
            <label className="mb-2 block text-xs text-neutral-400">
              El navegador bloqueó la copia automática. Selecciona el texto y cópialo con Ctrl+C o ⌘C.
              <textarea
                readOnly
                value={result.text}
                onFocus={(event) => event.currentTarget.select()}
                rows={5}
                className="mt-1 block w-full rounded-lg border border-ink-800 bg-ink-900 p-2"
              />
            </label>
          )}
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
