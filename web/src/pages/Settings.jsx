import { useEffect, useState } from 'react';
import { Settings as SettingsIcon, Check, X, Loader2, Download } from 'lucide-react';
import { api } from '../api.js';
import { PageTitle, Spinner, Button } from '../components.jsx';

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
          5 · Escritura de etiquetas <span className="text-xs text-neutral-500">(avanzado)</span>
        </h2>
        <p className="text-xs text-neutral-500 mb-3">
          Por defecto Liderarrr <strong>nunca</strong> toca tus ficheros. Si lo activas, podrás escribir los
          identificadores de MusicBrainz (solo los MBID) en los álbumes identificados con confianza, desde su ficha y
          con confirmación. Nunca borra otras etiquetas ni toca rarezas.
        </p>
        <label className="flex items-center gap-2 text-sm mb-2 cursor-pointer">
          <input
            type="checkbox"
            checked={s.allow_tag_writing === '1'}
            onChange={(e) => setS((p) => ({ ...p, allow_tag_writing: e.target.checked ? '1' : '0' }))}
          />
          Permitir escribir etiquetas MBID en mis ficheros
        </label>
        <p className="text-xs text-amber-400/80">
          Requiere montar tu carpeta de música en modo escritura: cambia <code>/music:ro</code> por{' '}
          <code>/music:rw</code> en tu Docker. Con <code>:ro</code> (lo recomendado por defecto) esto no tendrá efecto.
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
