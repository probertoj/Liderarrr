import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Copy } from 'lucide-react';
import { api } from '../api.js';
import { copyText } from '../clipboard.js';
import { Spinner } from '../components.jsx';

// Qué álbumes son: los de alta resolución, los que están por debajo de calidad CD, los que
// mezclan frecuencias, los que no tienen ReplayGain y los que no tienen imagen en su carpeta.
// Con buscador y «Copiar lista». La idea y la primera versión vienen del fork de tinker-net
// (github.com/tinker-net/Liderarrr), que hacía una pestaña por cada frecuencia de muestreo;
// el porqué del reagrupado está en server/src/qualitylists.js.

const fmtRate = (hz) => `${(hz / 1000).toLocaleString('es', { maximumFractionDigits: 1 })} kHz`;
const PAGE = 200; // filas por «mostrar más»: miles de enlaces de golpe harían lenta la página
const miles = (n) => Number(n || 0).toLocaleString('es-ES');

// «24 bits · 96 kHz», «16 bits · 44,1 + 48 kHz»: lo mejor que tiene el disco en bits y todas
// sus frecuencias.
const calidad = (a) => {
  const bits = a.bits?.length ? `${Math.max(...a.bits)} bits · ` : '';
  return `${bits}${(a.rates || []).map(fmtRate).join(' + ')}`;
};

const LISTAS = [
  {
    key: 'hires',
    label: 'Alta resolución',
    cuenta: (s) => s.hiRes,
    nota: 'Álbumes sin pérdida con alguna pista a más de 16 bits o a más de 48 kHz. Un disco a 24 bits y 44,1 kHz también lo es.',
  },
  {
    key: 'belowcd',
    label: 'Por debajo de CD',
    cuenta: (s) => s.belowCd,
    nota: 'Álbumes con alguna pista a menos de 44,1 kHz: por debajo de la calidad de un CD, sea cual sea el formato. Los más claros de sustituir.',
  },
  {
    key: 'mixed',
    label: 'Mezclan frecuencias',
    cuenta: (s) => s.mixed,
    nota: 'Álbumes con pistas a distinta frecuencia de muestreo. Suele ser un disco montado a partir de dos fuentes.',
  },
  {
    key: 'replaygain',
    label: 'Sin ReplayGain',
    cuenta: (s) => s.noReplaygain,
    nota: 'Álbumes con alguna pista sin etiqueta ReplayGain (volumen sin normalizar).',
  },
  {
    key: 'cover',
    label: 'Sin imagen en la carpeta',
    cuenta: (s) => s.noCover,
    nota: 'Álbumes sin ningún fichero de imagen en su carpeta. La carátula puede salir igual, del propio audio o de fuera.',
  },
];

