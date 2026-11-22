import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpCircle, Plus, Check, Loader2, ExternalLink } from 'lucide-react';
import { api, fmtBytes, pollLidarrQueue } from '../api.js';
import { PageTitle, Cover, Spinner, ErrorMsg, SearchModal, useLidarrEnabled } from '../components.jsx';
import { aviso } from '../avisos.jsx';
import { useTandas, VerMas, cuenta } from '../tandas.jsx';

// Cola de upgrades: álbumes que tienes SIN ninguna pista sin pérdida. Por cada uno,
// las dos vías de siempre: enviarlo a Lidarr (que busque una versión mejor) o
// buscarlo tú a mano en Prowlarr (para elegir el rip lossless que quieras).
export default function Upgrades() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(null);
  const [done, setDone] = useState({});
  const [queue, setQueue] = useState(null);
  const [search, setSearch] = useState(null); // query del modal de búsqueda manual
  const lidarrOn = useLidarrEnabled();

  const paraCola = useRef(null);
  useEffect(() => {
    let vivo = true;
    api
      .upgrades()
      .then((r) => vivo && setRows(r))
      .catch((e) => vivo && setErr(e.message));
    return () => {
      vivo = false;
      paraCola.current?.(); // el sondeo de la cola de Lidarr no sigue al irte
    };
  }, []);
  // Eran 2.133 fichas pintadas de golpe (55.000 nodos): de 150 en 150.
  const tandas = useTandas(rows, { tamano: 150 });

  // Con Lidarr → que busque una versión mejor. Sin Lidarr → descarga nativa de la mejor
  // release (agarra un rip sin pérdida; el auto-import la coloca junto a la que tienes).
  const send = async (a) => {
    if (busy != null) return;
    setBusy(a.id);
    try {
      if (lidarrOn) {
        await api.lidarrAdd(a.rg_mbid, a.artist_mbid);
        paraCola.current?.();
        paraCola.current = pollLidarrQueue(setQueue);
      } else {
        const res = await api.grabBest(`${a.album_artist || ''} ${a.title}`.trim(), { rg_mbid: a.rg_mbid, artist: a.album_artist, album: a.title });
        if (!res.grabbed) {
          aviso(`No se pudo agarrar: ${res.reason || 'sin release'}`, 'error');
          return;
        }
      }
      setDone((p) => ({ ...p, [a.id]: true }));
    } catch (e) {
      aviso(e.message, 'error');
    } finally {
      setBusy(null);
    }
  };

  if (err) return <ErrorMsg>{err}</ErrorMsg>;
  if (!rows) return <Spinner />;

  return (
    <div>
      <PageTitle
        icon={ArrowUpCircle}
        title="Candidatos a upgrade"
        sub={rows.length ? `${cuenta(tandas)} álbumes sin ninguna pista sin pérdida` : ''}
      />
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

      {rows.length === 0 ? (
        <div className="card p-8 text-center text-neutral-400">
          Nada que mejorar: todos tus álbumes tienen al menos una pista sin pérdida. 🎉
        </div>
      ) : (
        <div className="space-y-2">
          {tandas.visibles.map((a) => (
            // .release-row: en el móvil los botones bajan a su línea. Antes iban al lado y al
            // título le quedaban unos 70 px.
            <div key={a.id} className="card release-row p-2.5">
              <div className="release-main">
                {/* la carátula no es un enlace aparte: repetía el del título y, al no tener
                    texto, un lector de pantalla leía 2.133 enlaces sin nombre */}
                <div className="w-12 h-12 rounded overflow-hidden shrink-0" aria-hidden="true">
                  <Cover id={a.id} size="sm" />
                </div>
                <Link to={`/album/${a.id}`} className="min-w-0 flex-1 hover:text-gold-400">
                  <div className="truncate clamp-mobile">{a.title}</div>
                  <div className="text-xs text-neutral-500 truncate clamp-mobile">
                    {a.album_artist}
                    {a.year ? ` · ${a.year}` : ''}
                    {/* en el móvil la columna de formato no cabe: va aquí, que es el dato de la página */}
                    <span className="sm:hidden">
                      {' · '}
                      <span className="text-amber-400">{a.formats}</span>
                      {a.max_kbps ? ` ${a.max_kbps} kbps` : ''}
                    </span>
                  </div>
                </Link>
                <div className="text-right shrink-0 text-sm hidden sm:block">
                  <div className="text-amber-400">{a.formats}</div>
                  <div className="text-xs text-neutral-600">
                    {a.max_kbps ? `${a.max_kbps} kbps · ` : ''}
                    {fmtBytes(a.size_bytes)}
                  </div>
                </div>
              </div>
              <div className="release-actions">
                {a.rg_mbid && (
                  <a
                    href={`https://musicbrainz.org/release-group/${a.rg_mbid}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-gold-400 hover:underline inline-flex items-center gap-0.5"
                  >
                    MB <ExternalLink size={11} />
                  </a>
                )}
                <button
                  onClick={() => setSearch(`${a.album_artist || ''} ${a.title}`.trim())}
                  className="text-xs px-2 py-1 rounded border border-ink-700 bg-ink-850 hover:bg-ink-800"
                >
                  Buscar
                </button>
                {done[a.id] ? (
                  <span className="text-emerald-400 text-xs inline-flex items-center gap-1">
                    <Check size={14} /> {lidarrOn ? 'Lidarr' : 'pedido'}
                  </span>
                ) : a.can_upgrade ? (
                  <button
                    onClick={() => send(a)}
                    disabled={busy != null}
                    className="text-xs px-2 py-1 rounded border border-gold-500/40 bg-gold-500/10 text-gold-300 hover:bg-gold-500/20 inline-flex items-center gap-1 disabled:opacity-50"
                  >
                    {busy === a.id ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                    {busy === a.id ? (lidarrOn ? 'Enviando…' : 'Descargando…') : lidarrOn ? 'Lidarr' : 'Descargar'}
                  </button>
                ) : null}
              </div>
            </div>
          ))}
          <VerMas tandas={tandas} />
        </div>
      )}

      {search != null && <SearchModal initialQuery={search} onClose={() => setSearch(null)} />}
    </div>
  );
}
