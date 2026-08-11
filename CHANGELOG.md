# Registro de cambios — Liderarr

Todo lo notable del proyecto. Principio rector: **tus ficheros mandan, MusicBrainz
anota, Lidarr solo ejecuta.** Nunca borra música.

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/).

---

## [Sin publicar]

### Añadido
- **Sello en la ficha del álbum, junto a «Origen».** Ahora se muestra siempre; si los ficheros no
  traían la etiqueta de sello pero el álbum está identificado, se resuelve de MusicBrainz (cacheado
  y capturado para la vista de Sellos). Enlaza a la página del sello.
- **Corregir el emparejamiento de un álbum ya identificado.** En la ficha, «Corregir emparejamiento»
  reabre el buscador de MusicBrainz para elegir otra referencia cuando lo casó con la equivocada
  (p. ej. un single en vez del álbum), mostrando el tipo de cada candidato.

### Corregido
- **Emparejamiento manual con el tipo/año equivocados.** Al fijar un release-group a mano se
  guardaba el tipo de una búsqueda por título (podía seguir marcándolo «Single» al corregirlo a
  «Álbum»); ahora se lee del release-group elegido por su MBID (tipo, tipos secundarios y año reales).

---

## [0.6.3] — 2026-08-10

Objetivo: renombrar discos mal nombrados y ordenar la biblioteca en lote (limpieza).

### Añadido
- **Renombrar el disco desde la interfaz.** Como el artista, ahora el título del álbum es editable
  (ficha del álbum y «Sin identificar»), para discos mal nombrados que no casan con MusicBrainz;
  al guardarlo en «Sin identificar» se reintenta identificar en el acto. Metadato interno (no toca
  ficheros), protegido de reescaneos.
- **Pestaña «Correcciones».** Reúne todos los álbumes cuyo artista o título has corregido a mano,
  con su carpeta actual y el destino que tendrían en `{artist}/{album} ({year})`. Desde ahí los
  «ordenas en su carpeta» todos a la vez («Mover todos») o uno a uno, como en «Importar». Los que
  no se pueden reubicar (fuera de la biblioteca, caja multidisco) se marcan con el motivo.

---

## [0.6.2] — 2026-08-10

Objetivo: corregir metadatos y ordenar la biblioteca desde la interfaz (limpieza y mantenimiento).

### Añadido
- **Corregir el artista de un álbum desde la interfaz.** En «Sin identificar» cada fila trae el
  artista editable en línea (con sugerencias de tu biblioteca): lo corriges y **se reintenta
  identificar al instante**, así lo que llegó sin etiquetar casa y abandona la lista. También
  editable desde la ficha del álbum. Es un metadato interno (no toca los ficheros) y queda
  protegido: un reescaneo posterior ya no lo pisa con la etiqueta del fichero.
- **Ordenar en su carpeta (re-ubicar en disco).** Acción en la ficha del álbum que mueve su
  carpeta a la estructura configurada `{artist}/{album} ({year})` dentro de la biblioteca —
  para limpiar material antiguo mal archivado (típico tras corregir el artista). Usa `rename`
  en el mismo volumen (conserva inodos: el seeding sobrevive), nunca sale de la biblioteca ni
  toca el origen de descargas, no sobrescribe destino, y actualiza ruta, identidad (`local_key`),
  pistas y carátula. No aplica a cajas multidisco.

### Cambiado
- **Sellos**: los que ya sigues se resaltan (fondo dorado + estrella) para distinguirlos de un
  vistazo de los que aún no sigues.

---

## [0.6.1] — 2026-08-10

Objetivo: seguimiento de sellos, discografía del artista por tipo y herramientas de limpieza de la
discoteca (además de varios arreglos de feedback y de detección).

### Añadido
- **Seguir un sello desde su página.** En la ficha de un sello (Sellos) hay un botón «Seguir
  sello»: lo resuelve en MusicBrainz y lo añade a los seguidos, para que sus lanzamientos salgan
  en el calendario.
