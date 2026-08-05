import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { DownloadCloud, Link2, RefreshCw } from 'lucide-react';
import { api } from '../api.js';
import { PageTitle, Spinner, ErrorMsg, Button } from '../components.jsx';

const inputCls = 'block mt-0.5 bg-ink-850 border border-ink-800 rounded px-2 py-1 text-sm text-neutral-200 outline-none focus:border-gold-500/60';

// Importar descargas: enlaza (hardlink) lo que bajas por Prowlarr a tu biblioteca
// organizada, como hace Lidarr pero SIN su veto. No borra ni copia el origen.
export default function Imports() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [edits, setEdits] = useState({}); // source_dir -> { artist, album, year }
  const [done, setDone] = useState({}); // source_dir -> dest

  const load = () => {
    setData(null);
    setErr(null);
    api.importsPending().then(setData).catch((e) => setErr(e.message));
  };
  useEffect(() => {
    load();
  }, []);

  const field = (src, key, fallback) => edits[src]?.[key] ?? (fallback == null ? '' : String(fallback));
  const setField = (src, key, val) => setEdits((p) => ({ ...p, [src]: { ...p[src], [key]: val } }));

  const run = async (it) => {
    setBusy(it.source_dir);
    setErr(null);
    try {
      const r = await api.importRun(it.source_dir, {
        artist: field(it.source_dir, 'artist', it.artist),
        album: field(it.source_dir, 'album', it.album),
        year: field(it.source_dir, 'year', it.year),
      });
      setDone((p) => ({ ...p, [it.source_dir]: { dest: r.dest, method: r.method } }));
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  };

  // importar uno, avisando si ya parece estar en la biblioteca
  const runWithWarn = (it) => {
    if (
      it.inLibrary &&
      !window.confirm(`«${it.album || it.name}» ya parece estar en tu biblioteca. ¿Importar igualmente? Creará una copia organizada aparte.`)
    )
      return;
    run(it);
  };

  // importar en lote las que NO están ya en la biblioteca
  const importAll = async () => {
    const todo = (data?.items || []).filter((it) => !done[it.source_dir] && !it.inLibrary);
    if (!todo.length || !window.confirm(`¿Importar ${todo.length} descargas a la biblioteca?`)) return;
    setBulkBusy(true);
    try {
      for (const it of todo) {
        // eslint-disable-next-line no-await-in-loop
        await run(it);
      }
    } finally {
      setBulkBusy(false);
    }
  };

  if (err) return <ErrorMsg>{err}</ErrorMsg>;
  if (!data) return <Spinner />;

  const importable = data.items?.filter((it) => !done[it.source_dir] && !it.inLibrary) || [];

  return (
    <div>
      <PageTitle
        icon={DownloadCloud}
        title="Importar descargas"
        sub={data.items?.length ? `${data.items.length} sin importar` : ''}
      >
        {importable.length > 0 && (
          <Button variant="gold" onClick={importAll} disabled={bulkBusy}>
            <span className="inline-flex items-center gap-1.5">
              <Link2 size={14} /> {bulkBusy ? 'Importando…' : `Importar todo (${importable.length})`}
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
        Enlaza (hardlink) las descargas a tu biblioteca organizada, como hace Lidarr pero sin su veto. No borra ni copia
        el origen: sigues sembrando. Tras importar, el álbum aparece en el próximo escaneo.
      </p>

      {!data.configured && (
        <div className="card p-6 text-neutral-400">
          Configura las carpetas de descargas y biblioteca en{' '}
          <Link to="/ajustes" className="underline">Ajustes → Importar descargas</Link>.
        </div>
      )}
      {data.configured && !data.enabled && (
        <div className="card p-6 text-amber-400/90">
          La importación está desactivada. Actívala en{' '}
          <Link to="/ajustes" className="underline">Ajustes → Importar descargas</Link> (requiere la biblioteca en :rw).
        </div>
      )}
      {data.error && <ErrorMsg>{data.error}</ErrorMsg>}

      {data.configured && data.enabled && data.items?.length === 0 && !data.error && (
        <div className="card p-8 text-center text-neutral-400">No hay descargas nuevas por importar.</div>
      )}

      <div className="space-y-2">
        {data.items?.map((it) => (
          <div key={it.source_dir} className="card p-3">
            <div className="text-xs text-neutral-600 truncate mb-2" title={it.source_dir}>
              {it.name} · {it.tracks} pistas
              {it.inLibrary && <span className="text-amber-400/80"> · ⚠ ya en tu biblioteca</span>}
            </div>
            {done[it.source_dir] ? (
              <div className="text-sm text-emerald-400 flex items-center gap-2 min-w-0">
                <Link2 size={14} className="shrink-0" />
                <span className="truncate">
                  {done[it.source_dir].method === 'copy' ? 'Copiado' : 'Enlazado'} a {done[it.source_dir].dest}
                </span>
              </div>
            ) : (
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-xs text-neutral-500">
                  Artista
                  <input
                    className={inputCls}
                    value={field(it.source_dir, 'artist', it.artist)}
                    onChange={(e) => setField(it.source_dir, 'artist', e.target.value)}
                    placeholder="Artista"
                  />
                </label>
                <label className="text-xs text-neutral-500 flex-1 min-w-[12rem]">
                  Álbum
                  <input
                    className={`${inputCls} w-full`}
                    value={field(it.source_dir, 'album', it.album)}
                    onChange={(e) => setField(it.source_dir, 'album', e.target.value)}
                    placeholder="Álbum"
                  />
                </label>
                <label className="text-xs text-neutral-500">
                  Año
                  <input
                    className={`${inputCls} w-20`}
                    value={field(it.source_dir, 'year', it.year)}
                    onChange={(e) => setField(it.source_dir, 'year', e.target.value)}
                    placeholder="Año"
                  />
                </label>
                <Button
                  variant={it.inLibrary ? 'default' : 'gold'}
                  disabled={busy === it.source_dir}
                  onClick={() => runWithWarn(it)}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Link2 size={14} /> {busy === it.source_dir ? 'Enlazando…' : 'Importar'}
                  </span>
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