export default function QualityLists() {
  const [summary, setSummary] = useState(null);
  const [err, setErr] = useState(null);
  const [listError, setListError] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [tab, setTab] = useState('hires');
  const [list, setList] = useState(null); // null = cargando
  const [q, setQ] = useState('');
  const [rate, setRate] = useState(null); // filtro por frecuencia dentro de la lista (null = todas)
  const [limit, setLimit] = useState(PAGE);
  const [copyResult, setCopyResult] = useState(null);

  useEffect(() => {
    api
      .qualityLists()
      .then(setSummary)
      .catch((e) => setErr(e.message));
  }, []);

  const current = LISTAS.find((t) => t.key === tab);

  useEffect(() => {
    let alive = true;
    setList(null);
    setListError(null);
    setQ('');
    setRate(null);
    setLimit(PAGE);
    api
      .qualityList(tab)
      .then((r) => alive && setList(r.albums))
      .catch((e) => alive && setListError(e.message));
    return () => {
      alive = false;
    };
  }, [tab, attempt]);

  // Las frecuencias que aparecen en ESTA lista, con cuántos álbumes cada una: dentro de «alta
  // resolución» sirve para quedarse solo con los de 96 kHz, por ejemplo. Antes cada una era
  // una pestaña; ahora es un filtro de la lista que la tiene.
  const frecuencias = useMemo(() => {
    if (!list || !list[0]?.rates) return [];
    const n = new Map();
    for (const a of list) for (const hz of a.rates) n.set(hz, (n.get(hz) || 0) + 1);
    return [...n.entries()].sort((x, y) => x[0] - y[0]).map(([hz, albums]) => ({ hz, albums }));
  }, [list]);

  const filtered = useMemo(() => {
    if (!list) return [];
    const needle = q.trim().toLowerCase();
    return list.filter(
      (a) =>
        (rate == null || a.rates?.includes(rate)) &&
        (!needle || `${a.album_artist} ${a.title} ${a.path || ''}`.toLowerCase().includes(needle))
    );
  }, [list, q, rate]);

  const result = copyResult?.albums === filtered ? copyResult : null;
  const copyAll = async () => {
    if (!filtered.length) return;
    const text = filtered.map((a) => `${a.album_artist} — ${a.title}`).join('\n');
    const copied = await copyText(text);
    setCopyResult({ albums: filtered, copied, text });
  };

  const detail = (a) => {
    if (tab === 'hires') return <span className="text-neutral-500">{calidad(a)}</span>;
    if (tab === 'belowcd')
      return (
        <span className="text-amber-400">
          {a.rates.map(fmtRate).join(' + ')}
          {a.formats?.length ? ` · ${a.formats.join(', ')}` : ''}
        </span>
      );
    if (tab === 'mixed') return <span className="text-amber-400">{a.rates.map(fmtRate).join(' + ')}</span>;
    if (tab === 'replaygain')
      return (
        <span className="text-neutral-500">{a.without === a.total ? `${a.total} pistas sin RG` : `${a.without} de ${a.total} sin RG`}</span>
      );
    return <span className="text-neutral-500">{a.track_file_count} pistas</span>;
  };

  const chip = (activo, menudo = false) =>
    `${menudo ? 'text-xs px-2 py-1' : 'text-sm px-3 py-1.5'} rounded-lg border transition ${
      activo ? 'border-gold-500/40 bg-gold-500/15 text-gold-300' : 'border-ink-800 text-neutral-300 hover:bg-ink-850'
    }`;

  if (err) return <div className="aviso aviso-error p-4 mb-6 text-sm">No se pudieron cargar los listados: {err}</div>;
  if (!summary) return <Spinner />;

  return (
    <div className="card p-4 mb-6">
      <h2 className="text-sm text-neutral-400 mb-3">¿Qué álbumes son?</h2>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {LISTAS.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)} aria-pressed={tab === t.key} className={chip(tab === t.key)}>
            {t.label} <span className="text-neutral-500">· {miles(t.cuenta(summary))}</span>
          </button>
        ))}
      </div>

      <p className="text-xs text-neutral-500 mb-3">{current.nota}</p>

      {listError ? (
        <div className="text-sm text-red-400">
          <p>{listError}</p>
          <button type="button" className="mt-2 underline" onClick={() => setAttempt((n) => n + 1)}>
            Reintentar
          </button>
        </div>
      ) : !list ? (
        <Spinner />
      ) : list.length === 0 ? (
        <p className="text-neutral-500 text-sm">Ninguno. Nada que mostrar en esta lista.</p>
      ) : (
        <>
          {frecuencias.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5 mb-3">
              <span className="text-xs text-neutral-500 mr-1">Frecuencia:</span>
              <button
                type="button"
                onClick={() => {
                  setRate(null);
                  setLimit(PAGE);
                }}
                aria-pressed={rate == null}
                className={chip(rate == null, true)}
              >
                Todas
              </button>
              {frecuencias.map((f) => (
                <button
                  key={f.hz}
                  type="button"
                  onClick={() => {
                    setRate(f.hz);
                    setLimit(PAGE);
                  }}
                  aria-pressed={rate === f.hz}
                  className={chip(rate === f.hz, true)}
                >
                  {fmtRate(f.hz)} <span className="text-neutral-500">· {miles(f.albums)}</span>
                </button>
              ))}
            </div>
          )}
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
              type="button"
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
              {result.albums.length === 1 ? '1 álbum copiado' : `${miles(result.albums.length)} álbumes copiados`}
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
          <p className="text-xs text-neutral-500 mb-2">
            {miles(filtered.length)} {filtered.length === 1 ? 'álbum' : 'álbumes'}
            {filtered.length !== list.length ? ` de ${miles(list.length)}` : ''}
          </p>
          <div className="space-y-0.5 max-h-[32rem] overflow-y-auto">
            {filtered.slice(0, limit).map((a) => (
              <Link key={a.id} to={`/album/${a.id}`} className="block px-2 py-1.5 -mx-2 rounded hover:bg-ink-850/60">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="truncate min-w-0 hover:text-gold-400">
                    {a.album_artist} — {a.title}
                    {a.year ? <span className="text-neutral-500"> ({a.year})</span> : null}
                  </span>
                  <span className="text-xs shrink-0">{detail(a)}</span>
                </div>
                {a.path && <div className="text-[11px] text-neutral-500 truncate">{a.path}</div>}
              </Link>
            ))}
            {filtered.length > limit && (
              <button type="button" onClick={() => setLimit((l) => l + PAGE)} className="w-full text-xs text-neutral-400 hover:text-gold-400 py-2">
                Mostrar {Math.min(PAGE, filtered.length - limit)} más ({miles(filtered.length - limit)} restantes)
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
