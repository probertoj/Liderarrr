import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, ArrowLeft } from 'lucide-react';
import { api } from '../api.js';
import { PageTitle, AlbumCard, Spinner, ErrorMsg } from '../components.jsx';

// Sellos de tu colección. Los sellos se van capturando de Discogs a medida que
// consultas ediciones de tus álbumes (y de las etiquetas si las traen), así que
// esta vista crece con el uso.
export default function Labels() {
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(null);
  const [q, setQ] = useState('');
  const [err, setErr] = useState(null);
  useEffect(() => {
    api.labels().then(setRows).catch((e) => setErr(e.message));
  }, []);

  if (err) return <ErrorMsg>{err}</ErrorMsg>;
  if (!rows) return <Spinner />;
  if (open) return <LabelDetail name={open} onBack={() => setOpen(null)} />;

  const shown = rows.filter((l) => l.name.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div>
      <PageTitle icon={Building2} title="Sellos" sub={rows.length ? `${rows.length} sellos en tu colección` : ''} />
      {rows.length === 0 ? (
        <div className="card p-8 text-center text-neutral-400">
          Aún no hay sellos. Se llenan al escanear (leyendo la etiqueta de sello de tus ficheros) y al consultar
          «Ediciones (Discogs)» en la ficha de un álbum.
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3 mb-4">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar sello…"
              className="w-full sm:max-w-xs bg-ink-850 border border-ink-800 rounded px-3 py-1.5 text-sm outline-none focus:border-gold-500/60"
            />
            {q && (
              <span className="text-xs text-neutral-500 shrink-0">
                {shown.length} de {rows.length}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {shown.map((l) => (
              <button
                key={l.name}
                onClick={() => setOpen(l.name)}
                className="text-sm px-3 py-1.5 rounded-full bg-ink-850 border border-ink-800 hover:border-gold-500/40"
              >
                {l.name} <span className="text-neutral-600">{l.albums}</span>
              </button>
            ))}
            {shown.length === 0 && <span className="text-sm text-neutral-500">Ningún sello coincide con «{q}».</span>}
          </div>
        </>
      )}
    </div>
  );
}

function LabelDetail({ name, onBack }) {
  const [albums, setAlbums] = useState(null);
  useEffect(() => {
    api.label(name).then(setAlbums);
  }, [name]);
  return (
    <div>
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-neutral-400 hover:text-gold-400 mb-4">
        <ArrowLeft size={15} /> Sellos
      </button>
      <h1 className="text-xl font-display mb-4">{name}</h1>
      {!albums ? (
        <Spinner />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {albums.map((a) => (
            <AlbumCard key={a.id} album={a} />
          ))}
        </div>
      )}
    </div>
  );
}
