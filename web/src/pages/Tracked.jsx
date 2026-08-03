import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Star, Search, Plus } from 'lucide-react';
import { api } from '../api.js';
import { PageTitle, Spinner, ErrorMsg, Button, ProgressBar } from '../components.jsx';

// Seguidos (favoritos): los artistas cuya obra quieres completar. Alimentan los
// huecos, el calendario y el auto-Lidarr. Puedes seguir de tu biblioteca o buscar
// en MusicBrainz a alguien de quien aún no tienes nada (artistas emergentes).
export default function Tracked() {
  const [rows, setRows] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [err, setErr] = useState(null);

  const load = () =>
    Promise.all([api.tracked(), api.suggestions()])
      .then(([t, s]) => {
        setRows(t);
        setSuggestions(s);
      })
      .catch((e) => setErr(e.message));
  useEffect(() => {
    load();
  }, []);

  const follow = async (id) => {
    await api.follow(id, 'artist');
    await load();
  };
  const unfollow = async (id) => {
    await api.unfollow(id, 'artist');
    await load();
  };

  if (err) return <ErrorMsg>{err}</ErrorMsg>;
  if (!rows) return <Spinner />;

  return (
    <div>
      <PageTitle icon={Star} title="Seguidos" sub={`${rows.length} artistas que quieres completar`} />

      <MbSearch onFollowed={load} />

      {rows.length === 0 ? (
        <div className="card p-6 text-center text-neutral-400 mb-6">
          Aún no sigues a nadie. Sigue a un artista para ver qué te falta de su discografía y encargarlo a Lidarr.
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-2 mb-8">
          {rows.map((a) => (
            <div key={a.id} className="card p-3">
              <div className="flex items-center justify-between mb-2">
                <Link to={`/artista/${a.id}`} className="hover:text-gold-400 min-w-0 truncate">
                  {a.name}
                </Link>
                <button
                  onClick={() => unfollow(a.id)}
                  className="text-xs text-neutral-500 hover:text-red-400 shrink-0 ml-2"
                >
                  dejar de seguir
                </button>
              </div>
              <ProgressBar pct={a.pct} />
              <div className="text-xs text-neutral-500 mt-1.5">
                {a.owned_albums} en disco
                {a.studio_total != null ? ` · ${a.studio_owned}/${a.studio_total} estudio · faltan ${a.missing}` : ' · sin datos de MusicBrainz'}
              </div>
            </div>
          ))}
        </div>
      )}

      {suggestions.length > 0 && (
        <div>
          <h2 className="text-sm text-neutral-400 mb-2">Sugerencias (de tu biblioteca)</h2>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button
                key={s.id}
                onClick={() => follow(s.id)}
                className="text-sm px-2.5 py-1 rounded-full bg-ink-850 border border-ink-800 hover:border-gold-500/40 inline-flex items-center gap-1.5"
              >
                <Plus size={13} /> {s.name} <span className="text-neutral-600">{s.albums}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MbSearch({ onFollowed }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);

  const search = async (e) => {
    e.preventDefault();
    if (!q.trim()) return;
    setBusy(true);
    setResults(null);
    try {
      setResults(await api.searchArtistMb(q));
    } catch (e2) {
      alert(e2.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-6">
      <form onSubmit={search} className="flex gap-2">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-2.5 top-2.5 text-neutral-600" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar artista en MusicBrainz (aunque no lo tengas)…"
            className="w-full bg-ink-850 border border-ink-800 rounded-lg pl-8 pr-3 py-1.5 text-sm"
          />
        </div>
        <Button variant="default" disabled={busy}>
          {busy ? 'Buscando…' : 'Buscar'}
        </Button>
      </form>
      {results && (
        <div className="mt-2 space-y-1">
          {results.length === 0 && <p className="text-sm text-neutral-600">Sin resultados.</p>}
          {results.map((r) => (
            <div key={r.mbid} className="card px-3 py-2 flex items-center justify-between text-sm">
              <div className="min-w-0">
                <span className="truncate">{r.name}</span>
                <span className="text-xs text-neutral-600 ml-2">
                  {r.type || ''}
                  {r.country ? ` · ${r.country}` : ''}
                  {r.disambiguation ? ` · ${r.disambiguation}` : ''}
                </span>
              </div>
              <button
                onClick={async () => {
                  await api.followMbid(r.mbid, 'artist');
                  setResults(null);
                  setQ('');
                  onFollowed();
                }}
                className="text-xs px-2 py-1 rounded border border-gold-500/40 bg-gold-500/10 text-gold-300 hover:bg-gold-500/20 shrink-0 inline-flex items-center gap-1"
              >
                <Plus size={13} /> Seguir
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
