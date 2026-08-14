import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Star, RefreshCw, Plus, Check, CalendarClock, Network, Loader2, ExternalLink } from 'lucide-react';
import { api, fmtBytes, pollLidarrQueue } from '../api.js';
import { AlbumCard, Spinner, ErrorMsg, Button, ProgressBar, SearchModal, DuplicateGroupPanel, useLidarrEnabled } from '../components.jsx';

export default function ArtistDetail() {
  const { id } = useParams();
  const [artist, setArtist] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [openKey, setOpenKey] = useState(null); // grupo de duplicados desplegado
  const lidarrOn = useLidarrEnabled();

  const load = () => api.artist(id).then(setArtist).catch((e) => setErr(e.message));
  useEffect(() => {
    setArtist(null);
    load();
  }, [id]);

  const following = artist?.tracked?.includes('artist');

  const toggleFollow = async () => {
    setBusy(true);
    try {
      if (following) await api.unfollow(id, 'artist');
      else await api.follow(id, 'artist');
      await load();
    } finally {
      setBusy(false);
    }
  };

  const refreshDisco = async () => {
    setBusy(true);
    try {
      await api.refreshArtistDisco(id);
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  // Ámbito de completismo, persistente por artista: 'albums' (solo álbumes) o 'all'
  // (además EPs y singles). De unos artistas quieres todo; de otros, solo los discos.
  const toggleScope = async () => {
    const cur = artist?.completism_scope || 'albums';
    setBusy(true);
    try {
      await api.setArtistScope(id, cur === 'all' ? 'albums' : 'all');
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (err) return <ErrorMsg>{err}</ErrorMsg>;
  if (!artist) return <Spinner />;

  const comp = artist.completeness || {};
  const noMbid = !artist.mbid;
  const scope = artist.completism_scope || 'albums';

  // Clasifica cada álbum de la colección por tipo (para agrupar la parrilla). Los que
  // tienen tipos secundarios (recopilatorio, directo, remezcla…) van a "Otros".
  const parseSec = (s) => {
    try {
      return typeof s === 'string' ? JSON.parse(s) : s || [];
    } catch {
      return [];
    }
  };
  const typeBucket = (a) => {
    if (parseSec(a.secondary_types).length) return 'Otros';
    if (a.primary_type === 'EP') return 'EPs';
    if (a.primary_type === 'Single') return 'Singles';
    if (a.primary_type === 'Album' || !a.primary_type) return 'Álbumes';
    return 'Otros';
  };
  const TYPE_ORDER = ['Álbumes', 'EPs', 'Singles', 'Otros'];

  // Duplicados: la rejilla muestra solo la copia representante (la mejor) de cada
  // grupo, con badge ×N; al pincharla se despliega el grupo. groupsByKey mapea la
  // clave del grupo a sus copias para el panel.
  const groupsByKey = {};
  for (const g of artist.duplicateGroups || []) groupsByKey[g.key] = g;
  const gridAlbums = artist.albums.filter((a) => !a.dup || a.dup.best);
  const dupCount = artist.duplicateGroups?.length || 0;
  const byType = {};
  for (const a of gridAlbums) (byType[typeBucket(a)] ||= []).push(a);
  const typeSections = TYPE_ORDER.filter((t) => byType[t]?.length);

  return (
    <div>
      <Link to="/artistas" className="inline-flex items-center gap-1.5 text-sm text-neutral-400 hover:text-gold-400 mb-4">
        <ArrowLeft size={15} /> Artistas
      </Link>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-display">{artist.name}</h1>
          <p className="text-sm text-neutral-500 mb-1">
            {artist.mbid ? 'en MusicBrainz' : 'artista local (sin MBID)'}
            {artist.type ? ` · ${artist.type}` : ''}
            {artist.country ? ` · ${artist.country}` : ''}
            {artist.began ? ` · ${artist.began}${artist.ended ? `–${artist.ended}` : ''}` : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant={following ? 'gold' : 'default'} onClick={toggleFollow} disabled={busy}>
            <span className="inline-flex items-center gap-1.5">
              <Star size={14} className={following ? 'fill-current' : ''} />
              {following ? 'Siguiendo' : 'Seguir'}
            </span>
          </Button>
          {!noMbid && (
            <Button onClick={refreshDisco} disabled={busy}>
              <span className="inline-flex items-center gap-1.5">
                <RefreshCw size={14} className={busy ? 'animate-spin' : ''} /> Discografía
              </span>
            </Button>
          )}
        </div>
      </div>

      {/* completismo */}
      {!noMbid && (
        <div className="card p-4 my-5 max-w-lg">
          {comp.pct == null ? (
            <p className="text-sm text-neutral-500">
              Aún no se ha calculado la discografía. Pulsa «Discografía» para cruzarla con MusicBrainz.
            </p>
          ) : (
            <>
              <ProgressBar pct={comp.pct} label="Álbumes de estudio que tienes" />
              <p className="text-xs text-neutral-500 mt-2">
                {comp.stats?.studio_owned} de {comp.stats?.studio_total} · faltan {comp.stats?.missing}
                {comp.stats?.upcoming ? ` · ${comp.stats.upcoming} por estrenar` : ''}
              </p>
            </>
          )}
        </div>
      )}

      {/* ámbito de completismo (persistente por artista): solo álbumes vs todo */}
      {!noMbid && (
        <div className="flex items-center gap-2 flex-wrap mb-4 text-sm">
          <span className="text-neutral-500">Completismo:</span>
          <button
            onClick={toggleScope}
            disabled={busy}
            className={`px-2.5 py-1 rounded-lg border text-xs disabled:opacity-50 ${
              scope === 'all' ? 'border-gold-500/50 bg-gold-500/15 text-gold-300' : 'border-ink-800 bg-ink-850 text-neutral-400'
            }`}
          >
            {scope === 'all' ? 'Álbumes + EPs + singles' : 'Solo álbumes'}
          </button>
          <span className="text-xs text-neutral-600">
            {scope === 'all' ? 'sigues todo de este artista' : 'pulsa para seguir también EPs y singles'}
          </span>
        </div>
      )}

      {/* lo que falta */}
      {comp.missing?.length > 0 && (
        <MissingList items={comp.missing} artistMbid={artist.mbid} artistName={artist.name} lidarrOn={lidarrOn} />
      )}
      {scope === 'all' && comp.missingEps?.length > 0 && (
        <MissingList items={comp.missingEps} artistMbid={artist.mbid} artistName={artist.name} noun="EPs" singular="EP" lidarrOn={lidarrOn} />
      )}
      {scope === 'all' && comp.missingSingles?.length > 0 && (
        <MissingList items={comp.missingSingles} artistMbid={artist.mbid} artistName={artist.name} noun="singles" singular="single" lidarrOn={lidarrOn} />
      )}

      {/* por estrenar */}
      {comp.upcoming?.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm text-neutral-400 mb-2 flex items-center gap-1.5">
            <CalendarClock size={15} /> Por estrenar
          </h2>
          <div className="space-y-1.5">
            {comp.upcoming.map((u) => (
              <div key={u.rg_mbid} className="card px-3 py-2 flex items-center justify-between text-sm">
                <span>{u.title}</span>
                <span className="text-neutral-500">{u.first_release}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-sm text-neutral-500 mt-4 mb-3">
        {artist.albums.length} álbumes en tu colección
        {dupCount > 0 && (
          <span className="text-neutral-600">
            {' · '}
            {dupCount} con copias (agrupadas; pincha las <span className="text-sky-400">×N</span> para gestionarlas)
          </span>
        )}
      </p>
      {typeSections.length > 1 ? (
        <div className="space-y-6 mb-8">
          {typeSections.map((t) => (
            <div key={t}>
              <h2 className="text-sm text-gold-400/80 mb-2">
                {t} <span className="text-neutral-600">· {byType[t].length}</span>
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                {byType[t].map((a) => (
                  <AlbumCard
                    key={a.id}
                    album={{ ...a, album_artist: artist.name }}
                    onClick={a.dup ? () => setOpenKey(a.dup.key) : undefined}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-8">
          {gridAlbums.map((a) => (
            <AlbumCard
              key={a.id}
              album={{ ...a, album_artist: artist.name }}
              onClick={a.dup ? () => setOpenKey(a.dup.key) : undefined}
            />
          ))}
        </div>
      )}

      {openKey && groupsByKey[openKey] && (
        <DuplicateGroupPanel group={groupsByKey[openKey]} onClose={() => setOpenKey(null)} />
      )}

      {!noMbid && <Relations artistId={id} />}
    </div>
  );
}

// Grafo de relaciones de MusicBrainz cruzado con tu colección: miembros, bandas,
// proyectos paralelos y colaboraciones, con lo que ya tienes o sigues.
function Relations({ artistId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      setData(await api.relations(artistId));
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm text-neutral-400 flex items-center gap-2">
          <Network size={15} /> Relaciones (MusicBrainz)
        </h2>
        {!data && (
          <Button onClick={load} disabled={loading}>
            {loading ? 'Cargando…' : 'Ver relaciones'}
          </Button>
        )}
      </div>
      {err && <p className="text-sm text-red-400 mt-3">{err}</p>}
      {data && !data.hasMbid && <p className="text-sm text-neutral-600 mt-3">Este artista no está en MusicBrainz.</p>}
      {data && data.hasMbid && data.groups.length === 0 && (
        <p className="text-sm text-neutral-600 mt-3">MusicBrainz no tiene relaciones para este artista.</p>
      )}
      {data?.groups?.map((g) => (
        <div key={g.key} className="mt-4">
          <h3 className="text-xs uppercase tracking-wider text-neutral-600 mb-2">{g.label}</h3>
          <div className="flex flex-wrap gap-1.5">
            {g.artists.map((a) => (
              <RelChip key={a.mbid} a={a} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function RelChip({ a }) {
  const [followed, setFollowed] = useState(a.tracked);
  const [busy, setBusy] = useState(false);
  const follow = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setBusy(true);
    try {
      await api.followMbid(a.mbid, 'artist');
      setFollowed(true);
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  };
  const inner = (
    <>
      {a.name}
      {a.owned_albums > 0 && <span className="text-emerald-400/80"> · {a.owned_albums}</span>}
      {a.attributes?.length > 0 && <span className="text-neutral-600"> · {a.attributes.join(', ')}</span>}
    </>
  );
  const cls =
    'text-xs px-2 py-1 rounded-full border inline-flex items-center gap-1 ' +
    (a.owned_albums > 0 || followed
      ? 'border-gold-500/30 bg-gold-500/10 text-gold-200'
      : 'border-ink-800 bg-ink-850 text-neutral-300');

  // si lo tienes en local, enlaza a su ficha; si no, botón de seguir
  if (a.artist_id) {
    return (
      <Link to={`/artista/${a.artist_id}`} className={cls}>
        {inner}
      </Link>
    );
  }
  return (
    <button onClick={follow} disabled={busy} className={cls} title="Seguir en Liderarrr">
      {inner}
      {followed ? <Check size={12} className="text-emerald-400" /> : <Plus size={12} />}
    </button>
  );
}

function MissingList({ items, artistMbid, artistName, noun = 'álbumes de estudio', singular = 'álbum de estudio', lidarrOn }) {
  const [added, setAdded] = useState({});
  const [busy, setBusy] = useState(null);
  const [queue, setQueue] = useState(null);
  const [search, setSearch] = useState(null); // query del modal de búsqueda manual

  // Con Lidarr → se lo mandamos (envío encolado, no bloqueante). Sin Lidarr (opcional)
  // → descarga nativa: agarra la mejor release por Prowlarr/Jackett y el auto-import
  // la coloca en la biblioteca.
  const add = async (rg) => {
    setBusy(rg.rg_mbid);
    try {
      if (lidarrOn) {
        await api.lidarrAdd(rg.rg_mbid, artistMbid);
        pollLidarrQueue(setQueue);
      } else {
        const res = await api.grabBest(`${artistName || ''} ${rg.title}`.trim(), { rg_mbid: rg.rg_mbid, artist: artistName, album: rg.title });
        if (!res.grabbed) {
          alert(`No se pudo agarrar: ${res.reason || 'sin release'}`);
          return;
        }
      }
      setAdded((p) => ({ ...p, [rg.rg_mbid]: true }));
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(null);
    }
  };

  const addAll = async () => {
    const toSend = items.filter((i) => !added[i.rg_mbid] && !i.in_lidarr);
    if (!toSend.length) return;
    setBusy('all');
    try {
      if (lidarrOn) {
        await api.lidarrAddBulk(toSend.map((i) => ({ rg_mbid: i.rg_mbid, artist_mbid: artistMbid })));
        pollLidarrQueue(setQueue);
        setAdded((p) => ({ ...p, ...Object.fromEntries(toSend.map((i) => [i.rg_mbid, true])) }));
      } else {
        // nativo: secuencial (los indexers se consultan en vivo). Marca las que agarra.
        for (const i of toSend) {
          try {
            const res = await api.grabBest(`${artistName || ''} ${i.title}`.trim(), { rg_mbid: i.rg_mbid, artist: artistName, album: i.title });
            if (res.grabbed) setAdded((p) => ({ ...p, [i.rg_mbid]: true }));
          } catch {
            /* uno que falla no corta la tanda */
          }
        }
      }
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm text-neutral-400">
          {items.length === 1 ? `Te falta 1 ${singular}` : `Te faltan ${items.length} ${noun}`}
        </h2>
        <Button variant="gold" onClick={addAll} disabled={busy === 'all'}>
          <span className="inline-flex items-center gap-1.5">
            {busy === 'all' && <Loader2 size={14} className="animate-spin" />}
            {busy === 'all' ? (lidarrOn ? 'Encolando…' : 'Descargando…') : lidarrOn ? 'Enviar todos a Lidarr' : 'Descargar todos'}
          </span>
        </Button>
      </div>
      {queue &&
        (queue.running ? (
          <p className="text-xs text-gold-300/90 mb-2">Lidarr: procesando {queue.done}/{queue.total}…</p>
        ) : (
          <p className="text-xs text-neutral-500 mb-2">
            Lidarr: {queue.added} enviados
            {queue.pending ? ` · ${queue.pending} pendientes de importar` : ''}
            {queue.errors?.length ? ` · ${queue.errors.length} con error` : ''}.
          </p>
        ))}
      <div className="space-y-1.5">
        {items.map((m) => {
          const done = added[m.rg_mbid] || m.in_lidarr;
          return (
            <div key={m.rg_mbid} className="card px-3 py-2 flex items-center gap-2 text-sm">
              <span className="truncate flex-1 min-w-0">
                {m.title}
                {m.year ? <span className="text-neutral-600"> · {m.year}</span> : ''}
              </span>
              <a
                href={`https://musicbrainz.org/release-group/${m.rg_mbid}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-gold-400 hover:underline inline-flex items-center gap-0.5 shrink-0"
              >
                MB <ExternalLink size={11} />
              </a>
              <button
                onClick={() => setSearch(`${artistName || ''} ${m.title}`.trim())}
                className="text-xs px-2 py-1 rounded border border-ink-700 bg-ink-850 hover:bg-ink-800 shrink-0"
              >
                Buscar
              </button>
              {done ? (
                <span className="text-emerald-400 text-xs inline-flex items-center gap-1 shrink-0">
                  <Check size={14} /> {lidarrOn ? 'en Lidarr' : 'pedido'}
                </span>
              ) : (
                <button
                  onClick={() => add(m)}
                  disabled={busy === m.rg_mbid}
                  className="text-xs px-2 py-1 rounded border border-gold-500/40 bg-gold-500/10 text-gold-300 hover:bg-gold-500/20 shrink-0 inline-flex items-center gap-1 disabled:opacity-50"
                >
                  {busy === m.rg_mbid ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                  {busy === m.rg_mbid ? (lidarrOn ? 'Enviando…' : 'Descargando…') : lidarrOn ? 'Lidarr' : 'Descargar'}
                </button>
              )}
            </div>
          );
        })}
      </div>
      {search != null && <SearchModal initialQuery={search} onClose={() => setSearch(null)} />}
    </div>
  );
}

