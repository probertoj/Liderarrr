import { useEffect, useState } from 'react';
import { Rocket } from 'lucide-react';
import { api } from '../api.js';
import { PageTitle } from '../components.jsx';

// «Novedades de la app»: resumen curado de lo que se va implementando, versión a versión.
// Va en el menú «How did I get here?». Lo de arriba («En camino») es lo aún sin publicar;
// al hacer bump, esos puntos pasan a su número de versión. Marca en qué versión estás.

const RELEASES = [
  {
    version: '0.9.22',
    title: 'El radar «Descubre» también mira tus sellos seguidos',
    items: [
      'El radar «🌐 Descubre» añade una fuente: los estrenos recientes de artistas de tus SELLOS seguidos (vía Deezer), aunque no sigas al artista.',
      'Nuevo nivel «De tus sellos seguidos» entre «sigues/tienes» y «parecido a lo que escuchas», con la razón «En tu sello X».',
    ],
  },
  {
    version: '0.9.21',
    title: 'El radar «Descubre» ahora sí trae cosas (vía Deezer)',
    items: [
      'Arreglo del radar «🌐 Descubre»: Spotify ha restringido su feed «New Releases» (403 en apps nuevas), así que en 0.9.20 salía vacío. Ahora la fuente principal son los estrenos recientes de tus artistas PARECIDOS (similares de Last.fm) vía Deezer, que es fiable y sin límites.',
      'Spotify queda como suplemento opcional: si su feed responde, se añade; si no, el radar funciona igual y te lo indica.',
      'El barrido corre en segundo plano con progreso (artistas afines sondeados) y cachea el id de Deezer de cada similar para no re-buscar.',
    ],
  },
  {
    version: '0.9.20',
    title: 'Radar de descubrimiento (novedades globales por afinidad)',
    items: [
      'Nueva pestaña «🌐 Descubre» en Lanzamientos: novedades globales de Spotify de CUALQUIER artista, no solo los tuyos, ordenadas por afinidad contigo.',
      'Se agrupan en tres niveles: primero lo de artistas que sigues o tienes en la colección, luego lo parecido a lo que escuchas (similares de Last.fm), y —si marcas «También sin relación»— el feed entero para descubrir grupos nuevos.',
      'Ventana Hoy / 7 / 14 / 30 días, oculta por defecto lo que ya tienes, y cada novedad trae enlace a Spotify + botones Buscar/Descargar. Se llena en el refresco nocturno o con «Buscar novedades ahora».',
    ],
  },
  {
    version: '0.9.19',
    title: 'Canciones nuevas de toda tu colección',
    items: [
      'Canciones nuevas: el radar de singles ya no mira solo a tus artistas SEGUIDOS, sino a TODOS los de tu colección (los sigas o no). Antes, un single de un artista que tienes pero no seguías —p. ej. una novedad de Olivia Rodrigo— no aparecía nunca.',
      'Como la colección puede tener miles de artistas, el barrido es por rotación (varias pasadas la cubren entera) y cachea el id de Deezer de cada artista para no re-buscarlo cada vez. Los seguidos se miran en cada pasada.',
      '«Buscar novedades ahora» ya no bloquea: lanza el barrido en segundo plano y muestra el progreso (artistas sondeados y novedades encontradas) mientras la lista se va rellenando.',
      'Recordatorio en la propia pestaña: las canciones que salen dentro de un álbum recién estrenado aparecen en «Estrenados recientemente», no en «Canciones nuevas» (que es solo para singles sueltos).',
    ],
  },
  {
    version: '0.9.18',
    title: 'Canciones nuevas, copias de cajas y navegación',
    items: [
      'Lanzamientos: nueva pestaña «🎵 Canciones nuevas» con los singles que sacan tus artistas seguidos, con filtro Hoy / Últimos 7 días / Últimos 30 días. (La vista de discos sigue mostrando solo álbumes.)',
      'Cajas multidisco: las distintas copias del mismo disco (una carpeta con todo, o en varios CDs) se reconocen como copias en «Copias de este disco» y se pueden descartar de una vez; ya no aparecen como ediciones distintas.',
      'Discoteca: al buscar, entrar a un disco y darle «atrás» en el navegador, vuelves a tu búsqueda en vez de a la lista completa.',
      'En Lanzamientos y Canciones nuevas, botón directo a Spotify/Deezer junto a Buscar/Descargar.',
      'Identificar cajas: se limpian del título los sufijos de disco de la carpeta («CD1», «(Disc 2)»…), así se identifican cajas que antes fallaban.',
    ],
  },
  {
    version: '0.9.17',
    title: 'Multidiscos, copias y móvil',
    items: [
      'Multidiscos: las cajas se auto-agrupan también por los tags DISCNUMBER (no solo por el nombre de carpeta), completando cajas cuyo disco suelto no se llamaba «CD N». Con salvaguarda para no fundir copias del mismo disco.',
      'Una caja se puede identificar como UNA unidad en MusicBrainz («Identificar caja» en la ficha) y muestra «N de M discos» — así ves si te falta algún disco de la caja.',
      'Copias de un disco: botón «★ Marcar como la mejor» para elegir a mano cuál conservar (cuando empatan), y una explicación de por qué una es la mejor.',
      'Móvil: el menú lateral ya se puede ocultar en horizontal, y los nombres largos que se cortaban ahora se ven enteros al no caber (en pantallas táctiles).',
    ],
  },
  {
    version: '0.9.16',
    title: 'AcoustID más fino y seguro',
    items: [
      'Identificación por huella de audio (AcoustID) con consenso multipista: en vez de fiarse de una sola pista, huella varias y elige el disco que aparece en más de ellas. Mucho más certero para los «Artista desconocido» (donde el título no ayuda).',
      'Arreglo importante: al identificar un disco de la ficha compartida «Artista desconocido», ahora se le crea su propia ficha de artista y se mueve solo ese disco — antes se corría el riesgo de asociar cientos de discos al artista equivocado.',
      'Sube el umbral de confianza de AcoustID (menos coincidencias débiles). Para usarlo: Ajustes → API key de AcoustID + activar «Usar AcoustID al identificar», y «Reintentar identificación». No modifica tus ficheros.',
      'En «Sin identificar», botón «Reintentar» por disco (además del masivo de arriba): re-lanza la identificación de un solo disco, útil tras activar AcoustID o corregir el artista/título.',
    ],
  },
  {
    version: '0.9.15',
    title: 'Identificar recopilatorios (Various Artists)',
    items: [
      'Los discos etiquetados como «Varios / Various / VA / AA.VV.» ahora se buscan acotados a «Various Artists» en MusicBrainz, así que se identifican recopilatorios que antes se quedaban fuera (La Bola de Cristal, El Planeta de los Ritmos, bandas sonoras…).',
      'Se exige coincidencia EXACTA del título para no confundir un recopilatorio genérico con un volumen concreto equivocado (p. ej. un «Momentos Rockdelux» cualquiera con el volumen de otro año). Cero falsos positivos.',
    ],
  },
  {
    version: '0.9.14',
    title: 'Mejor identificación en MusicBrainz',
    items: [
      'La búsqueda en MusicBrainz limpia mejor el título: quita sufijos de edición de la misma obra (Remasterizado, Deluxe, Edición, Reissue, Versión, bandas sonoras…) y prefijos («2021 - », «1. »). Recupera discos que antes se quedaban sin identificar por el sufijo.',
      'Nuevo respaldo por título: si «artista + título» no casa, busca solo el título y acepta el resultado si el artista coincide al normalizar el nombre. Arregla variantes como ACDC↔AC/DC, acentos y signos.',
      'Se mantiene el criterio de cero falsos positivos: no toca sufijos arriesgados (Live/Remix) y exige verificación de artista. Pulsa «Reintentar identificación» en «Sin identificar» para reprocesar lo pendiente.',
    ],
  },
  {
    version: '0.9.13',
    title: '«Siguiente por escuchar» en Retos',
    items: [
      'La página de Retos muestra arriba «Siguiente por escuchar de tus retos»: el próximo disco de CADA reto que ya tienes y aún no has oído (uno por reto, con el nombre del reto), para ir directo a escucharlos.',
    ],
  },
  {
    version: '0.9.12',
    title: 'Arreglo: menús de la ficha',
    items: [
      'En la ficha de disco, los menús opcionales del botón «⋯» (Multidisco, Versiones, etc.) ahora se ocultan al volver a pinchar la misma opción; antes solo se abrían.',
    ],
  },
  {
    version: '0.9.11',
    title: 'Importar (restaurar) la base de datos',
    items: [
      'Ajustes → Copia de seguridad: ahora además de descargar la base puedes RESTAURARLA subiendo un .db que exportaste antes. Red de seguridad por si una actualización deja la base rara.',
      'Al restaurar se valida el fichero, se guarda un respaldo automático de la base actual y la app se reinicia para aplicar el cambio (en el NAS con Docker vuelve sola en segundos).',
      'La descarga de la base ahora vuelca antes el WAL, para que la copia incluya siempre las escrituras más recientes.',
    ],
  },
  {
    version: '0.9.10',
    title: 'Bootlegs con espacio propio',
    items: [
      'Las «rarezas» se dividen en dos: rarezas (demos, maquetas, inéditos, tomas perdidas) y bootlegs (directos no oficiales, sesiones de radio, ROIOs), cada uno con su página y su distintivo.',
      'Marca un disco como rareza o como bootleg desde su ficha o desde «Sin identificar»; nueva sección «Bootlegs» en el menú y filtro «Bootleg» en la Discoteca.',
      'Ambos cuentan en tus estadísticas pero no en el completismo (igual que antes las rarezas). Tus rarezas actuales se quedan como están; reclasifica a bootleg las que quieras.',
    ],
  },
  {
    version: '0.9.9',
    title: 'Crear fichas en MusicBrainz',
    items: [
      'Discos que no están en MusicBrainz: botón «Crear ficha en MusicBrainz» que abre su editor ya relleno con la tracklist, duraciones, artista(s), año y sello de tu copia — revisas, confirmas con tu sesión de MB y listo. Devolvemos a la comunidad lo que la app aprovecha de ella.',
      'Al guardar la ficha, MusicBrainz te devuelve a Liderarr: el álbum se enlaza solo (deja de estar «sin identificar») y puedes subir la portada con un clic (con el userscript Enhanced Cover Art Uploads) e importarlo en record.club.',
      'Aviso de posible duplicado antes de crear: si MusicBrainz ya tiene algo casi idéntico, te ofrece enlazarlo en vez de duplicar.',
      'El botón está en la ficha del disco y, por fila, en «Sin identificar» para sembrar sin entrar disco a disco.',
    ],
  },
  {
    version: '0.9.8',
    title: 'Motor de descargas y escuchas',
    items: [
      'ListenBrainz como fuente de escuchas (alternativa o complemento a Last.fm): Escuchas, Resumen y retos cuentan las dos.',
      'Auto-import: ahora también coge los torrents de un solo fichero (singles/remixes), no solo carpetas.',
      'Auto-descarga: cruce de propiedad EN VIVO (no re-descarga lo que ya tienes) y, si «artista título» no casa, reintenta con el título.',
      'Auto-import: los torrents sin música (software/ebooks) se saltan en silencio, sin salir como error.',
      'Exportar listas M3U (un reto o tus «no escuchados») para tu reproductor.',
      'Novedades de Spotify: casilla «mostrar también los que ya tengo»; y mejor detección de lo que ya posees en todo el calendario.',
      'Resumen: las portadas del mosaico tienen respaldos (Deezer → Last.fm → Cover Art Archive).',
    ],
  },
  {
    version: '0.9.7',
    title: 'Resumen con portadas',
    items: [
      'Resumen: crea el de la semana, el mes, 3 meses, un año concreto o todo — con un mosaico de las portadas de tus discos más escuchados (locales o de Deezer si no los tienes).',
      'Resumen: botón «Descargar imagen» para compartir tu mosaico como PNG.',
    ],
  },
  {
    version: '0.9.6',
    title: 'Avisos, resumen y recomendaciones',
    items: [
      'Notificaciones por webhook (Discord / Slack / ntfy): aviso al importar descargas y de novedades de tus artistas (Ajustes → Notificaciones).',
      'Resumen tipo Wrapped: tu año en música — top artistas/álbumes, totales, evolución por mes y discos añadidos (menú Losing My Edge).',
      'Recomendaciones en la ficha: «Discos que quizá te gusten» de artistas afines que aún no tienes, con seguir/descargar.',
      'Escuchas: «Los más escuchados» con rango de fechas (semana / mes / 3 meses / año / todo).',
      'Búsqueda: arreglado el caso de artistas colaborativos — si la cadena entera no da resultados, reintenta con el título (y limpia «&»).',
    ],
  },
  {
    version: '0.9.5',
    title: 'Retos por todas partes',
    items: [
      'Ficha de disco: botón «Añadir a reto» para meterlo en uno de tus retos activos.',
      'Discoteca (y demás rejillas): clic derecho en una tarjeta → añadir a reto.',
      'Retos: importar listas de Hip Hop Golden Age por URL (sus páginas /list/…).',
    ],
  },
  {
    version: '0.9.4',
    title: 'Calendario mensual',
    items: [
      'Lanzamientos: nueva vista «📅 Mes», una rejilla mensual estilo Google Calendar que junta en su día TODAS las fuentes: Próximos, Estrenados recientemente, De tus sellos, Radar y Novedades de Spotify.',
      'Novedades de Spotify: cruce robusto con tu biblioteca — ya no aparecen discos que ya tienes (casa por artist_id además de por nombre, y filtra en vivo al mostrar).',
    ],
  },
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
