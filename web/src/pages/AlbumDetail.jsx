import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Music2, Sparkles, RotateCcw, Disc3, ExternalLink, Tag, AlertTriangle } from 'lucide-react';
import { api, fmtBytes } from '../api.js';
import { Cover, StateBadge, Spinner, ErrorMsg, Button, PageTitle } from '../components.jsx';

export default function AlbumDetail() {
  const { id } = useParams();
  const [album, setAlbum] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.album(id).then(setAlbum).catch((e) => setErr(e.message));
  useEffect(() => {
    setAlbum(null);
    load();
  }, [id]);

  const setState = async (state) => {
    setBusy(true);
    try {
      await api.albumState(id, state);
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (err) return <ErrorMsg>{err}</ErrorMsg>;
  if (!album) return <Spinner label="Cargando álbum…" />;

  const incomplete = album.track_file_count < album.track_count;
  const min = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;

  return (
    <div>
      <Link to="/discoteca" className="inline-flex items-center gap-1.5 text-sm text-neutral-400 hover:text-gold-400 mb-4">
        <ArrowLeft size={15} /> Discoteca
      </Link>

      <div className="flex flex-col md:flex-row gap-6 mb-6">
        <div className="w-full md:w-64 shrink-0">
          <div className="rounded-xl overflow-hidden card">
            <Cover id={album.id} />
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <StateBadge state={album.match_state} />
            {album.primary_type && <span className="text-xs text-neutral-500">{album.primary_type}</span>}
            {album.secondary_types?.map((t) => (
              <span key={t} className="text-xs text-neutral-600">· {t}</span>
            ))}
          </div>
          <h1 className="text-2xl font-display">{album.title}</h1>
          <Link to={`/artista/${album.artist_id}`} className="text-gold-400 hover:underline">
            {album.artist?.name || album.album_artist}
          </Link>
          {album.year && <span className="text-neutral-500"> · {album.year}</span>}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 text-sm">
            <div>
              <div className="text-neutral-500 text-xs">Pistas</div>
              <div className={incomplete ? 'text-amber-400' : ''}>
                {album.track_file_count}
                {incomplete ? ` / ${album.track_count}` : ''}
              </div>
            </div>
            <div>
              <div className="text-neutral-500 text-xs">Tamaño</div>
              <div>{fmtBytes(album.size_bytes)}</div>
            </div>
            <div>
              <div className="text-neutral-500 text-xs">Discos</div>
              <div>{album.disc_count}</div>
            </div>
            <div>
              <div className="text-neutral-500 text-xs">Origen</div>
              <div>{album.match_source || '—'}</div>
            </div>
          </div>

          {album.genres?.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-4">
              {album.genres.map((g) => (
                <span key={g} className="text-xs px-2 py-0.5 rounded-full bg-ink-850 border border-ink-800">
                  {g}
                </span>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-2 mt-5">
            {album.match_state !== 'orphan' ? (
              <Button variant="default" onClick={() => setState('orphan')} disabled={busy}>
                <span className="inline-flex items-center gap-1.5">
                  <Sparkles size={14} /> Marcar como rareza
                </span>
              </Button>
            ) : (
              <Button variant="default" onClick={() => setState('pending')} disabled={busy}>
                <span className="inline-flex items-center gap-1.5">
                  <RotateCcw size={14} /> Devolver a pendiente
                </span>
              </Button>
            )}
            {album.inLidarr && <span className="text-sm text-emerald-400 self-center">✓ en Lidarr</span>}
          </div>
          <p className="text-xs text-neutral-600 mt-2 break-all">{album.path}</p>
        </div>
      </div>

      <Editions albumId={album.id} />

      {album.match_state === 'matched' && <TagWriter albumId={album.id} />}

      <div className="card overflow-hidden mb-6">
        <div className="px-4 py-2.5 border-b border-ink-800 flex items-center gap-2 text-sm text-neutral-400">
          <Music2 size={15} /> Pistas
        </div>
        <table className="w-full text-sm">
          <tbody>
            {album.tracks.map((t) => (
              <tr key={t.id} className="border-b border-ink-850/60 last:border-0 hover:bg-ink-850/40">
                <td className="py-2 px-4 text-neutral-600 w-10 text-right">{t.num || '·'}</td>
                <td className="py-2 pr-4">
                  <div className="truncate">{t.title}</div>
                </td>
                <td className="py-2 pr-4 text-neutral-500 whitespace-nowrap">
                  <span className={t.lossless ? 'text-emerald-400/80' : ''}>{t.format}</span>
                  {t.bitrate ? ` · ${Math.round(t.bitrate / 1000)}k` : ''}
                  {t.bit_depth ? ` · ${t.bit_depth}bit` : ''}
                </td>
                <td className="py-2 pr-4 text-neutral-600 text-right whitespace-nowrap">
                  {t.duration_ms ? min(t.duration_ms) : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Escritura de etiquetas (MBID): la única parte que toca tus ficheros. Opt-in,
// con preview del diff y confirmación. Solo se muestra en álbumes 'matched'.
function TagWriter({ albumId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [writing, setWriting] = useState(false);
  const [done, setDone] = useState(null);
  const [err, setErr] = useState(null);

  const load = async () => {
    setLoading(true);
    setErr(null);
    setDone(null);
    try {
      setData(await api.tagPreview(albumId));
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  const write = async () => {
    if (!confirm('Se escribirán los identificadores de MusicBrainz en los ficheros de este álbum. ¿Continuar?')) return;
    setWriting(true);
    try {
      const r = await api.writeTags(albumId);
      setDone(r);
      await load();
    } catch (e) {
      alert(e.message);
    } finally {
      setWriting(false);
    }
  };

  const notWritable = data?.tracks?.some((t) => !t.writable);

  return (
    <div className="card p-4 mb-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm text-neutral-400 flex items-center gap-2">
          <Tag size={15} /> Etiquetas MusicBrainz (escritura)
        </h2>
        {!data && (
          <Button onClick={load} disabled={loading}>
            {loading ? 'Comprobando…' : 'Previsualizar'}
          </Button>
        )}
      </div>
      <p className="text-xs text-neutral-600 mt-1">
        Escribe los MBID en tus ficheros para que el próximo escaneo los identifique al instante. Nunca borra otras
        etiquetas ni toca rarezas.
      </p>

      {err && <p className="text-sm text-red-400 mt-3">{err}</p>}

      {data && !data.eligible && <p className="text-sm text-neutral-500 mt-3">{data.reason}</p>}

      {data && data.eligible && (
        <div className="mt-3">
          {done && (
            <div className="mb-3 text-sm text-emerald-400">
              ✓ Escrito en {done.written} de {done.total} ficheros
              {done.errors?.length > 0 && <span className="text-amber-400"> · {done.errors.length} con error</span>}
            </div>
          )}

          {data.totalChanges === 0 ? (
            <p className="text-sm text-neutral-500">Los ficheros ya tienen estos MBID. Nada que escribir.</p>
          ) : (
            <>
              <div className="text-sm text-neutral-400 mb-2">
                {data.totalChanges} cambios en {data.tracks.filter((t) => t.changes.length).length} ficheros:
              </div>
              <div className="max-h-52 overflow-y-auto text-xs space-y-1 mb-3">
                {data.tracks
                  .filter((t) => t.changes.length)
                  .slice(0, 3)
                  .map((t, i) => (
                    <div key={i} className="text-neutral-500">
                      {t.changes.map((c, j) => (
                        <div key={j}>
                          <span className="text-neutral-400">{c.field.replace('MusicBrainz ', '')}:</span>{' '}
                          {c.from ? <span className="line-through text-neutral-700">{c.from.slice(0, 8)}…</span> : <span className="text-neutral-700">(vacío)</span>}{' '}
                          → <span className="text-emerald-400/80">{c.to.slice(0, 8)}…</span>
                        </div>
                      ))}
                    </div>
                  ))}
                <div className="text-neutral-600">…igual en el resto de pistas.</div>
              </div>

              {!data.writingEnabled ? (
                <div className="text-xs text-amber-400/90 flex items-start gap-1.5 bg-amber-950/20 border border-amber-900/40 rounded p-2">
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                  <span>
                    La escritura está desactivada. Actívala en{' '}
                    <Link to="/ajustes" className="underline">Ajustes</Link> (requiere montar la música en modo escritura).
                  </span>
                </div>
              ) : notWritable ? (
                <div className="text-xs text-amber-400/90 flex items-start gap-1.5">
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                  Los ficheros son de solo lectura. Monta tu música en modo escritura (`:rw`) para poder etiquetar.
                </div>
              ) : (
                <Button variant="gold" onClick={write} disabled={writing}>
                  {writing ? 'Escribiendo…' : `Escribir MBID en ${data.tracks.filter((t) => t.changes.length).length} ficheros`}
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Ediciones de Discogs (el equivalente de JustWatch): ¿existe una versión mejor
// de este disco ahí fuera? Se carga bajo demanda para no gastar peticiones.
function Editions({ albumId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      setData(await api.editions(albumId));
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card p-4 mb-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm text-neutral-400 flex items-center gap-2">
          <Disc3 size={15} /> Ediciones (Discogs)
        </h2>
        {!data && (
          <Button onClick={load} disabled={loading}>
            {loading ? 'Buscando…' : 'Buscar ediciones'}
          </Button>
        )}
      </div>

      {err && <p className="text-sm text-red-400 mt-3">{err}</p>}
      {data && data.configured === false && (
        <p className="text-sm text-neutral-600 mt-3">Configura un token de Discogs en Ajustes para ver ediciones.</p>
      )}
      {data && data.found === false && <p className="text-sm text-neutral-600 mt-3">Discogs no encuentra este álbum.</p>}

      {data && data.found && (
        <div className="mt-3">
          {data.upgradeHints?.length > 0 && (
            <div className="mb-3 text-sm">
              <span className="text-gold-400">Posibles upgrades:</span>{' '}
              {data.upgradeHints.map((u, i) => (
                <span key={i} className="text-neutral-400">
                  {u.format}
                  {u.year ? ` (${u.year})` : ''}
                  {i < data.upgradeHints.length - 1 ? ' · ' : ''}
                </span>
              ))}
            </div>
          )}
          <div className="max-h-72 overflow-y-auto divide-y divide-ink-850/60">
            {data.editions.map((e, i) => (
              <div key={i} className="py-1.5 flex items-center justify-between text-sm">
                <span className="text-neutral-300">
                  {e.format}
                  {e.label ? <span className="text-neutral-600"> · {e.label}</span> : ''}
                </span>
                <span className="text-neutral-500 shrink-0 ml-2">
                  {e.country ? `${e.country} ` : ''}
                  {e.year || ''}
                </span>
              </div>
            ))}
          </div>
          {data.discogsUrl && (
            <a
              href={data.discogsUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-gold-400 hover:underline mt-2"
            >
              Ver en Discogs <ExternalLink size={12} />
            </a>
          )}
        </div>
      )}
    </div>
  );
}
