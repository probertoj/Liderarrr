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

// Desplegable "¿cómo consigo…?": guía paso a paso, plegada por defecto (estilo PowaFlex).
function HowTo({ title, children }) {
  return (
    <details className="mb-3 rounded-lg border border-ink-800 bg-ink-850/40">
      <summary className="cursor-pointer select-none px-3 py-2 text-xs text-gold-400/90 hover:text-gold-300">
        {title}
      </summary>
      <div className="px-3 pb-3 pt-0.5 text-xs text-neutral-400 leading-relaxed">{children}</div>
    </details>
  );
}
const Steps = ({ children }) => <ol className="list-decimal ml-4 space-y-1">{children}</ol>;

const input = 'w-full bg-ink-850 border border-ink-800 rounded-lg px-2.5 py-1.5 text-sm mt-1';

function TestButton({ service, label, beforeTest }) {
  const [state, setState] = useState(null); // null | 'run' | ok | err
  const [msg, setMsg] = useState('');
  return (
    <div className="flex items-center gap-2">
      <Button
        onClick={async () => {
          setState('run');
          setMsg('');
          try {
            // guarda primero: el test corre contra la config del SERVIDOR, así que sin
            // guardar probaría con lo viejo. Así siempre prueba lo que hay en pantalla.
            if (beforeTest) await beforeTest();
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
  const [initial, setInitial] = useState(null); // snapshot para detectar cambios sin guardar
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [profiles, setProfiles] = useState(null);

  useEffect(() => {
    api.settings().then((v) => {
      setS(v);
      setInitial(v);
    });
  }, []);

  const set = (k) => (e) => setS((prev) => ({ ...prev, [k]: e.target.value }));
  const dirty = s && initial && JSON.stringify(s) !== JSON.stringify(initial);

  const save = async () => {
    setSaving(true);
    try {
      await api.saveSettings(s);
      setInitial(s); // ya guardado: deja de estar "sucio"
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
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
        <HowTo title="¿Qué ruta pongo aquí?">
          <p className="mb-1">
            Son las rutas <b className="font-normal text-neutral-300">dentro del contenedor</b> (la parte izquierda del
            volumen en tu <code>docker-compose</code>), no las del NAS. Con el layout recomendado suele ser{' '}
            <code>/library/media/music</code>.
          </p>
          <p>Una carpeta por línea si tienes varias. Deben coincidir con el volumen que montaste en Docker.</p>
        </HowTo>
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
        <HowTo title="¿Cómo consigo la API key de AcoustID?">
          <Steps>
            <li>Entra en <code>acoustid.org</code> y crea una cuenta (o inicia sesión).</li>
            <li>Ve a <code>acoustid.org/api-key</code> y registra una aplicación si te lo pide.</li>
            <li>Copia la «API key» que te da.</li>
          </Steps>
          <p className="mt-1">Es opcional: solo se usa como último recurso (huella acústica) cuando lo demás no identifica.</p>
        </HowTo>
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
        <HowTo title="¿Cómo consigo el token de Discogs?">
          <Steps>
            <li>En <code>discogs.com</code>, tu avatar → «Settings».</li>
            <li>Pestaña «Developers».</li>
            <li>«Generate new token» y copia el token personal.</li>
          </Steps>
        </HowTo>
        <Field label="Last.fm · API key" hint="last.fm/api/account/create. Resuelve nombres y trae tus escuchas.">
          <input value={s.lastfm_key || ''} onChange={set('lastfm_key')} className={input} placeholder="••••••••" />
        </Field>
        <Field label="Last.fm · tu usuario" hint="Para importar tu historial de escuchas (la brecha escucha↔propiedad).">
          <input value={s.lastfm_user || ''} onChange={set('lastfm_user')} className={input} placeholder="tu_usuario" />
        </Field>
        <HowTo title="¿Cómo consigo la API key de Last.fm?">
          <Steps>
            <li>Entra en <code>last.fm/api/account/create</code>.</li>
            <li>Rellena nombre y descripción (la URL puede ser cualquiera).</li>
            <li>Copia la «API key».</li>
          </Steps>
          <p className="mt-1">Pon también tu usuario de Last.fm arriba para importar tus escuchas.</p>
        </HowTo>

        <Field
          label="Spotify · Client ID"
          hint="Opcional. Suma Spotify como fuente de novedades adelantadas (además de Deezer, que ya funciona sin clave)."
        >
          <input value={s.spotify_client_id || ''} onChange={set('spotify_client_id')} className={input} placeholder="client id" />
        </Field>
        <Field label="Spotify · Client Secret">
          <input value={s.spotify_client_secret || ''} onChange={set('spotify_client_secret')} className={input} placeholder="••••••••" />
        </Field>
        <HowTo title="¿Cómo consigo las credenciales de Spotify?">
          <Steps>
            <li>Entra en <code>developer.spotify.com/dashboard</code> e inicia sesión.</li>
            <li>«Create app» (nombre y descripción cualesquiera; el Redirect URI puede ser <code>http://localhost</code>).</li>
            <li>En la app, copia el «Client ID» y el «Client secret».</li>
          </Steps>
          <p className="mt-1">Solo se usa para leer catálogo (client credentials): no requiere tu cuenta ni login de usuario.</p>
        </HowTo>

        <div className="flex flex-wrap gap-2 mt-3">
          <TestButton service="musicbrainz" label="MusicBrainz" beforeTest={save} />
          <TestButton service="acoustid" label="AcoustID" beforeTest={save} />
          <TestButton service="discogs" label="Discogs" beforeTest={save} />
          <TestButton service="lastfm" label="Last.fm" beforeTest={save} />
          <TestButton service="spotify" label="Spotify" beforeTest={save} />
        </div>
      </section>

      {/* Notificaciones */}
      <section className="card p-5 mb-4">
        <h2 className="font-display text-lg mb-1">Notificaciones <span className="text-xs text-neutral-500">(opcional)</span></h2>
        <p className="text-xs text-neutral-500 mb-3">
          Recibe un aviso cuando aparezcan novedades de tus artistas o se importen descargas, sin abrir la app. Pega la
          URL de un webhook de <b>Discord</b>, <b>Slack</b> o un tema de <b>ntfy</b> (u otro que reciba un POST de texto).
        </p>
        <label className="flex items-center gap-2 text-sm mb-3 cursor-pointer">
          <input
            type="checkbox"
            checked={s.notify_enabled === '1'}
            onChange={(e) => setS((p) => ({ ...p, notify_enabled: e.target.checked ? '1' : '0' }))}
          />
          Enviar notificaciones
        </label>
        <Field label="URL del webhook" hint="Discord: URL del webhook del canal. ntfy: https://ntfy.sh/tu-tema. Slack: incoming webhook.">
          <input value={s.notify_url || ''} onChange={set('notify_url')} className={input} placeholder="https://ntfy.sh/mi-tema  ·  https://discord.com/api/webhooks/…" />
        </Field>
        <HowTo title="¿Cómo consigo un webhook?">
          <Steps>
            <li><b>ntfy</b> (lo más fácil): elige un nombre de tema único y usa <code>https://ntfy.sh/ese-tema</code>; instala la app de ntfy y suscríbete a ese tema.</li>
            <li><b>Discord</b>: Editar canal → Integraciones → Webhooks → Nuevo webhook → Copiar URL.</li>
            <li><b>Slack</b>: crea un «Incoming Webhook» en la configuración de tu espacio y copia la URL.</li>
          </Steps>
        </HowTo>
        <div className="flex flex-wrap gap-2 mt-3">
          <TestButton service="notify" label="Enviar prueba" beforeTest={save} />
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
        <HowTo title="¿Cómo consigo la API key de Lidarr? ¿Y los perfiles?">
          <Steps>
            <li>Lidarr → Settings → General → sección «Security» → copia «API Key».</li>
            <li>Pega URL y key aquí y pulsa «Probar Lidarr».</li>
            <li>Pulsa «Cargar perfiles» para elegir calidad, metadatos y carpeta raíz (dónde Lidarr guardará lo que pidas).</li>
          </Steps>
        </HowTo>
        <div className="flex gap-2 mb-3">
          <TestButton service="lidarr" label="Lidarr" beforeTest={save} />
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
        <HowTo title="¿Cómo consigo la API key de Prowlarr?">
          <Steps>
            <li>Prowlarr → Settings → General → sección «Security» → «API Key».</li>
          </Steps>
          <p className="mt-1">
            Para que descargue de punta a punta, Prowlarr necesita un cliente de descarga en Settings → Download Clients.
            Si un indexer tiene el freeleech en «Required» y te quedas sin tokens, filtra resultados: ponlo en «Preferred».
          </p>
        </HowTo>
        <div className="flex gap-2">
          <TestButton service="prowlarr" label="Prowlarr" beforeTest={save} />
        </div>
        <p className="text-xs text-neutral-600 mt-2">
          Para descargar de punta a punta, Prowlarr necesita un cliente de descarga en Settings → Download Clients.
        </p>
      </section>

      {/* 3c. Jackett — alternativa de búsqueda (solo busca; descarga vía qBittorrent) */}
      <section className="card p-5 mb-4">
        <h2 className="font-display text-lg mb-1">
          3c · Jackett <span className="text-xs text-neutral-500">(alternativa a Prowlarr)</span>
        </h2>
        <p className="text-xs text-neutral-500 mb-3">
          Alternativa por si Prowlarr te falla (suele ser más inestable). Jackett solo BUSCA (Torznab); la descarga la
          hace qBittorrent (sección 3d). Elige aquí qué motor usa el botón «Buscar» de la app.
        </p>
        <Field label="Motor de búsqueda activo" hint="El que usa «Buscar» en fichas, sellos y completismo.">
          <select value={s.search_engine || 'prowlarr'} onChange={set('search_engine')} className={input}>
            <option value="prowlarr">Prowlarr</option>
            <option value="jackett">Jackett (descarga → qBittorrent)</option>
          </select>
        </Field>
        <Field label="URL de Jackett" hint="Ej.: http://192.168.1.50:9117">
          <input value={s.jackett_url || ''} onChange={set('jackett_url')} className={input} placeholder="http://…:9117" />
        </Field>
        <Field label="API key" hint="Jackett → arriba a la derecha, «API Key».">
          <input value={s.jackett_key || ''} onChange={set('jackett_key')} className={input} placeholder="••••••••" />
        </Field>
        <Field
          label="Categorías"
          hint="Torznab, separadas por coma. 3000 = música. Déjalo VACÍO si algún tracker (p. ej. Orpheus) no aparece: buscará en todas las categorías."
        >
          <input value={s.jackett_categories ?? '3000'} onChange={set('jackett_categories')} className={input} placeholder="3000" />
        </Field>
        <HowTo title="¿Cómo consigo la API key de Jackett?">
          <Steps>
            <li>Abre la web de Jackett.</li>
            <li>Arriba a la derecha verás «API Key»: cópiala.</li>
          </Steps>
          <p className="mt-1">Liderarr busca en el indexer agregado «all» (todos tus indexers de Jackett a la vez).</p>
        </HowTo>
        <TestButton service="jackett" label="Jackett" beforeTest={save} />
      </section>

      {/* 3e · Prioridad de trackers — desempata la descarga de un clic y el auto-grab */}
      <section className="card p-5 mb-4">
        <h2 className="font-display text-lg mb-1">
          3e · Prioridad de trackers <span className="text-xs text-neutral-500">(opcional)</span>
        </h2>
        <p className="text-xs text-neutral-500 mb-3">
          Cuando la descarga de un clic (o el auto-grab) encuentra el MISMO disco en la MISMA calidad en varios
          trackers, elige el del tracker que pongas más arriba. Un nombre por línea, del preferido al menos preferido;
          los no listados van los últimos. Usa los nombres tal como aparecen en la columna del indexer en los resultados
          de búsqueda. A igual calidad y tracker, decide el número de seeders.
        </p>
        <Field label="Orden de preferencia" hint="Un tracker por línea, el preferido arriba.">
          <textarea
            value={s.tracker_priority || ''}
            onChange={set('tracker_priority')}
            rows={4}
            className={input}
            placeholder={'Redacted\nOrpheus\nWaffles'}
          />
        </Field>
      </section>

      {/* 3d. qBittorrent — materializa la descarga cuando el motor es Jackett */}
      <section className="card p-5 mb-4">
        <h2 className="font-display text-lg mb-1">
          3d · qBittorrent <span className="text-xs text-neutral-500">(para Jackett)</span>
        </h2>
        <p className="text-xs text-neutral-500 mb-3">
          Cuando el motor es Jackett, Liderarr envía aquí el magnet/.torrent que elijas. Con Prowlarr no hace falta
          (empuja a su propio cliente de descarga).
        </p>
        <Field label="URL de la WebUI" hint="Ej.: http://192.168.1.50:8080">
          <input value={s.qbittorrent_url || ''} onChange={set('qbittorrent_url')} className={input} placeholder="http://…:8080" />
        </Field>
        <Field label="Usuario" hint="El de la WebUI de qBittorrent.">
          <input value={s.qbittorrent_user || ''} onChange={set('qbittorrent_user')} className={input} placeholder="admin" />
        </Field>
        <Field label="Contraseña">
          <input type="password" value={s.qbittorrent_pass || ''} onChange={set('qbittorrent_pass')} className={input} placeholder="••••••••" />
        </Field>
        <Field label="Categoría (opcional)" hint="Separa en qBittorrent lo que manda Liderarr. Ej.: liderarr">
          <input value={s.qbittorrent_category || ''} onChange={set('qbittorrent_category')} className={input} placeholder="liderarr" />
        </Field>
        <HowTo title="¿Cómo preparo la WebUI de qBittorrent? (importante)">
          <Steps>
            <li>qBittorrent → Opciones → «Web UI»: activa «Web User Interface (Remote control)», y define usuario, contraseña y puerto (ese puerto es el de la URL de arriba).</li>
            <li>
              Si accedes por <b className="font-normal text-neutral-300">HTTP en tu red local</b> (no HTTPS):
              en «Security» <b className="font-normal text-neutral-300">DESMARCA «Enable cookie Secure flag»</b> y pulsa
              Save. Si no, qBittorrent no acepta la sesión y da 403.
            </li>
            <li>Si usas «Enable Host header validation», permite la IP/host de Liderarr (o desactívala para probar).</li>
          </Steps>
          <p className="mt-1">Usuario y contraseña son los de la WebUI de qBittorrent, no los del NAS.</p>
        </HowTo>
        <TestButton service="qbittorrent" label="qBittorrent" beforeTest={save} />
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
        <HowTo title="Estructura recomendada (TRaSH Guides) — evita el 99% de los problemas">
          <p className="mb-1">
            Monta UNA sola carpeta <code className="text-neutral-400">data</code> del host en{' '}
            <code className="text-neutral-400">/data</code>, con <b>el mismo path en Liderarr y en qBittorrent</b>. Así
            qBittorrent reporta <code className="text-neutral-400">/data/torrents/music/…</code> y Liderarr ve
            exactamente esa ruta → los hardlinks funcionan y el auto-import va solo.
          </p>
          <pre className="text-[11px] text-neutral-500 bg-ink-900/60 rounded p-2 my-1 overflow-x-auto">{`data/
├── torrents/music/   ← qBittorrent descarga aquí  → /data/torrents/music
└── media/music/      ← biblioteca organizada       → /data/media/music`}</pre>
          <p className="text-neutral-500">
            Docker: <code className="text-neutral-400">-v /host/data:/data</code> en AMBOS contenedores. Guía completa
            en <a href="https://trash-guides.info/File-and-Folder-Structure/" target="_blank" rel="noreferrer" className="text-gold-400 hover:underline">trash-guides.info</a>.
            Si tus rutas ya difieren y no quieres tocar montajes, usa el «Remapeo de rutas» de abajo.
          </p>
        </HowTo>
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
          label="Remapeo de rutas qBittorrent → Liderarr (opcional)"
          hint="Solo si qBittorrent reporta las descargas en un path distinto al que monta Liderarr. Una regla por línea: rutaQB => rutaLocal"
        >
          <textarea
            value={s.import_qb_path_map || ''}
            onChange={set('import_qb_path_map')}
            rows={2}
            className={input}
            placeholder={'/downloads => /data/torrents\n/mnt/user/data => /data'}
          />
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
        <label className="flex items-center gap-2 text-sm mt-3 cursor-pointer">
          <input
            type="checkbox"
            checked={s.auto_import === '1'}
            onChange={(e) => setS((p) => ({ ...p, auto_import: e.target.checked ? '1' : '0' }))}
          />
          <b className="font-normal">Auto-importar al terminar</b>{' '}
          <span className="text-xs text-neutral-500">
            (cierra el bucle sin Lidarr: cada pocos minutos revisa qBittorrent y enlaza a la biblioteca lo que haya
            terminado; requiere «Permitir importar» y qBittorrent configurado)
          </span>
        </label>
        {s.auto_import === '1' && (
          <Field label="Cada cuántos minutos" hint="Frecuencia del auto-import (mínimo 1; por defecto 3). El cambio se aplica sin reiniciar.">
            <input
              type="number"
              min="1"
              value={s.auto_import_interval_min ?? '3'}
              onChange={set('auto_import_interval_min')}
              className={`${input} w-24`}
              placeholder="3"
            />
          </Field>
        )}
      </section>

      {/* Listas de reproducción (M3U) */}
      <section className="card p-5 mb-4">
        <h2 className="font-display text-lg mb-1">Listas de reproducción <span className="text-xs text-neutral-500">(opcional)</span></h2>
        <p className="text-xs text-neutral-500 mb-3">
          Puedes exportar un reto o tus «no escuchados» como lista <b>M3U</b> para tu reproductor. Las rutas de los
          ficheros son las que ve el servidor (p. ej. <code>/data/media/music/…</code>). Si tu reproductor monta la música
          en otra ruta, define aquí la sustitución para que la lista funcione.
        </p>
        <Field
          label="Sustitución de ruta"
          hint="Una línea: «rutaServidor => rutaReproductor». Ej.: /data/media/music => \\NAS\music"
        >
          <input
            value={s.playlist_path_map || ''}
            onChange={set('playlist_path_map')}
            className={input}
            placeholder="/data/media/music => \\NAS\music"
          />
        </Field>
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

      {/* 4b. Auto-descargar nativo (sin Lidarr) */}
      <section className="card p-5 mb-4">
        <h2 className="font-display text-lg mb-1">
          4b · Auto-descargar sin Lidarr <span className="text-xs text-neutral-500">(opcional)</span>
        </h2>
        <p className="text-xs text-neutral-500 mb-3">
          La alternativa nativa al auto-Lidarr: cada noche busca en tus indexers (Jackett/Prowlarr) los estrenos de tus
          artistas seguidos, elige la mejor release (sin pérdida primero, descartando las que no tienen semillas) y la
          agarra. El auto-import la enlaza a la biblioteca al terminar. Requiere motor de búsqueda y, con Jackett,
          qBittorrent.
        </p>
        <label className="flex items-center gap-2 text-sm mb-3 cursor-pointer">
          <input
            type="checkbox"
            checked={s.auto_grab_enabled === '1'}
            onChange={(e) => setS((p) => ({ ...p, auto_grab_enabled: e.target.checked ? '1' : '0' }))}
          />
          Activar auto-descarga nativa en el refresco nocturno
        </label>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Horizonte (meses)" hint="Cuánto mirar hacia adelante.">
            <input type="number" value={s.auto_grab_months || '6'} onChange={set('auto_grab_months')} className={input} />
          </Field>
          <Field label="Margen atrás (días)" hint="Recoge estrenos fechados con retraso.">
            <input type="number" value={s.auto_grab_lookback_days || '30'} onChange={set('auto_grab_lookback_days')} className={input} />
          </Field>
          <Field label="Semillas mínimas" hint="Descarta releases con menos seeders (evita torrents muertos).">
            <input type="number" value={s.auto_grab_min_seeders || '1'} onChange={set('auto_grab_min_seeders')} className={input} />
          </Field>
          <Field label="Máximo por tanda" hint="Tope de descargas que agarra en cada pasada.">
            <input type="number" value={s.auto_grab_limit || '20'} onChange={set('auto_grab_limit')} className={input} />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm mt-3 cursor-pointer">
          <input
            type="checkbox"
            checked={s.auto_grab_freeleech_only === '1'}
            onChange={(e) => setS((p) => ({ ...p, auto_grab_freeleech_only: e.target.checked ? '1' : '0' }))}
          />
          <b className="font-normal">Solo freeleech</b>{' '}
          <span className="text-xs text-neutral-500">
            (solo agarra releases marcadas freeleech —no cuentan para el ratio—; protege tu cuenta en trackers
            privados. Si el indexer no informa el freeleech, se descarta por seguridad)
          </span>
        </label>
        <div className="mt-2">
          <Button
            onClick={async () => {
              await save();
              try {
                const r = await api.autograbRun(true);
                alert(`Simulación: ${r.considered} candidatos.\n\n${(r.log || []).slice(0, 15).join('\n') || '(ninguno)'}`);
              } catch (e) {
                alert(e.message);
              }
            }}
          >
            Simular ahora (sin agarrar)
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

      {/* 7 · guiño (Talking Heads — «Once in a Lifetime»). Solo el título, a propósito. */}
      <section className="card p-5 mt-4 opacity-70">
        <h2 className="font-display text-lg text-neutral-400">
          7 · Letting the days goes by, let the water hold me down
        </h2>
      </section>

      {/* Barra de guardado flotante: aparece al cambiar cualquier ajuste, cerca de donde
          estás (antes el único botón Guardar quedaba arriba y era fácil olvidarlo). */}
      {dirty && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40">
          <div className="flex items-center gap-3 rounded-xl border border-gold-500/50 bg-ink-900/95 backdrop-blur px-4 py-2.5 shadow-lg">
            <span className="text-sm text-gold-200">Cambios sin guardar</span>
            <Button variant="gold" onClick={save} disabled={saving}>
              <span className="inline-flex items-center gap-1.5">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {saving ? 'Guardando…' : 'Guardar'}
              </span>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
