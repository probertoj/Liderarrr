import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { HelpCircle, Sparkles, Check, ExternalLink, Loader2, Pencil, X, Database, Radio, RefreshCw } from 'lucide-react';
import { api } from '../api.js';
import { openMbReleaseEditor } from '../mb.js';
import { PageTitle, Cover, Spinner, ErrorMsg, Button } from '../components.jsx';
import { aviso, confirmar } from '../avisos.jsx';
import { useTandas, VerMas } from '../tandas.jsx';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Renombra un disco mal nombrado y reintenta identificarlo en el acto. Mismo patrón
// que ArtistInline: a veces el problema no es el artista sino un título imposible.
function TitleInline({ album, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(album.title || '');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const t = val.trim();
    if (!t || t === album.title) {
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      await api.setAlbumTitle(album.id, t);
      const r = await api.identifyAlbum(album.id);
      await onSaved();
      if (!r?.matched) aviso('Título guardado, pero sigue sin coincidencia.', 'info');
    } catch (e) {
      aviso(e.message, 'error');
    } finally {
      // Antes solo se soltaba si fallaba: al guardar un título que seguía sin casar (lo
      // normal en esta lista) la fila se quedaba con el campo bloqueado y el reloj girando.
      setBusy(false);
      setEditing(false);
    }
  };

  if (!editing) {
    return (
      <span className="flex items-center gap-1 min-w-0">
        <Link to={`/album/${album.id}`} className="truncate hover:text-gold-400">
          {album.title}
        </Link>
        <button onClick={() => setEditing(true)} title="Renombrar el disco" aria-label="Renombrar el disco" className="text-neutral-600 hover:text-gold-400 shrink-0 p-1">
          <Pencil size={11} />
        </button>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1">
      <input
        value={val}
        autoFocus
        disabled={busy}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') setEditing(false);
        }}
        aria-label="Título del disco"
        className="bg-ink-850 border border-ink-800 rounded px-1.5 py-0.5 text-sm flex-1 min-w-0 outline-none focus:border-gold-500/60"
      />
      <button onClick={save} disabled={busy} title="Guardar y reidentificar" className="text-gold-300 hover:text-gold-200 disabled:opacity-50 shrink-0">
        {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={14} />}
      </button>
      <button onClick={() => setEditing(false)} className="text-neutral-500 hover:text-neutral-300 shrink-0" title="Cancelar">
        <X size={13} />
      </button>
    </span>
  );
}

// Corrige el artista de un álbum sin identificar y reintenta identificarlo en el acto.
// Lo típico para lo que llega sin etiquetar: pones el artista bueno y, si con eso casa,
// el álbum abandona la lista solo.
function ArtistInline({ album, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(album.album_artist || '');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const name = val.trim();
    if (!name || name === album.album_artist) {
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      await api.setAlbumArtist(album.id, name);
      const r = await api.identifyAlbum(album.id); // ya con el artista bueno, intenta casar
      await onSaved();
      if (!r?.matched) aviso('Artista guardado, pero sigue sin coincidencia.', 'info');
    } catch (e) {
      aviso(e.message, 'error');
    } finally {
      setBusy(false);
      setEditing(false);
    }
  };

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        title="Corregir el artista"
        className="inline-flex items-center gap-1 hover:text-gold-400 min-w-0 text-left"
      >
        <Pencil size={11} className="opacity-70 shrink-0" />
        <span className="truncate">{album.album_artist || <span className="italic text-neutral-600">sin artista</span>}</span>
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <input
        list="artist-names"
        value={val}
        autoFocus
        disabled={busy}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') setEditing(false);
        }}
        aria-label="Artista del disco"
        className="bg-ink-850 border border-ink-800 rounded px-1.5 py-0.5 text-xs w-44 max-w-full outline-none focus:border-gold-500/60"
      />
      <button onClick={save} disabled={busy} title="Guardar y reidentificar" className="text-gold-300 hover:text-gold-200 disabled:opacity-50">
        {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={14} />}
      </button>
      <button onClick={() => setEditing(false)} className="text-neutral-500 hover:text-neutral-300" title="Cancelar">
        <X size={13} />
      </button>
    </span>
  );
}

