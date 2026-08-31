import { HardDrive, Sparkles, Compass, DownloadCloud, Radio, Headphones, Clock, Moon, Library } from 'lucide-react';
import { PageTitle } from '../components.jsx';

// «¿Cómo funciona todo esto?»: explica en cristiano el recorrido de la app y, sobre todo,
// CUÁNDO pasa cada cosa (auto-import cada pocos minutos vs. refresco nocturno completo).
// Va en el menú «How did I get here?» (guiño a Talking Heads, «Once in a Lifetime»).

function Step({ n, Icon, title, children }) {
  return (
    <div className="card p-4 flex gap-3">
      <div className="shrink-0 w-8 h-8 rounded-lg bg-gold-500/15 border border-gold-500/30 text-gold-300 flex items-center justify-center">
        <Icon size={16} />
      </div>
      <div className="min-w-0">
        <div className="text-sm text-neutral-200 mb-0.5">
          <span className="text-gold-400/80 mr-1">{n}.</span>
          {title}
        </div>
        <div className="text-xs text-neutral-500 leading-relaxed">{children}</div>
      </div>
    </div>
  );
}

export default function HowItWorks() {
  return (
    <div>
      <PageTitle title="¿Cómo funciona todo esto?" sub="El recorrido de Liderarr, en cristiano" />

      <p className="text-sm text-neutral-400 mb-6 max-w-2xl">
        Principio rector: <strong className="text-neutral-300">tus ficheros mandan</strong>. Liderarr lee tu
        música tal cual está en el disco, <strong className="text-neutral-300">anota</strong> con datos de
        MusicBrainz para saber qué te falta, y nunca borra ni reescribe tu audio sin que se lo pidas.
      </p>

      <h2 className="text-xs uppercase tracking-wide text-neutral-500 mb-2">Los pasos</h2>
      <div className="grid md:grid-cols-2 gap-2 mb-8">
        <Step n="1" Icon={HardDrive} title="Escaneo (Coleccionista de discos)">
          Recorre tus carpetas de música. Una carpeta = un álbum. Lee las etiquetas y vuelca artistas, discos y
          pistas. No consulta nada externo: aquí solo cuentan tus ficheros.
        </Step>
        <Step n="2" Icon={Sparkles} title="Identificación (Identikit)">
          Cruza cada disco con MusicBrainz para saber qué es (artista, álbum, año, tipo). Escribe metadatos en la
          base de datos de Liderarr, nunca en tus ficheros. Un disco sin identificar existe igual.
        </Step>
        <Step n="3" Icon={Compass} title="Completismo (I Hear a New World)">
          De los artistas que sigues, mira su discografía en MusicBrainz y la cruza con lo que tienes: te dice qué
          álbumes te faltan y qué está por salir.
        </Step>
        <Step n="4" Icon={DownloadCloud} title="Descargas e importación">
          Buscas y descargas por Prowlarr o Jackett + qBittorrent (sin el filtro de Lidarr). Cuando un torrent
          termina, el <strong className="text-neutral-400">auto-import</strong> lo enlaza (hardlink) a tu biblioteca
          organizada, sin copiar ni dejar de sembrar. Con la prioridad de trackers eliges de dónde tirar.
        </Step>
        <Step n="5" Icon={Radio} title="Radar de novedades (Lanzamientos)">
          Estrenos de tu colección (álbumes y <strong className="text-neutral-400">Canciones nuevas</strong>/singles),
          un calendario «Mes» con filtros por fuente, curadores (buymusic.club, Rosy Overdrive, Hipersónica), y{' '}
          <strong className="text-neutral-400">Descubre</strong>: novedades por afinidad de artistas parecidos a lo que
          escuchas y de tus sellos seguidos. Todo marcando lo que ya tienes.
        </Step>
        <Step n="6" Icon={Headphones} title="Escuchas y retos (Losing My Edge)">
          Conecta Last.fm para cruzar lo que TIENES con lo que has ESCUCHADO, y construye retos (1001 discos,
          listas, tier lists…) con anillos de progreso. El botón <strong className="text-neutral-400">«Añadir a
          reto»</strong> está en cualquier disco de la app, y marca los que ya están en un reto.
        </Step>
        <Step n="7" Icon={Library} title="Streaming (tu biblioteca de Spotify)">
          Conecta tu cuenta de Spotify (solo lectura) y cruza tus <strong className="text-neutral-400">álbumes
          guardados</strong> con tu colección local: lo que tienes en streaming y no en disco (para descargar) y lo
          que tienes en disco y no en streaming (para abrirlo en Spotify y guardarlo).
        </Step>
      </div>

      <h2 className="text-xs uppercase tracking-wide text-neutral-500 mb-2">¿Cuándo pasa cada cosa?</h2>
      <div className="space-y-2 max-w-2xl">
        <div className="card p-4 flex gap-3">
          <div className="shrink-0 w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 flex items-center justify-center">
            <Clock size={16} />
          </div>
          <div>
            <div className="text-sm text-neutral-200 mb-0.5">Cada 3 minutos · auto-import</div>
            <div className="text-xs text-neutral-500 leading-relaxed">
              Revisa qBittorrent, enlaza lo que haya terminado a tu biblioteca, reescanea esas carpetas nuevas y
              hace una <strong className="text-neutral-400">identificación ligera</strong> de lo recién importado.
              Rápido y barato: si no hay nada nuevo, no hace nada.
            </div>
          </div>
        </div>
        <div className="card p-4 flex gap-3">
          <div className="shrink-0 w-8 h-8 rounded-lg bg-sky-500/15 border border-sky-500/30 text-sky-300 flex items-center justify-center">
            <Moon size={16} />
          </div>
          <div>
            <div className="text-sm text-neutral-200 mb-0.5">Cada noche a las 03:00 · refresco completo</div>
            <div className="text-xs text-neutral-500 leading-relaxed">
              La pasada de fondo, en orden: auto-importar → escanear → identificar todo lo pendiente → importar
              escuchas de Last.fm → (si usas Lidarr) sincronizar su snapshot → recalcular discografías y
              completismo → actualizar sellos seguidos → refrescar el radar y las novedades de tu colección
              (Deezer/Spotify) → radar de descubrimiento → sincronizar tu biblioteca de Spotify → auto-descargar
              estrenos. Es lo mismo que hace el botón <strong className="text-neutral-400">«Actualizar todo»</strong>{' '}
              cuando lo pulsas a mano.
            </div>
          </div>
        </div>
      </div>

      <p className="text-xs text-neutral-600 mt-6 max-w-2xl">
        ¿Prisa por ver algo recién descargado? El auto-import ya lo coloca e identifica en minutos. Para forzar la
        pasada completa cuando quieras, usa «Actualizar todo» (arriba a la izquierda).
      </p>
    </div>
  );
}
