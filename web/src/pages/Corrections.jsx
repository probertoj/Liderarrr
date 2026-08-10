import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Wrench, FolderInput, RefreshCw, Loader2, Check } from 'lucide-react';
import { api } from '../api.js';
import { PageTitle, Spinner, ErrorMsg, Button } from '../components.jsx';

// Correcciones: álbumes cuyo artista o título has corregido a mano. Aquí los revisas
// todos de un vistazo y los «ordenas en su carpeta» ({artist}/{album}) — todos a la
// vez o uno a uno, como la pestaña de importar. Mover no toca los ficheros del origen
// de descargas: solo reubica la carpeta de la biblioteca (mismo volumen, seeding intacto).
export default function Corrections() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(null); // id en curso
  const [bulk, setBulk] = useState(false);
  const [done, setDone] = useState({}); // id -> destino movido

  const load = () => {
    setErr(null);
    api.corrections().then(setRows).catch((e) => setErr(e.message));
  };
  useEffect(() => {
    load();
  }, []);

  const moveOne = async (a) => {
    setBusy(a.id);
    try {
      const r = await api.refileAlbum(a.id);
      if (r.moved) setDone((p) => ({ ...p, [a.id]: r.to }));
      load();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(null);
    }
  };

  const moveAll = async () => {
    const n = (rows || []).filter((a) => a.needsMove && !a.blocked).length;
    if (!n || !window.confirm(`¿Ordenar en su carpeta ${n} álbum(es)? Mueve sus carpetas dentro de la biblioteca.`)) return;
    setBulk(true);
    try {
      const r = await api.refileAllCorrections();
      load();
      if (r.errors?.length) alert(`Movidos ${r.moved} de ${r.candidates}. ${r.errors.length} con error.`);
    } catch (e) {
      alert(e.message);
    } finally {
      setBulk(false);
    }
  };

  if (err) return <ErrorMsg>{err}</ErrorMsg>;
  if (!rows) return <Spinner />;

  const pending = rows.filter((a) => a.needsMove && !a.blocked);

  return (
    <div>
      <PageTitle
        icon={Wrench}
        title="Correcciones"
        sub={rows.length ? `${rows.length} corregidos · ${pending.length} por ordenar` : ''}
      >
        {pending.length > 0 && (
          <Button variant="gold" onClick={moveAll} disabled={bulk}>
            <span className="inline-flex items-center gap-1.5">
              {bulk ? <Loader2 size={14} className="animate-spin" /> : <FolderInput size={14} />}
              {bulk ? 'Moviendo…' : `Mover todos (${pending.length})`}
            </span>
          </Button>
        )}
        <Button onClick={load}>
          <span className="inline-flex items-center gap-1.5">
            <RefreshCw size={14} /> Refrescar
          </span>
        </Button>
      </PageTitle>
      <p className="text-sm text-neutral-500 mb-4">
        Álbumes cuyo artista o título has corregido a mano. «Ordenar en su carpeta» mueve la carpeta a la estructura
        <code className="mx-1 text-neutral-400">{'{artist}/{album} ({year})'}</code> dentro de la biblioteca (no toca el
        origen de descargas; el seeding sobrevive).
      </p>

      {rows.length === 0 ? (
        <div className="card p-8 text-center text-neutral-400">
          No has corregido ningún álbum todavía. Corrige el artista o el título desde la ficha de un álbum o desde{' '}
          <Link to="/sin-identificar" className="underline">Sin identificar</Link>.
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((a) => (
            <div key={a.id} className="card p-3 flex items-center gap-3 text-sm">
              <div className="min-w-0 flex-1">
                <div className="truncate">
                  <Link to={`/album/${a.id}`} className="hover:text-gold-400">
                    {a.album_artist} — {a.title}
                  </Link>
                  {a.artist_manual && <span className="ml-2 text-xs text-gold-400/70">artista</span>}
                  {a.title_manual && <span className="ml-1.5 text-xs text-gold-400/70">título</span>}
                </div>
                <div className="text-xs text-neutral-600 truncate" title={a.path}>
                  {a.path}
                </div>
                {a.needsMove && !a.blocked && (
                  <div className="text-xs text-emerald-400/70 truncate" title={a.target}>
                    → {a.target}
                  </div>
                )}
              </div>
              {done[a.id] ? (
                <span className="text-emerald-400 text-xs inline-flex items-center gap-1 shrink-0">
                  <Check size={14} /> movido
                </span>
              ) : a.blocked ? (
                <span className="text-neutral-500 text-xs shrink-0" title="No se puede reubicar automáticamente">
                  {a.blocked}
                </span>
              ) : a.needsMove ? (
                <button
                  onClick={() => moveOne(a)}
                  disabled={busy === a.id || bulk}
                  className="text-xs px-2 py-1 rounded border border-gold-500/40 bg-gold-500/10 text-gold-300 hover:bg-gold-500/20 shrink-0 inline-flex items-center gap-1 disabled:opacity-50"
                >
                  {busy === a.id ? <Loader2 size={13} className="animate-spin" /> : <FolderInput size={13} />} Mover
                </button>
              ) : (
                <span className="text-emerald-400/60 text-xs inline-flex items-center gap-1 shrink-0">
                  <Check size={13} /> en su carpeta
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
