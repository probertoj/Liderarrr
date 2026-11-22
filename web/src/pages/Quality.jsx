import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { HardDrive } from 'lucide-react';
import { api, fmtBytes } from '../api.js';
import { PageTitle, Stat, Spinner, ErrorMsg, DuplicateGroupPanel } from '../components.jsx';
import { aviso } from '../avisos.jsx';
import { CaratulasPendientes, CarpetasPerdidas } from '../mantenimiento.jsx';
import QualityLists from './QualityLists.jsx';

export default function Quality() {
  const [ov, setOv] = useState(null);
  const [dups, setDups] = useState(null);
  const [err, setErr] = useState(null);
  const [group, setGroup] = useState(null); // grupo de duplicados abierto (para limpiarlo)
  const cargar = (alFallar = (e) => setErr(e.message)) =>
    Promise.all([api.quality(), api.duplicates()])
      .then(([o, d]) => {
        setOv(o);
        setDups(d);
      })
      .catch(alFallar);
  useEffect(() => {
    cargar();
  }, []);

  // abre el panel de limpieza del grupo (mismas acciones que en la Discoteca al pinchar ×N)
  const openDup = async (d) => {
    const firstId = Number(String(d.ids || '').split(',')[0]);
    if (!firstId) return;
    try {
      setGroup(await api.dupGroup(firstId));
    } catch (e) {
      aviso(e.message, 'error');
    }
  };

  if (err) return <ErrorMsg>{err}</ErrorMsg>;
  if (!ov) return <Spinner />;

  const miles = (n) => Number(n || 0).toLocaleString('es-ES');
  const pistas = (n) => `${miles(n)} ${n === 1 ? 'pista' : 'pistas'}`;
  // un servidor anterior a esta versión no manda albumCounts: se cae a los de pistas
  const ac = ov.albumCounts || {
    lossless: ov.lossless.lossless,
    lossy: ov.lossless.lossy,
    noReplaygain: ov.noReplaygain,
    losslessTracks: ov.lossless.lossless,
    lossyTracks: ov.lossless.lossy,
    noReplaygainTracks: ov.noReplaygain,
  };

  return (
    <div>
      <PageTitle icon={HardDrive} title="Calidad y disco" sub="Formatos, metadatos y duplicados" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {/* contado por ÁLBUM (con las pistas debajo): «¿cuántos discos tengo con pérdida?» es
            la pregunta, no cuántas pistas. Idea del fork de tinker-net. */}
        <Stat label="Álbumes sin pérdida" value={miles(ac.lossless)} sub={pistas(ac.losslessTracks)} />
        <Stat label="Álbumes con pérdida" value={miles(ac.lossy)} sub={pistas(ac.lossyTracks)} />
        <Stat label="Álbumes sin ReplayGain" value={miles(ac.noReplaygain)} sub={pistas(ac.noReplaygainTracks)} />
        {/* no es «sin carátula»: es sin fichero de imagen en la carpeta. La mayoría la lleva
            incrustada en el audio y se ve igual. */}
        <Stat label="Sin imagen en la carpeta" value={miles(ov.noCover)} sub="la carátula sale del audio o de fuera" />
      </div>
      <p className="-mt-3 mb-6 text-xs text-neutral-500">
        Basta una pista para que el álbum cuente: si mezcla audio con y sin pérdida, sale en los dos totales.
      </p>

      <CarpetasPerdidas onChange={() => cargar((e) => aviso(e.message, 'error'))} />
      <CaratulasPendientes />

      {/* grid-cols-1 y min-w-0: sin ellos la columna única del móvil se ensanchaba hasta el
          título más largo de las listas de abajo (1.257 px en una pantalla de 375). */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card p-4 min-w-0">
          <h2 className="text-sm text-neutral-400 mb-3">Formatos</h2>
          <div className="space-y-1.5">
            {ov.byFormat.map((f) => (
              <div key={f.name} className="flex items-center justify-between text-sm">
                <span>{f.name}</span>
                <span className="text-neutral-500">
                  {f.n.toLocaleString('es')} · {fmtBytes(f.size)}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="card p-4 min-w-0">
          <h2 className="text-sm text-neutral-400 mb-3">Formatos mezclados en un mismo álbum</h2>
          {ov.mixed.length === 0 ? (
            <p className="text-neutral-600 text-sm">Ninguno. Cada álbum es de un solo formato.</p>
          ) : (
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {ov.mixed.map((m) => (
                <Link key={m.id} to={`/album/${m.id}`} className="flex items-baseline justify-between gap-2 text-sm hover:text-gold-400">
                  <span className="truncate min-w-0">{m.album_artist} — {m.title}</span>
                  <span className="text-xs text-amber-400 shrink-0">{m.formats}</span>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="card p-4 min-w-0">
          <h2 className="text-sm text-neutral-400 mb-3">Álbumes más pesados</h2>
          <div className="space-y-1.5 max-h-64 overflow-y-auto">
            {ov.heaviest.map((h) => (
              <Link key={h.id} to={`/album/${h.id}`} className="flex justify-between text-sm hover:text-gold-400">
                <span className="truncate min-w-0">{h.album_artist} — {h.title}</span>
                <span className="text-neutral-500 shrink-0 ml-2">{fmtBytes(h.size_bytes)}</span>
              </Link>
            ))}
          </div>
        </div>

        <div className="card p-4 min-w-0">
          <h2 className="text-sm text-neutral-400 mb-3">Duplicados</h2>
          {!dups || dups.length === 0 ? (
            <p className="text-neutral-600 text-sm">Sin duplicados detectados.</p>
          ) : (
            <>
              <p className="text-xs text-neutral-600 mb-2">Pincha uno para ver las copias y limpiarlas.</p>
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {dups.map((d, i) => (
                  <button
                    key={i}
                    onClick={() => openDup(d)}
                    className="w-full text-left text-sm px-2 py-1 rounded hover:bg-ink-850/60 flex items-center justify-between"
                  >
                    <span className="truncate min-w-0">
                      {d.album_artist} — {d.title}
                    </span>
                    <span className="text-xs text-sky-400 ml-2 shrink-0">×{d.copies}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* al final de la página: es la lista larga, lo demás se ve de un vistazo */}
      <div className="mt-4">
        <QualityLists />
      </div>

      {group && (
        <DuplicateGroupPanel
          group={group}
          onClose={() => {
            setGroup(null);
            // al cerrar puede haber una copia menos: la lista de detrás se quedaba vieja
            cargar((e) => aviso(e.message, 'error'));
          }}
        />
      )}
    </div>
  );
}
