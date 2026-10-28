import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Disc, Layers, X, Loader2 } from 'lucide-react';
import { api } from '../api.js';
import { PageTitle, AlbumCard, Spinner, ErrorMsg, DuplicateGroupPanel, Button } from '../components.jsx';
import { aviso } from '../avisos.jsx';

// Campos de filtro que se guardan en la URL (?q=…&sort=…). Así, al entrar a un disco y volver
// con «atrás» del navegador, se restaura tu búsqueda/filtros en vez de la vista global.
const FILTER_KEYS = ['q', 'genre', 'decade', 'year', 'format', 'lossless', 'state', 'sort', 'dupesOnly'];
// Cuántos discos se piden de una vez. Con 33.000 álbumes el servidor tarda unos 200 ms en
// armar la lista entera (la colapsa para fundir duplicados antes de recortar), así que
// pedir de 500 en 500 va fino y no deja la parrilla a medias.
const PAGINA = 500;
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
  const [cargandoMas, setCargandoMas] = useState(false);
  // El orden «aleatorio» necesita una semilla fija mientras dure la visita: sin ella cada
  // página se barajaría por su cuenta y verías discos repetidos al seguir bajando.
  const [semilla] = useState(() => Math.floor(Math.random() * 1e9));
  const centinela = useRef(null);
  // NO son estado: el estado se actualiza en el siguiente render y los eventos de scroll
  // llegan antes, así que con `cargandoMas` a secas se solapaban peticiones.
  const cargando = useRef(false);
  const armado = useRef(true);

  // Los parámetros de la consulta, en un solo sitio: los usan la carga inicial, «cargar
  // más» y el refresco de después de combinar discos.
  const consulta = useCallback(
    (extra = {}) => {
      const clean = Object.fromEntries(Object.entries(f).filter(([, v]) => v));
      return {
        ...clean,
        ...(selectMode ? { flat: '1' } : {}),
        ...(f.sort === 'random' ? { seed: semilla } : {}),
        limit: PAGINA,
        ...extra,
      };
    },
    [f, selectMode, semilla]
  );

  const openDup = async (id) => {
    try {
      setGroup(await api.dupGroup(id));
    } catch (e) {
      aviso(e.message, 'error');
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
      setData(await api.library(consulta()));
    } catch (e) {
      aviso(e.message, 'error');
    } finally {
      setCombining(false);
    }
  };

  useEffect(() => {
    api.libraryFilters().then(setFilters).catch(() => {});
  }, []);

  // en modo selección la lista va PLANA (cada disco por separado, para poder combinarlos)
  useEffect(() => {
    let cancelado = false;
    const t = setTimeout(() => {
      api
        .library(consulta())
        // con la biblioteca grande una respuesta tarda unos 200 ms: sin esta guardia, la
        // de una búsqueda ya abandonada podía llegar después y pisar a la buena.
        .then((d) => !cancelado && setData(d))
        .catch((e) => !cancelado && setErr(e.message));
    }, 250);
    return () => {
      cancelado = true;
      clearTimeout(t);
    };
  }, [consulta]);

  // Siguiente página, al pulsar el botón o al asomar el centinela por abajo.
  const cargarMas = useCallback(async () => {
    if (!data || cargando.current || data.albums.length >= data.total) return;
    cargando.current = true;
    setCargandoMas(true);
    try {
      const d = await api.library(consulta({ offset: data.albums.length }));
      setData((prev) => {
        if (!prev) return d;
        // si la colección cambió entre peticiones, algún disco podría repetirse
        const vistos = new Set(prev.albums.map((a) => a.id));
        return { total: d.total, albums: [...prev.albums, ...d.albums.filter((a) => !vistos.has(a.id))] };
      });
    } catch (e) {
      aviso(e.message, 'error');
    } finally {
      cargando.current = false;
      setCargandoMas(false);
    }
  }, [data, consulta]);

  // Pintada la tanda nueva, si el pie ya quedó lejos se rearma el cerrojo. Hace falta
  // porque si no solo se rearma cuando llega un evento de scroll con el pie lejos, y quien
  // estaba al final y baja de golpe no generaría ninguno.
  useEffect(() => {
    const el = centinela.current;
    if (el && el.getBoundingClientRect().top - window.innerHeight >= 600) armado.current = true;
  }, [data]);

  // Se carga sola al acercarte al final (600 px antes), que es como se recorre una parrilla;
  // el botón sigue ahí para quien prefiera pedirlo a mano.
  //
  // UNA carga por acercamiento: el cerrojo no se rearma hasta que el pie vuelve a quedar
  // lejos. Un gesto de rueda suelta decenas de eventos, y las tarjetas recién añadidas
  // tardan en tener carátula —y altura—, así que sin el cerrojo el pie puede seguir en zona
  // y encadenar tandas que nadie ha pedido. Va con un evento de scroll y no con
  // IntersectionObserver porque ese avisa también cuando la parrilla CRECE, que es justo
  // cuando no hay que pedir nada.
  useEffect(() => {
    const alBajar = () => {
      const el = centinela.current;
      if (!el) return;
      if (el.getBoundingClientRect().top - window.innerHeight >= 600) {
        armado.current = true;
        return;
      }
      if (!armado.current) return;
      armado.current = false;
      cargarMas();
    };
    window.addEventListener('scroll', alBajar, { passive: true });
    return () => window.removeEventListener('scroll', alBajar);
  }, [cargarMas]);

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
      <PageTitle
        icon={Disc}
        title="Discoteca"
        sub={
          data
            ? data.albums.length < data.total
              ? `${data.albums.length.toLocaleString('es')} de ${data.total.toLocaleString('es')} álbumes`
              : `${data.total.toLocaleString('es')} álbumes`
            : 'Toda tu colección'
        }
      />

      <div className="flex flex-wrap gap-2 mb-5">
        <input
          value={f.q}
          onChange={set('q')}
          placeholder="Buscar álbum o artista…"
          className={`${sel} flex-1 min-w-[180px]`}
        />
        {/* Géneros CANÓNICOS, los mismos de la sección «Géneros». Antes era un campo libre
            contra las etiquetas crudas: elegir «Rock» dejaba fuera «rock», «Classic Rock» y
            «ロック», porque son cadenas distintas en los ficheros. */}
        <select value={f.genre} onChange={set('genre')} className={`${sel} max-w-[14rem]`}>
          <option value="">Género</option>
          {filters?.canonicalGenres?.map((g) => (
            <option key={g.value} value={g.value}>
              {g.sub ? `   ${g.label.split(' · ')[1]}` : g.label} ({g.count})
            </option>
          ))}
        </select>
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

      {data && data.albums.length < data.total && (
        <div ref={centinela} className="mt-6 flex justify-center">
          <Button onClick={cargarMas} disabled={cargandoMas}>
            <span className="inline-flex items-center gap-1.5">
              {cargandoMas && <Loader2 size={14} className="animate-spin" />}
              {cargandoMas ? 'Cargando…' : `Ver más (quedan ${(data.total - data.albums.length).toLocaleString('es')})`}
            </span>
          </Button>
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