- **Sello en la ficha del álbum.** La ficha de un álbum muestra ahora su(s) sello(s), con enlace
  a la página de ese sello.
- **Discografía del artista por tipo.** La colección del artista se agrupa por tipo (Álbumes,
  EPs, Singles, Otros). Además, por artista puedes elegir el **ámbito de completismo**: solo
  álbumes (por defecto) o «álbumes + EPs + singles» — una decisión consciente y persistente, para
  seguir «todo» de unos artistas y solo los discos de otros.
- **Discoteca: filtro «con duplicados»** para ver de un vistazo los álbumes con copias, como
  herramienta de limpieza.
- **Borrar del disco desde la ficha del álbum.** Acción de mantenimiento (no solo para
  duplicados), con los mismos guardarraíles: solo dentro de la biblioteca, nunca `torrents/`,
  irreversible y con confirmación.

### Corregido
- **«Reintentar identificación» sin feedback.** En «Sin identificar» el botón disparaba el proceso
  (que corre en segundo plano) y recargaba la lista al instante, cuando aún no había cambiado nada:
  parecía que no hacía nada. Ahora muestra progreso en vivo (X/Y) y un resumen al terminar
  («N identificados · M siguen sin coincidencia»), y refresca la lista al final.
- **«Por estrenar» obsoleto.** Los discos con fecha ya pasada dejaban de figurar como «por
  estrenar»: el estado se calcula ahora por fecha en vivo, no por un flag guardado que quedaba
  rancio. (Afecta a la ficha de artista y al calendario.)

### Cambiado
- **Favicon** rediseñado fiel al logo punk (monograma «LA» con las cajas recortadas crema/oro y la
  estrella roja, en vez del «L!» genérico anterior).
- **Selector de género de la Discoteca** convertido en un campo con autocompletado (antes era un
  desplegable enorme).
- En el completismo de un sello, el **artista de cada hueco es ahora un enlace** (a su ficha si lo
  tienes, o a MusicBrainz si no).

---

## [0.6.0] — 2026-08-10

Objetivo: mejorar el calendario de lanzamientos (seguimiento y descubrimiento).

### Añadido
- **Calendario de lanzamientos, fase 1.** La página pasa a «Lanzamientos» con dos pestañas:
  **Próximos** y **Estrenados recientemente** (ventana de fechas configurable; por defecto
  este año hasta hoy). En cada fila puedes **seguir al artista** sin entrar en su ficha,
  **buscar/descargar** la release (motor Prowlarr/Jackett) además de enviarla a Lidarr, y se
  muestra la **carátula** (Cover Art Archive). Marca lo que ya tienes y a quién ya sigues.
- **Seguir sellos, fase 2.** Nueva pestaña **«De tus sellos»**: sigues un sello por su MBID de
  MusicBrainz (buscándolo por nombre) y el radar resalta sus estrenos —recientes y futuros—
  **aunque no sigas al artista**. Además, en las pestañas Próximos y Estrenados recientemente
  aparece una **insignia de sello** en las filas que edite un sello que sigues. El catálogo de
  cada sello se refresca en «Actualizar todo».
- **Radar de novedades curadas (Bandcamp), fase 3.** Nueva pestaña **«Radar»**: sigues a
  curadores de [buymusic.club](https://www.buymusic.club) (que publican semanalmente lo mejor de
  Bandcamp) y sus selecciones alimentan un radar afín a tu gusto. Cada ítem cruza con tu
  biblioteca (marca *ya lo tienes*, *sigues al artista*, *sello seguido*) y ofrece abrir en
  Bandcamp, buscar/descargar, o enviarlo a Lidarr **resolviendo su MBID contra MusicBrainz al
  vuelo** (los ítems de Bandcamp no traen MBID). Filtro «ocultar lo que ya tengo» y sección
  aparte para **pre-pedidos / futuros**. Se refresca en «Actualizar todo».

