import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Compass, Plus, Check, X, RefreshCw, Loader2, ExternalLink } from 'lucide-react';
import { api, pollLidarrQueue } from '../api.js';
import { PageTitle, Spinner, ErrorMsg, Button, SearchModal } from '../components.jsx';

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

  const load = () => api.gaps(all).then(setData).catch((e) => setErr(e.message));
  useEffect(() => {
    setData(null);
    load();
  }, [all]);

  // Lidarr es lento: el envío se ENCOLA y responde al instante; se sondea el progreso.
  const add = async (rg, artistMbid) => {
    setBusy(rg.rg_mbid);
    try {
      await api.lidarrAdd(rg.rg_mbid, artistMbid);
      setAdded((p) => ({ ...p, [rg.rg_mbid]: true }));
      pollLidarrQueue(setQueue);
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(null);
    }
  };
  const addArtist = async (group) => {
    const toSend = group.missing.filter((m) => !added[m.rg_mbid] && !m.in_lidarr);
    if (!toSend.length) return;
    setBusy(group.artist_id);
    try {
      await api.lidarrAddBulk(toSend.map((m) => ({ rg_mbid: m.rg_mbid, artist_mbid: group.artist_mbid })));
      const next = {};
      for (const m of toSend) next[m.rg_mbid] = true;
      setAdded((p) => ({ ...p, ...next }));
      pollLidarrQueue(setQueue);
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(null);
    }
  };
  const dismiss = async (rg) => {
    await api.dismiss(rg.rg_mbid, rg.title);
    await load();
  };

  const recalc = async () => {
    setRefreshing(true);
    try {
      await api.discographyRefresh(!all);
      // sondear hasta que termine
      let done = false;
      while (!done) {
        await new Promise((r) => setTimeout(r, 1500));
        const s = await api.discographyStatus();
        done = !s.running;
      }
      await load();
    } finally {
      setRefreshing(false);
    }
  };

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

      <div className="space-y-4">
        {data?.artists.map((group) => (
          <div key={group.artist_id} className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <Link to={`/artista/${group.artist_id}`} className="font-medium hover:text-gold-400">
                {group.artist}
                <span className="text-neutral-600 text-sm ml-2">faltan {group.missing.length}</span>
              </Link>
              <Button variant="gold" onClick={() => addArtist(group)} disabled={busy === group.artist_id}>
                <span className="inline-flex items-center gap-1.5">
                  {busy === group.artist_id && <Loader2 size={14} className="animate-spin" />}
                  {busy === group.artist_id ? 'Enviando…' : 'Enviar todos'}
                </span>
              </Button>
            </div>
            <div className="grid sm:grid-cols-2 gap-1.5">
              {group.missing.map((m) => {
                const done = added[m.rg_mbid] || m.in_lidarr;
                return (
                  <div key={m.rg_mbid} className="flex items-center justify-between text-sm bg-ink-850/50 rounded px-2.5 py-1.5">
                    <span className="truncate">
                      {m.title}
                      {m.year ? <span className="text-neutral-600"> · {m.year}</span> : ''}
                    </span>
                    <div className="flex items-center gap-1 shrink-0 ml-2">
                      <a
                        href={`https://musicbrainz.org/release-group/${m.rg_mbid}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-gold-400 hover:underline inline-flex items-center gap-0.5"
                      >
                        MB <ExternalLink size={11} />
                      </a>
                      <button
                        onClick={() => setSearch(`${group.artist} ${m.title}`)}
                        className="text-xs px-1.5 py-0.5 rounded border border-ink-700 bg-ink-850 hover:bg-ink-800"
                      >
                        Buscar
                      </button>
                      {done ? (
                        <span className="text-emerald-400 text-xs inline-flex items-center gap-1">
                          <Check size={13} /> Lidarr
                        </span>
                      ) : (
                        <>
                          <button
                            onClick={() => add(m, group.artist_mbid)}
                            disabled={busy === m.rg_mbid}
                            className="text-xs px-1.5 py-0.5 rounded border border-gold-500/40 bg-gold-500/10 text-gold-300 hover:bg-gold-500/20 inline-flex items-center gap-1 disabled:opacity-50"
                          >
                            {busy === m.rg_mbid ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                            {busy === m.rg_mbid ? 'Enviando…' : 'Lidarr'}
                          </button>
                          <button
                            onClick={() => dismiss(m)}
                            title="No me interesa"
                            className="text-neutral-600 hover:text-red-400"
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

      {search != null && <SearchModal initialQuery={search} onClose={() => setSearch(null)} />}
    </div>
  );
}
