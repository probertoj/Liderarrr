import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Star, Search, Plus, Sparkles, X, RefreshCw } from 'lucide-react';
import { api } from '../api.js';
import { PageTitle, Spinner, ErrorMsg, Button, ProgressBar } from '../components.jsx';
import { aviso } from '../avisos.jsx';

// Seguidos (favoritos): los artistas cuya obra quieres completar. Alimentan los
// huecos, el calendario y el auto-Lidarr. Puedes seguir de tu biblioteca o buscar
// en MusicBrainz a alguien de quien aún no tienes nada (artistas emergentes).
export default function Tracked() {
  const [rows, setRows] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [err, setErr] = useState(null);

  const pedir = () =>
    Promise.all([api.tracked(), api.suggestions()]).then(([t, s]) => {
      setRows(t);
      setSuggestions(s);
    });
  // Recarga tras seguir o dejar de seguir: si falla se avisa y la página se queda como
  // estaba (antes un fallo aquí la cambiaba entera por un cuadro rojo).
  const load = () => pedir().catch((e) => aviso(e.message, 'error'));
  useEffect(() => {
    pedir().catch((e) => setErr(e.message));
  }, []);

  // Antes, si la petición fallaba, el clic sencillamente no hacía nada.
  const follow = async (id) => {
    try {
      await api.follow(id, 'artist');
      await load();
    } catch (e) {
      aviso(e.message, 'error');
    }
  };
  const unfollow = async (id) => {
    try {
      await api.unfollow(id, 'artist');
      await load();
    } catch (e) {
      aviso(e.message, 'error');
    }
  };

  if (err) return <ErrorMsg>{err}</ErrorMsg>;
  if (!rows) return <Spinner />;

  return (
    <div>
      <PageTitle icon={Star} title="Seguidos" sub={`${rows.length} artistas que quieres completar`} />

      <MbSearch onFollowed={load} />

      {rows.length === 0 ? (
        <div className="card p-6 text-center text-neutral-400 mb-6">
          Aún no sigues a nadie. Sigue a un artista para ver qué te falta de su discografía y pedirlo.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-8">
          {rows.map((a) => (
            <div key={a.id} className="card p-3 min-w-0">
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
        <div className="mb-8">
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

      <SimilarSuggestions onFollowed={load} />
    </div>
  );
}

// «Quizá quieras seguir a…»: artistas que NO tienes ni sigues, similares (Last.fm) a los
// que ya sigues. Seguir uno lo resuelve a MusicBrainz y calcula su discografía.
function SimilarSuggestions({ onFollowed }) {
  const [items, setItems] = useState(null);
  const [busy, setBusy] = useState(null); // name en curso
  const [refreshing, setRefreshing] = useState(false);

  // Dos artistas que sigues pueden recomendar al mismo: llegaba dos veces, con la misma
  // clave de React («Damon Albarn», «Iván Ferreiro»…) y la ficha salía repetida.
  const sinRepetir = (lista) => {
    const vistos = new Set();
    return (lista || []).filter((s) => {
      const k = String(s.name || '').trim().toLowerCase();
      if (!k || vistos.has(k)) return false;
      vistos.add(k);
      return true;
    });
  };
  const load = () =>
    api
      .artistSuggestions(40)
      .then((l) => setItems(sinRepetir(l)))
      .catch(() => setItems([]));
  useEffect(() => {
    load();
  }, []);

  const follow = async (s) => {
    setBusy(s.name);
    try {
      await api.followSuggestion(s.name, s.mbid);
      setItems((p) => p.filter((x) => x.name !== s.name));
      onFollowed?.();
    } catch (e) {
      aviso(e.message, 'error');
    } finally {
      setBusy(null);
    }
  };
  const dismiss = async (s) => {
    setItems((p) => p.filter((x) => x.name !== s.name));
    // Se quita ya de la vista; si el servidor no lo apunta, se dice y vuelve a salir, en
    // vez de reaparecer sin explicación en la siguiente visita.
    api.dismissSuggestion(s.name).catch((e) => {
      aviso(`No se pudo descartar a ${s.name}: ${e.message}`, 'error');
      load();
    });
  };
  const recompute = async () => {
    setRefreshing(true);
    try {
      await api.refreshSuggestions();
      await load();
    } catch (e) {
      aviso(e.message, 'error');
    } finally {
      setRefreshing(false);
    }
  };

  if (!items) return null;

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2">
        <h2 className="text-sm text-neutral-400 inline-flex items-center gap-1.5">
          <Sparkles size={14} className="text-gold-400" /> Quizá quieras seguir a…
        </h2>
        <button
          onClick={recompute}
          disabled={refreshing}
          className="text-xs text-neutral-500 hover:text-gold-400 inline-flex items-center gap-1 disabled:opacity-60"
        >
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} /> {refreshing ? 'Calculando…' : 'Recalcular'}
        </button>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-neutral-600">
          Sin sugerencias todavía. Sigue a algún artista y pulsa «Recalcular» (necesita Last.fm configurado).
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {items.map((s) => (
            <div key={s.name} className="card p-3 flex gap-3 min-w-0">
              <div className="shrink-0 w-12 h-12 rounded-full overflow-hidden bg-ink-800 border border-ink-700 flex items-center justify-center text-neutral-500 text-sm">
                {s.image ? (
                  <img src={s.image} alt="" className="w-full h-full object-cover" loading="lazy" />
                ) : (
                  (s.name || '?').slice(0, 2).toUpperCase()
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-sm truncate min-w-0">{s.name}</div>
                  <button onClick={() => dismiss(s)} className="text-neutral-600 hover:text-neutral-300 shrink-0 p-1 -m-1" aria-label={`Descartar a ${s.name}`} title="No me interesa">
                    <X size={14} />
                  </button>
                </div>
                {s.reasons?.length > 0 && (
                  <div className="text-[11px] text-neutral-500 truncate" title={s.reasons.join(', ')}>
                    porque sigues a {s.reasons.slice(0, 2).join(', ')}
                    {s.reasons.length > 2 ? '…' : ''}
                  </div>
                )}
                <button
                  onClick={() => follow(s)}
                  disabled={busy === s.name}
                  className="mt-1.5 text-xs px-2 py-1 rounded border border-gold-500/40 bg-gold-500/10 text-gold-300 hover:bg-gold-500/20 disabled:opacity-60 inline-flex items-center gap-1"
                >
                  <Plus size={13} /> {busy === s.name ? 'Siguiendo…' : 'Seguir'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MbSearch({ onFollowed }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [siguiendo, setSiguiendo] = useState(null); // mbid en curso

  const search = async (e) => {
    e.preventDefault();
    if (!q.trim()) return;
    setBusy(true);
    setResults(null);
    try {
      setResults(await api.searchArtistMb(q));
    } catch (e2) {
      aviso(e2.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-6">
      <form onSubmit={search} className="flex gap-2">
        <div className="relative flex-1 min-w-0">
          <Search size={15} className="absolute left-2.5 top-2.5 text-neutral-600" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar artista en MusicBrainz (aunque no lo tengas)…"
            aria-label="Buscar artista en MusicBrainz"
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
            <div key={r.mbid} className="card px-3 py-2 flex items-center justify-between gap-2 text-sm">
              <div className="min-w-0 break-words">
                <span>{r.name}</span>
                <span className="text-xs text-neutral-600 ml-2">
                  {r.type || ''}
                  {r.country ? ` · ${r.country}` : ''}
                  {r.disambiguation ? ` · ${r.disambiguation}` : ''}
                </span>
              </div>
              <button
                type="button"
                disabled={siguiendo != null}
                onClick={async () => {
                  setSiguiendo(r.mbid);
                  try {
                    await api.followMbid(r.mbid, 'artist');
                    setResults(null);
                    setQ('');
                    onFollowed();
                  } catch (e) {
                    aviso(e.message, 'error');
                  } finally {
                    setSiguiendo(null);
                  }
                }}
                className="text-xs px-2 py-1 rounded border border-gold-500/40 bg-gold-500/10 text-gold-300 hover:bg-gold-500/20 shrink-0 inline-flex items-center gap-1 disabled:opacity-50"
              >
                <Plus size={13} /> {siguiendo === r.mbid ? 'Siguiendo…' : 'Seguir'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
