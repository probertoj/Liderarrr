import { useEffect, useState, useRef } from 'react';
import { Settings as SettingsIcon, Check, X, Loader2, Download, FolderSearch, RefreshCw } from 'lucide-react';
import { api } from '../api.js';
import { PageTitle, Spinner, Button } from '../components.jsx';

// Panel de escaneo: progreso en vivo del recorrido de tus carpetas. Deja ver si
// terminó o dónde va, que es justo lo que faltaba para saber si escanea todo.
function ScanPanel() {
  const [st, setSt] = useState(null);
  const timer = useRef(null);

  const poll = async () => {
    const s = await api.scanStatus().catch(() => null);
    if (s) setSt(s);
    return s;
  };
  useEffect(() => {
    poll();
    return () => clearInterval(timer.current);
  }, []);
  useEffect(() => {
    clearInterval(timer.current);
    if (st?.running) timer.current = setInterval(poll, 1500);
    return () => clearInterval(timer.current);
  }, [st?.running]);

  const start = async (force) => {
    // respuesta inmediata: marcamos "en marcha" antes de nada, para que se vea
    setSt((s) => ({ ...(s || {}), running: true, phase: 'walking', foldersFound: 0, albumsDone: 0, skipped: 0 }));
    try {
      await api.scan(force);
    } catch (e) {
      alert(e.message);
    }
    setTimeout(poll, 600);
  };

  if (!st) return null;
  const n = (x) => (x || 0).toLocaleString('es');
  const fmtTime = (ms) => (ms ? new Date(ms).toLocaleString('es') : '—');

  return (
    <div className="mt-3 border-t border-ink-800 pt-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm text-neutral-300">
          {st.totalAlbums?.toLocaleString('es') || 0} álbumes · {st.totalArtists?.toLocaleString('es') || 0} artistas en la biblioteca
        </div>
        <div className="flex gap-2">
          <Button onClick={() => start(false)} disabled={st.running}>
            <span className="inline-flex items-center gap-1.5">
              <FolderSearch size={14} /> Escanear
            </span>
          </Button>
          <Button
            onClick={() => confirm('Reescanea TODAS las carpetas desde cero (más lento). ¿Seguir?') && start(true)}
            disabled={st.running}
          >
            <span className="inline-flex items-center gap-1.5">
              <RefreshCw size={14} className={st.running ? 'animate-spin' : ''} /> Reescanear todo
            </span>
          </Button>
        </div>
      </div>

      {st.running ? (
        <div>
          <div className="flex items-center gap-2 text-xs text-neutral-400 mb-1.5">
            <Loader2 size={13} className="animate-spin shrink-0" />
            <span>
              {n(st.foldersFound)} carpetas · {n(st.albumsDone)} nuevas · {n(st.skipped)} sin cambios
              {st.errors ? ` · ${n(st.errors)} omitidas` : ''}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-ink-800 overflow-hidden">
            <div className="h-full w-1/3 bg-gold-400 animate-pulse" />
          </div>
          {st.current && <div className="text-[11px] text-neutral-600 mt-1 truncate">{st.current}</div>}
        </div>
      ) : (
        <div className="text-xs text-neutral-600">
          {st.lastScan
            ? `Último escaneo: ${fmtTime(st.lastScan.at)} · ${st.lastScan.albums} nuevas de ${st.lastScan.folders} carpetas${st.lastScan.errors ? ` · ${st.lastScan.errors} omitidas` : ''}${st.lastScan.error ? ` · error: ${st.lastScan.error}` : ''}`
            : 'Aún no se ha escaneado.'}
        </div>
      )}
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <label className="block mb-3">
      <span className="text-sm text-neutral-300">{label}</span>
      {hint && <span className="block text-xs text-neutral-600 mb-1">{hint}</span>}
      {children}
    </label>
  );
}

const input = 'w-full bg-ink-850 border border-ink-800 rounded-lg px-2.5 py-1.5 text-sm mt-1';