### Corregido
- **Detección de «lo que ya tengo» en retos y radar.** El cruce artista+título era una
  comparación exacta de cadenas y fallaba de forma sistemática: los retos guardaban el año como
  sufijo del título (p. ej. «Marquee Moon - 1977», porque el parser solo entendía «(1977)») y no
  casaba nunca (un reto de 500 salía 0/500); y cualquier morralla del título en disco (carpetas
  tipo «On the Beach (1974) [FLAC 16bit]», ediciones «(Deluxe)»/«(2009 Remaster)») rompía la
  coincidencia. Ahora hay un normalizador de cruce compartido que quita solo morralla inequívoca
  (año, formato, edición) antes de comparar. Los retos ya guardados se corrigen solos al reabrirlos.

---

## [0.5.0] — 2026-08-08

Objetivo: importar listas de agregadores como retos.

### Añadido
- **Importar listas por URL → reto** (AlbumOfTheYear). Como AOTY está tras Cloudflare, se
  descarga vía un lector que ejecuta JS (r.jina.ai); trae la lista **completa** paginando
  (`?p=N`, 50/página) y la ordena por ranking (el nº 1 primero), tomando el título de la
  lista automáticamente. El formulario de «Nuevo reto» ofrece importar por URL o pegar.
  Nota: **RateYourMusic bloquea incluso al lector** (403); desde ahí no se puede por URL, pero
  **sí pegando**: el parser de «pegar» detecta el formato de un chart de RYM copiado (usa la
  línea «Artista - Álbum, Cover art» de cada entrada) y descarta el ruido.
- **Aviso de nueva versión.** Un banner descartable avisa cuando hay una versión más nueva
  que la que corre (compara con los tags publicados en GitHub) y enlaza al CHANGELOG con las
  novedades. Se descarta por versión (reaparece cuando salga otra).

---

## [0.4.0] — 2026-08-08

Objetivo: fiabilidad de la búsqueda y una primera configuración guiada.

### Añadido
- **Jackett como motor de búsqueda alternativo a Prowlarr** (Prowlarr resulta más
  inestable). Selector de motor en Ajustes (Prowlarr | Jackett). Jackett busca vía Torznab
  —resultados en crudo, sin el filtrado de freeleech de Prowlarr— y la descarga la
  materializa **qBittorrent** (nueva integración: login WebUI + añadir magnet/.torrent).
  Secciones nuevas en Ajustes (Jackett, qBittorrent) con botón de prueba.
- **Descartar y borrar del disco** en el panel de copias duplicadas: además de «descartar»
  (oculta, recuperable en Papelera), «descartar y borrar» elimina los ficheros de la copia
  peor. Irreversible, con confirmación dura; solo borra dentro de tu biblioteca (nunca
  `torrents/`), y si no puede (biblioteca en solo lectura) no toca nada. Avisa del seeding.
- **Onboarding en Ajustes (estilo PowaFlex).** Cada sección explicada, y desplegables
  «¿cómo consigo…?» paso a paso por credencial (AcoustID, Discogs, Last.fm, Lidarr, Prowlarr,
  Jackett, qBittorrent) — incluida la preparación de la WebUI de qBittorrent con sus gotchas.
- **El motor de búsqueda elegido se respeta en TODA la UI**, también la búsqueda de la ficha
  de disco (antes estaba fija a Prowlarr). Componentes renombrados a `SearchModal`/`SearchSection`.
- **Fusión suave de sellos por variante** (backlog 0.3): «Jabalina Música» y «Jabalina Musica»
  cuentan como un solo sello (normalización de acentos/mayúsculas), bajo el nombre más
  frecuente y con contador de variantes. Conservador: no toca sub-sellos (Warner ≠ Warner Spain).
- **Cola de envío a Lidarr persistente** (backlog 0.3): sobrevive a reinicios/redespliegues
  (se reanuda al arrancar) y su estado sale en el Diagnóstico (línea «Cola Lidarr» + bloque
  con barra de progreso).
