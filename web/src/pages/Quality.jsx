import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { HardDrive } from 'lucide-react';
import { api, fmtBytes } from '../api.js';
import { PageTitle, Stat, Spinner, ErrorMsg, DuplicateGroupPanel } from '../components.jsx';

export default function Quality() {
  const [ov, setOv] = useState(null);
  const [dups, setDups] = useState(null);
  const [err, setErr] = useState(null);
  const [group, setGroup] = useState(null); // grupo de duplicados abierto (para limpiarlo)
  useEffect(() => {
    Promise.all([api.quality(), api.duplicates()])
      .then(([o, d]) => {
        setOv(o);
        setDups(d);
      })
      .catch((e) => setErr(e.message));
  }, []);

  // abre el panel de limpieza del grupo (mismas acciones que en la Discoteca al pinchar ×N)
  const openDup = async (d) => {
    const firstId = Number(String(d.ids || '').split(',')[0]);
    if (!firstId) return;
    try {
      setGroup(await api.dupGroup(firstId));
    } catch (e) {
      alert(e.message);
    }
  };

  if (err) return <ErrorMsg>{err}</ErrorMsg>;
  if (!ov) return <Spinner />;

  return (
    <div>
      <PageTitle icon={HardDrive} title="Calidad y disco" sub="Formatos, metadatos y duplicados" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Stat label="Pistas sin pérdida" value={ov.lossless.lossless || 0} sub={`de ${ov.lossless.total}`} />
        <Stat label="Con pérdida" value={ov.lossless.lossy || 0} />
        <Stat label="Sin ReplayGain" value={ov.noReplaygain} sub="volumen sin normalizar" />
        <Stat label="Sin carátula" value={ov.noCover} />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="card p-4">
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

        <div className="card p-4">
          <h2 className="text-sm text-neutral-400 mb-3">Formatos mezclados en un mismo álbum</h2>
          {ov.mixed.length === 0 ? (
            <p className="text-neutral-600 text-sm">Ninguno. Cada álbum es de un solo formato.</p>
          ) : (
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {ov.mixed.map((m) => (
                <Link key={m.id} to={`/album/${m.id}`} className="block text-sm hover:text-gold-400">
                  <span className="truncate">{m.album_artist} — {m.title}</span>
                  <span className="text-xs text-amber-400/80 ml-2">{m.formats}</span>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="card p-4">
          <h2 className="text-sm text-neutral-400 mb-3">Álbumes más pesados</h2>
          <div className="space-y-1.5 max-h-64 overflow-y-auto">
            {ov.heaviest.map((h) => (
              <Link key={h.id} to={`/album/${h.id}`} className="flex justify-between text-sm hover:text-gold-400">
                <span className="truncate">{h.album_artist} — {h.title}</span>
                <span className="text-neutral-500 shrink-0 ml-2">{fmtBytes(h.size_bytes)}</span>
              </Link>
            ))}
          </div>
        </div>

        <div className="card p-4">
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
                    className="w-full text-left text-sm px-2 py-1 -mx-2 rounded hover:bg-ink-850/60 flex items-center justify-between"
                  >
                    <span className="truncate">
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

      {group && <DuplicateGroupPanel group={group} onClose={() => setGroup(null)} />}
    </div>
  );
}
