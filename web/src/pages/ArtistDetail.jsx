import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Star, RefreshCw, Plus, Check, CalendarClock, Network } from 'lucide-react';
import { api } from '../api.js';
import { AlbumCard, Spinner, ErrorMsg, Button, ProgressBar } from '../components.jsx';

export default function ArtistDetail() {
  const { id } = useParams();
  const [artist, setArtist] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

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

  if (err) return <ErrorMsg>{err}</ErrorMsg>;
  if (!artist) return <Spinner />;

  const comp = artist.completeness || {};
  const noMbid = !artist.mbid;

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

      {/* lo que falta */}
      {comp.missing?.length > 0 && <MissingList items={comp.missing} artistMbid={artist.mbid} />}

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

      <p className="text-sm text-neutral-500 mt-4 mb-3">{artist.albums.length} álbumes en tu colección</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-8">
        {artist.albums.map((a) => (
          <AlbumCard key={a.id} album={{ ...a, album_artist: artist.name }} />
        ))}
      </div>

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

function MissingList({ items, artistMbid }) {
  const [added, setAdded] = useState({});
  const [busy, setBusy] = useState(null);

  const add = async (rg) => {
    setBusy(rg.rg_mbid);
    try {
      await api.lidarrAdd(rg.rg_mbid, artistMbid);
      setAdded((p) => ({ ...p, [rg.rg_mbid]: true }));
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(null);
    }
  };

  const addAll = async () => {
    const pending = items.filter((i) => !added[i.rg_mbid] && !i.in_lidarr);
    if (!pending.length) return;
    setBusy('all');
    try {
      const r = await api.lidarrAddBulk(pending.map((i) => ({ rg_mbid: i.rg_mbid, artist_mbid: artistMbid })));
      const next = {};
      for (const i of pending) next[i.rg_mbid] = true;
      setAdded((p) => ({ ...p, ...next }));
      if (r.errors?.length) alert(`${r.added} añadidos, ${r.errors.length} con error`);
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm text-neutral-400">Te faltan {items.length} álbumes de estudio</h2>
        <Button variant="gold" onClick={addAll} disabled={busy === 'all'}>
          Enviar todos a Lidarr
        </Button>
      </div>
      <div className="space-y-1.5">
        {items.map((m) => {
          const done = added[m.rg_mbid] || m.in_lidarr;
          return (
            <div key={m.rg_mbid} className="card px-3 py-2 flex items-center justify-between text-sm">
              <span className="truncate">
                {m.title}
                {m.year ? <span className="text-neutral-600"> · {m.year}</span> : ''}
              </span>
              {done ? (
                <span className="text-emerald-400 text-xs inline-flex items-center gap-1 shrink-0">
                  <Check size={14} /> en Lidarr
                </span>
              ) : (
                <button
                  onClick={() => add(m)}
                  disabled={busy === m.rg_mbid}
                  className="text-xs px-2 py-1 rounded border border-gold-500/40 bg-gold-500/10 text-gold-300 hover:bg-gold-500/20 shrink-0 inline-flex items-center gap-1 disabled:opacity-50"
                >
                  <Plus size={13} /> Lidarr
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
