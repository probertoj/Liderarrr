import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Headphones, TrendingUp, Star, EarOff, Search, Disc3, ListMusic } from 'lucide-react';
import { BarChart, Bar, ResponsiveContainer, XAxis, Tooltip } from 'recharts';
import { api } from '../api.js';
import { PageTitle, Stat, Spinner, ErrorMsg, Button, SearchModal } from '../components.jsx';

// Ventanas de fecha para la brecha. `since` = ms (o null = todo el tiempo).
const RANGES = [
  { key: 'all', label: 'Todo el tiempo', since: () => null },
  { key: 'week', label: 'Última semana', since: () => Date.now() - 7 * 86400000 },
  { key: 'month', label: 'Último mes', since: () => Date.now() - 30 * 86400000 },
  { key: 'q', label: 'Últimos 3 meses', since: () => Date.now() - 90 * 86400000 },
  { key: 'year', label: 'Último año', since: () => Date.now() - 365 * 86400000 },
];

// Descarga una lista M3U (para el reproductor) de una lista de álbumes que tienes.
async function downloadM3U(albumIds, name) {
  try {
    const res = await fetch('/api/playlist/m3u', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ albumIds, name }),
    });
    if (!res.ok) throw new Error(`error ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.m3u`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert(`No se pudo generar la lista: ${e.message}`);
  }
}

