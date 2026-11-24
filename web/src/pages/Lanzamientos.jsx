import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  CalendarClock, Heart, MoreHorizontal, Download, Search, ExternalLink, X, Star, Disc3, SlidersHorizontal,
  ChevronLeft, ChevronRight, Loader2, RefreshCw, Check, Undo2,
} from 'lucide-react';
import { api } from '../api.js';
import { PageTitle, Spinner, ErrorMsg, SearchModal, WantButton, AddToChallengeButton, Button, useLidarrEnabled, useEscape } from '../components.jsx';
import { aviso } from '../avisos.jsx';
import { useTandas, VerMas } from '../tandas.jsx';
import { LabelManager, CuratorManager } from './piezasLanzamientos.jsx';

// LANZAMIENTOS, POR LO QUE UNO SE PREGUNTA.
//
// Antes eran nueve pestañas, una por fuente de datos, con el mismo disco repetido en varias
// y hasta siete botones por fila (al título le quedaban 126 px). Ahora son tres preguntas
// —qué viene, qué ha salido que me falta, qué me recomiendan— sobre UNA lista que el
// servidor ya trae fundida (server/src/lanzamientos.js): una fila por disco, con el motivo
// por el que está ahí, una acción principal y el resto en un menú.

const VISTAS = [
  { k: 'porvenir', label: 'Por venir' },
  { k: 'recientes', label: 'Recién salido' },
  { k: 'descubrir', label: 'Descubrir' },
];
const TIPOS = [
  { k: 'album', label: 'Álbumes' },
  { k: 'ep', label: 'EP' },
  { k: 'single', label: 'Singles' },
  { k: 'otro', label: 'Directos y recopilatorios' },
];
const VENTANAS = { recientes: [30, 90, 365], descubrir: [7, 30, 90] };
const POR_DEFECTO = { recientes: 90, descubrir: 30 };

const dia = (iso) => new Date(`${iso}T12:00:00`);
const hoyIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const corto = (iso) => dia(iso).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
const mesLargo = (iso) => {
  const t = dia(`${iso.slice(0, 7)}-01`).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
  return t.charAt(0).toUpperCase() + t.slice(1);
};
// lunes de la semana de una fecha, para agrupar por semanas (los discos salen los viernes)
const lunesDe = (iso) => {
  const d = dia(iso);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};

// En qué grupo cae una fila: esta semana, la que viene, luego por meses, luego por años.
function grupoDe(f, hoy) {
  if (!f.date || f.date.length < 10) return f.date ? `En ${f.date.slice(0, 4)}, fecha por confirmar` : 'Fecha por confirmar';
  const semanas = Math.round((Date.parse(lunesDe(f.date)) - Date.parse(lunesDe(hoy))) / (7 * 86400000));
  if (semanas === 0) return 'Esta semana';
  if (semanas === 1) return 'La semana que viene';
  if (semanas === -1) return 'La semana pasada';
  if (f.date.slice(0, 4) !== hoy.slice(0, 4) && f.date > hoy) return f.date.slice(0, 4);
  return mesLargo(f.date);
}

const NOMBRE_ENLACE = { deezer: 'Deezer', cancion: 'Deezer', descubre: 'Deezer', radar: 'Reseña o tienda' };