// Cola de resolución: lo que la cadena no pudo casar. Cada fila se puede
// resolver a mano (candidatos de MusicBrainz/Discogs) o marcar como rareza para
// que deje de preguntar. Ningún fichero desaparece: solo cambia de estado.
export default function Unidentified() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [status, setStatus] = useState(null); // progreso/resumen de reidentificación
  const [names, setNames] = useState([]); // sugerencias de artista (datalist)

  const [haciendo, setHaciendo] = useState(null); // id de la fila con una acción en marcha
  // ¿Sigue la página en pantalla? El sondeo de la reidentificación dura minutos.
  const vivo = useRef(true);

  const pedir = () =>
    api.unidentified().then((r) => {
      if (vivo.current) setRows(r);
    });
  // Recarga tras una acción. Si falla se avisa y la lista se queda como estaba: antes un
  // fallo aquí cambiaba la página entera por un cuadro rojo y había que recargar.
  const load = () => pedir().catch((e) => aviso(e.message, 'error'));

  // Sondea la reidentificación hasta que termina (o hasta que te vas).
  const seguirReidentificacion = async () => {
    let s;
    do {
      await sleep(1200);
      if (!vivo.current) return;
      s = await api.identifyStatus();
      if (!vivo.current) return;
      setStatus(s);
    } while (s.running);
    if (s.error) aviso(s.error, 'error');
    await load();
  };

  useEffect(() => {
    vivo.current = true;
    pedir().catch((e) => vivo.current && setErr(e.message));
    api
      .artistNames()
      .then((n) => vivo.current && setNames(n))
      .catch(() => {});
    // Si ya había una reidentificación en marcha (la lanzaste y te fuiste a otra página),
    // se retoma el progreso: antes el botón parecía libre con 2.900 discos en proceso.
    api
      .identifyStatus()
      .then((s) => {
        if (!vivo.current || !s?.running) return;
        setStatus(s);
        seguirReidentificacion().catch((e) => vivo.current && aviso(e.message, 'error'));
      })
      .catch(() => {});
    return () => {
      vivo.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Una acción sobre una fila: se bloquean sus botones mientras dura y, si falla, se dice.
  const act = async (id, fn) => {
    if (haciendo != null) return;
    setHaciendo(id);
    try {
      await fn();
      await load();
    } catch (e) {
      aviso(e.message, 'error');
    } finally {
      if (vivo.current) setHaciendo(null);
    }
  };

  // Reidentificar corre en 2º plano: se dispara y se SONDEA el estado hasta que
  // termina, mostrando progreso en vivo y un resumen al final (antes no daba feedback:
  // recargaba la lista al instante, cuando aún no había cambiado nada).
  const reidentify = async () => {
    setStatus({ running: true, done: 0, total: 0, matched: 0, unmatched: 0 });
    try {
      await api.identify(true);
      await seguirReidentificacion();
    } catch (e) {
      if (!vivo.current) return;
      aviso(e.message, 'error');
      setStatus(null);
    }
  };

  // 2.898 fichas de golpe eran 168.000 nodos y 6,5 s sin poder tocar nada: de 100 en 100.
  const tandas = useTandas(rows, { tamano: 100 });

  if (err) return <ErrorMsg>{err}</ErrorMsg>;
  if (!rows) return <Spinner />;

  return (
    <div>
      <datalist id="artist-names">
        {names.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      <PageTitle
        icon={HelpCircle}
        title="Sin identificar"
        sub={rows.length ? `${rows.length.toLocaleString('es-ES')} álbumes sin coincidencia en ninguna base` : ''}
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
          {tandas.quedan > 0 && (
            <p className="text-xs text-neutral-500">
              Se ven los primeros {tandas.mostrados.toLocaleString('es-ES')}; el resto aparece al bajar.
            </p>
          )}
          {tandas.visibles.map((a) => (
            <div key={a.id} className="card p-2.5 min-w-0">
              {/* La fila ENVUELVE: los cinco botones miden unos 590 px y antes iban en un
                  bloque rígido, así que por debajo de 1.100 px el título se quedaba sin
                  sitio y en el móvil «Es una rareza» y «Es un bootleg» caían fuera de la
                  pantalla. Ahora, si no caben al lado, bajan a su propia línea. */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <div className="flex items-center gap-3 min-w-0 flex-1 basis-64">
                  <div className="w-12 h-12 rounded overflow-hidden shrink-0">
                    <Cover id={a.id} size="sm" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <TitleInline album={a} onSaved={load} />
                    <div className="text-xs text-neutral-500 flex items-center gap-1 min-w-0">
                      <ArtistInline album={a} onSaved={load} />
                      <span className="shrink-0">· {a.track_file_count} pistas</span>
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <RetryButton album={a} onDone={load} />
                  <Button onClick={() => setOpenId(openId === a.id ? null : a.id)}>Buscar</Button>
                  <CreateMbButton album={a} />
                  <Button variant="default" disabled={haciendo === a.id} onClick={() => act(a.id, () => api.albumState(a.id, 'orphan'))}>
                    <span className="inline-flex items-center gap-1.5">
                      <Sparkles size={14} /> Es una rareza
                    </span>
                  </Button>
                  <Button variant="default" disabled={haciendo === a.id} onClick={() => act(a.id, () => api.albumState(a.id, 'bootleg'))} title="Directo no oficial, sesión de radio, ROIO">
                    <span className="inline-flex items-center gap-1.5">
                      <Radio size={14} /> Es un bootleg
                    </span>
                  </Button>
                </div>
              </div>
              {openId === a.id && <Candidates id={a.id} onDone={() => act(a.id, async () => setOpenId(null))} />}
            </div>
          ))}
          <VerMas tandas={tandas} />
        </div>
      )}
    </div>
  );
}

// Reintentar la identificación de UN solo disco (la cadena completa: MusicBrainz, Last.fm y
// AcoustID si está activado), sin lanzar el barrido masivo. Útil tras mejorar el motor,
// activar AcoustID o corregir el artista/título: si casa, el disco desaparece de la lista.
function RetryButton({ album, onDone }) {
  const [busy, setBusy] = useState(false);
  const [nope, setNope] = useState(false);
  const retry = async () => {
    setBusy(true);
    setNope(false);
    try {
      const r = await api.identifyAlbum(album.id);
      if (r.matched) {
        await onDone(); // casó → se recarga la lista y este disco desaparece
      } else {
        setBusy(false);
        setNope(true);
        setTimeout(() => setNope(false), 2500);
      }
    } catch (e) {
      aviso(e.message, 'error');
      setBusy(false);
    }
  };
  return (
    <Button variant="gold" onClick={retry} disabled={busy} title="Volver a identificar solo este disco">
      <span className="inline-flex items-center gap-1.5">
        {busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
        {nope ? 'Sin coincidencia' : 'Reintentar'}
      </span>
    </Button>
  );
}

// Sembrar la ficha del disco en MusicBrainz (release editor seeding) directamente desde
// la lista, sin entrar en la ficha. Si MB ya tiene un candidato muy parecido, pide
// confirmación antes de sembrar (evita crear duplicados sin recargar la fila). El detalle
// completo del aviso vive en la ficha del álbum.
function CreateMbButton({ album }) {
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try {
      const r = await api.mbSeed(album.id);
      if (
        r.possibleDuplicate &&
        !(await confirmar(
          `MusicBrainz ya tiene algo muy parecido (${r.possibleDuplicate.score}%):\n` +
            `${r.possibleDuplicate.artist} — ${r.possibleDuplicate.title}\n\n` +
            '¿Crear la ficha igualmente? (Cancela si es este disco: enlázalo desde su ficha.)',
          { aceptar: 'Crear igualmente' }
        ))
      ) {
        return;
      }
      openMbReleaseEditor(r.fields, album.id);
    } catch (e) {
      aviso(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button onClick={create} disabled={busy} title="Crear su ficha en MusicBrainz">
      <span className="inline-flex items-center gap-1.5">
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Database size={14} />} Crear en MB
      </span>
    </Button>
  );
}

function Candidates({ id, onDone }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [guardando, setGuardando] = useState(false);
  useEffect(() => {
    let cancelado = false;
    setData(null);
    api
      .candidates(id)
      .then((d) => !cancelado && setData(d))
      .catch((e) => !cancelado && setErr(e.message));
    return () => {
      cancelado = true;
    };
  }, [id]);

  if (err) return <p className="text-sm text-red-400 mt-3 px-2">{err}</p>;
  if (!data) return <Spinner label="Buscando candidatos…" />;

  return (
    <div className="mt-3 pt-3 border-t border-ink-800 space-y-2 px-1">
      {data.musicbrainz ? (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 text-sm">
          <div className="min-w-0 break-words">
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
            disabled={guardando}
            onClick={async () => {
              setGuardando(true);
              try {
                await api.match(id, data.musicbrainz.rg_mbid);
                onDone();
              } catch (e) {
                aviso(e.message, 'error');
                setGuardando(false);
              }
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
