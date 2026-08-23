import { useEffect, useState } from 'react';
import { Radio } from 'lucide-react';
import { api } from '../api.js';
import { PageTitle, AlbumCard, Spinner, ErrorMsg } from '../components.jsx';

// Bootlegs: directos no oficiales, sesiones de radio, ROIOs. Como las rarezas, están en
// tu disco y cuentan en las estadísticas, pero no en el completismo. Espacio propio para
// lo que otras herramientas mezclan o descartan.
export default function Bootlegs() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    api.bootlegs().then(setRows).catch((e) => setErr(e.message));
  }, []);

  if (err) return <ErrorMsg>{err}</ErrorMsg>;
  if (!rows) return <Spinner />;

  return (
    <div>
      <PageTitle
        icon={Radio}
        title="Bootlegs"
        sub={rows.length ? `${rows.length} grabaciones no oficiales` : ''}
      />
      {rows.length === 0 ? (
        <div className="card p-8 text-center text-neutral-400">
          Aún no has marcado ningún bootleg. Desde «Sin identificar» o desde la ficha de un álbum puedes marcar
          directos no oficiales, sesiones de radio y ROIOs como bootlegs: cuentan en tus estadísticas, pero no en el
          completismo.
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {rows.map((a) => (
            <AlbumCard key={a.id} album={{ ...a, match_state: 'bootleg', track_count: a.track_file_count }} />
          ))}
        </div>
      )}
    </div>
  );
}
