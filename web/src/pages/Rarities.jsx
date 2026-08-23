import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { api } from '../api.js';
import { PageTitle, AlbumCard, Spinner, ErrorMsg } from '../components.jsx';

// Rarezas e inéditos: los orphan. Demos, maquetas, inéditos y tomas perdidas. Material
// que en otras herramientas se pierde entre lo demás; aquí tiene su propia sección con
// personalidad. Los directos no oficiales van aparte, en «Bootlegs».
export default function Rarities() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    api.rarities().then(setRows).catch((e) => setErr(e.message));
  }, []);

  if (err) return <ErrorMsg>{err}</ErrorMsg>;
  if (!rows) return <Spinner />;

  return (
    <div>
      <PageTitle
        icon={Sparkles}
        title="Rarezas e inéditos"
        sub={rows.length ? `${rows.length} joyas fuera de catálogo` : ''}
      />
      {rows.length === 0 ? (
        <div className="card p-8 text-center text-neutral-400">
          Aún no has marcado ninguna rareza. Desde «Sin identificar» o desde la ficha de un álbum puedes marcar
          demos, maquetas, inéditos y tomas perdidas como rarezas: cuentan en tus estadísticas, pero no en el
          completismo. Los directos no oficiales tienen su propia sección en «Bootlegs».
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {rows.map((a) => (
            <AlbumCard key={a.id} album={{ ...a, match_state: 'orphan', track_count: a.track_file_count }} />
          ))}
        </div>
      )}
    </div>
  );
}
