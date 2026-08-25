import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Disc, Layers, X, Loader2 } from 'lucide-react';
import { api } from '../api.js';
import { PageTitle, AlbumCard, Spinner, ErrorMsg, DuplicateGroupPanel, Button } from '../components.jsx';

// Campos de filtro que se guardan en la URL (?q=…&sort=…). Así, al entrar a un disco y volver
// con «atrás» del navegador, se restaura tu búsqueda/filtros en vez de la vista global.
const FILTER_KEYS = ['q', 'genre', 'decade', 'year', 'format', 'lossless', 'state', 'sort', 'dupesOnly'];
const DEFAULTS = { q: '', genre: '', decade: '', year: '', format: '', lossless: '', state: '', sort: 'added', dupesOnly: '' };

export default function Library() {
  const [sp, setSp] = useSearchParams();
  const [filters, setFilters] = useState(null);
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [group, setGroup] = useState(null); // grupo de duplicados abierto (al pinchar ×N)
  // estado inicial de los filtros: desde la URL (para restaurar al volver con «atrás»)
  const [f, setF] = useState(() => {
    const init = { ...DEFAULTS };
    for (const k of FILTER_KEYS) if (sp.get(k) != null) init[k] = sp.get(k);
    return init;
  });
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [combining, setCombining] = useState(false);

  const openDup = async (id) => {
    try {
      setGroup(await api.dupGroup(id));
    } catch (e) {
      alert(e.message);
    }
  };

  const toggleSelect = (id) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const exitSelect = () => {
    setSelectMode(false);
    setSelected(new Set());
  };

  const combine = async () => {
    if (selected.size < 2) return;
    setCombining(true);
    try {
      await api.combineAlbums([...selected]);
      exitSelect();
      const clean = Object.fromEntries(Object.entries(f).filter(([, v]) => v));
      setData(await api.library({ ...clean, limit: 500 }));
    } catch (e) {
      alert(e.message);
    } finally {
      setCombining(false);
    }
  };

  useEffect(() => {
    api.libraryFilters().then(setFilters).catch(() => {});
  }, []);

  useEffect(() => {
    const clean = Object.fromEntries(Object.entries(f).filter(([, v]) => v));
    // en modo selección la lista va PLANA (cada disco por separado, para poder combinarlos)
    const t = setTimeout(() => {
      api
        .library({ ...clean, ...(selectMode ? { flat: '1' } : {}), limit: 500 })
        .then(setData)
        .catch((e) => setErr(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [f, selectMode]);

  // refleja los filtros en la URL (replace: no ensucia el historial con cada tecla). Al abrir
  // un disco se apila una entrada nueva; «atrás» vuelve a esta URL y restaura los filtros.
  useEffect(() => {
    const next = {};
    for (const k of FILTER_KEYS) if (f[k] && f[k] !== DEFAULTS[k]) next[k] = f[k];
    setSp(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f]);

  const set = (k) => (e) => setF((prev) => ({ ...prev, [k]: e.target.value }));
  const sel = 'bg-ink-850 border border-ink-800 rounded-lg px-2.5 py-1.5 text-sm';

  return (
    <div>
      <PageTitle icon={Disc} title="Discoteca" sub={data ? `${data.total} álbumes` : 'Toda tu colección'} />

      <div className="flex flex-wrap gap-2 mb-5">
        <input
          value={f.q}
          onChange={set('q')}
          placeholder="Buscar álbum o artista…"
          className={`${sel} flex-1 min-w-[180px]`}
        />
        <input
          list="genre-list"
          value={f.genre}
          onChange={set('genre')}
          placeholder="Género"
          className={`${sel} w-36`}
        />
        <datalist id="genre-list">
          {filters?.genres.map((g) => (
            <option key={g.name} value={g.name}>
              {g.n}
            </option>
          ))}
        </datalist>
        <select value={f.decade} onChange={set('decade')} className={sel}>
          <option value="">Década</option>
          {filters?.decades.map((d) => (
            <option key={d} value={d}>
              {d}s
            </option>
          ))}
        </select>
        <input
          list="year-list"
          value={f.year}
          onChange={set('year')}
          placeholder="Año"
          className={`${sel} w-24`}
          title="Filtrar por un año concreto (tiene prioridad sobre la década)"
        />
        <datalist id="year-list">
          {filters?.years?.map((y) => (
            <option key={y} value={y} />
          ))}
        </datalist>
        <select value={f.format} onChange={set('format')} className={sel}>
          <option value="">Formato</option>
          {filters?.formats.map((fm) => (
            <option key={fm} value={fm}>
              {fm}
            </option>
          ))}
        </select>
        <select value={f.lossless} onChange={set('lossless')} className={sel}>
          <option value="">Calidad</option>
          <option value="1">Sin pérdida</option>
          <option value="0">Con pérdida</option>
        </select>
        <select value={f.state} onChange={set('state')} className={sel}>
          <option value="">Estado</option>
          <option value="matched">Identificado</option>
          <option value="orphan">Rareza</option>
          <option value="bootleg">Bootleg</option>
          <option value="unmatched">Sin identificar</option>
        </select>
        <select value={f.sort} onChange={set('sort')} className={sel}>
          <option value="added">Recientes</option>
          <option value="artist">Artista</option>
          <option value="title">Título</option>
          <option value="year">Año</option>
          <option value="size">Tamaño</option>
          <option value="random">Aleatorio</option>
        </select>
        <button
          type="button"
          onClick={() => setF((p) => ({ ...p, dupesOnly: p.dupesOnly ? '' : '1' }))}
          className={`${sel} ${f.dupesOnly ? 'border-gold-500/50 bg-gold-500/15 text-gold-300' : 'text-neutral-400'}`}
          title="Mostrar solo álbumes con copias duplicadas"
        >
          Con duplicados
        </button>
        <button
          type="button"
          onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
          className={`${sel} inline-flex items-center gap-1.5 ${
            selectMode ? 'border-gold-500/50 bg-gold-500/15 text-gold-300' : 'text-neutral-400'
          }`}
          title="Seleccionar discos para combinarlos en una caja multidisco"
        >
          <Layers size={14} /> Combinar discos
        </button>
      </div>

      {err && <ErrorMsg>{err}</ErrorMsg>}
      {!data && !err && <Spinner label="Cargando…" />}
      {data && data.albums.length === 0 && <p className="text-neutral-500">Nada que coincida.</p>}

      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {data.albums.map((a) => (
            <AlbumCard
              key={a.id}
              album={a}
              selectable={selectMode}
              selected={selected.has(a.id)}
              onSelectToggle={() => toggleSelect(a.id)}
              onClick={!selectMode && a.dup ? () => openDup(a.id) : undefined}
            />
          ))}
        </div>
      )}

      {selectMode && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 card px-4 py-2.5 flex items-center gap-3 shadow-lg border border-ink-700">
          <span className="text-sm text-neutral-300">
            {selected.size} seleccionado{selected.size === 1 ? '' : 's'}
          </span>
          <Button variant="gold" onClick={combine} disabled={combining || selected.size < 2}>
            <span className="inline-flex items-center gap-1.5">
              {combining ? <Loader2 size={14} className="animate-spin" /> : <Layers size={14} />}
              Combinar en multidisco
            </span>
          </Button>
          <button onClick={exitSelect} className="text-neutral-500 hover:text-neutral-300 inline-flex items-center gap-1 text-sm">
            <X size={15} /> Cancelar
          </button>
        </div>
      )}

      {group && <DuplicateGroupPanel group={group} onClose={() => setGroup(null)} />}
    </div>
  );
}