- **Retos: «Buscar» y «Lidarr» por ítem** (backlog 0.3), y el envío en bloque «Faltantes a
  Lidarr» ya no bloquea (resuelve en MB + encola en 2º plano; progreso en la cola de Lidarr).

### Cambiado
- **Los tests de Ajustes guardan primero.** «Probar» persiste la configuración antes de
  probar, así el test siempre usa lo que hay en pantalla (antes fallaba si no habías guardado).

### Corregido
- **qBittorrent 403.** Causa real: qBittorrent 5.x cambió el nombre de la cookie de sesión
  (ya no es `SID`) y el login responde 204; el parseo a `SID=` no la capturaba. Ahora se
  toma la cookie por su nombre real, sea cual sea, y se reenvía. Además se envían `Referer`
  y `Origin` (CSRF) y el error es accionable (apunta a la WebUI: cookie Secure flag / Host).

---

## [0.3.0] — 2026-08-08

### Añadido
- **Logo nuevo** (punk/DIY "Fuck Design"): LIDER en tipos recortados sobre ARRR gritado
  en oro, con grano de fotocopia (SVG, escala sin pixelar). En la cabecera, adaptado a
  claro/oscuro; favicon a juego (sello `L!`).
- **Multidiscos: las cajas cuentan como un solo álbum.** Un box-set/deluxe/antología
  viene como una carpeta por disco (CD 1, CD 2…); como la identidad de álbum es la
  carpeta y las etiquetas llevan el total de la CAJA, cada disco parecía un incompleto
  brutal (7/92) y salían N filas casi iguales. Ahora una columna `disc_group` marca los
  discos de una misma caja y las vistas los colapsan: **Álbumes incompletos** (una fila
  por caja, con badge "caja · N discos"; una caja completa desaparece), **Discoteca** y
  el recuento del **Dashboard**. Detección por carpeta padre + artista + total de caja
  compartido que supera los ficheros, con guardarraíl para no fundir álbumes normales.
  Es **solo lectura** sobre los ficheros; migración no destructiva (`ADD COLUMN`) con
  backfill al arrancar (sin reescaneo completo).
