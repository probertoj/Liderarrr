import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Building2, ArrowLeft, ExternalLink, Check, Star, Loader2 } from 'lucide-react';
import { api, pollLidarrQueue } from '../api.js';
import { PageTitle, AlbumCard, Spinner, ErrorMsg, Button, ProgressBar, SearchModal, DuplicateGroupPanel } from '../components.jsx';

// Coincidencia laxa de nombre de sello (acentos/mayúsculas/signos) para saber si un
// sello de la colección ya está entre los seguidos (que usan el nombre canónico de MB).
const labelNorm = (s) => String(s || '').normalize('NFD').toLowerCase().replace(/[^a-z0-9]+/g, '');

// Sellos de tu colección. Los sellos se van capturando de Discogs a medida que
// consultas ediciones de tus álbumes (y de las etiquetas si las traen), así que
// esta vista crece con el uso.
export default function Labels() {
  const [rows, setRows] = useState(null);
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(params.get('label'));
  const [q, setQ] = useState('');
  const [err, setErr] = useState(null);
  const [followedNorms, setFollowedNorms] = useState([]);
  useEffect(() => {
    api.labels().then(setRows).catch((e) => setErr(e.message));
    api
      .trackedLabels()
      .then((ls) => setFollowedNorms(ls.map((l) => labelNorm(l.name))))
      .catch(() => {});
  }, []);

  // ¿este sello (etiqueta de la colección) está entre los seguidos? Cruce laxo por
  // nombre (los seguidos usan el nombre canónico de MB, que puede diferir).
  const isFollowed = (name) => {
    const n = labelNorm(name);
    return n && followedNorms.some((t) => t.includes(n) || n.includes(t));
  };

  const back = () => {
    setOpen(null);
    if (params.get('label')) setParams({}, { replace: true });
  };

  if (err) return <ErrorMsg>{err}</ErrorMsg>;
  if (!rows) return <Spinner />;
  if (open) return <LabelDetail name={open} onBack={back} />;

  const shown = rows.filter((l) => l.name.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div>
      <PageTitle icon={Building2} title="Sellos" sub={rows.length ? `${rows.length} sellos en tu colección` : ''} />
      {rows.length === 0 ? (
        <div className="card p-8 text-center text-neutral-400">
          Aún no hay sellos. Se llenan al escanear (leyendo la etiqueta de sello de tus ficheros) y al consultar
          «Ediciones (Discogs)» en la ficha de un álbum.
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3 mb-4">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar sello…"
              className="w-full sm:max-w-xs bg-ink-850 border border-ink-800 rounded px-3 py-1.5 text-sm outline-none focus:border-gold-500/60"
            />
            {q && (
              <span className="text-xs text-neutral-500 shrink-0">
                {shown.length} de {rows.length}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {shown.map((l) => {
              const followed = isFollowed(l.name);
              return (
                <button
                  key={l.name}
                  onClick={() => setOpen(l.name)}
                  title={followed ? 'Sigues este sello (sale en Lanzamientos)' : undefined}
                  className={`text-sm px-3 py-1.5 rounded-full border inline-flex items-center gap-1.5 ${
                    followed
                      ? 'border-gold-500/50 bg-gold-500/15 text-gold-200 hover:border-gold-500/70'
                      : 'bg-ink-850 border-ink-800 hover:border-gold-500/40'
                  }`}
                >
                  {followed && <Star size={12} className="fill-current text-gold-400" />}
                  {l.name} <span className={followed ? 'text-gold-300/70' : 'text-neutral-600'}>{l.albums}</span>
                  {l.variants > 1 && (
                    <span className="text-neutral-600" title="Variantes de nombre fusionadas (acentos/mayúsculas)">
                      {' '}· {l.variants} variantes
                    </span>
                  )}
                </button>
              );
            })}
            {shown.length === 0 && <span className="text-sm text-neutral-500">Ningún sello coincide con «{q}».</span>}
          </div>
        </>
      )}
    </div>
  );
}

function LabelDetail({ name, onBack }) {
  const [albums, setAlbums] = useState(null);
  const [group, setGroup] = useState(null); // grupo de duplicados abierto (×N)
  const [followed, setFollowed] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  useEffect(() => {
    api.label(name).then(setAlbums);
    // ¿ya lo sigo? cruce laxo por nombre contra los sellos seguidos (que usan el
    // nombre canónico de MusicBrainz, que puede diferir del de la etiqueta).
    api
      .trackedLabels()
      .then((ls) => setFollowed(ls.some((l) => labelNorm(l.name).includes(labelNorm(name)) || labelNorm(name).includes(labelNorm(l.name)))))
      .catch(() => {});
  }, [name]);

  const follow = async () => {
    setFollowBusy(true);
    try {
      await api.followLabelByName(name);
      setFollowed(true);
    } catch (e) {
      alert(e.message);
    } finally {
      setFollowBusy(false);
    }
  };

  const openDup = async (id) => {
    try {
      setGroup(await api.dupGroup(id));
    } catch (e) {
      alert(e.message);
    }
  };

  return (
    <div>
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-neutral-400 hover:text-gold-400 mb-4">
        <ArrowLeft size={15} /> Sellos
      </button>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <h1 className="text-xl font-display">{name}</h1>
        {followed ? (
          <span className="text-sm text-gold-400/90 inline-flex items-center gap-1.5">
            <Star size={14} className="fill-current" /> Siguiendo · sale en Lanzamientos
          </span>
        ) : (
          <Button onClick={follow} disabled={followBusy}>
            <span className="inline-flex items-center gap-1.5">
              {followBusy ? <Loader2 size={14} className="animate-spin" /> : <Star size={14} />} Seguir sello
            </span>
          </Button>
        )}
      </div>

      <LabelCompletism name={name} />

      <p className="text-sm text-neutral-500 mb-2">{albums?.length || 0} en tu colección</p>
      {!albums ? (
        <Spinner />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {albums.map((a) => (
            <AlbumCard key={a.id} album={a} onClick={a.dup ? () => openDup(a.id) : undefined} />
          ))}
        </div>
      )}

      {group && <DuplicateGroupPanel group={group} onClose={() => setGroup(null)} />}
    </div>
  );
}

// Completismo del sello contra MusicBrainz (bajo demanda). Cruza el catálogo de
// álbumes de estudio del sello con lo que tienes; por cada uno que falte, o lo
// envías a Lidarr o lo buscas a mano en Prowlarr.
function LabelCompletism({ name }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [added, setAdded] = useState({});
  const [queue, setQueue] = useState(null);
  const [search, setSearch] = useState(null); // query del modal de búsqueda manual

  // Reenganche: la cola de envío corre en el BACKEND, así que al volver a esta página
  // (o entrar con un envío ya en marcha) sondeamos su estado en vez de mostrar "como si
  // no hubiera pasado nada". Si está corriendo, sigue sondeando hasta que termine.
  useEffect(() => {
    const stop = pollLidarrQueue(setQueue);
    return stop;
  }, []);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      setData(await api.labelCompletism(name));
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  const sendLidarr = async (m, all) => {
    const list = all ? data.missing : [m];
    const mark = {};
    for (const x of list) mark[x.rg_mbid] = true;
    setAdded((p) => ({ ...p, ...mark }));
    try {
      if (all) await api.lidarrAddBulk(list.map((x) => ({ rg_mbid: x.rg_mbid, artist_mbid: null })));
      else await api.lidarrAdd(m.rg_mbid, null);
      pollLidarrQueue(setQueue);
    } catch (e) {
      alert(e.message);
    }
  };

  return (
    <div className="card p-4 mb-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-sm text-neutral-400 flex items-center gap-2">
          <Building2 size={15} /> Completismo (MusicBrainz)
        </h2>
        {!data && (
          <Button onClick={load} disabled={loading}>
            {loading ? 'Calculando…' : 'Calcular'}
          </Button>
        )}
      </div>
      <p className="text-xs text-neutral-600 mt-1">
        Cruza el catálogo de álbumes de estudio del sello en MusicBrainz con lo que tienes. Consulta MB en vivo: puede
        tardar.
      </p>

      {/* Envío en 2º plano en marcha (aunque no hayas pulsado "Calcular" en esta visita) */}
      {!data && queue?.running && (
        <p className="text-xs text-gold-300/90 mt-2">
          Lidarr: procesando {queue.done}/{queue.total}… (envío en segundo plano)
        </p>
      )}

      {err && <p className="text-sm text-red-400 mt-3">{err}</p>}
      {data && !data.found && <p className="text-sm text-neutral-500 mt-3">MusicBrainz no encuentra este sello.</p>}
      {data?.found && data.tooBig && (
        <p className="text-sm text-amber-400/90 mt-3">
          Sello demasiado grande ({data.total.toLocaleString('es')} lanzamientos en MusicBrainz). El completismo no
          aplica a un sello de este tamaño (majors, distribuidoras…).
        </p>
      )}
      {data?.found && !data.tooBig && (
        <div className="mt-3">
          <div className="text-xs text-neutral-500 mb-1">
            Casado con <span className="text-neutral-300">{data.label.name}</span>
            {data.label.disambiguation ? ` (${data.label.disambiguation})` : ''}
          </div>
          <ProgressBar pct={data.pct ?? 0} label="Álbumes de estudio del sello" />
          <p className="text-xs text-neutral-500 mt-2">
            {data.owned} de {data.total} · faltan {data.missing.length}
          </p>

          {data.missing.length > 0 && (
            <>
              <div className="flex items-center justify-between mt-3 mb-1">
                <span className="text-sm text-neutral-400">Te faltan {data.missing.length}</span>
                <Button variant="gold" onClick={() => sendLidarr(null, true)}>
                  Enviar todos a Lidarr
                </Button>
              </div>
              {queue &&
                (queue.running ? (
                  <p className="text-xs text-gold-300/90 mb-2">Lidarr: procesando {queue.done}/{queue.total}…</p>
                ) : (
                  <p className="text-xs text-neutral-500 mb-2">
                    Lidarr: {queue.added} enviados
                    {queue.pending ? ` · ${queue.pending} pend.` : ''}
                    {queue.errors?.length ? ` · ${queue.errors.length} error` : ''}.
                  </p>
                ))}
              <div className="max-h-96 overflow-y-auto divide-y divide-ink-850/60">
                {data.missing.map((m) => (
                  <div key={m.rg_mbid} className="py-2 flex items-center gap-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="truncate">
                        {m.artist_id ? (
                          <Link to={`/artista/${m.artist_id}`} className="text-neutral-300 hover:text-gold-400">
                            {m.artist}
                          </Link>
                        ) : m.artist_mbid ? (
                          <a
                            href={`https://musicbrainz.org/artist/${m.artist_mbid}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-neutral-300 hover:text-gold-400"
                          >
                            {m.artist}
                          </a>
                        ) : (
                          <span className="text-neutral-300">{m.artist}</span>
                        )}
                        <span className="text-neutral-500"> — {m.title}</span>
                        {m.year ? <span className="text-neutral-600"> · {m.year}</span> : null}
                      </div>
                    </div>
                    <a
                      href={`https://musicbrainz.org/release-group/${m.rg_mbid}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-gold-400 hover:underline inline-flex items-center gap-0.5 shrink-0"
                    >
                      MB <ExternalLink size={11} />
                    </a>
                    <button
                      onClick={() => setSearch(`${m.artist} ${m.title}`)}
                      className="text-xs px-2 py-1 rounded border border-ink-700 bg-ink-850 hover:bg-ink-800 shrink-0"
                    >
                      Buscar
                    </button>
                    {added[m.rg_mbid] ? (
                      <span className="text-emerald-400 text-xs inline-flex items-center gap-1 shrink-0">
                        <Check size={13} /> en cola
                      </span>
                    ) : (
                      <button
                        onClick={() => sendLidarr(m, false)}
                        className="text-xs px-2 py-1 rounded border border-gold-500/40 bg-gold-500/10 text-gold-300 hover:bg-gold-500/20 shrink-0"
                      >
                        Lidarr
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {search != null && <SearchModal initialQuery={search} onClose={() => setSearch(null)} />}
    </div>
  );
}
