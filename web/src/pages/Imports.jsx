import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { DownloadCloud, Link2, RefreshCw, Zap } from 'lucide-react';
import { api } from '../api.js';
import { PageTitle, Spinner, ErrorMsg, Button } from '../components.jsx';

// Panel de auto-import (cierre del bucle sin Lidarr): estado, botón para importar las
// descargas terminadas ahora mismo, y las últimas descargas registradas con su estado.
function AutoImportPanel() {
  const [dl, setDl] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => api.downloads().then(setDl).catch(() => {});
  useEffect(() => {
    load();
  }, []);
  const runNow = async () => {
    setBusy(true);
    try {
      await api.autoImportRun();
      await load();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };
  const clear = async () => {
    setBusy(true);
    try {
      await api.clearImportedDownloads();
      await load();
    } finally {
      setBusy(false);
    }
  };
  if (!dl) return null;
  const STATE = { requested: 'pedido', importing: 'importando', imported: 'importado', error: 'error' };
  const st = dl.status || {};
  const hasClosed = dl.items?.some((d) => d.status === 'imported' || d.status === 'error');
  return (
    <div className="card p-4 mb-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-sm text-neutral-400 flex items-center gap-2">
          <Zap size={15} /> Auto-import{' '}
          <span className={`text-xs ${dl.enabled ? 'text-emerald-400/80' : 'text-neutral-600'}`}>
            {dl.enabled ? 'activado' : 'desactivado'}
          </span>
        </h2>
        <div className="flex items-center gap-2">
          {hasClosed && (
            <button
              onClick={clear}
              disabled={busy}
              className="text-xs px-2 py-1.5 rounded-lg border border-ink-700 bg-ink-850 text-neutral-400 hover:text-neutral-200 disabled:opacity-50"
              title="Quitar del panel las descargas ya importadas (o con error)"
            >
              Limpiar importadas
            </button>
          )}
          <Button onClick={runNow} disabled={busy}>
            <span className="inline-flex items-center gap-1.5">
              <RefreshCw size={14} className={busy ? 'animate-spin' : ''} /> {busy ? 'Importando…' : 'Importar terminadas ahora'}
            </span>
          </Button>
        </div>
      </div>
      <p className="text-xs text-neutral-600 mt-1">
        Al terminar una descarga en qBittorrent, se enlaza a tu biblioteca organizada.
        {dl.enabled ? ' Se ejecuta solo cada 3 minutos.' : ' Actívalo en Ajustes → Importar descargas.'}
      </p>

      {/* diagnóstico de la última pasada: revela POR QUÉ el automático (no) importa */}
      {dl.enabled && st.lastRun && (
        <div className="text-[11px] mt-1.5 space-y-0.5">
          <div className="text-neutral-500">
            Última pasada: qBittorrent devolvió <b className="text-neutral-300">{st.torrents ?? 0}</b> completados ·{' '}
            <b className="text-neutral-300">{st.underSource ?? 0}</b> bajo tu carpeta de torrents ·{' '}
            <b className="text-neutral-300">{st.imported ?? 0}</b> importados
            {st.alreadyImported ? ` · ${st.alreadyImported} ya estaban` : ''}.
          </div>
          {st.torrents === 0 && (
            <div className="text-amber-400/80">
              ⚠ qBittorrent no devolvió descargas completadas. Si pusiste una <b>categoría</b> en Ajustes, solo mira esa
              categoría — comprueba que tus torrents la tengan (o quítala). Y que estén completos.
            </div>
          )}
          {st.torrents > 0 && st.underSource === 0 && (
            <div className="text-amber-400/80">
              ⚠ Ninguna cuelga de la carpeta de torrents configurada (<code>{st.source || '—'}</code>). La ruta que ve
              Liderarr y la que ve qBittorrent deben coincidir (mismo montaje en el contenedor).
            </div>
          )}
          {st.errors?.slice(0, 3).map((e, i) => (
            <div key={i} className="text-red-400">{e}</div>
          ))}
        </div>
      )}
      {dl.items?.length > 0 && (
        <div className="mt-3 max-h-56 overflow-y-auto divide-y divide-ink-850/60 text-sm">
          {dl.items.slice(0, 30).map((d) => (
            <div key={d.id} className="py-1.5 flex items-center gap-2 min-w-0">
              <span className="truncate flex-1 min-w-0" title={d.release_title || ''}>
                {d.artist ? `${d.artist} — ` : ''}
                {d.album || d.release_title || '(sin título)'}
              </span>
              <span
                className={`text-xs shrink-0 ${
                  d.status === 'imported'
                    ? 'text-emerald-400'
                    : d.status === 'error'
                      ? 'text-red-400'
                      : 'text-neutral-500'
                }`}
              >
                {STATE[d.status] || d.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

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

      <AutoImportPanel />


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
