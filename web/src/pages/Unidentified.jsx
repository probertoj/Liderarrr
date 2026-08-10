import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { HelpCircle, Sparkles, Check, ExternalLink, Loader2 } from 'lucide-react';
import { api } from '../api.js';
import { PageTitle, Cover, Spinner, ErrorMsg, Button } from '../components.jsx';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Cola de resolución: lo que la cadena no pudo casar. Cada fila se puede
// resolver a mano (candidatos de MusicBrainz/Discogs) o marcar como rareza para
// que deje de preguntar. Ningún fichero desaparece: solo cambia de estado.
export default function Unidentified() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [status, setStatus] = useState(null); // progreso/resumen de reidentificación

  const load = () => api.unidentified().then(setRows).catch((e) => setErr(e.message));
  useEffect(() => {
    load();
  }, []);

  const act = async (fn) => {
    await fn();
    await load();
  };

  // Reidentificar corre en 2º plano: se dispara y se SONDEA el estado hasta que
  // termina, mostrando progreso en vivo y un resumen al final (antes no daba feedback:
  // recargaba la lista al instante, cuando aún no había cambiado nada).
  const reidentify = async () => {
    setErr(null);
    setStatus({ running: true, done: 0, total: 0, matched: 0, unmatched: 0 });
    try {
      await api.identify(true);
      let s;
      do {
        await sleep(1200);
        s = await api.identifyStatus();
        setStatus(s);
      } while (s.running);
      if (s.error) setErr(s.error);
      await load();
    } catch (e) {
      setErr(e.message);
      setStatus(null);
    }
  };

  if (err) return <ErrorMsg>{err}</ErrorMsg>;
  if (!rows) return <Spinner />;

  return (
    <div>
      <PageTitle
        icon={HelpCircle}
        title="Sin identificar"
        sub={rows.length ? `${rows.length} álbumes sin coincidencia en ninguna base` : ''}
      >
        <Button variant="gold" onClick={reidentify} disabled={status?.running}>
          <span className="inline-flex items-center gap-1.5">
            {status?.running && <Loader2 size={14} className="animate-spin" />}
            {status?.running ? 'Reidentificando…' : 'Reintentar identificación'}
          </span>
        </Button>
      </PageTitle>

      {status && (
        <div className="card px-3 py-2 mb-4 text-sm">
          {status.running ? (
            <p className="text-gold-300/90">
              Reidentificando… {status.done}/{status.total}
              {status.current ? ` · ${status.current}` : ''}
            </p>
          ) : (
            <p className="text-neutral-400">
              Reidentificación terminada: <span className="text-emerald-400">{status.matched} identificados</span>
              {' · '}
              {status.unmatched} siguen sin coincidencia.
            </p>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="card p-8 text-center text-neutral-400">
          Todo identificado o marcado como rareza. Nada pendiente.
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((a) => (
            <div key={a.id} className="card p-2.5">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded overflow-hidden shrink-0">
                  <Cover id={a.id} size="sm" />
                </div>
                <div className="min-w-0 flex-1">
                  <Link to={`/album/${a.id}`} className="truncate hover:text-gold-400 block">
                    {a.title}
                  </Link>
                  <div className="text-xs text-neutral-500 truncate">
                    {a.album_artist} · {a.track_file_count} pistas
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button onClick={() => setOpenId(openId === a.id ? null : a.id)}>Buscar</Button>
                  <Button variant="default" onClick={() => act(() => api.albumState(a.id, 'orphan'))}>
                    <span className="inline-flex items-center gap-1.5">
                      <Sparkles size={14} /> Es una rareza
                    </span>
                  </Button>
                </div>
              </div>
              {openId === a.id && <Candidates id={a.id} onDone={() => act(async () => setOpenId(null))} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Candidates({ id, onDone }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    setData(null);
    api.candidates(id).then(setData).catch((e) => setErr(e.message));
  }, [id]);

  if (err) return <p className="text-sm text-red-400 mt-3 px-2">{err}</p>;
  if (!data) return <Spinner label="Buscando candidatos…" />;

  return (
    <div className="mt-3 pt-3 border-t border-ink-800 space-y-2 px-1">
      {data.musicbrainz ? (
        <div className="flex items-center justify-between gap-3 text-sm">
          <div className="min-w-0">
            <span className="text-emerald-400 text-xs mr-2">MusicBrainz {data.musicbrainz.score}%</span>
            <span className="truncate">
              {data.musicbrainz.artist} — {data.musicbrainz.title}
            </span>
            {data.musicbrainz.primary_type && (
              <span className="text-neutral-600 text-xs ml-2">{data.musicbrainz.primary_type}</span>
            )}
            <a
              href={`https://musicbrainz.org/release-group/${data.musicbrainz.rg_mbid}`}
              target="_blank"
              rel="noreferrer"
              className="ml-2 text-gold-400 hover:underline inline-flex items-center gap-0.5 text-xs"
            >
              MusicBrainz <ExternalLink size={11} />
            </a>
          </div>
          <Button
            variant="gold"
            onClick={async () => {
              await api.match(id, data.musicbrainz.rg_mbid);
              onDone();
            }}
          >
            <span className="inline-flex items-center gap-1.5">
              <Check size={14} /> Es este
            </span>
          </Button>
        </div>
      ) : (
        <p className="text-sm text-neutral-600">MusicBrainz no propone nada.</p>
      )}
      {data.discogs && (
        <div className="text-sm text-neutral-500">
          <span className="text-xs mr-2 text-neutral-600">Discogs</span>
          {data.discogs.title} {data.discogs.year ? `(${data.discogs.year})` : ''}
          {data.discogs.label ? ` · ${data.discogs.label}` : ''}
        </div>
      )}
    </div>
  );
}