- **Bug de duplicados corregido de paso**: los discos de una caja con el mismo título
  (p. ej. los 8 CD de *Sign O' The Times (Super Deluxe)*) ya no se cuentan como copias
  duplicadas.

### Cambiado
- **Aviso claro en «Escritura de etiquetas»**: marcada como no recomendada, con el peligro
  concreto para tu montaje — con hardlinks de seeding, `media` y `torrents` son el mismo
  inodo, así que escribir una etiqueta cambia el hash y **rompe el torrent**. Se recuerda
  que identificación y completismo funcionan sin tocar los ficheros.

---

## [0.2.0] — 2026-08-07

Hito de **completismo de sello**: la función más nueva queda validada contra sellos
reales (Elefant, Merge, Sub Pop) y se endurecen los puntos frágiles que salieron al
probarla de verdad.

### Añadido
- **Completismo de sello validado de punta a punta.** Cruzar el catálogo de álbumes de
  estudio de un sello en MusicBrainz con tu colección, ver el % que tienes, y enviar lo
  que falta a Lidarr o buscarlo en Prowlarr. Probado con Elefant (60/187): resolución
  nombre→sello correcta, deduplicación releases→release-group correcta (las reediciones
  colapsan al año original), y filtro a solo álbumes de estudio (fuera EPs/singles/comps).
- **La página de Sellos se reengancha a la cola de envío en curso.** Al volver a la
  página (o entrar con un envío ya en marcha) sondea el estado real del backend y muestra
  "procesando X/Y", en vez de parecer que no se hizo nada. La cola siempre corrió en el
  backend; antes solo se perdía la *vista* al cambiar de página.

### Cambiado
- **MusicBrainz reintenta ante 503** con backoff exponencial, respetando la cabecera
  `Retry-After`. Un 503 fugaz (saturación del servicio de MB, no del límite de 1 req/s)
  ya no aborta una operación entera de decenas de llamadas paginadas.
- **Tope de "sello demasiado grande" 800 → 5000 releases.** El tope mide *releases brutas*
  (todas las ediciones/formatos/reediciones/singles/EPs/comps), no álbumes de estudio;
  800 excluía a indies consagrados (Sub Pop ~3200, Merge ~1800) que son justo el caso de
  uso. Ahora solo se excluyen majors de verdad. Coste: hasta ~55 s el peor caso, cacheado
  después.

### Corregido
- **La cola de envío a Lidarr dejaba de dar señales de vida a mitad.** El `catch` del
  worker era mudo: un fallo por ítem (p. ej. Lidarr saturado devolviendo un lookup vacío →
  "no encuentra al artista") desaparecía sin traza, y la cola *parecía* morir. Ahora deja
  rastro en el diagnóstico: log al iniciar, log en **cada** error, y **resumen al terminar**
  (`N enviados · M pend · K error`). Se distingue una cola muerta de una que terminó con
  fallos silenciosos.

---

## [0.1.0] — base

Todo el armazón de la app, construido antes de este registro. Monorepo Node 22 + Fastify +
better-sqlite3 (server, puerto 3861) y React 19 + Vite + Tailwind 4 (web); Docker vía
GitHub Actions.

### Ingesta e identidad
- **Escáner** de la biblioteca con **clave de álbum relativa al root**: cambiar el punto de
  montaje ya no reescanea ni pierde el estado de emparejamiento. Salto incremental por mtime.
- Lee **géneros y sellos** de las etiquetas al escanear (los sellos son tags `type='label'`,
  con filtro de basura: PMEDIA, [no label], N/A…).
- **Cadena de identificación**: MBID en etiquetas → MusicBrainz (texto) → Last.fm → AcoustID
  (último recurso, huella del fichero; caro, desactivable). `cleanAlbumTitle` rescató miles
  de álbumes sin emparejar (quita el artista repetido y los paréntesis de año/edición).
- **Estados de álbum**: matched / pending / unmatched / orphan / dismissed.

### MusicBrainz
- **Cola de 1 req/s con dos carriles**: interactivo (tus clics) adelanta al barrido de fondo
  (identificación y discografías). Todo cacheado en SQLite.

### Ficha de disco e integraciones
- **Ficha de disco**: identificar (auto + "elegir a mano" con candidatos de MB), sección
  Lidarr (envío + búsqueda interactiva de releases), Discogs y sección Prowlarr.
- **Lidarr** como actuador, con **envío no bloqueante** (cola de fondo + progreso "X/Y").
- **Prowlarr** directo (buscar + descargar), puenteando el lento servidor de metadatos de
  Lidarr.
- **Last.fm** (escuchas), **Discogs** (ediciones/upgrades), **AcoustID** (huellas).

### Colección
- **Duplicados**: detección difusa, recomendación de la mejor copia, descartar + **Papelera**
  con deshacer. Colapso con badge ×N y panel compartido en artista, Discoteca y sellos.
- **Importador por hardlink** (torrents → media): plantilla de naming, "importar todo",
  detección de pendientes por `nlink`, fallback a copia.
- **Carátulas no bloqueantes**: local/caché al instante + resolución cara en 2º plano, con
  placeholder de carga.
- **Enlaces a MusicBrainz** por toda la app.

### Estabilidad
- Fijado **Node 22 LTS** (Node 24 provocaba un crash nativo de better-sqlite3).
- Consultas pesadas fuera del hilo principal (analítica en memoria) para no bloquear el
  event loop.

### Páginas
Dashboard, Discoteca, Ficha de disco, Artistas, Álbumes incompletos, Calidad, Sin
identificar, Rarezas, Seguidos, Huecos, Próximos lanzamientos, Escuchas, Retos, Upgrades,
Sellos, Importar descargas, Papelera, Diagnóstico, Ajustes.
