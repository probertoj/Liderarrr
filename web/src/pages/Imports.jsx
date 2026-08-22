import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { DownloadCloud, Link2, RefreshCw, Zap } from 'lucide-react';
import { api } from '../api.js';
import { PageTitle, Spinner, ErrorMsg, Button } from '../components.jsx';

// Estilo del badge de diagnóstico por ítem (por qué no se auto-importa). Los códigos los
// fija el servidor en importer.js classifyPending().
const DIAG_CLS = {
  'multi-album': 'diag-warn',
  'in-library': 'diag-warn',
  'not-torrent': 'diag-info',
  'torrent-pending': 'diag-muted',
  ready: 'diag-ok',
};

// «hace Ns / Nm / Nh» a partir de un timestamp (para ver si el auto-import se dispara solo).
function fmtAgo(ts) {
  if (!ts) return 'nunca';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `hace ${s}s`;
  if (s < 3600) return `hace ${Math.round(s / 60)}m`;
  return `hace ${Math.round(s / 3600)}h`;
}

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
            Última pasada <span className="text-neutral-400">{fmtAgo(st.lastRun)}</span>
            {st.running ? <span className="text-gold-300"> · en curso…</span> : ''}: qBittorrent devolvió{' '}
            <b className="text-neutral-300">{st.torrents ?? 0}</b> completados ·{' '}
            <b className="text-neutral-300">{st.underSource ?? 0}</b> bajo tu carpeta de torrents ·{' '}
            <b className="text-neutral-300">{st.imported ?? 0}</b> importados
            {st.alreadyImported ? ` · ${st.alreadyImported} ya estaban` : ''}
            {st.errors?.length ? ` · ${st.errors.length} con error` : ''}.
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
              Liderarr y la que ve qBittorrent deben coincidir (mismo montaje en el contenedor, estilo TRaSH).
              {st.samplePaths?.length > 0 && (
                <>
                  <div className="mt-1 text-neutral-400">qBittorrent reporta rutas como:</div>
                  {st.samplePaths.map((p, i) => (
                    <div key={i} className="text-neutral-500">
                      <code>{p}</code>
                    </div>
                  ))}
                  <div className="mt-1 text-neutral-400">
                    Arréglalo montando esa carpeta en el mismo path en ambos contenedores, o añade un remapeo en{' '}
                    <Link to="/ajustes" className="underline">Ajustes → Importar descargas</Link>.
                  </div>
                </>
              )}
            </div>
          )}
          {st.errors?.slice(0, 6).map((e, i) => (
            <div key={i} className="text-red-400">{e}</div>
          ))}
          {st.errors?.length > 6 && <div className="text-red-400/70">…y {st.errors.length - 6} más.</div>}
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
  const [itemErr, setItemErr] = useState({}); // source_dir -> mensaje de error

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
    setItemErr((p) => {
      const n = { ...p };
      delete n[it.source_dir];
      return n;
    });
    try {
      const r = await api.importRun(it.source_dir, {
        artist: field(it.source_dir, 'artist', it.artist),
        album: field(it.source_dir, 'album', it.album),
        year: field(it.source_dir, 'year', it.year),
      });
      setDone((p) => ({ ...p, [it.source_dir]: { dest: r.dest, method: r.method } }));
    } catch (e) {
      // error POR ÍTEM (antes salía un banner global y no sabías cuál falló); reintentar es
      // volver a pulsar su botón.
      setItemErr((p) => ({ ...p, [it.source_dir]: e.message }));
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
            <div className="flex items-center gap-2 mb-1 min-w-0">
              <span className="text-xs text-neutral-600 truncate" title={it.source_dir}>
                {it.name} · {it.tracks} pistas
              </span>
              {it.diag && (
                <span
                  className={`diag-badge shrink-0 text-[11px] px-2 py-0.5 rounded-full ${DIAG_CLS[it.diag.code] || DIAG_CLS.ready}`}
                  title={it.diag.hint}
                >
                  {it.diag.label}
                </span>
              )}
            </div>
            {it.diag && it.diag.code !== 'ready' && (
              <p className="text-xs text-neutral-300 leading-relaxed mb-2">{it.diag.hint}</p>
            )}
            {it.multiAlbum && it.folders?.length > 0 && (
              <p className="text-xs text-neutral-400 mb-2">
                <span className="text-neutral-500">Subcarpetas: </span>
                {it.folders.slice(0, 8).map((f, i) => (
                  <span key={f.name}>
                    {i > 0 && ' · '}
                    {f.name} <span className="text-neutral-500">({f.tracks})</span>
                  </span>
                ))}
                {it.folders.length > 8 && <span className="text-neutral-500"> · +{it.folders.length - 8} más</span>}
              </p>
            )}
            <p className="text-[11px] text-neutral-400 break-all mb-2 font-mono select-all">{it.source_dir}</p>
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
                  variant={
                    itemErr[it.source_dir] || it.diag?.code === 'multi-album' || it.diag?.code === 'in-library'
                      ? 'default'
                      : 'gold'
                  }
                  disabled={busy === it.source_dir}
                  onClick={() => runWithWarn(it)}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Link2 size={14} />{' '}
                    {busy === it.source_dir ? 'Enlazando…' : itemErr[it.source_dir] ? 'Reintentar' : 'Importar'}
                  </span>
                </Button>
              </div>
            )}
            {itemErr[it.source_dir] && !done[it.source_dir] && (
              <p className="text-xs text-red-400 mt-2">{itemErr[it.source_dir]}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
