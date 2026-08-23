import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Database, Check, ExternalLink, Loader2, ImageUp, ArrowLeft, AlertTriangle } from 'lucide-react';
import { api } from '../api.js';
import { PageTitle, Spinner, Button } from '../components.jsx';

// Página de retorno tras sembrar una ficha en MusicBrainz. MB redirige aquí con
// ?album=<id>&release_mbid=<mbid> cuando el usuario guarda el release. Cerramos el bucle:
// enlazamos el álbum a su nuevo release-group (pasa de «sin identificar» a identificado) y
// ofrecemos subir la portada y abrir record.club.
//
// Si MB no devolvió release_mbid (el usuario canceló o no guardó), mostramos una red de
// seguridad para pegar la URL de MB a mano (igual que el /mb-resolve del Rellenator).

// URL de subida de portada con seeding del userscript Enhanced Cover Art Uploads
// (ROpdebee): apunta a la copia local servida por Liderarr. Si el userscript está
// instalado, rellena el formulario solo; si no, la página se abre para arrastrar la imagen.
function coverSeedUrl(releaseMbid, albumId) {
  const origin = window.location.origin;
  const params = new URLSearchParams();
  params.set('x_seed.image.0.url', `${origin}/api/cover/${albumId}`);
  params.set('x_seed.image.0.types', '[1]'); // 1 = Front
  params.set('x_seed.origin', origin);
  return `https://musicbrainz.org/release/${releaseMbid}/add-cover-art?${params.toString()}`;
}

export default function MbSeedCallback() {
  const [params] = useSearchParams();
  const albumId = params.get('album');
  const releaseMbid = params.get('release_mbid');

  const [state, setState] = useState('idle'); // idle | linking | done | error
  const [rgMbid, setRgMbid] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!albumId || !releaseMbid) return;
    setState('linking');
    api
      .linkRelease(albumId, releaseMbid)
      .then((r) => {
        setRgMbid(r.rg_mbid);
        setState('done');
      })
      .catch((e) => {
        setErr(e.message);
        setState('error');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <PageTitle icon={Database} title="Ficha creada en MusicBrainz" />
      <div className="max-w-2xl">
        {!albumId ? (
          <div className="card p-6 text-neutral-400">
            Falta el álbum en la dirección. Vuelve a la <Link to="/sin-identificar" className="text-gold-400 hover:underline">lista de sin identificar</Link>.
          </div>
        ) : !releaseMbid ? (
          <NoReleaseFallback albumId={albumId} />
        ) : (
          <div className="card p-6">
            {state === 'linking' && <Spinner label="Enlazando el álbum con su nueva ficha…" />}

            {state === 'error' && (
              <div className="text-sm">
                <p className="text-amber-300/90 flex items-center gap-2">
                  <AlertTriangle size={15} /> El release se creó en MusicBrainz, pero no pude enlazarlo automáticamente.
                </p>
                <p className="text-neutral-500 mt-1">{err}</p>
                <p className="text-neutral-500 mt-2">
                  No pasa nada: abre la ficha del álbum y usa «Elegir a mano» → «pegar enlace de MusicBrainz» con
                  <span className="text-neutral-400"> musicbrainz.org/release/{releaseMbid}</span>.
                </p>
                <div className="mt-4">
                  <Link to={`/album/${albumId}`}>
                    <Button variant="gold">
                      <span className="inline-flex items-center gap-1.5">
                        <ArrowLeft size={14} /> Ir a la ficha del álbum
                      </span>
                    </Button>
                  </Link>
                </div>
              </div>
            )}

            {state === 'done' && (
              <div>
                <p className="text-emerald-400 flex items-center gap-2 text-sm">
                  <Check size={16} /> ¡Listo! Gracias por contribuir a MusicBrainz. El álbum ya está enlazado a su nueva
                  ficha.
                </p>
                <p className="text-xs text-neutral-600 mt-2">
                  Ya tiene MBID: se activan carátula oficial, completismo y créditos. Ahora puedes subir la portada.
                </p>
                <div className="flex gap-2 mt-5 flex-wrap">
                  <a href={coverSeedUrl(releaseMbid, albumId)} target="_blank" rel="noreferrer">
                    <Button variant="gold">
                      <span className="inline-flex items-center gap-1.5">
                        <ImageUp size={15} /> Subir portada a MusicBrainz
                      </span>
                    </Button>
                  </a>
                  {rgMbid && (
                    <a href={`https://record.club/import/${rgMbid}`} target="_blank" rel="noreferrer">
                      <Button>
                        <span className="inline-flex items-center gap-1.5">
                          Importar en record.club <ExternalLink size={13} />
                        </span>
                      </Button>
                    </a>
                  )}
                  <Link to={`/album/${albumId}`}>
                    <Button variant="default">
                      <span className="inline-flex items-center gap-1.5">
                        <ArrowLeft size={14} /> Volver a la ficha
                      </span>
                    </Button>
                  </Link>
                </div>
                <p className="text-xs text-neutral-600 mt-4">
                  «Subir portada» usa la imagen de tu copia. Rellena el formulario solo si tienes el userscript
                  <a
                    href="https://github.com/ROpdebee/mb-userscripts"
                    target="_blank"
                    rel="noreferrer"
                    className="text-gold-400 hover:underline mx-1 inline-flex items-center gap-0.5"
                  >
                    Enhanced Cover Art Uploads <ExternalLink size={10} />
                  </a>
                  ; si no, la página se abre para arrastrar la imagen a mano.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Red de seguridad: MB no devolvió release_mbid. Pega la URL de MB para enlazar el álbum.
function NoReleaseFallback({ albumId }) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [ok, setOk] = useState(false);

  const link = async () => {
    if (!url.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await api.matchByUrl(albumId, url.trim());
      setOk(true);
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  };

  if (ok) {
    return (
      <div className="card p-6 text-sm">
        <p className="text-emerald-400 flex items-center gap-2">
          <Check size={16} /> Álbum enlazado. ¡Gracias por contribuir!
        </p>
        <div className="mt-4">
          <Link to={`/album/${albumId}`}>
            <Button variant="gold">
              <span className="inline-flex items-center gap-1.5">
                <ArrowLeft size={14} /> Ir a la ficha del álbum
              </span>
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="card p-6 text-sm">
      <p className="text-neutral-400">
        MusicBrainz no devolvió el identificador del release (quizá cancelaste, o no guardaste todavía).
      </p>
      <p className="text-neutral-600 text-xs mt-1">
        Si ya lo creaste, pega aquí la URL de MusicBrainz (release-group o release) para enlazar tu álbum:
      </p>
      <div className="flex gap-2 mt-3">
        <input
          className="flex-1 bg-ink-850 border border-ink-800 rounded px-2 py-1.5 text-sm outline-none focus:border-gold-500/60"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && link()}
          placeholder="musicbrainz.org/release/… o /release-group/…"
        />
        <Button variant="gold" onClick={link} disabled={busy || !url.trim()}>
          <span className="inline-flex items-center gap-1.5">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <ExternalLink size={14} />} Enlazar
          </span>
        </Button>
      </div>
      {err && <p className="text-red-400 mt-2">{err}</p>}
      <div className="mt-4">
        <Link to={`/album/${albumId}`} className="text-gold-400 hover:underline text-xs inline-flex items-center gap-1">
          <ArrowLeft size={12} /> Volver a la ficha del álbum
        </Link>
      </div>
    </div>
  );
}
