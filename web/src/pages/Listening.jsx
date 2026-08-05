import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Headphones, TrendingUp, Star, EarOff } from 'lucide-react';
import { BarChart, Bar, ResponsiveContainer, XAxis, Tooltip } from 'recharts';
import { api } from '../api.js';
import { PageTitle, Stat, Spinner, ErrorMsg, Button } from '../components.jsx';

export default function Listening() {
  const [ov, setOv] = useState(null);
  const [gap, setGap] = useState(null);
  const [unplayed, setUnplayed] = useState(null);
  const [err, setErr] = useState(null);
  const [importing, setImporting] = useState(false);

  const load = () => {
    api.listening().then(setOv).catch((e) => setErr(e.message));
    api.gap().then(setGap).catch(() => {});
    api.unplayed().then(setUnplayed).catch(() => {});
  };
  useEffect(() => {
    load();
  }, []);

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
        <h2 className="font-display text-lg mb-1 flex items-center gap-2">
          <TrendingUp size={18} className="text-gold-400" /> Brecha escucha↔propiedad
        </h2>
        <p className="text-xs text-neutral-500 mb-3">
          Artistas que escuchas mucho y de los que tienes poco o nada. Tu mejor lista de candidatos: es tu
          gusto real, no un algoritmo.
        </p>
        {!gap || gap.length === 0 ? (
          <p className="text-neutral-600 text-sm">Nada destacable: tienes lo que escuchas. 👏</p>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {gap.map((g) => (
              <GapRow key={g.artist} g={g} />
            ))}
          </div>
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-4 mb-6">
        <div className="card p-4">
          <h2 className="text-sm text-neutral-400 mb-3">Más escuchados</h2>
          <div className="space-y-1">
            {ov.topArtists.slice(0, 12).map((a) => (
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

        <div className="card p-4">
          <h2 className="text-sm text-neutral-400 mb-3">Escuchas por año</h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={ov.byYear}>
              <XAxis dataKey="year" tick={{ fill: '#888', fontSize: 12 }} />
              <Tooltip contentStyle={{ background: '#191921', border: '1px solid #2c2c39', borderRadius: 8 }} />
              <Bar dataKey="plays" fill="#d4a24a" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {unplayed && unplayed.length > 0 && (
        <div className="card p-4">
          <h2 className="text-sm text-neutral-400 mb-3 flex items-center gap-2">
            <EarOff size={15} /> Tienes pero nunca has escuchado ({unplayed.length})
          </h2>
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