// ------------------------------------------------------------------------------- una fila
function Fila({ f, hoy, estado, alPedir, alBuscar, alDescartar, alSeguir, lidarrOn }) {
  const [menu, setMenu] = useState(false);
  const caja = useRef(null);
  useEscape(() => setMenu(false), menu);
  useEffect(() => {
    if (!menu) return undefined;
    const fuera = (e) => caja.current && !caja.current.contains(e.target) && setMenu(false);
    document.addEventListener('mousedown', fuera);
    return () => document.removeEventListener('mousedown', fuera);
  }, [menu]);

  const [sinImg, setSinImg] = useState(false);
  const portada = f.cover || (f.rg_mbid ? `https://coverartarchive.org/release-group/${f.rg_mbid}/front-250` : null);
  const pedido = estado === 'pedido' || f.requested;
  const cuando =
    !f.date || f.date.length < 10
      ? null
      : f.cuando === 'futuro'
        ? `Sale el ${corto(f.date)}`
        : f.date === hoy
          ? 'Sale hoy'
          : `Salió el ${corto(f.date)}`;
  const tipo = { ep: 'EP', single: 'Single', otro: 'Directo o recopilatorio' }[f.tipo];
  const item = 'w-full text-left px-3 py-1.5 text-sm hover:bg-ink-800 inline-flex items-center gap-2 disabled:opacity-40';

  return (
    <div className="card p-2.5 flex items-center gap-3">
      <div className="w-11 h-11 rounded overflow-hidden shrink-0 bg-ink-850 flex items-center justify-center text-neutral-500" aria-hidden="true">
        {portada && !sinImg ? <img src={portada} alt="" loading="lazy" className="w-full h-full object-cover" onError={() => setSinImg(true)} /> : <Disc3 size={18} />}
      </div>
      <div className="min-w-0 flex-1">
        {/* en el móvil el título puede ocupar dos líneas: en una sola no cabía ni el artista */}
        <div className="truncate clamp-mobile text-sm">
          {f.artistas.map((a, i) => (
            <span key={a.name}>
              {i > 0 && ' & '}
              {a.id ? (
                <Link to={`/artista/${a.id}`} className="hover:text-gold-400">
                  {a.name}
                </Link>
              ) : (
                a.name
              )}
            </span>
          ))}
          <span className="text-neutral-500"> — </span>
          {f.title}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-neutral-500">
          {cuando && <span>{cuando}</span>}
          {tipo && <span>{tipo}</span>}
          {f.relacion === 'sigo' && <span className="lanz-motivo lanz-tuyo">Sigues al artista</span>}
          {f.sellos.map((s) => (
            <span key={s} className="lanz-motivo lanz-tuyo">
              Sello {s}
            </span>
          ))}
          {f.relacion === 'coleccion' && <span className="lanz-motivo">En tu colección</span>}
          {f.curadores.map((c) => (
            <span key={c.nombre} className="lanz-motivo" title={c.nota ? `Su nota: ${c.nota}` : undefined}>
              {c.nota ? `${c.nombre}: «${c.nota}»` : `Lo recomienda ${c.nombre}`}
            </span>
          ))}
          {/* el «porqué» de afines solo dice algo de lo que no es tuyo: en lo que sigues repetía el motivo */}
          {f.razon && f.relacion === 'descubrir' && !f.curadores.length && <span className="lanz-motivo">{f.razon}</span>}
          {f.sinMb && <span title="Está en Deezer pero MusicBrainz aún no lo lista">Aún no está en MusicBrainz</span>}
          {f.owned && (
            <span className="text-emerald-400 inline-flex items-center gap-1">
              <Check size={12} /> ya lo tienes
            </span>
          )}
          {pedido && !f.owned && <span className="text-emerald-400">pedido</span>}
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {/* en pantallas estrechas el corazón va sin texto: el sitio es para el título */}
        {!f.owned &&
          ['hidden sm:inline-flex', 'sm:hidden'].map((visible, i) => (
            <span key={visible} className={visible}>
              <WantButton
                artist={f.artistas[0].name}
                title={f.title}
                rg_mbid={f.rg_mbid}
                releaseDate={f.date}
                cover={f.cover}
                origin={f.relacion === 'descubrir' ? 'radar' : 'calendario'}
                size="md"
                label={i === 0 ? undefined : ''}
                className={i === 0 ? undefined : 'w-9 h-9 rounded-lg border border-ink-700 bg-ink-850 inline-flex items-center justify-center'}
              />
            </span>
          ))}
        <div className="relative" ref={caja}>
          <button
            type="button"
            onClick={() => setMenu((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menu}
            aria-label={`Más acciones para ${f.title}`}
            className="w-9 h-9 rounded-lg border border-ink-700 bg-ink-850 hover:bg-ink-800 inline-flex items-center justify-center"
          >
            {estado === 'ocupado' ? <Loader2 size={15} className="animate-spin" /> : <MoreHorizontal size={16} />}
          </button>
          {menu && (
            <div role="menu" className="absolute right-0 top-full mt-1 z-30 w-60 py-1 rounded-lg border border-ink-700 bg-ink-900 shadow-xl">
              {!f.owned && (
                <button type="button" role="menuitem" className={item} disabled={pedido || estado === 'ocupado'} onClick={() => (setMenu(false), alPedir(f))}>
                  <Download size={14} /> {pedido ? 'Ya está pedido' : lidarrOn && f.rg_mbid ? 'Encargar a Lidarr' : 'Descargar ahora'}
                </button>
              )}
              <button type="button" role="menuitem" className={item} onClick={() => (setMenu(false), alBuscar(f))}>
                <Search size={14} /> Buscar a mano
              </button>
              <div className="px-3 py-1.5">
                <AddToChallengeButton artist={f.artistas[0].name} title={f.title} label="Añadir a un reto" size="md" />
              </div>
              {f.relacion !== 'sigo' && (
                <button type="button" role="menuitem" className={item} onClick={() => (setMenu(false), alSeguir(f))}>
                  <Star size={14} /> Seguir a {f.artistas[0].name}
                </button>
              )}
              <div className="my-1 border-t border-ink-800" />
              {f.rg_mbid && (
                <a role="menuitem" className={item} href={`https://musicbrainz.org/release-group/${f.rg_mbid}`} target="_blank" rel="noreferrer">
                  <ExternalLink size={14} /> MusicBrainz
                </a>
              )}
              {f.enlaces.slice(0, 2).map((e) => (
                <a key={e.url} role="menuitem" className={item} href={e.url} target="_blank" rel="noreferrer">
                  <ExternalLink size={14} /> {NOMBRE_ENLACE[e.fuente] || 'Enlace'}
                </a>
              ))}
              <a
                role="menuitem"
                className={item}
                href={`https://open.spotify.com/search/${encodeURIComponent(`${f.artistas[0].name} ${f.title}`)}`}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink size={14} /> Buscar en Spotify
              </a>
              <div className="my-1 border-t border-ink-800" />
              <button type="button" role="menuitem" className={item} onClick={() => (setMenu(false), alDescartar(f))}>
                <X size={14} /> No me interesa
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------- vista de mes
function Mes({ items, hoy, fila }) {
  const [cursor, setCursor] = useState(hoy.slice(0, 7));
  const [sel, setSel] = useState(hoy);
  const porDia = useMemo(() => {
    const m = new Map();
    for (const f of items) {
      if (!m.has(f.date)) m.set(f.date, []);
      m.get(f.date).push(f);
    }
    return m;
  }, [items]);
  const celdas = useMemo(() => {
    const primero = dia(`${cursor}-01`);
    const ini = new Date(primero);
    ini.setDate(1 - ((primero.getDay() + 6) % 7));
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(ini);
      d.setDate(ini.getDate() + i);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    });
  }, [cursor]);
  const mover = (n) => {
    const d = dia(`${cursor}-01`);
    d.setMonth(d.getMonth() + n);
    setCursor(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };
  const delDia = porDia.get(sel) || [];
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Button onClick={() => mover(-1)} aria-label="Mes anterior">
          <ChevronLeft size={15} />
        </Button>
        <Button onClick={() => mover(1)} aria-label="Mes siguiente">
          <ChevronRight size={15} />
        </Button>
        <Button
          onClick={() => {
            setCursor(hoy.slice(0, 7));
            setSel(hoy);
          }}
        >
          Hoy
        </Button>
        <h2 className="ml-auto font-display">{mesLargo(`${cursor}-01`)}</h2>
      </div>
      <div className="grid grid-cols-7 text-[11px] text-neutral-500 text-center mb-1">
        {['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'].map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px rounded-xl overflow-hidden border border-ink-800 bg-ink-800">
        {celdas.map((d) => {
          const ev = porDia.get(d) || [];
          const fuera = d.slice(0, 7) !== cursor;
          const faltan = ev.filter((f) => !f.owned).length;
          return (
            <button
              key={d}
              type="button"
              onClick={() => setSel(d)}
              aria-pressed={sel === d}
              aria-label={`${corto(d)}: ${ev.length} lanzamientos`}
              className={`min-h-[4.25rem] sm:min-h-[5.5rem] p-1.5 text-left align-top bg-ink-900 hover:bg-ink-850 ${fuera ? 'opacity-50' : ''} ${
                sel === d ? 'outline outline-2 -outline-offset-2 outline-gold-500' : ''
              }`}
            >
              <span className={`text-xs ${d === hoy ? 'lanz-hoy' : 'text-neutral-400'}`}>{Number(d.slice(8))}</span>
              {ev.length > 0 && (
                <>
                  <div className="hidden sm:block mt-1 space-y-0.5">
                    {ev.slice(0, 2).map((f) => (
                      <div key={f.clave} className={`truncate text-[11px] ${f.owned ? 'text-neutral-500' : ''}`}>
                        {f.artist}
                      </div>
                    ))}
                    {ev.length > 2 && <div className="text-[11px] text-neutral-500">+{ev.length - 2} más</div>}
                  </div>
                  <div className="sm:hidden mt-1 text-[11px] text-gold-400">{faltan || ev.length}</div>
                </>
              )}
            </button>
          );
        })}
      </div>
      <h3 className="text-sm text-neutral-400 mt-5 mb-2">
        {corto(sel)} · {delDia.length ? `${delDia.length} lanzamiento${delDia.length === 1 ? '' : 's'}` : 'sin lanzamientos'}
      </h3>
      <div className="space-y-2">{delDia.map(fila)}</div>
    </div>
  );
}

// ------------------------------------------------------------------------ panel de fuentes
function Fuentes({ alCerrar, alCambiar }) {
  const [sellos, setSellos] = useState(null);
  const [curadores, setCuradores] = useState(null);
  const [barrido, setBarrido] = useState(null); // texto de progreso
  const reloj = useRef(null);
  useEscape(alCerrar);
  const cargar = () => {
    api.trackedLabels().then(setSellos).catch((e) => aviso(e.message, 'error'));
    api.curators().then(setCuradores).catch((e) => aviso(e.message, 'error'));
  };
  useEffect(() => {
    cargar();
    return () => clearInterval(reloj.current);
  }, []);
  const cambio = () => {
    cargar();
    alCambiar();
  };
  const barrer = async (arrancar, estado, que) => {
    try {
      await arrancar();
    } catch (e) {
      aviso(e.message, 'error');
      return;
    }
    setBarrido(`Buscando ${que}…`);
    clearInterval(reloj.current);
    reloj.current = setInterval(async () => {
      let st;
      try {
        st = await estado();
      } catch {
        return;
      }
      if (st.total) setBarrido(`Buscando ${que}… ${st.done}/${st.total} artistas`);
      if (!st.running) {
        clearInterval(reloj.current);
        setBarrido(null);
        aviso(`Búsqueda de ${que} terminada.`, 'ok');
        alCambiar();
      }
    }, 3000);
  };
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center p-4 bg-black/60 overflow-y-auto" onClick={alCerrar}>
      <div role="dialog" aria-modal="true" aria-label="Fuentes de lanzamientos" className="card p-4 w-full max-w-2xl my-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display">De dónde salen los lanzamientos</h2>
          <button type="button" onClick={alCerrar} aria-label="Cerrar" className="w-8 h-8 inline-flex items-center justify-center rounded hover:bg-ink-800">
            <X size={16} />
          </button>
        </div>
        <p className="text-xs text-neutral-500 mb-4">
          Los artistas que sigues se gestionan en <Link to="/seguidos" className="text-gold-400 hover:underline">Seguidos</Link>. Aquí, los sellos y las
          personas cuyo criterio te fías. Todo se actualiza solo cada noche.
        </p>
        <h3 className="text-sm text-neutral-300 mb-2">Sellos que sigues</h3>
        {sellos ? <LabelManager labels={sellos} onChange={cambio} /> : <Spinner />}
        <h3 className="text-sm text-neutral-300 mt-5 mb-2">Curadores (quién te recomienda)</h3>
        {curadores ? <CuratorManager curators={curadores} onChange={cambio} /> : <Spinner />}
        <h3 className="text-sm text-neutral-300 mt-5 mb-2">Buscar ahora, sin esperar a la noche</h3>
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={!!barrido} onClick={() => barrer(api.refreshNewReleases, api.refreshNewReleasesStatus, 'novedades de tu colección')}>
            <RefreshCw size={13} className="inline mr-1" /> Novedades de mi colección
          </Button>
          <Button disabled={!!barrido} onClick={() => barrer(api.refreshGlobalReleases, api.refreshGlobalReleasesStatus, 'recomendaciones')}>
            <RefreshCw size={13} className="inline mr-1" /> Recomendaciones de afines
          </Button>
          {barrido && <span className="text-xs text-neutral-400">{barrido}</span>}
        </div>
        <p className="text-xs text-neutral-500 mt-2">Consultan Deezer artista a artista: tardan unos minutos y puedes cerrar esto mientras.</p>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------------- página
export default function Lanzamientos() {
  const [sp, setSp] = useSearchParams();
  const lidarrOn = useLidarrEnabled();
  const hoy = hoyIso();

  // Todo el estado de lo que estás viendo vive en la dirección: al volver de una ficha estás
  // donde estabas, y se puede guardar en marcadores.
  const vista = ['recientes', 'descubrir', 'mes'].includes(sp.get('v')) ? sp.get('v') : 'porvenir';
  const alcance = sp.get('a') === 'coleccion' ? 'coleccion' : 'sigo';
  const tipos = (sp.get('t') || 'album,ep').split(',').filter((t) => TIPOS.some((x) => x.k === t));
  const reediciones = sp.get('r') === '1';
  const conTuyos = sp.get('tuyos') === '1';
  const dias = Number(sp.get('d')) || POR_DEFECTO[vista] || null;
  const curador = sp.get('c') || '';
  const pon = (cambios) => {
    const n = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(cambios)) {
      if (v == null || v === '' || v === false) n.delete(k);
      else n.set(k, v === true ? '1' : String(v));
    }
    setSp(n, { replace: true });
  };

  const [datos, setDatos] = useState(null);
  const [err, setErr] = useState(null);
  const [vuelta, setVuelta] = useState(0);
  const [estados, setEstados] = useState({}); // clave → 'ocupado' | 'pedido'
  const [buscar, setBuscar] = useState(null);
  const [fuentes, setFuentes] = useState(false);
  const [deshacer, setDeshacer] = useState(null); // la última fila descartada
  const [vigilando, setVigilando] = useState(null);
  const relojDeshacer = useRef(null);

  const consulta = `${vista}|${alcance}|${tipos.join(',')}|${reediciones}|${conTuyos}|${dias}`;
  useEffect(() => {
    let vigente = true;
    setErr(null);
    setDatos(null);
    api
      .lanzamientos({ vista: vista === 'mes' ? 'todo' : vista, alcance, tipos: tipos.join(','), reediciones, dias, tuyos: conTuyos })
      .then((d) => vigente && setDatos(d))
      .catch((e) => vigente && setErr(e.message));
    return () => {
      vigente = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consulta, vuelta]);
  useEffect(() => {
    api
      .wanted()
      .then((w) => setVigilando(w?.counts?.watching ?? null))
      .catch(() => {});
    return () => clearTimeout(relojDeshacer.current);
  }, []);

  const items = useMemo(() => {
    if (!datos) return null;
    const quitada = deshacer?.clave;
    return datos.items.filter((f) => f.clave !== quitada && (!curador || f.curadores.some((c) => c.nombre === curador)));
  }, [datos, curador, deshacer]);
  const curadores = useMemo(() => {
    if (!datos || vista !== 'descubrir') return [];
    const n = new Map();
    for (const f of datos.items) for (const c of f.curadores) n.set(c.nombre, (n.get(c.nombre) || 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1]);
  }, [datos, vista]);
  const tandas = useTandas(vista === 'mes' ? null : items, { tamano: 60, clave: `${consulta}|${curador}` });
  const grupos = useMemo(() => {
    const out = [];
    for (const f of tandas.visibles) {
      const g = vista === 'descubrir' && f.cuando === 'futuro' ? 'Por venir' : grupoDe(f, hoy);
      if (!out.length || out[out.length - 1].nombre !== g) out.push({ nombre: g, filas: [] });
      out[out.length - 1].filas.push(f);
    }
    return out;
  }, [tandas.visibles, vista, hoy]);

  const marca = (clave, v) => setEstados((p) => ({ ...p, [clave]: v }));
  const pedir = async (f) => {
    if (estados[f.clave]) return; // cada fila lleva su propio cerrojo: no se pide dos veces
    marca(f.clave, 'ocupado');
    try {
      if (lidarrOn && f.rg_mbid) await api.lidarrAdd(f.rg_mbid, f.artist_mbid);
      else {
        const r = await api.grabBest(`${f.artistas[0].name} ${f.title}`, { rg_mbid: f.rg_mbid, artist: f.artistas[0].name, album: f.title });
        if (!r.grabbed) {
          aviso(`No se encontró nada que descargar: ${r.reason || 'sin release'}. Puedes marcarlo con «Lo quiero» para que se siga buscando.`, 'info');
          marca(f.clave, undefined);
          return;
        }
      }
      marca(f.clave, 'pedido');
      aviso(`«${f.title}» pedido.`, 'ok');
    } catch (e) {
      aviso(e.message, 'error');
      marca(f.clave, undefined);
    }
  };
  const seguir = async (f) => {
    try {
      let mbid = f.artist_mbid;
      const radar = f.refs.find((r) => r.tipo === 'radar');
      if (!mbid && radar) mbid = (await api.radarResolve(radar.id)).artist_mbid;
      if (!mbid) {
        aviso(`No se ha podido identificar a ${f.artistas[0].name} en MusicBrainz. Búscalo desde Seguidos.`, 'info');
        return;
      }
      await api.followMbid(mbid);
      aviso(`Ahora sigues a ${f.artistas[0].name}.`, 'ok');
      setVuelta((v) => v + 1);
    } catch (e) {
      aviso(e.message, 'error');
    }
  };
  const descartar = async (f) => {
    try {
      await api.lanzamientosDescartar(f.refs);
      setDeshacer(f);
      clearTimeout(relojDeshacer.current);
      relojDeshacer.current = setTimeout(() => setDeshacer(null), 9000);
    } catch (e) {
      aviso(e.message, 'error');
    }
  };
  const recuperar = async () => {
    const f = deshacer;
    clearTimeout(relojDeshacer.current);
    try {
      await api.lanzamientosRestaurar(f.refs);
      setDeshacer(null);
    } catch (e) {
      aviso(e.message, 'error');
    }
  };

  const fila = (f) => (
    <Fila
      key={f.clave}
      f={f}
      hoy={hoy}
      estado={estados[f.clave]}
      alPedir={pedir}
      alBuscar={(x) => setBuscar(`${x.artistas[0].name} ${x.title}`)}
      alDescartar={descartar}
      alSeguir={seguir}
      lidarrOn={lidarrOn}
    />
  );
  const chip = (activo) =>
    `text-xs px-2.5 py-1 rounded-lg border transition ${activo ? 'border-gold-500/40 bg-gold-500/15 text-gold-300' : 'border-ink-800 text-neutral-400 hover:bg-ink-850'}`;
  const seg = (activo) => `text-sm px-3 py-1.5 border-y border-r first:border-l first:rounded-l-lg last:rounded-r-lg border-ink-700 ${activo ? 'bg-ink-800 text-neutral-100' : 'bg-ink-900 text-neutral-400 hover:bg-ink-850'}`;
  const cambiaTipo = (k) => {
    const n = tipos.includes(k) ? tipos.filter((t) => t !== k) : [...tipos, k];
    pon({ t: n.length && n.join(',') !== 'album,ep' ? n.join(',') : null });
  };

  const vacio = {
    porvenir: alcance === 'sigo' ? 'Nada anunciado de lo que sigues. Prueba con «Toda mi colección».' : 'Nada anunciado por ahora.',
    recientes: 'Nada reciente que te falte en esta ventana.',
    descubrir: 'Nada que recomendarte en esta ventana. Sigue a algún curador o sello en «Fuentes».',
    mes: '',
  }[vista];

  return (
    <div>
      <PageTitle icon={CalendarClock} title="Lanzamientos">
        <Link to="/lo-quiero" className="text-sm px-3 py-1.5 rounded-lg border border-ink-700 bg-ink-850 hover:bg-ink-800 inline-flex items-center gap-1.5">
          <Heart size={14} /> {vigilando == null ? 'Lo quiero' : `${vigilando} vigilando`}
        </Link>
        <Button onClick={() => setFuentes(true)}>
          <SlidersHorizontal size={13} className="inline mr-1" /> Fuentes
        </Button>
      </PageTitle>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-3">
        <div className="inline-flex" role="tablist" aria-label="Qué quieres ver">
          {VISTAS.map((v) => (
            <button key={v.k} type="button" role="tab" aria-selected={vista === v.k} onClick={() => pon({ v: v.k === 'porvenir' ? null : v.k, d: null, c: null })} className={seg(vista === v.k)}>
              {v.label}
              {datos?.cuentas && <span className="text-neutral-500"> · {datos.cuentas[v.k]}</span>}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => pon({ v: vista === 'mes' ? null : 'mes', d: null, c: null })} aria-pressed={vista === 'mes'} className={`text-sm px-3 py-1.5 rounded-lg border border-ink-700 ${vista === 'mes' ? 'bg-ink-800 text-neutral-100' : 'bg-ink-900 text-neutral-400 hover:bg-ink-850'}`}
        >
          <CalendarClock size={14} className="inline mr-1" /> Calendario
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-5">
        {vista !== 'descubrir' && (
          <select
            value={alcance}
            onChange={(e) => pon({ a: e.target.value === 'coleccion' ? 'coleccion' : null })}
            aria-label="De quién"
            className="bg-ink-850 border border-ink-800 rounded-lg px-2.5 py-1 text-xs"
          >
            <option value="sigo">Lo que sigo</option>
            <option value="coleccion">Toda mi colección</option>
          </select>
        )}
        {VENTANAS[vista] && (
          <select
            value={dias}
            onChange={(e) => pon({ d: Number(e.target.value) === POR_DEFECTO[vista] ? null : e.target.value })}
            aria-label="Desde cuándo"
            className="bg-ink-850 border border-ink-800 rounded-lg px-2.5 py-1 text-xs"
          >
            {VENTANAS[vista].map((d) => (
              <option key={d} value={d}>
                {d === 365 ? 'Último año' : `Últimos ${d} días`}
              </option>
            ))}
          </select>
        )}
        {TIPOS.map((t) => (
          <button key={t.k} type="button" aria-pressed={tipos.includes(t.k)} onClick={() => cambiaTipo(t.k)} className={chip(tipos.includes(t.k))}>
            {t.label}
          </button>
        ))}
        <button type="button" aria-pressed={reediciones} onClick={() => pon({ r: !reediciones })} className={chip(reediciones)}>
          Reediciones
        </button>
        {vista === 'recientes' && datos?.yaTienes > 0 && (
          <button type="button" aria-pressed={conTuyos} onClick={() => pon({ tuyos: !conTuyos })} className={chip(conTuyos)}>
            Ya los tengo · {datos.yaTienes}
          </button>
        )}
      </div>

      {vista === 'descubrir' && curadores.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 mb-5 -mt-2">
          <span className="text-xs text-neutral-500">Quién lo recomienda:</span>
          <button type="button" aria-pressed={!curador} onClick={() => pon({ c: null })} className={chip(!curador)}>
            Todos
          </button>
          {curadores.map(([n, c]) => (
            <button key={n} type="button" aria-pressed={curador === n} onClick={() => pon({ c: n })} className={chip(curador === n)}>
              {n} <span className="text-neutral-500">· {c}</span>
            </button>
          ))}
        </div>
      )}

      {deshacer && (
        <div className="aviso aviso-info px-3 py-2 mb-3 text-sm flex items-center gap-3" role="status">
          <span className="min-w-0 flex-1 truncate">Quitado de la lista: {deshacer.artist} — {deshacer.title}</span>
          <button type="button" onClick={recuperar} className="shrink-0 underline inline-flex items-center gap-1">
            <Undo2 size={13} /> Deshacer
          </button>
        </div>
      )}

      {err ? (
        <ErrorMsg>{err}</ErrorMsg>
      ) : !items ? (
        <Spinner />
      ) : vista === 'mes' ? (
        <Mes items={items} hoy={hoy} fila={fila} />
      ) : items.length === 0 ? (
        <div className="card p-8 text-center text-neutral-400 text-sm">{vacio}</div>
      ) : (
        <>
          {grupos.map((g) => (
            <section key={g.nombre} className="mb-5">
              <h2 className="text-sm text-neutral-400 mb-2">{g.nombre}</h2>
              <div className="space-y-2">{g.filas.map(fila)}</div>
            </section>
          ))}
          <VerMas tandas={tandas} />
        </>
      )}

      {buscar != null && <SearchModal initialQuery={buscar} onClose={() => setBuscar(null)} />}
      {fuentes && <Fuentes alCerrar={() => setFuentes(false)} alCambiar={() => setVuelta((v) => v + 1)} />}
    </div>
  );
}
