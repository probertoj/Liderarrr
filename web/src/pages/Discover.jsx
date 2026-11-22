import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Compass, Plus, Check, X, RefreshCw, Loader2, ExternalLink } from 'lucide-react';
import { api, pollLidarrQueue } from '../api.js';
import { PageTitle, Spinner, ErrorMsg, Button, SearchModal, QuickSearch, AddToChallengeButton, WantButton, ReleaseYear, useLidarrEnabled } from '../components.jsx';
import { aviso, confirmar } from '../avisos.jsx';
import { useTandas, VerMas } from '../tandas.jsx';

// Huecos: álbumes de estudio que MusicBrainz conoce de tus artistas y que no
// tienes. Agrupados por artista, con envío a Lidarr (uno o todos) y opción de
// descartar los que no te interesan.
export default function Discover() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [all, setAll] = useState(false);
  const [added, setAdded] = useState({});
  const [busy, setBusy] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [queue, setQueue] = useState(null);
  const [search, setSearch] = useState(null); // query del modal de búsqueda manual
  const lidarrOn = useLidarrEnabled();
  // ¿Sigue la página en pantalla? Los sondeos de abajo duran minutos: sin esto seguían
  // preguntando al servidor después de irte.
  const vivo = useRef(true);
  // Qué lista se está pidiendo: «todos los artistas» tarda mucho más que «los que sigo»,
  // y si marcabas y desmarcabas la casilla, la lenta llegaba la última y ganaba.
  const pedida = useRef(0);
  const paraCola = useRef(null);

  useEffect(() => {
    vivo.current = true;
    return () => {
      vivo.current = false;
      paraCola.current?.();
    };
  }, []);

  const load = () => {
    const turno = ++pedida.current;
    return api
      .gaps(all)
      .then((d) => {
        if (vivo.current && turno === pedida.current) {
          setData(d);
          setErr(null);
        }
      })
      .catch((e) => {
        if (vivo.current && turno === pedida.current) setErr(e.message);
      });
  };
  useEffect(() => {
    setData(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all]);

  const sondearCola = () => {
    paraCola.current?.();
    paraCola.current = pollLidarrQueue(setQueue);
  };

  // Con Lidarr → envío encolado (Lidarr es lento; se sondea el progreso). Sin Lidarr →
  // descarga nativa (grabBest agarra la mejor release; el auto-import la coloca).
  const add = async (rg, group) => {
    if (busy != null) return;
    setBusy(rg.rg_mbid);
    try {
      if (lidarrOn) {
        await api.lidarrAdd(rg.rg_mbid, group.artist_mbid);
        sondearCola();
      } else {
        const res = await api.grabBest(`${group.artist || ''} ${rg.title}`.trim(), { rg_mbid: rg.rg_mbid, artist: group.artist, album: rg.title });
        if (!res.grabbed) {
          aviso(`No se pudo agarrar: ${res.reason || 'sin release'}`, 'error');
          return;
        }
      }
      setAdded((p) => ({ ...p, [rg.rg_mbid]: true }));
    } catch (e) {
      aviso(e.message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const addArtist = async (group) => {
    if (busy != null) return; // un doble clic lanzaba la tanda dos veces
    const toSend = group.missing.filter((m) => !added[m.rg_mbid] && !m.in_lidarr && !m.requested);
    if (!toSend.length) {
      aviso('Ya están todos pedidos.', 'info');
      return;
    }
    const n = toSend.length;
    // Cada disco es al menos una búsqueda en tus trackers: que se sepa antes de lanzarla.
    const pregunta = lidarrOn
      ? `¿Enviar a Lidarr ${n} ${n === 1 ? 'disco' : 'discos'} de ${group.artist}?`
      : `¿Buscar y descargar ${n} ${n === 1 ? 'disco' : 'discos'} de ${group.artist}?\n\nSon ${n === 1 ? 'una búsqueda' : `${n} búsquedas`} en tus trackers, una detrás de otra y con el freno puesto: puede tardar. De cada disco se pide la mejor release que haya.`;
    if (!(await confirmar(pregunta, { aceptar: lidarrOn ? 'Enviar todos' : 'Descargar todos' }))) return;

    setBusy(group.artist_id);
    try {
      if (lidarrOn) {
        await api.lidarrAddBulk(toSend.map((m) => ({ rg_mbid: m.rg_mbid, artist_mbid: group.artist_mbid })));
        setAdded((p) => ({ ...p, ...Object.fromEntries(toSend.map((m) => [m.rg_mbid, true])) }));
        sondearCola();
      } else {
        let pedidos = 0;
        const sinSuerte = [];
        for (const m of toSend) {
          if (!vivo.current) return; // te fuiste de la página: no se siguen lanzando búsquedas
          try {
            const res = await api.grabBest(`${group.artist || ''} ${m.title}`.trim(), { rg_mbid: m.rg_mbid, artist: group.artist, album: m.title });
            if (res.grabbed) {
              pedidos++;
              setAdded((p) => ({ ...p, [m.rg_mbid]: true }));
            } else {
              sinSuerte.push(`${m.title} (${res.reason || 'sin release'})`);
            }
          } catch (e) {
            // uno que falla no corta la tanda, pero se cuenta
            sinSuerte.push(`${m.title} (${e.message})`);
          }
        }
        // Antes lo que no se conseguía no dejaba rastro: el botón volvía a su sitio y ya.
        if (!sinSuerte.length) aviso(`${group.artist}: ${pedidos === 1 ? 'pedido 1 disco' : `pedidos los ${pedidos} discos`}.`, 'ok');
        else {
          const lista = sinSuerte.slice(0, 6).join('; ') + (sinSuerte.length > 6 ? `; y ${sinSuerte.length - 6} más` : '');
          aviso(`${group.artist}: pedidos ${pedidos} de ${n}. No se pudo con: ${lista}.`, pedidos ? 'info' : 'error');
        }
      }
    } catch (e) {
      aviso(e.message, 'error');
    } finally {
      if (vivo.current) setBusy(null);
    }
  };

  const dismiss = async (rg) => {
    try {
      await api.dismiss(rg.rg_mbid, rg.title);
      await load();
    } catch (e) {
      aviso(e.message, 'error');
    }
  };

  const recalc = async () => {
    setRefreshing(true);
    try {
      await api.discographyRefresh(!all);
      // sondear hasta que termine (o hasta que te vayas de la página)
      let done = false;
      while (!done && vivo.current) {
        await new Promise((r) => setTimeout(r, 1500));
        if (!vivo.current) return;
        const s = await api.discographyStatus();
        done = !s.running;
      }
      if (vivo.current) await load();
    } catch (e) {
      aviso(e.message, 'error');
    } finally {
      if (vivo.current) setRefreshing(false);
    }
  };

  // Con «todos los artistas» son miles de filas: los artistas se pintan de 40 en 40.
  const tandas = useTandas(data?.artists, { tamano: 40, clave: all ? 'todos' : 'seguidos' });
  const ocupado = busy != null;

  return (
    <div>
      <PageTitle
        icon={Compass}
        title="Huecos"
        sub={data ? `${data.total} álbumes de estudio que te faltan` : 'Lo que no tienes de tus artistas'}
      >
        <Button onClick={recalc} disabled={refreshing}>
          <span className="inline-flex items-center gap-1.5">
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /> Recalcular
          </span>
        </Button>
      </PageTitle>
      <QuickSearch />

      <label className="flex items-center gap-2 text-sm text-neutral-400 mb-4 cursor-pointer">
        <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
        Incluir todos los artistas con MBID (no solo los que sigo)
      </label>

      {queue &&
        (queue.running ? (
          <p className="text-xs text-gold-300/90 mb-3">Lidarr: procesando {queue.done}/{queue.total}…</p>
        ) : (
          <p className="text-xs text-neutral-500 mb-3">
            Lidarr: {queue.added} enviados
            {queue.pending ? ` · ${queue.pending} pendientes de importar` : ''}
            {queue.errors?.length ? ` · ${queue.errors.length} con error` : ''}.
          </p>
        ))}

      {err && <ErrorMsg>{err}</ErrorMsg>}
      {!data && !err && <Spinner />}
      {data && data.artists.length === 0 && (
        <div className="card p-6 text-center text-neutral-400">
          Nada pendiente. {all ? 'Tienes todo lo que MusicBrainz conoce.' : 'Sigue a más artistas o pulsa «Recalcular» para cruzar sus discografías.'}
        </div>
      )}

      {data && tandas.quedan > 0 && (
        <p className="text-xs text-neutral-500 mb-2">
          Se ven {tandas.mostrados} de {tandas.total} artistas; el resto aparece al bajar.
        </p>
      )}
      <div className="space-y-4">
        {tandas.visibles.map((group) => (
          <div key={group.artist_id} className="card p-4 min-w-0">
            <div className="flex items-center justify-between gap-3 mb-3">
              <Link to={`/artista/${group.artist_id}`} className="font-medium hover:text-gold-400 min-w-0">
                <span className="break-words">{group.artist}</span>
                <span className="text-neutral-600 text-sm ml-2 whitespace-nowrap">faltan {group.missing.length}</span>
              </Link>
              <Button variant="gold" onClick={() => addArtist(group)} disabled={ocupado} className="shrink-0">
                <span className="inline-flex items-center gap-1.5">
                  {busy === group.artist_id && <Loader2 size={14} className="animate-spin" />}
                  {busy === group.artist_id ? (lidarrOn ? 'Enviando…' : 'Descargando…') : lidarrOn ? 'Enviar todos' : 'Descargar todos'}
                </span>
              </Button>
            </div>
            {/* Una columna hasta xl: cada fila lleva unos 290 px de botones y, a dos columnas,
                al título le quedaban entre 0 y 50 px. Por debajo de 640 px la fila se apila
                (.release-row): título arriba con todo el ancho, botones debajo. */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-1.5">
              {group.missing.map((m) => {
                const done = added[m.rg_mbid] || m.in_lidarr || m.requested;
                return (
                  <div key={m.rg_mbid} className="release-row text-sm bg-ink-850/50 rounded px-2.5 py-1.5 min-w-0">
                    <div className="release-main" title={m.title}>
                      <ReleaseYear date={m.first_release || m.year} />
                      <span className="truncate clamp-mobile min-w-0">{m.title}</span>
                    </div>
                    <div className="release-actions">
                      <a
                        href={`https://musicbrainz.org/release-group/${m.rg_mbid}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-gold-400 hover:underline inline-flex items-center gap-0.5"
                        title="Ver en MusicBrainz"
                      >
                        MB <ExternalLink size={11} />
                      </a>
                      <button
                        type="button"
                        onClick={() => setSearch(`${group.artist} ${m.title}`)}
                        className="text-xs px-1.5 py-0.5 rounded border border-ink-700 bg-ink-850 hover:bg-ink-800"
                      >
                        Buscar
                      </button>
                      <AddToChallengeButton artist={group.artist} title={m.title} />
                      <WantButton
                        artist={group.artist}
                        title={m.title}
                        rg_mbid={m.rg_mbid}
                        year={m.year}
                        origin="huecos"
                        label=""
                        className="text-xs p-1 rounded border border-ink-700 bg-ink-850 hover:bg-ink-800 inline-flex items-center"
                      />
                      {done ? (
                        <span className="text-emerald-400 text-xs inline-flex items-center gap-1">
                          <Check size={13} /> {m.in_lidarr ? 'Lidarr' : 'pedido'}
                        </span>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => add(m, group)}
                            disabled={ocupado}
                            className="text-xs px-1.5 py-0.5 rounded border border-gold-500/40 bg-gold-500/10 text-gold-300 hover:bg-gold-500/20 inline-flex items-center gap-1 disabled:opacity-50"
                          >
                            {busy === m.rg_mbid ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                            {busy === m.rg_mbid ? (lidarrOn ? 'Enviando…' : 'Descargando…') : lidarrOn ? 'Lidarr' : 'Descargar'}
                          </button>
                          <button
                            type="button"
                            onClick={() => dismiss(m)}
                            title="No me interesa"
                            aria-label={`No me interesa ${m.title}`}
                            className="text-neutral-600 hover:text-red-400 p-1"
                          >
                            <X size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <VerMas tandas={tandas} />

      {search != null && <SearchModal initialQuery={search} onClose={() => setSearch(null)} />}
    </div>
  );
}
