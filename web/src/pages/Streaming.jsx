import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Library, Download, ExternalLink, RefreshCw, Loader2, Check, Disc3 } from 'lucide-react';
import { api } from '../api.js';
import { PageTitle, Spinner, ErrorMsg, Button, AddToChallengeButton } from '../components.jsx';

// Página «Streaming» (1.0): la brecha entre tu COLECCIÓN LOCAL y tu BIBLIOTECA GUARDADA de
// Spotify. Dos lados: lo que tienes en streaming y no en disco (→ descargar) y lo que tienes
// en disco y no en streaming (→ abrir en Spotify para guardarlo). Requiere conectar tu
// biblioteca de Spotify por OAuth (en Ajustes).

function StreamingRow({ r, added, busy, onDownload }) {
  const done = added[r.id];
  return (
    <div className="card px-3 py-2 flex items-center gap-3 text-sm">
      <img
        src={r.cover || ''}
        alt=""
        loading="lazy"
        onError={(e) => (e.currentTarget.style.visibility = 'hidden')}
        className="w-10 h-10 rounded object-cover bg-ink-850 shrink-0"
      />
      <div className="min-w-0 flex-1">
        <div className="truncate clamp-mobile" title={`${r.artist} — ${r.title}`}>
          <span>{r.artist}</span>
          <span className="text-neutral-500"> — {r.title}</span>
        </div>
        <div className="text-xs text-neutral-600 flex items-center gap-2 flex-wrap">
          {r.release_date && <span>{r.release_date.slice(0, 4)}</span>}
          {r.album_type && r.album_type !== 'album' && (
            <span className="uppercase text-[10px] px-1.5 py-0.5 rounded-full border border-ink-700">{r.album_type}</span>
          )}
          {r.added_at && <span className="text-neutral-700">guardado {r.added_at.slice(0, 10)}</span>}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <AddToChallengeButton artist={r.artist} title={r.title} />
        {done ? (
          <span className="text-emerald-400 text-xs inline-flex items-center gap-1">
            <Check size={13} /> pedido
          </span>
        ) : (
          <button
            onClick={() => onDownload(r)}
            disabled={busy === r.id}
            className="text-xs px-1.5 py-0.5 rounded border border-gold-500/40 bg-gold-500/10 text-gold-300 hover:bg-gold-500/20 inline-flex items-center gap-1 disabled:opacity-50"
          >
            {busy === r.id ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} Descargar
          </button>
        )}
        {r.url && (
          <a
            href={r.url}
            target="_blank"
            rel="noreferrer"
            title="Abrir en Spotify"
            className="text-xs px-1.5 py-0.5 rounded border border-emerald-600/40 bg-emerald-600/10 text-emerald-300/90 hover:bg-emerald-600/20 inline-flex items-center gap-1"
          >
            <ExternalLink size={12} /> Spotify
          </a>
        )}
      </div>
    </div>
  );
}

function LocalRow({ r }) {
  return (
    <div className="card px-3 py-2 flex items-center gap-3 text-sm">
      <div className="min-w-0 flex-1">
        <div className="truncate clamp-mobile" title={`${r.artist} — ${r.title}`}>
          {r.album_id ? (
            <Link to={`/album/${r.album_id}`} className="hover:text-gold-400">
              {r.artist} <span className="text-neutral-500">— {r.title}</span>
            </Link>
          ) : (
            <span>
              {r.artist} <span className="text-neutral-500">— {r.title}</span>
            </span>
          )}
        </div>
        {r.year ? <div className="text-xs text-neutral-600">{r.year}</div> : null}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <AddToChallengeButton artist={r.artist} title={r.title} />
        <a
          href={`https://open.spotify.com/search/${encodeURIComponent(`${r.artist} ${r.title}`.trim())}`}
          target="_blank"
          rel="noreferrer"
          title="Buscarlo en Spotify para guardarlo en tu biblioteca"
          className="text-xs px-1.5 py-0.5 rounded border border-emerald-600/40 bg-emerald-600/10 text-emerald-300/90 hover:bg-emerald-600/20 inline-flex items-center gap-1"
        >
          <ExternalLink size={12} /> Guardar en Spotify
        </a>
      </div>
    </div>
  );
}