function TestButton({ service, label }) {
  const [state, setState] = useState(null); // null | 'run' | ok | err
  const [msg, setMsg] = useState('');
  return (
    <div className="flex items-center gap-2">
      <Button
        onClick={async () => {
          setState('run');
          setMsg('');
          try {
            const r = await api.test(service);
            setState(r.ok ? 'ok' : 'err');
            setMsg(r.ok ? Object.values(r).filter((v) => typeof v === 'string')[0] || 'OK' : r.error || 'Error');
          } catch (e) {
            setState('err');
            setMsg(e.message);
          }
        }}
      >
        <span className="inline-flex items-center gap-1.5">
          {state === 'run' && <Loader2 size={14} className="animate-spin" />}
          {state === 'ok' && <Check size={14} className="text-emerald-400" />}
          {state === 'err' && <X size={14} className="text-red-400" />}
          Probar {label}
        </span>
      </Button>
      {msg && <span className={`text-xs ${state === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}>{msg}</span>}
    </div>
  );
}

export default function Settings() {
  const [s, setS] = useState(null);
  const [saved, setSaved] = useState(false);
  const [profiles, setProfiles] = useState(null);

  useEffect(() => {
    api.settings().then(setS);
  }, []);

  const set = (k) => (e) => setS((prev) => ({ ...prev, [k]: e.target.value }));

  const save = async () => {
    await api.saveSettings(s);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const loadProfiles = async () => {
    await save();
    try {
      setProfiles(await api.lidarrProfiles());
    } catch (e) {
      alert(e.message);
    }
  };

  if (!s) return <Spinner />;

  return (
    <div className="max-w-2xl">
      <PageTitle icon={SettingsIcon} title="Ajustes" sub="Configura las fuentes de datos">
        <Button variant="gold" onClick={save}>
          {saved ? '✓ Guardado' : 'Guardar'}
        </Button>
      </PageTitle>

      {/* 1. Carpetas de música — la espina dorsal */}
      <section className="card p-5 mb-4">
        <h2 className="font-display text-lg mb-1">1 · Tu música</h2>
        <p className="text-xs text-neutral-500 mb-3">
          La fuente de verdad. Una carpeta por línea. Tus ficheros mandan: lo que esté aquí existe en Liderarrr, esté o
          no en MusicBrainz.
        </p>
        <Field label="Carpetas de música">
          <textarea
            value={s.music_dirs || ''}
            onChange={set('music_dirs')}
            rows={3}
            placeholder={'D:\\Musica\nE:\\FLAC'}
            className={`${input} font-mono`}
          />
        </Field>
        <ScanPanel />
        <div className="mt-3 border-t border-ink-800 pt-3 flex items-center justify-between gap-3">
          <span className="text-xs text-neutral-500">
            Las carátulas que no están en tus ficheros se descargan de Cover Art Archive / iTunes. Si acabas de
            identificar la biblioteca, reintenta las que faltaban.
          </span>
          <Button
            onClick={async () => {
              const r = await api.retryCovers();
              alert(`${r.retried} carátulas se reintentarán al volver a verlas.`);
            }}
          >
            Reintentar carátulas
          </Button>
        </div>
      </section>

      {/* 2. Identificación */}
      <section className="card p-5 mb-4">
        <h2 className="font-display text-lg mb-1">2 · Identificación</h2>
        <p className="text-xs text-neutral-500 mb-3">
          MusicBrainz no necesita clave. AcoustID (huella acústica) y Discogs mejoran mucho lo que se identifica.
        </p>
        <Field label="AcoustID · API key" hint="Gratis en acoustid.org/api-key. Necesita el binario fpcalc (incluido en Docker).">
          <input value={s.acoustid_key || ''} onChange={set('acoustid_key')} className={input} placeholder="••••••••" />
        </Field>
        <label className="flex items-center gap-2 text-sm mb-3 cursor-pointer">
          <input
            type="checkbox"
            checked={s.identify_acoustid !== '0'}
            onChange={(e) => setS((p) => ({ ...p, identify_acoustid: e.target.checked ? '1' : '0' }))}
          />
          Usar AcoustID como último recurso al identificar
          <span className="text-xs text-neutral-600">(lee el fichero entero; pesado en bibliotecas enormes)</span>
        </label>
        <Field label="Discogs · token personal" hint="discogs.com → Ajustes → Developers → Generate token.">
          <input value={s.discogs_token || ''} onChange={set('discogs_token')} className={input} placeholder="••••••••" />
        </Field>
        <Field label="Last.fm · API key" hint="last.fm/api/account/create. Resuelve nombres y trae tus escuchas.">
          <input value={s.lastfm_key || ''} onChange={set('lastfm_key')} className={input} placeholder="••••••••" />
        </Field>
        <Field label="Last.fm · tu usuario" hint="Para importar tu historial de escuchas (la brecha escucha↔propiedad).">
          <input value={s.lastfm_user || ''} onChange={set('lastfm_user')} className={input} placeholder="tu_usuario" />
        </Field>
        <div className="flex flex-wrap gap-2 mt-3">
          <TestButton service="musicbrainz" label="MusicBrainz" />
          <TestButton service="acoustid" label="AcoustID" />
          <TestButton service="discogs" label="Discogs" />
          <TestButton service="lastfm" label="Last.fm" />
        </div>
      </section>

      {/* 3. Lidarr — el actuador */}
      <section className="card p-5 mb-4">
        <h2 className="font-display text-lg mb-1">3 · Lidarr <span className="text-xs text-neutral-500">(opcional)</span></h2>
        <p className="text-xs text-neutral-500 mb-3">
          Solo para enviar álbumes que te faltan. Lidarr no cataloga tu música; es el actuador.
        </p>
        <Field label="URL de Lidarr" hint="Ej.: http://192.168.1.50:8686">
          <input value={s.lidarr_url || ''} onChange={set('lidarr_url')} className={input} placeholder="http://…:8686" />
        </Field>
        <Field label="API key" hint="Lidarr → Settings → General → Security → API Key.">
          <input value={s.lidarr_key || ''} onChange={set('lidarr_key')} className={input} placeholder="••••••••" />
        </Field>
        <div className="flex gap-2 mb-3">
          <TestButton service="lidarr" label="Lidarr" />
          <Button onClick={loadProfiles}>Cargar perfiles</Button>
        </div>
        {profiles && (
          <div className="grid sm:grid-cols-3 gap-2">
            <Field label="Perfil de calidad">
              <select value={s.lidarr_quality_profile || ''} onChange={set('lidarr_quality_profile')} className={input}>
                <option value="">—</option>
                {profiles.quality.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Perfil de metadatos">
              <select value={s.lidarr_metadata_profile || ''} onChange={set('lidarr_metadata_profile')} className={input}>
                <option value="">—</option>
                {profiles.metadata.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Carpeta raíz">
              <select value={s.lidarr_root_folder || ''} onChange={set('lidarr_root_folder')} className={input}>
                <option value="">—</option>
                {profiles.folders.map((f) => (
                  <option key={f.path} value={f.path}>{f.path}</option>
                ))}
              </select>
            </Field>
          </div>
        )}
      </section>

      {/* 3b. Prowlarr — buscar y descargar sin el filtro de Lidarr */}
      <section className="card p-5 mb-4">
        <h2 className="font-display text-lg mb-1">
          3b · Prowlarr <span className="text-xs text-neutral-500">(opcional)</span>
        </h2>
        <p className="text-xs text-neutral-500 mb-3">
          Buscar y descargar un disco desde Liderarr usando TODOS tus indexers (RED, OPS, Jackett), sin pasar por el
          filtro de metadatos de Lidarr. Prowlarr manda la release elegida a su cliente de descarga.
        </p>
        <Field label="URL de Prowlarr" hint="Ej.: http://192.168.1.50:9696">
          <input value={s.prowlarr_url || ''} onChange={set('prowlarr_url')} className={input} placeholder="http://…:9696" />
        </Field>
        <Field label="API key" hint="Prowlarr → Settings → General → Security → API Key.">
          <input value={s.prowlarr_key || ''} onChange={set('prowlarr_key')} className={input} placeholder="••••••••" />
        </Field>
        <div className="flex gap-2">
          <TestButton service="prowlarr" label="Prowlarr" />
        </div>
        <p className="text-xs text-neutral-600 mt-2">
          Para descargar de punta a punta, Prowlarr necesita un cliente de descarga en Settings → Download Clients.
        </p>
      </section>

      {/* 3c. Importar descargas — hardlink torrents -> biblioteca */}
      <section className="card p-5 mb-4">
        <h2 className="font-display text-lg mb-1">
          3c · Importar descargas <span className="text-xs text-neutral-500">(opcional)</span>
        </h2>
        <p className="text-xs text-neutral-500 mb-3">
          Cierra el círculo: lo que bajas se enlaza (hardlink) a tu biblioteca organizada, como hace Lidarr pero sin su
          veto. No borra ni copia el origen (sigues sembrando). Requiere que ambas carpetas estén en el mismo volumen
          (monta <code className="text-neutral-400">/data</code> completo) y la biblioteca en escritura (<code className="text-neutral-400">:rw</code>).
        </p>
        <label className="flex items-center gap-2 text-sm mb-3 cursor-pointer">
          <input
            type="checkbox"
            checked={s.allow_import === '1'}
            onChange={(e) => setS((p) => ({ ...p, allow_import: e.target.checked ? '1' : '0' }))}
          />
          Permitir importar (enlazar descargas a la biblioteca)
        </label>
        <Field label="Carpeta de descargas" hint="Donde tu cliente guarda la música. Ej.: /data/torrents/music">
          <input value={s.import_source_dir || ''} onChange={set('import_source_dir')} className={input} placeholder="/data/torrents/music" />
        </Field>
        <Field label="Carpeta de la biblioteca (destino)" hint="Tu biblioteca organizada. Ej.: /data/media/music">
          <input value={s.import_dest_dir || ''} onChange={set('import_dest_dir')} className={input} placeholder="/data/media/music" />
        </Field>
        <Field
          label="Estructura de carpetas"
          hint="Tokens: {artist} {album} {year}. La / crea subcarpetas. Ej.: {artist}/{year} - {album}"
        >
          <input
            value={s.import_naming || ''}
            onChange={set('import_naming')}
            className={input}
            placeholder="{artist}/{album} ({year})"
          />
        </Field>
        <label className="flex items-center gap-2 text-sm mt-3 cursor-pointer">
          <input
            type="checkbox"
            checked={s.import_copy_fallback === '1'}
            onChange={(e) => setS((p) => ({ ...p, import_copy_fallback: e.target.checked ? '1' : '0' }))}
          />
          Copiar si el hardlink no es posible <span className="text-xs text-neutral-500">(ocupa el doble; úsalo si origen y biblioteca no comparten volumen)</span>
        </label>
      </section>

      {/* 4. Auto-Lidarr */}
      <section className="card p-5 mb-4">
        <h2 className="font-display text-lg mb-1">4 · Auto-Lidarr diario <span className="text-xs text-neutral-500">(opcional)</span></h2>
        <p className="text-xs text-neutral-500 mb-3">
          Cada noche, encarga a Lidarr los álbumes de estudio que estrenan tus artistas seguidos dentro de la ventana.
        </p>
        <label className="flex items-center gap-2 text-sm mb-3 cursor-pointer">
          <input
            type="checkbox"
            checked={s.auto_lidarr_enabled === '1'}
            onChange={(e) => setS((p) => ({ ...p, auto_lidarr_enabled: e.target.checked ? '1' : '0' }))}
          />
          Activar auto-Lidarr en el refresco nocturno
        </label>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Horizonte (meses)" hint="Cuánto mirar hacia adelante.">
            <input
              type="number"
              value={s.auto_lidarr_months || '6'}
              onChange={set('auto_lidarr_months')}
              className={input}
            />
          </Field>
          <Field label="Margen atrás (días)" hint="Recoge estrenos fechados con retraso.">
            <input
              type="number"
              value={s.auto_lidarr_lookback_days || '30'}
              onChange={set('auto_lidarr_lookback_days')}
              className={input}
            />
          </Field>
        </div>
        <div className="mt-2">
          <Button
            onClick={async () => {
              await save();
              try {
                const r = await api.autoLidarrRun(true);
                alert(`Simulación: ${r.considered} candidatos.\n\n${r.log.slice(0, 15).join('\n') || '(ninguno)'}`);
              } catch (e) {
                alert(e.message);
              }
            }}
          >
            Simular ahora (sin encargar)
          </Button>
        </div>
      </section>

      {/* 5. Escritura de etiquetas */}
      <section className="card p-5 mb-4">
        <h2 className="font-display text-lg mb-1">
          5 · Escritura de etiquetas{' '}
          <span className="text-xs text-red-400/90 border border-red-500/40 bg-red-500/10 rounded px-1.5 py-0.5">
            no recomendado
          </span>
        </h2>
        <p className="text-xs text-neutral-500 mb-3">
          Por defecto Liderarr <strong>nunca</strong> toca tus ficheros, y así debería quedarse. Esta opción existe solo
          para casos muy concretos: si la activas, podrás escribir identificadores de MusicBrainz (solo los MBID) en los
          álbumes identificados con confianza, desde su ficha y con confirmación. Nunca borra otras etiquetas ni toca
          rarezas — pero <strong>modifica el fichero</strong>, y eso tiene consecuencias.
        </p>
        <div className="text-xs text-red-300/90 bg-red-500/10 border border-red-500/30 rounded p-3 mb-3 space-y-1.5">
          <p>
            <strong>⚠️ Si usas hardlinks con torrents (seeding), NO lo actives.</strong> Tu música en{' '}
            <code>media</code> y el torrent en <code>torrents</code> son <strong>el mismo fichero</strong> (mismo inodo).
            Escribir una etiqueta cambia ese fichero → cambia su hash → <strong>rompes el torrent</strong>: qBittorrent
            lo marcará como erróneo y dejarás de seedear (o forzará una recomprobación).
          </p>
          <p>
            Riesgo general: cualquier reescritura de etiquetas puede corromper un fichero si algo falla a media
            escritura. Ten copia de seguridad. La identificación y el completismo funcionan perfectamente{' '}
            <strong>sin</strong> esto: Liderarr guarda los MBID en su propia base de datos.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm mb-2 cursor-pointer">
          <input
            type="checkbox"
            checked={s.allow_tag_writing === '1'}
            onChange={(e) => setS((p) => ({ ...p, allow_tag_writing: e.target.checked ? '1' : '0' }))}
          />
          Permitir escribir etiquetas MBID en mis ficheros (no recomendado)
        </label>
        <p className="text-xs text-neutral-500">
          Además requiere montar la carpeta de música en modo escritura (<code>:rw</code>) en tu Docker; con el montaje
          de solo lectura (<code>:ro</code>, lo recomendado) esto no tiene efecto aunque lo marques.
        </p>
      </section>

      {/* 6. Copia de seguridad */}
      <section className="card p-5">
        <h2 className="font-display text-lg mb-1">6 · Copia de seguridad</h2>
        <p className="text-xs text-neutral-500 mb-3">Descarga la base de datos entera (SQLite). Todo vive en local.</p>
        <a
          href="/api/backup/database"
          className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-ink-700 bg-ink-850 hover:bg-ink-800"
        >
          <Download size={14} /> Descargar base de datos
        </a>
      </section>
    </div>
  );
}
