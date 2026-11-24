import { useState } from 'react';
import { Heart } from 'lucide-react';
import { PageTitle, SearchModal } from '../components.jsx';
import { WantedPanel } from './piezasLanzamientos.jsx';

// «Lo quiero» era una pestaña de Lanzamientos, pero dos de cada tres deseos no salen del
// calendario: vienen de Géneros, de Streaming o de la ficha de un artista. Es una lista
// propia, con su página.
export default function LoQuiero() {
  const [buscar, setBuscar] = useState(null);
  return (
    <div>
      <PageTitle icon={Heart} title="Lo quiero" sub="Lo que Liderarrr busca por ti hasta encontrarlo" />
      <WantedPanel onSearch={setBuscar} />
      {buscar != null && <SearchModal initialQuery={buscar} onClose={() => setBuscar(null)} />}
    </div>
  );
}