export default function Streaming() {
  const [status, setStatus] = useState(null);
  const [gap, setGap] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(null);
  const [added, setAdded] = useState({});
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState(null);
  const [side, setSide] = useState('streaming'); // qué lado de la brecha mostrar
  const [q, setQ] = useState(''); // filtro de texto (la lista local puede tener miles)
  const [limit, setLimit] = useState(200); // render por lotes: evita congelar con 26k filas
  const [onlyAlbums, setOnlyAlbums] = useState(false); // opcional: deja fuera singles/EPs
  const poll = useRef(null);
  useEffect(() => {
    setLimit(200); // al cambiar de lado, buscar o filtrar, vuelve al primer lote
  }, [side, q, onlyAlbums]);

  const loadStatus = () => api.spotifyUserStatus().then(setStatus).catch((e) => setErr(e.message));
  const loadGap = () =>
    api
      .spotifyGap()
      .then(setGap)
      .catch(() => {});
  useEffect(() => {
    loadStatus();
  }, []);
  useEffect(() => {
    if (status?.connected) loadGap();
  }, [status?.connected]);
  useEffect(() => () => clearInterval(poll.current), []);

  const sync = async () => {
    setSyncing(true);
    setSyncMsg('Sincronizando tu biblioteca de Spotify…');
    setErr(null);
    try {
      await api.spotifyLibraryRefresh();
    } catch (e) {
      setErr(e.message);
      setSyncing(false);
      return;
    }
    clearInterval(poll.current);
    poll.current = setInterval(async () => {
      let st;
      try {
        st = await api.spotifyLibraryStatus();
      } catch {
        return;
      }
      if (st.running) {
        setSyncMsg(`Sincronizando… ${st.fetched}${st.total ? `/${st.total}` : ''} álbumes`);
        return;
      }
      clearInterval(poll.current);
      setSyncing(false);
      setSyncMsg(null);
      if (st.error) {
        setErr(st.error);
        return;
      }
      await loadStatus();
      await loadGap();
    }, 1500);
  };

  const download = async (r) => {
    setBusy(r.id);
    try {
      const res = await api.grabBest(`${r.artist} ${r.title}`, { artist: r.artist, album: r.title });
      if (!res.grabbed) {
        alert(`No se pudo agarrar: ${res.reason || 'sin release'}`);
        return;
      }
      setAdded((p) => ({ ...p, [r.id]: true }));
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(null);
    }
  };

  if (err && !status) return <ErrorMsg>{err}</ErrorMsg>;
  if (!status) return <Spinner />;

  // estados sin conectar
  if (!status.clientConfigured) {
    return (
      <div>
        <PageTitle icon={Library} title="Streaming" sub="Tu colección local frente a tu biblioteca de Spotify" />
        <div className="card p-8 text-center text-neutral-400">
          Primero configura tu app de Spotify (client id y secret) en{' '}
          <Link to="/ajustes" className="text-gold-400 hover:underline">
            Ajustes
          </Link>
          . Luego podrás conectar tu biblioteca.
        </div>
      </div>
    );
  }
  if (!status.connected) {
    return (
      <div>
        <PageTitle icon={Library} title="Streaming" sub="Tu colección local frente a tu biblioteca de Spotify" />
        <div className="card p-8 text-center text-neutral-400">
          Conecta tu biblioteca de Spotify en{' '}
          <Link to="/ajustes" className="text-gold-400 hover:underline">
            Ajustes → Biblioteca de Spotify
          </Link>{' '}
          para ver la brecha entre lo que tienes en disco y lo que tienes en streaming.
        </div>
      </div>
    );
  }

  const c = gap?.counts;
  // toggle «solo álbumes»: fuera singles/EPs/recopilatorios. En streaming por album_type de
  // Spotify; en local por primary_type (null = sin identificar → se trata como álbum).
  const isAlbumStreaming = (r) => (r.album_type || 'album').toLowerCase() === 'album';
  const isAlbumLocal = (r) => !r.primary_type || /^album$/i.test(r.primary_type);
  const streamRows = onlyAlbums ? (gap?.onlyStreaming || []).filter(isAlbumStreaming) : gap?.onlyStreaming || [];
  const localRows = onlyAlbums ? (gap?.onlyLocal || []).filter(isAlbumLocal) : gap?.onlyLocal || [];
  const allRows = side === 'streaming' ? streamRows : localRows;
  const term = q.trim().toLowerCase();
  const filtered = term
    ? allRows.filter((r) => `${r.artist} ${r.title}`.toLowerCase().includes(term))
    : allRows;
  const rows = filtered.slice(0, limit);

  return (
    <div>
      <PageTitle icon={Library} title="Streaming" sub="Tu colección local frente a tu biblioteca de Spotify">
        <Button onClick={sync} disabled={syncing}>
          <span className="inline-flex items-center gap-1.5">
            <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} /> {syncing ? 'Sincronizando…' : 'Sincronizar Spotify'}
          </span>
        </Button>
      </PageTitle>

      {syncMsg && <p className="text-xs text-gold-300/90 mb-3">{syncMsg}</p>}
      {err && <ErrorMsg>{err}</ErrorMsg>}

      {c && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
          <div className="card p-3">
            <div className="text-xl font-display text-neutral-100">{c.streaming.toLocaleString('es')}</div>
            <div className="text-xs text-neutral-500">guardados en Spotify</div>
          </div>
          <div className="card p-3">
            <div className="text-xl font-display text-neutral-100">{c.local.toLocaleString('es')}</div>
            <div className="text-xs text-neutral-500">álbumes en tu disco</div>
          </div>
          <div className="card p-3">
            <div className="text-xl font-display text-emerald-300">{c.inBoth.toLocaleString('es')}</div>
            <div className="text-xs text-neutral-500">en ambos</div>
          </div>
          <div className="card p-3">
            <div className="text-xl font-display text-gold-300">{(c.onlyStreaming + c.onlyLocal).toLocaleString('es')}</div>
            <div className="text-xs text-neutral-500">en la brecha</div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-4">
        <button
          onClick={() => setSide('streaming')}
          className={`text-sm px-3 py-1.5 rounded-lg border ${
            side === 'streaming' ? 'border-gold-500/50 bg-gold-500/15 text-gold-300' : 'border-ink-800 bg-ink-850 text-neutral-400'
          }`}
        >
          ⬇️ En Spotify, no en tu disco{gap ? ` · ${streamRows.length}` : ''}
        </button>
        <button
          onClick={() => setSide('local')}
          className={`text-sm px-3 py-1.5 rounded-lg border ${
            side === 'local' ? 'border-gold-500/50 bg-gold-500/15 text-gold-300' : 'border-ink-800 bg-ink-850 text-neutral-400'
          }`}
        >
          ⬆️ En tu disco, no en Spotify{gap ? ` · ${localRows.length}` : ''}
        </button>
      </div>

      <div className="flex items-center gap-2 flex-wrap mb-3">
        <p className="text-xs text-neutral-600 inline-flex items-center gap-1.5">
          <Disc3 size={13} />
          {side === 'streaming'
            ? 'Lo tienes guardado en Spotify pero no en tu disco: descárgalo.'
            : 'Lo tienes en tu disco pero no guardado en Spotify: ábrelo en Spotify y dale a guardar.'}
        </p>
        <label className="ml-auto flex items-center gap-2 text-sm text-neutral-400 cursor-pointer shrink-0">
          <input type="checkbox" checked={onlyAlbums} onChange={(e) => setOnlyAlbums(e.target.checked)} />
          Solo álbumes
        </label>
        {allRows.length > 20 && (
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filtrar por artista o álbum…"
            className="w-full sm:w-64 bg-ink-850 border border-ink-800 rounded-lg px-2.5 py-1.5 text-sm"
          />
        )}
      </div>

      {!gap ? (
        <Spinner label="Cruzando tu colección con Spotify…" />
      ) : filtered.length === 0 ? (
        <div className="card p-6 text-center text-neutral-400">
          {term
            ? 'Nada coincide con tu filtro.'
            : side === 'streaming'
              ? 'No hay nada en tu Spotify que no tengas ya en disco. 🎉'
              : 'Todo lo de tu disco está también guardado en tu Spotify.'}
          {status.syncedAt ? '' : ' (Pulsa «Sincronizar Spotify» para traer tu biblioteca.)'}
        </div>
      ) : (
        <>
          <div className="space-y-1.5">
            {side === 'streaming'
              ? rows.map((r) => <StreamingRow key={r.id} r={r} added={added} busy={busy} onDownload={download} />)
              : rows.map((r) => <LocalRow key={r.album_id} r={r} />)}
          </div>
          {filtered.length > rows.length && (
            <div className="mt-3 text-center">
              <button
                onClick={() => setLimit((l) => l + 300)}
                className="text-sm px-3 py-1.5 rounded-lg border border-ink-700 bg-ink-850 hover:bg-ink-800"
              >
                Mostrar más ({(filtered.length - rows.length).toLocaleString('es')} restantes)
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
