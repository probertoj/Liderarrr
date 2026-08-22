import { useEffect, useState } from 'react';
import { Rocket } from 'lucide-react';
import { api } from '../api.js';
import { PageTitle } from '../components.jsx';

// «Novedades de la app»: resumen curado de lo que se va implementando, versión a versión.
// Va en el menú «How did I get here?». Lo de arriba («En camino») es lo aún sin publicar;
// al hacer bump, esos puntos pasan a su número de versión. Marca en qué versión estás.

const RELEASES = [
  {
    version: '0.9.3',
    title: 'Spotify a fondo y esta página',
    items: [
      'Escuchas: nuevo rango «Última semana» en la brecha escucha↔propiedad.',
      'Ficha de disco: el enlace de Spotify abre el álbum concreto (antes iba al buscador).',
      '«Novedades de Spotify»: además de las adelantadas (⚡ que MusicBrainz aún no tiene), muestra los estrenos recientes de tus artistas seguidos, semana a semana, con un botón para buscarlas al momento.',
      'Esta misma página de «Novedades de la app».',
    ],
  },
  {
    version: '0.9.2',
    title: 'Descubrimiento',
    items: [
      '«Novedades de Spotify» (en Lanzamientos): estrenos de tus artistas detectados en Deezer/Spotify que MusicBrainz aún no lista, adelantándose a su retraso.',
      '«Quizá quieras seguir a…» (en Seguidos): sugerencias de artistas similares (Last.fm) que aún no tienes, para seguir de un clic.',
      'Conexión opcional con Spotify (client id/secret); Deezer sigue sin necesitar clave.',
      'README reescrito como manual de uso completo.',
    ],
  },
  {
    version: '0.9.1',
    title: 'Móvil e importación manual',
    items: [
      'App usable en móvil/iPhone: menú deslizable, respeto del notch, y los campos ya no provocan zoom al enfocarlos.',
      'Importar descargas: diagnóstico por ítem (por qué no se auto-importa) con la carpeta que mira.',
      'Importar por subcarpetas (vertederos de varios álbumes) y ocultar «ya la tengo».',
      'Auto-import más robusto, estructura TRaSH sugerida y remapeo de rutas qBittorrent↔contenedor.',
      'Ediciones y copias en la ficha de disco; la discoteca agrupa por edición.',
      'Enlazar la identificación pegando una URL de MusicBrainz.',
    ],
  },
  {
    version: '0.9.0',
    title: 'Radar, retos y descargas',
    items: [
      'Radar multifuente de novedades curadas: buymusic.club, Rosy Overdrive, Raven Sings the Blues e Hipersónica.',
      'Retos editables y con importación de listas por URL (Album of the Year, Record Club, Rosy Overdrive) o pegando (RYM).',
      'Prioridad de trackers en la descarga de un clic.',
      'Importar descargas: cierre del bucle sin Lidarr (auto-import por hardlink).',
    ],
  },
  {
    version: '0.8.x',
    title: 'Ficha rica y colección',
    items: [
      'Buscador rápido en el Dashboard: tu colección al instante + MusicBrainz para lo que no tienes.',
      'Panel tipo Roon en la ficha: créditos, reseña, valoración, recomendaciones y otras versiones.',
      'Carátulas fiables, multidiscos limpios (CD1/CD2) y gestión de copias/duplicados.',
    ],
  },
  {
    version: '0.7.0',
    title: 'Independencia de Lidarr',
    items: [
      'Buscar, descargar (Prowlarr/Jackett + qBittorrent) e importar por su cuenta, sin depender de Lidarr (que pasa a ser opcional).',
    ],
  },
];

export default function Changelog() {
  const [version, setVersion] = useState('');
  useEffect(() => {
    api.version().then((v) => setVersion(v.version)).catch(() => {});
  }, []);

  return (
    <div>
      <PageTitle icon={Rocket} title="Novedades de la app" sub="Lo que se va implementando, versión a versión" />

      <div className="space-y-4">
        {RELEASES.map((rel, i) => {
          const current = rel.version && rel.version === version;
          const unreleased = !rel.version;
          return (
            <div key={i} className={`card p-4 ${unreleased ? 'border-gold-500/30' : ''}`}>
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                {unreleased ? (
                  <span className="text-xs px-2 py-0.5 rounded-full border border-gold-500/40 bg-gold-500/10 text-gold-300">
                    sin publicar
                  </span>
                ) : (
                  <span className="font-display text-lg text-neutral-100">v{rel.version}</span>
                )}
                <span className="text-sm text-neutral-400">{rel.title}</span>
                {current && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full border border-emerald-800/60 bg-emerald-900/40 text-emerald-300">
                    estás aquí
                  </span>
                )}
              </div>
              <ul className="space-y-1.5">
                {rel.items.map((it, j) => (
                  <li key={j} className="text-sm text-neutral-300 leading-relaxed flex gap-2">
                    <span className="text-gold-400/70 shrink-0">·</span>
                    <span>{it}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-neutral-600 mt-6">
        Historial completo en{' '}
        <a href="https://github.com/probertoj/Liderarrr/releases" target="_blank" rel="noreferrer" className="text-gold-400 hover:underline">
          GitHub
        </a>
        .
      </p>
    </div>
  );
}
