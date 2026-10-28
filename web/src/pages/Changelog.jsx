import { useEffect, useState } from 'react';
import { Rocket } from 'lucide-react';
import { api } from '../api.js';
import { PageTitle } from '../components.jsx';

// «Novedades de la app»: resumen curado de lo que se va implementando, versión a versión.
// Va en el menú «How did I get here?». Lo de arriba («En camino») es lo aún sin publicar;
// al hacer bump, esos puntos pasan a su número de versión. Marca en qué versión estás.

const RELEASES = [
  {
    version: '1.7.0',
    title: 'Los discos sin identificar vuelven a intentarlo solos',
    items: [
      'Hasta ahora, un disco que no se identificaba a la primera no se volvía a mirar nunca más: el refresco nocturno solo repasaba los recién escaneados. Cada disco tenía un único intento en toda su vida, y la única forma de darle otro era acordarse de pulsar «Reintentar identificación» y dejar la pasada llegar al final.',
      'Ahora cada noche se repasa una tanda de los que quedaron pendientes. Van primero los que no tienen artista, que son justo aquellos para los que hay algo nuevo que probar: sin artista, la búsqueda por texto no puede hacer nada y solo queda la huella del audio.',
      'La tanda es de 300 por noche y no se toca el mismo disco dos veces en menos de dos semanas, porque cada uno cuesta sus llamadas a MusicBrainz y hasta cuatro huellas. Con una biblioteca de 33.516 álbumes, los 528 sin artista quedan repasados en dos noches y la cola entera da la vuelta en diez.',
    ],
  },
  {
    version: '1.6.2',
    title: 'Las rutas de la API ya se pueden probar',
    items: [
      'Por fuera no cambia nada. Por dentro, arrancar el servidor y registrar las rutas dejan de ser lo mismo: antes, cargar el fichero principal abría el puerto y programaba los cron, así que no había forma de probar una ruta sin levantar la app entera.',
      'Ahora hay diez pruebas que entran por donde entras tú, y las que más importan son las de lo que destruye: borrar del disco no borra sin confirmación expresa y se niega en seco si la carpeta está fuera de tu biblioteca. La prueba deja un fichero fuera a propósito y comprueba que sigue ahí.',
      'Son también las que habrían cazado el fallo de paginación de la versión anterior, que solo aparecía pasando por HTTP. Comprobado volviendo a meter el fallo: la prueba falla.',
    ],
  },
  {
    version: '1.6.1',
    title: 'La base recoge sus propios restos',
    items: [
      '«Identificar y sincronizar» tiene un paso nuevo: recoger lo que se queda suelto en la base. Al borrar un álbum o fusionar una ficha de artista, lo que colgaba de ellos —pistas, etiquetas, créditos, letras, resúmenes, discografías, seguimientos— podía quedarse ahí, porque el esquema no tiene claves ajenas que lo impidan.',
      'Lo que de verdad molestaba: un lanzamiento que guardaba el puntero a una copia tuya ya borrada seguía contando como «lo tienes». No salía entre lo que te falta y la auto-descarga no volvía a pedirlo nunca. Ahora el puntero se suelta y el disco vuelve a contar como ausente.',
      'Es conservador a propósito: solo toca filas cuyo padre ya no existe, y nunca tus álbumes ni tus fichas de artista. Si un disco tuyo se queda sin ficha de artista, lo cuenta y lo dice en Diagnóstico, pero no lo borra: ahí están tus ficheros.',
    ],
  },
  {
    version: '1.6.0',
    title: 'La Discoteca ya no se queda en 500 discos',
    items: [
      'La Discoteca enseñaba los primeros 500 álbumes y no había forma de llegar al resto: con 27.000 discos, eso era el 1,8 % de la colección. Ahora, al llegar abajo, trae más de 500 en 500; hay un botón «Ver más» que dice cuántos quedan, y la cabecera cuenta lo que estás viendo de verdad («1000 de 27.102 álbumes»).',
      'Por el camino salió el motivo de que nunca se hubiera notado: pedir la segunda página devolvía media biblioteca de golpe. Los parámetros llegan de la URL como texto y al recortar la lista se sumaban como texto, así que el corte se iba hasta el final. Queda fijado con tests.',
      'Y ordenar por título o por artista pasa de 3,5 segundos a 0,2 con la biblioteca grande: cada comparación estaba construyendo un comparador de idioma nuevo. Se nota en toda la app.',
      'El orden «aleatorio» tampoco repite discos al traer más: antes barajaba otra vez en cada petición y la segunda tanda podía devolverte lo ya visto.',
    ],
  },
  {
    version: '1.5.0',
    title: 'Se acabaron los cuadros del navegador',
    items: [
      'Los 103 avisos y confirmaciones de la app dejan de ser los del navegador. Aquellos congelaban la pestaña entera mientras estaban abiertos —se paraba hasta el reloj del escaneo—, salían con un «localhost:3861 dice» delante y no se parecían en nada al resto de la interfaz.',
      'Ahora los avisos salen flotando abajo a la derecha, no bloquean nada, se van solos (los errores tardan más), se pueden cerrar a mano y nunca hay más de cuatro. Los mensajes largos respetan sus saltos de línea y hacen scroll si no caben.',
      'Y las preguntas tienen diálogo propio, con el botón diciendo lo que va a hacer («Borrar del disco», «Reemplazar», «Importar igualmente») en vez de «Aceptar», y en rojo cuando no tiene vuelta atrás. Se cancela con Escape o pinchando fuera, y Enter solo confirma si el foco sigue en el botón.',
      'Todo con su variante para el tema claro, que es donde el rojo pálido sobre blanco no había quien lo leyera.',
    ],
  },
  {
    version: '1.4.4',
    title: 'El contenedor ya no tiene por qué ser root',
    items: [
      'Nuevas variables PUID y PGID, las mismas que usan las demás *arr: si las pones en el compose, el contenedor arranca como root, se prepara y baja a ese usuario antes de ejecutar la app. A partir de ahí corre sin privilegios y ni siquiera puede tocar su propio código.',
      'Solo cambia de dueño lo que es suyo (la base de datos, img/ y backups/), nunca la carpeta que montas en /data: en la estructura recomendada esa carpeta es la raíz de tu música y tus descargas. Y antes de soltar el timón comprueba que ese usuario puede escribir ahí; si no puede, se queda como root y te lo dice en el log con el chown exacto que lo arregla.',
      'Si no pones PUID/PGID no cambia nada: sigue arrancando como siempre. Una instalación que ya existe tiene los ficheros de /data creados por root, y cambiarle el usuario a la brava la dejaría sin poder abrir su propia base.',
      'Además, la imagen se construye con npm ci en vez de npm install: instala exactamente lo que dice el lock, así que lleva las versiones parcheadas que se probaron y no otras.',
    ],
  },
  {
    version: '1.4.3',
    title: 'Al día con los parches de seguridad',
    items: [
      'De 16 avisos de seguridad en las dependencias (3 críticos, 10 altos) a 2. El salto gordo es Fastify 4 → 5, que es lo que permite actualizar las dos piezas donde estaban los agujeros de verdad: el servidor de ficheros estáticos (salto de autorización y recorrido de directorios: la app sirve su propia interfaz, así que cualquiera que llegara al puerto lo tocaba) y el lector de subidas de ficheros (denegación de servicio e inyección de CRLF).',
      'También sube el lector de etiquetas (music-metadata 10 → 12), que se quedaba en bucle infinito con un .wma malformado; y eso lo come el escaneo de tu biblioteca. Comprobado antes de subirlo que sigue leyendo igual título, artistas, álbum, pista y disco, año, género, sello, los MBID, el ReplayGain, el formato, la carátula incrustada y la duración.',
      'Los 2 avisos que quedan no se arreglan a propósito: lo que propone npm es bajar la librería que escribe las etiquetas cinco versiones mayores, y el fallo solo aparece de una forma que esa librería no usa.',
      'De paso, un fallo sin motivo propio y por debajo de 500 ya no dice «Error inesperado en el servidor», sino «La petición no se pudo atender (403)».',
    ],
  },
  {
    version: '1.4.2',
    title: 'Cuando algo falla, la app dice qué ha fallado',
    items: [
      'Los avisos de error ya no dicen «Internal Server Error». El servidor siempre tuvo mensajes claros («Falta la carpeta raíz de Lidarr», «No se pudo contactar con Prowlarr»), pero en 72 de sus 205 rutas se perdían por el camino y en pantalla salía el nombre genérico del fallo, que no sirve para nada.',
      'Además, esos fallos quedan apuntados en Diagnóstico —con su traza si fue cosa del servidor—, así que ya no hace falta ir a `docker logs` para enterarte de qué pasó.',
      'Subir un fichero demasiado grande, o mandar algo que no se puede leer, se explica en español en vez de en el inglés de Fastify. Y si el servidor no contesta porque el contenedor se está reiniciando, el aviso lo dice con esas palabras.',
    ],
  },
  {
    version: '1.4.1',
    title: '«Various Artists» deja de llenarte el calendario',
    items: [
      '«Various Artists» ya no se comporta como si fuera un artista. MusicBrainz le acredita decenas de miles de recopilatorios que no son de nadie en particular, y Liderarrr se los bajaba todos: el calendario se llenaba de discos ajenos y su ficha anunciaba cosas como «0 de 27.139 · faltan 27.134».',
      'Ahora esos recopilatorios no salen en el calendario, no cuentan como huecos y no aparecen en novedades; su ficha explica que es el cajón de los recopilatorios, sin barra de completismo ni botón de seguir. Tus discos siguen donde estaban: no se toca ni un fichero.',
      'Pasaba aunque no siguieras a «Various Artists», porque la discografía se refrescaba para todo artista identificado; por eso dejar de seguirlo no servía de nada. Lo que ya estaba guardado se limpia solo al arrancar.',
      'Reconoce también las otras grafías de las etiquetas («VA», «V/A», «AA.VV.», «Varios Artistas», «Recopilatorio»), aunque esa ficha aún no esté identificada, sin tocar a artistas de verdad con nombres parecidos.',
    ],
  },
  {
    version: '1.4.0',
    title: 'La hora del refresco nocturno la pones tú',
    items: [
      'La hora del refresco nocturno ya se elige en Ajustes → Refresco nocturno (0–23, de fábrica las 3 de la madrugada). Estaba clavada a las 03:00 en el código: si a esa hora tu NAS andaba con las copias o transcodificando, no había forma de moverla. El cambio se aplica sin reiniciar.',
      'Esa pasada es la que escanea el disco, identifica lo pendiente, recalcula discografías y completismo, trae tus escuchas y refresca radares y novedades; la misma que el botón «Identificar y sincronizar».',
      'Y ya no se pierde por medio minuto: antes hacía falta que coincidieran la hora Y el minuto en punto, así que un contenedor arrancado a las 03:00:30 se quedaba sin refresco hasta el día siguiente. Ahora basta la hora, corre una vez al día, y si no se dio (app parada, o acabas de cambiar la hora) se lanza pasadas 36 horas.',
    ],
  },
  {
    version: '1.3.3',
    title: 'Enlazar un artista con MusicBrainz ya no choca con su propia ficha duplicada',
    items: [
      'Enlazar un artista con MusicBrainz ya no se atasca con un «UNIQUE constraint failed: artists.mbid» en rojo. Pasaba cuando ya existía otra ficha del mismo grupo con ese MBID —otra grafía del nombre, o la ficha que se creó sola al identificar—, y el MBID solo puede estar en una.',
      'Ahora las dos fichas se funden en una: los discos, los créditos, el seguimiento, la discografía y las novedades pasan a la ficha que tienes delante, la duplicada desaparece y te decimos qué se ha fundido. No se toca ningún fichero tuyo, solo la base de datos.',
      'Y el disco que llega de la otra ficha se cuenta ya como tuyo: antes podía seguir saliendo en «te faltan» porque sus etiquetas usan la otra grafía del artista («Go-Betweens» frente a «The Go-Betweens»). El completismo ya mira las dos.',
    ],
  },
  {
    version: '1.3.2',
    title: 'El envío automático a Lidarr deja de pedir lo que ya tienes',
    items: [
      'Si usas la integración opcional con Lidarr, el envío automático ya no vuelve a encargar discos que acabas de importar. Se fiaba de una marca guardada en la discografía que solo se refresca al volver a enriquecerla; ahora mira tu biblioteca en el momento.',
      'Y al contrario: si esa marca se había quedado puesta, un hueco de verdad no se pedía nunca. Ya no pasa.',
      'Reconoce lo que tienes aunque esté sin identificar, casando por artista y título además de por MBID. Es el mismo criterio que ya usaban la descarga nativa y el calendario.',
    ],
  },
  {
    version: '1.3.1',
    title: 'Los ocultos de un Mac dejan de contar como música',
    items: [
      'Liderarr ya no lee los ficheros ocultos que siembra un Mac. Si tocas la biblioteca desde macOS, al lado de cada canción aparece otro fichero con la misma extensión (la «otra mitad» del fichero, que empieza por ._) y se colaban como pistas: un disco de 10 canciones se veía con 20, la mitad sin título ni número, y encima parecía que le faltaban temas.',
      'Fuera también .DS_Store, .Trashes, .Spotlight-V100, el @eaDir de Synology y la papelera de Windows, tanto al escanear la biblioteca como al importar descargas.',
      'Y se arregla de paso la carátula rota de algunas carpetas: se podía estar cogiendo como carátula un ._cover.jpg, que no es una imagen.',
      'Los títulos que empiezan por puntos siguen intactos: «...And Justice for All» se escanea igual que siempre.',
      'La limpieza es retroactiva: al actualizar, esas pistas fantasma se van de la base una sola vez y los discos afectados recalculan sus cifras en el siguiente escaneo. Tus ficheros no se tocan: solo se borran filas de la base.',
    ],
  },
  {
    version: '1.3.0',
    title: 'Red de seguridad: copias solas y aviso antes de que el disco se llene',
    items: [
      'Liderarrr se hace una copia de la base de datos todos los días, sola. Esto viene de un susto de verdad: el volumen del NAS se quedó sin sitio, SQLite partió la base a mitad de una escritura nocturna y la copia más reciente era una exportación manual de dos meses antes. Se recuperó entera, pero el aviso estaba claro.',
      'La copia va a /data/backups, a la hora que digas (de fábrica las 4 de la mañana) y guardando las últimas que quieras (de fábrica 7). En Ajustes → 6 tienes la lista: copiar ahora, descargar, borrar o volver a una copia de un clic.',
      'No es un simple duplicado del fichero: se usa VACUUM INTO, que saca una instantánea coherente de la base EN USO sin parar la app y la reconstruye desde las tablas. Una copia que termina bien es sana por definición, en vez de ser el calco de una base ya rota. De paso la compacta: 521 MB de base caben en 248 MB de copia.',
      'Y la otra mitad del problema: si quedan menos GB de los que marques donde vive la base (de fábrica 20), te avisa en Ajustes, en Diagnóstico y por notificación. Quedarse sin espacio es justo lo que corrompe una base a mitad de escritura.',
      'Arreglado: una base de datos corrupta ya no deja el contenedor reiniciándose en bucle para siempre. Ahora el arranque lo detecta, explica qué ha pasado, apunta al disco lleno como causa probable, te da los dos caminos para recuperarla y se queda quieto en vez de machacar el disco.',
    ],
  },
  {
    version: '1.2.0',
    title: 'Buen vecino: no pasarse con nadie, y letras',
    items: [
      'Liderarr ya no se pasa del límite de peticiones de los trackers privados. Pasaba de verdad y cuesta un bloqueo: un barrido de «Lo quiero» con 20 discos mandaba 40 peticiones en menos de un segundo, cuatro veces el tope de RED. Ahora van repartidas, con un máximo configurable (de fábrica 6 cada 10 s) en Ajustes → 3f.',
      'No basta con respetar el total: también se separan en el tiempo. Diez de golpe y luego diez segundos parado cumple la norma sobre el papel, pero es justo la ráfaga que hace saltar las alarmas.',
      'El mismo rasero para todo lo demás que sale a la red: ListenBrainz (que además publica su cupo en cada respuesta y ahora se le hace caso), Last.fm, AcoustID y Deezer. Cada uno con el ritmo que pide, y todos a la vista en Diagnóstico — sirve para responder si un tracker te pregunta.',
      'Letras, vía LRCLIB: cada pista tiene su botón en la ficha del disco, y «Buscar letras» las trae todas. Muchas vienen sincronizadas, con sus marcas de tiempo.',
      'Y con «Guardar .lrc» se escriben junto a cada fichero para que las lea tu reproductor de siempre. No toca tu audio ni rompe el hardlink del torrent; hay que activarlo en Ajustes → 4d.',
      'Nuevo botón «No lo quiero» en las recomendaciones: si algo no te encaja, lo vetas y no vuelve a salir en ningún sitio. Se deshace cuando quieras.',
      'El buscador rápido encuentra géneros: escribe «shoegaze» y te lleva a tu shoegaze.',
      'Arreglado: la ficha del disco reventaba al mostrar sus géneros.',
    ],
  },
  {
    version: '1.1.0',
    title: 'Géneros: explora lo que tienes y descubre lo que te falta',
    items: [
      'Nueva sección «Géneros»: tu colección por género, de lo ancho (Rock) a lo concreto (Shoegaze), al estilo del árbol de Roon. Un disco puede estar en varios géneros a la vez.',
      'Al lado de lo tuyo, «lo mejor de este género que aún no tienes»: los discos más escuchados del género en Last.fm quitando los que ya están en tu colección, con ♥ Lo quiero y Descargar. Si no te convence la primera tanda, «Recomendar más» baja otra.',
      'El género sale de las etiquetas de tus ficheros, que vienen en mil grafías distintas (el mismo género en dos idiomas, variantes de caja, compuestos). Se normalizan contra 19 géneros con subgéneros; lo que no se reconoce NO se fuerza a ningún sitio: queda a la vista en «etiquetas sin clasificar».',
      'Y lo colocas tú: pincha una etiqueta sin clasificar y dices a qué género va —o que no es un género—. Cuenta al instante, sin reescanear. También puedes esconder de la portada los géneros que no te interesen.',
      'Desde la ficha de un disco o de un artista, sus géneros son enlaces: «esto es dream pop, ¿qué más tengo de dream pop?».',
      'Dentro de cada género: subgéneros, filtro por década, tus artistas y tus discos ordenables.',
      'La Discoteca filtra ahora por esos mismos géneros: elegir «Rock» ya no deja fuera «rock», «Classic Rock» ni «Hard Rock», que en tus ficheros son etiquetas distintas.',
      'El Resumen se puede acotar a un género: «tu año en shoegaze».',
      'Arreglado: en «Huecos» la fecha de los discos que te faltan salía siempre como «s/f».',
    ],
  },
  {
    version: '1.0.1',
    title: 'Detalles del feedback: fechas, recomendaciones y nombres de release',
    items: [
      'La fecha de los discos que te faltan ya se ve, en «Te faltan N discos» de la ficha de artista y en «Huecos». Antes no aparecía nunca: la lista leía un campo que las discografías de MusicBrainz no tienen.',
      'Las recomendaciones de la ficha ya distinguen lo que tienes de lo que te falta: «Más de X · ya en tu disco» arriba, y debajo «Te falta de X» con su discografía menos tu colección, cada disco con su año, ♥ Lo quiero y Descargar.',
      'En «Buscar y descargar», los nombres de las releases ya no se cortan: la edición, el remaster y el formato van al final del nombre, que era justo lo que se perdía. Ahora se ajustan en varias líneas y el panel es más ancho.',
    ],
  },
  {
    version: '1.0.0',
    title: '1.0 — vivir sin Lidarr, de verdad',
    items: [
      'Liderarr ya no necesita a Lidarr para nada: escanea tu música, la identifica, te dice qué te falta, vigila los estrenos, los descarga solo y los coloca en su sitio.',
      'Nueva página «Streaming»: conecta tu cuenta de Spotify y cruza tus álbumes guardados con tu colección local. Ves lo que tienes en streaming y no en disco (para descargarlo) y lo que tienes en disco y no en streaming (con «Guardar en Spotify» de un clic).',
      'Nuevo botón ♥ «Lo quiero» en cualquier disco que aún no tengas —al buscarlo, en el calendario, en el radar, en los huecos de un artista o en la brecha de streaming—. Liderarr lo busca solo en tus indexers hasta que aparece y lo agarra, aunque no sigas al artista.',
      '«Lo quiero» se adelanta al estreno: empieza a vigilar 16 h antes de la fecha oficial, porque un disco que sale el viernes aparece en los trackers el jueves por la mañana. Un estreno de madrugada te lo encuentras descargado por la mañana, con aviso.',
      'Su lista vive en Lanzamientos → ♥ Lo quiero, con el estado de cada deseo (sale el…, sin release, pedido, ya en tu disco).',
      'Lanzamientos abre ahora en «📅 Mes», la vista panorámica, y en todas sus listas los discos que YA tienes se agrupan arriba plegados («Ya los tienes en disco · N») en vez de mezclarse con lo que te falta.',
      'Cada lanzamiento trae botón a Spotify además del enlace a la fuente, y «Novedades de Spotify» pasa a llamarse «💿 Discos nuevos» (que es lo que es: álbumes y EPs; los singles van en «🎵 Canciones nuevas»).',
      'Arreglado el móvil: en Lanzamientos y Streaming las filas se apilan en pantallas estrechas, así que el título del disco se lee entero y los botones ya no se salen de la pantalla.',
      'El aviso nocturno de novedades ya no repite los mismos estrenos cada día.',
      'El auto-import funciona con cualquier cliente de descargas (Deluge, rTorrent, Transmission…), no solo qBittorrent: barre la carpeta e importa lo que esté completo.',
    ],
  },
  {
    version: '0.9.24',
    title: 'Retos por todas partes, buscador global y más detalle',
    items: [
      '«Añadir a reto» ahora está donde haya un disco: Lanzamientos (todas las pestañas y el calendario), Huecos, Escuchas, la Discoteca (botón al pasar el ratón) y la ficha del disco.',
      'Si un disco ya está en un reto, su botón lo marca en dorado con «En reto» y te dice en cuál(es) — pero puedes añadirlo a otro igualmente.',
      'La barra de búsqueda del Dashboard (tuyo + lo que aún no tienes, con Seguir/Descargar) está ahora también en Huecos, Lanzamientos, Escuchas, Resumen y Retos.',
      'Las notificaciones de «descargas importadas» ahora dicen QUÉ discos entraron, no solo cuántos.',
      'Importar listas por URL (AlbumOfTheYear) es más fiable (reintenta fallos temporales, trae la lista completa) y ya no bloquea: corre en segundo plano con progreso.',
    ],
  },
  {
    version: '0.9.23',
    title: 'Calendario «Mes» con filtros por fuente (singles y Descubre incluidos)',
    items: [
      'La vista «📅 Mes» ahora te deja elegir qué fuentes ver: pulsa cada etiqueta de la leyenda (Próximo, Estreno, Sello, Spotify, Canción, Radar, Descubre) para mostrarla u ocultarla. Tu elección se recuerda.',
      'Se añaden al calendario dos fuentes que antes no estaban: las «🎵 Canciones nuevas» (singles) y el radar «🌐 Descubre» (similares y de tus sellos). Los singles vienen activados; Descubre viene desactivado (para no llenar el mes de artistas que no tienes), pero puedes activarlo con un clic.',
      'En el detalle del día, los eventos de Descubre muestran su porqué («En tu sello X», «Parecido a Y»).',
    ],
  },
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
