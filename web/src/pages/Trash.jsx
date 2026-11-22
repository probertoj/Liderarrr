import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Trash2, RotateCcw } from 'lucide-react';
import { api, fmtBytes } from '../api.js';
import { PageTitle, Spinner, ErrorMsg, Button } from '../components.jsx';
import { aviso } from '../avisos.jsx';

// Papelera: álbumes descartados (normalmente copias duplicadas desde la página de
// artista). Siguen en tu disco — descartar nunca borra ficheros — y se pueden
// restaurar de un clic. Es la red de seguridad del "Descartar".
export default function Trash() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    api
      .dismissed()
      .then(setRows)
      .catch((e) => setErr(e.message));
  }, []);

  const restore = async (id) => {
    if (busy != null) return;
    setBusy(id);
    try {
      await api.restoreAlbum(id);
      setRows(await api.dismissed());
      aviso('Restaurado: vuelve a estar en tu discoteca.', 'ok');
    } catch (e) {
      // Antes un fallo aquí cambiaba la página entera por un cuadro rojo y se perdía la
      // lista: ahora se avisa y todo sigue donde estaba.
      aviso(e.message, 'error');
    } finally {
      setBusy(null);
    }
  };

  if (err) return <ErrorMsg>{err}</ErrorMsg>;
  if (!rows) return <Spinner />;

  return (
    <div>
      <PageTitle
        icon={Trash2}
        title="Papelera"
        sub={rows.length ? `${rows.length} álbumes descartados` : ''}
      />
      <p className="text-sm text-neutral-500 mb-4">
        Álbumes que descartaste (normalmente copias duplicadas). Están ocultos del resto de la app pero
        <b className="font-normal text-neutral-300"> siguen en tu disco</b>: descartar nunca borra ficheros. Restaura el
        que quieras.
      </p>

      {rows.length === 0 ? (
        <div className="card p-8 text-center text-neutral-400">La papelera está vacía.</div>
      ) : (
        <div className="space-y-2">
          {rows.map((a) => (
            <div key={a.id} className="card p-3 flex items-center gap-3 min-w-0">
              <div className="min-w-0 flex-1">
                <Link to={`/album/${a.id}`} className="truncate hover:text-gold-400 block">
                  {a.title}
                  {a.year ? <span className="text-neutral-600"> · {a.year}</span> : ''}
                </Link>
                <div className="text-xs text-neutral-500 truncate">{a.album_artist}</div>
                <div className="text-xs text-neutral-600 flex flex-wrap gap-x-2 mt-0.5">
                  {a.format && <span>{a.format}</span>}
                  <span>
                    {a.track_file_count}/{a.track_count} pistas
                  </span>
                  <span>{fmtBytes(a.size_bytes)}</span>
                </div>
                <div className="text-[11px] text-neutral-600 truncate mt-0.5" title={a.path}>
                  {a.path}
                </div>
              </div>
              <Button variant="default" className="shrink-0" disabled={busy != null} onClick={() => restore(a.id)}>
                <span className="inline-flex items-center gap-1.5">
                  <RotateCcw size={14} /> {busy === a.id ? '…' : 'Restaurar'}
                </span>
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