export default function Listening() {
  const [ov, setOv] = useState(null);
  const [gap, setGap] = useState(null);
  const [albumGap, setAlbumGap] = useState(null);
  const [unplayed, setUnplayed] = useState(null);
  const [err, setErr] = useState(null);
  const [importing, setImporting] = useState(false);
  const [range, setRange] = useState('all');
  const [search, setSearch] = useState(null);

  const load = () => {
    api.listening().then(setOv).catch((e) => setErr(e.message));
    api.unplayed().then(setUnplayed).catch(() => {});
  };
  useEffect(() => {
    load();
  }, []);

  // la brecha (por artista y por álbum) se recarga al cambiar la ventana de fecha
  useEffect(() => {
    const since = RANGES.find((r) => r.key === range)?.since() || null;
    setGap(null);
    setAlbumGap(null);
    api.gap(since).then(setGap).catch(() => {});
    api.albumGap(since).then(setAlbumGap).catch(() => {});
  }, [range]);

  const doImport = async (full) => {
    setImporting(true);
    try {
      await api.scrobblesImport(full);
      let done = false;
      while (!done) {
        await new Promise((r) => setTimeout(r, 1500));
        const s = await api.scrobblesStatus();
        done = !s.running;
        if (s.error) throw new Error(s.error);
      }
      load();
    } catch (e) {
      alert(e.message);
    } finally {
      setImporting(false);
    }
  };

  if (err) return <ErrorMsg>{err}</ErrorMsg>;
  if (!ov) return <Spinner />;

  if (ov.empty) {
    return (
      <div>
        <PageTitle icon={Headphones} title="Escuchas" />
        <div className="card p-8 text-center">
          <p className="text-neutral-300 mb-2">Aún no hay escuchas importadas.</p>
          <p className="text-neutral-500 text-sm mb-4">
            Pon tu usuario de Last.fm en Ajustes y trae tu historial. Con él aparece la brecha
            escucha↔propiedad: los artistas que más oyes y de los que apenas tienes nada.
          </p>
          <div className="flex gap-2 justify-center">
            <Button variant="gold" onClick={() => doImport(true)} disabled={importing}>
              {importing ? 'Importando…' : 'Importar de Last.fm'}
            </Button>
            <Link to="/ajustes" className="text-gold-400 hover:underline self-center text-sm">
              Ajustes →
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const t = ov.totals;
  return (
    <div>
      <PageTitle icon={Headphones} title="Escuchas" sub="Tu historial de Last.fm cruzado con tu disco">
        <Button onClick={() => doImport(false)} disabled={importing}>
          {importing ? 'Importando…' : 'Actualizar escuchas'}
        </Button>
      </PageTitle>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Stat label="Escuchas" value={t.scrobbles.toLocaleString('es')} />
        <Stat label="Artistas distintos" value={t.artists.toLocaleString('es')} />
        <Stat label="Álbumes distintos" value={t.albums.toLocaleString('es')} />
        <Stat
          label="Desde"
          value={t.first ? new Date(t.first).getFullYear() : '—'}
          sub={t.last ? `hasta ${new Date(t.last).toLocaleDateString('es')}` : ''}
        />
      </div>

      {/* LA BRECHA — protagonista */}
      <div className="card p-5 mb-6 border-gold-500/30">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
          <h2 className="font-display text-lg flex items-center gap-2">
            <TrendingUp size={18} className="text-gold-400" /> Brecha escucha↔propiedad
          </h2>
          <select
            value={range}
            onChange={(e) => setRange(e.target.value)}
            className="bg-ink-850 border border-ink-800 rounded-lg px-2.5 py-1.5 text-sm"
            title="Acota la brecha a lo que has escuchado en esta ventana de tiempo"
          >
            {RANGES.map((r) => (
              <option key={r.key} value={r.key}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <p className="text-xs text-neutral-500 mb-3">
          Artistas que escuchas mucho{range !== 'all' ? ' en esta ventana' : ''} y de los que tienes poco o nada. Tu mejor
          lista de candidatos: es tu gusto real, no un algoritmo.
        </p>
        {!gap ? (
          <Spinner />
        ) : gap.length === 0 ? (
          <p className="text-neutral-600 text-sm">Nada destacable: tienes lo que escuchas. 👏</p>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {gap.map((g) => (
              <GapRow key={g.artist} g={g} />
            ))}
          </div>
        )}
      </div>

      {/* Discos concretos que has escuchado (en la ventana) y no tienes: para pasarlos a propios */}
      {albumGap && albumGap.length > 0 && (
        <div className="card p-5 mb-6">
          <h2 className="font-display text-lg mb-1 flex items-center gap-2">
            <Disc3 size={18} className="text-gold-400" /> Discos que escuchas y no tienes
          </h2>
          <p className="text-xs text-neutral-500 mb-3">
            Álbumes que sonaron{range !== 'all' ? ' en esta ventana' : ''} y no están en tu disco. Ideal para pasar a
            propios lo que oyes ahora en streaming.
          </p>
          <div className="space-y-1 max-h-96 overflow-y-auto">
            {albumGap.map((a, i) => (
              <div key={i} className="flex items-center gap-2 text-sm px-1 py-1 rounded hover:bg-ink-850/50">
                <div className="min-w-0 flex-1">
                  <span className="truncate">
                    {a.artist_id ? (
                      <Link to={`/artista/${a.artist_id}`} className="text-neutral-300 hover:text-gold-400">
                        {a.artist}
                      </Link>
                    ) : (
                      <span className="text-neutral-300">{a.artist}</span>
                    )}
                    <span className="text-neutral-500"> — {a.album}</span>
                  </span>
                </div>
                <span className="text-xs text-neutral-600 shrink-0">{a.plays} escuchas</span>
                <button
                  onClick={() => setSearch(`${a.artist} ${a.album}`)}
                  className="text-xs px-1.5 py-0.5 rounded border border-gold-500/40 bg-gold-500/10 text-gold-300 hover:bg-gold-500/20 inline-flex items-center gap-1 shrink-0"
                >
                  <Search size={12} /> Buscar
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <TopPlayed />

      <div className="card p-4 mb-6">
        <h2 className="text-sm text-neutral-400 mb-3">Escuchas por año</h2>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={ov.byYear}>
            <XAxis dataKey="year" tick={{ fill: '#888', fontSize: 12 }} />
            <Tooltip contentStyle={{ background: '#191921', border: '1px solid #2c2c39', borderRadius: 8 }} />
            <Bar dataKey="plays" fill="#d4a24a" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {unplayed && unplayed.length > 0 && (
        <div className="card p-4">
          <div className="flex items-center justify-between gap-2 mb-3">
            <h2 className="text-sm text-neutral-400 flex items-center gap-2">
              <EarOff size={15} /> Tienes pero nunca has escuchado ({unplayed.length})
            </h2>
            <button
              onClick={() => downloadM3U(unplayed.map((a) => a.id), 'Nunca escuchados')}
              className="text-xs px-2.5 py-1.5 rounded-lg border border-ink-700 bg-ink-850 hover:bg-ink-800 inline-flex items-center gap-1.5"
              title="Descargar como lista M3U para escucharlos en tu reproductor"
            >
              <ListMusic size={13} /> Descargar M3U
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto">
            {unplayed.map((a) => (
              <Link
                key={a.id}
                to={`/album/${a.id}`}
                className="text-xs px-2 py-1 rounded-full bg-ink-850 border border-ink-800 hover:border-gold-500/40"
              >
                {a.album_artist} — {a.title}
              </Link>
            ))}
          </div>
        </div>
      )}

      {search != null && <SearchModal initialQuery={search} onClose={() => setSearch(null)} />}
    </div>
  );
}

// «Los más escuchados de [rango]»: artistas y álbumes que más has oído en la ventana
// elegida (semana, mes, 3 meses, año o todo), marcando lo que no tienes en disco.
function TopPlayed() {
  const [range, setRange] = useState('all');
  const [data, setData] = useState(null);
  useEffect(() => {
    const since = RANGES.find((r) => r.key === range)?.since() || null;
    setData(null);
    api.topPlayed(since, 12).then(setData).catch(() => setData({ artists: [], albums: [] }));
  }, [range]);
  const rangeLabel = RANGES.find((r) => r.key === range)?.label;

  return (
    <div className="card p-4 mb-6">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <h2 className="font-display text-lg">Los más escuchados</h2>
        <select
          value={range}
          onChange={(e) => setRange(e.target.value)}
          className="bg-ink-850 border border-ink-800 rounded-lg px-2.5 py-1.5 text-sm"
          title="Acota a lo que has escuchado en esta ventana de tiempo"
        >
          {RANGES.map((r) => (
            <option key={r.key} value={r.key}>
              {r.label}
            </option>
          ))}
        </select>
      </div>
      {!data ? (
        <Spinner />
      ) : data.artists.length === 0 && data.albums.length === 0 ? (
        <p className="text-sm text-neutral-600">Nada escuchado en «{rangeLabel}».</p>
      ) : (
        <div className="grid md:grid-cols-2 gap-x-6 gap-y-4">
          <div>
            <h3 className="text-xs uppercase tracking-wide text-neutral-600 mb-2">Artistas</h3>
            <div className="space-y-1">
              {data.artists.map((a) => (
                <div key={a.artist} className="flex items-center justify-between text-sm px-1 py-0.5">
                  {a.artist_id ? (
                    <Link to={`/artista/${a.artist_id}`} className="hover:text-gold-400 truncate">
                      {a.artist}
                    </Link>
                  ) : (
                    <span className="truncate text-neutral-300">{a.artist}</span>
                  )}
                  <span className="text-neutral-500 shrink-0 ml-2">
                    {a.plays}
                    {a.owned_albums === 0 && <span className="text-amber-500/80"> · 0 en disco</span>}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h3 className="text-xs uppercase tracking-wide text-neutral-600 mb-2">Álbumes</h3>
            <div className="space-y-1">
              {data.albums.map((a, i) => (
                <div key={i} className="flex items-center justify-between text-sm px-1 py-0.5">
                  <span className="truncate text-neutral-300">
                    {a.artist} <span className="text-neutral-500">— {a.album}</span>
                  </span>
                  <span className="text-neutral-500 shrink-0 ml-2">
                    {a.plays}
                    {!a.owned && <span className="text-amber-500/80"> · no lo tienes</span>}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function GapRow({ g }) {
  const [followed, setFollowed] = useState(g.tracked);
  const [busy, setBusy] = useState(false);
  const follow = async () => {
    setBusy(true);
    try {
      if (g.artist_mbid) await api.followMbid(g.artist_mbid, 'artist');
      else if (g.artist_id) await api.follow(g.artist_id, 'artist');
      else {
        // La brecha no trae MBID (no lo tienes en disco): lo resolvemos por nombre en
        // MusicBrainz y seguimos el mejor resultado.
        const hits = await api.searchArtistMb(g.artist);
        const best = hits?.[0];
        if (!best?.mbid) return alert('MusicBrainz no encuentra a este artista por su nombre.');
        await api.followMbid(best.mbid, 'artist');
      }
      setFollowed(true);
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex items-center justify-between bg-ink-850/50 rounded px-2.5 py-1.5 text-sm">
      <div className="min-w-0">
        <div className="truncate">{g.artist}</div>
        <div className="text-xs text-neutral-500">
          {g.plays} escuchas · {g.owned_albums} en disco
        </div>
      </div>
      {followed ? (
        <span className="text-emerald-400 text-xs inline-flex items-center gap-1 shrink-0">
          <Star size={12} className="fill-current" /> sigues
        </span>
      ) : (
        <button
          onClick={follow}
          disabled={busy}
          className="text-xs px-1.5 py-0.5 rounded border border-gold-500/40 bg-gold-500/10 text-gold-300 hover:bg-gold-500/20 shrink-0 inline-flex items-center gap-1 disabled:opacity-50"
        >
          <Star size={12} /> Seguir
        </button>
      )}
    </div>
  );
}
