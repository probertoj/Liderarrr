# Registro de cambios — Liderarr

Todo lo notable del proyecto. Principio rector: **tus ficheros mandan, MusicBrainz
anota, Lidarr solo ejecuta.** Nunca borra música.

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/).

---

## [Sin publicar]

### Añadido
- **Integración con tu biblioteca de Spotify (la brecha disco ↔ streaming)** — la feature de
  1.0. Conectas tu cuenta por **OAuth de usuario** (solo lectura, `user-library-read`) y
  Liderarr cruza tus **álbumes guardados** en Spotify con tu colección local:
  - Nueva página **«Streaming»**: dos lados. **En Spotify, no en tu disco** → botón Descargar
    (+ enlace a Spotify, + «Añadir a reto»). **En tu disco, no en Spotify** → «Guardar en
    Spotify» (abre el buscador de Spotify para que lo añadas). Con contadores (guardados /
    en disco / en ambos / en la brecha).
  - **Conexión en Ajustes → «Biblioteca de Spotify»**: flujo «pega el código» (por las reglas
    de Spotify 2025, el redirect debe ser HTTPS o loopback `http://127.0.0.1:puerto`; una IP de
    LAN no vale). El usuario registra el redirect que se le indica, aprueba, y pega el `code`.
    Si sirve Liderarr por HTTPS y registra `…/callback`, se completa solo.
  - Backend: `spotifyuser.js` (OAuth code + refresh token cifrado, `refreshSpotifyLibrary`,
    `spotifyGap`), tabla `spotify_saved_albums`, rutas `/api/spotify/user/*`,
    `/api/spotify/library/refresh[/status]`, `/api/spotify/gap`, y paso nocturno para
    resincronizar la biblioteca. Refresco de biblioteca no bloqueante con progreso.
  - El lado «en tu disco, no en Spotify» puede tener miles de álbumes: **filtro de texto +
    render por lotes** («Mostrar más») para que no congele el navegador.
  - Toggle opcional **«Solo álbumes»**: deja fuera singles/EPs/recopilatorios (streaming por
    `album_type` de Spotify; local por `primary_type`). Apagado por defecto.
  - **«Guardar en Spotify» de un clic** en el lado «en tu disco, no en Spotify»: busca el álbum
    en Spotify y lo añade a tu biblioteca (scope `user-library-modify`). Si conectaste solo con
    lectura, avisa de reconectar. Queda el enlace ↗ para hacerlo a mano. Maneja el 429
    (rate-limit) con reintentos y Retry-After.
  - **El catálogo (Canciones nuevas / Descubre) ya no usa Spotify, solo Deezer.** Antes se
    consultaba Spotify artista por artista de la colección (miles de peticiones), lo que agotaba
    la cuota de la app —capada en «modo desarrollo»— y provocaba 429 al usar la biblioteca de
    Spotify. Deezer ya cubre eso, así que la cuota de Spotify queda para sincronizar/guardar.
  - Si Spotify redirige con `error=…` (p. ej. `server_error` por app en modo desarrollo con la
    cuenta sin añadir a «User Management», o `access_denied`), la app lo detecta y da un mensaje
    accionable en vez de «no encontré el código».

---

## [0.9.24] — 2026-08-30

**Retos por todas partes (con marca «En reto»), buscador global, notificaciones detalladas y
mejor importación de listas.**

### Arreglado
- **Importar listas de AlbumOfTheYear más robusto**: el lector (r.jina.ai) devuelve a veces un
  404/429/5xx TEMPORAL para AOTY y la importación fallaba en seco. Ahora se **reintenta** con
  backoff en esos códigos (solo 401/403 —bloqueo real de bots, p. ej. RateYourMusic— falla sin
  reintentar). Además, las listas de tipo «ratings»/«genre» (…/2000s/1) **paginan por el
  número del path**, no por `?p=N`, así que ahora traen la lista completa (p. ej. 500 álbumes
  de «highest rated 2000s»). Un fallo en páginas posteriores ya no tira toda la importación:
  se queda con lo recogido.

### Añadido
- **«Añadir a reto» coherente en toda la app**: botón «Reto» (componente reutilizable
  `AddToChallengeButton`, envuelve `ChallengeContextMenu`) allá donde aparece un disco:
  - **Lanzamientos**: todas las filas (Próximos, Estrenados, Sellos, Novedades, Canciones
    nuevas, Descubre, Radar) y el detalle del calendario «Mes».
  - **Huecos**: cada álbum que te falta.
  - **Escuchas**: la brecha escucha↔propiedad y «Los más escuchados» (icono al pasar el ratón).
  - **Discoteca**: botón visible en la carátula al pasar el ratón (además del clic derecho).
  - **Ficha del disco**: unificada al mismo botón compartido (antes tenía su propio desplegable).
  - **Marca de pertenencia**: si un disco ya está en algún reto, el botón lo indica (trofeo
    dorado + «En reto», con el/los reto(s) en el tooltip) y el menú señala con un check el reto
    que ya lo contiene — sin impedir añadirlo a otro. Nuevo `GET /api/challenges/membership`
    (matchKey→retos), hook `useChallengeMembership` cacheado y compartido (una sola petición,
    todos los botones se actualizan al añadir), y `web/src/matchkey.js` portado del servidor.
- **Buscador rápido en más páginas**: la barra de búsqueda del Dashboard (colección + externo
  en MusicBrainz, con Seguir/Descargar) está ahora también en **Huecos, Lanzamientos, Escuchas,
  Resumen y Retos**. El componente `QuickSearch` se extrajo de `Dashboard.jsx` a
  `components.jsx` para reutilizarlo.

### Cambiado
- **Notificación de importación detallada**: el aviso «descargas importadas» ahora enumera
  QUÉ discos entraron («Artista — Álbum», uno por línea; recorta con «…y N más» si son muchos)
  en vez de solo el número. `autoimport.js` recoge los ítems de la pasada
  (`autoImportStatus.importedItems`) y los lista en `sendNotification`.
- **Importar listas por URL en segundo plano**: AOTY se lee página a página por el lector
  (puede tardar minutos), así que ya no bloquea. `POST /api/challenges/import` lanza y devuelve
  al instante (409 si ya hay una en curso); `GET /api/challenges/import/status` da el progreso
  (página · nº de álbumes) y la UI lo muestra («Importando… página N · X álbumes») y recarga al
  terminar.

---

## [0.9.23] — 2026-08-25

**Calendario «Mes» con filtros por fuente (incluye singles y Descubre).**

### Añadido
- La vista **«📅 Mes»** incorpora dos fuentes que faltaban: **singles** («Canciones nuevas»,
  `api.newSongs`) y el radar **«Descubre»** (`api.globalReleases`). Antes solo mostraba
  álbumes/EPs (Próximos, Estrenados, Sellos, Radar, Novedades de Spotify —que excluye singles).
- **Filtros por fuente**: la leyenda pasa a ser una fila de **toggles** (Próximo, Estreno,
  Sello, Spotify, Canción, Radar, Descubre); cada uno muestra/oculta su tipo y la elección se
  **persiste** en `localStorage`. Por defecto: todo activado menos «Descubre» (opt-in, para no
  llenar el mes de artistas que no tienes).
- El detalle del día muestra la razón de afinidad de los eventos de Descubre («En tu sello X»,
  «Parecido a Y»).

---

## [0.9.22] — 2026-08-25

**«Descubre» suma los artistas de tus sellos seguidos.**

### Añadido
- El radar de descubrimiento añade una **fuente**: los artistas del catálogo de tus **sellos
  seguidos** (`label_release_groups.artist_credit`). Se sondean sus estrenos recientes en
  Deezer igual que los similares, aunque no sigas al artista.
- **Nuevo nivel de afinidad «De tus sellos seguidos»** (score 70, entre «sigues/tienes» 90 y
  «parecido» 50), con la razón «En tu sello {nombre}». Si un artista es similar Y de un sello,
  gana el sello.

### Técnico
- `globalradar.js`: `buildAffinity()` añade `labelArtists` (normName → nombre de sello);
  `scoreRelease()` reescrito para quedarse con la mejor señal; las semillas del barrido son
  ahora `artist_suggestions ∪ label_release_groups.artist_credit` (sin duplicar).

---

## [0.9.21] — 2026-08-25

**El radar «Descubre» ahora sí trae resultados: fuente vía Deezer.**

### Cambiado
- **Fuente del radar de descubrimiento reescrita.** Spotify ha restringido su feed
  `/browse/new-releases` (403 en apps creadas tras nov-2024), por lo que en 0.9.20 la pestaña
  «🌐 Descubre» salía vacía aunque el token de Spotify fuera válido. Ahora la **fuente
  principal** son los estrenos recientes (≤45 días) de tus **artistas similares**
  (`artist_suggestions`, similares de Last.fm) obtenidos vía **Deezer** —sin API key, el mismo
  camino fiable que «Canciones nuevas»—. Spotify queda como **suplemento best-effort**: si su
  feed responde se añade, si no el radar funciona igual y la UI lo indica.
- El barrido de «Descubre» ahora corre **en segundo plano con progreso** (no bloquea): nuevo
  `GET /api/globalreleases/refresh/status`, y `POST /api/globalreleases/refresh` lanza y
  devuelve al instante. Cachea el id de Deezer de cada similar (30 días) para no re-buscar.

### Técnico
- `globalradar.js`: `refreshGlobalReleases()` itera `artist_suggestions` → `deezerArtistAlbums`
  (exportada ahora desde `newreleases.js`), con `cachedDeezerId()` (cache genérica) y
  `globalRefreshStatus`. La afinidad se sigue calculando en vivo al leer.

---

## [0.9.20] — 2026-08-25

**Radar de descubrimiento: novedades globales por afinidad («otros grupos»).**

### Añadido
- **Nueva pestaña «🌐 Descubre»** en Lanzamientos: el feed editorial **New Releases** de
  Spotify, de **cualquier** artista (no solo los tuyos), ordenado por **afinidad** contigo.
- **Tres niveles de afinidad** (calculados EN VIVO al leer, no guardados): _De artistas que
  sigues o tienes_ (100/90), _Parecido a lo que escuchas_ (50, vía similares de Last.fm en
  `artist_suggestions`), y _Descubrimiento sin relación directa_ (0, oculto salvo que marques
  «También sin relación»). Cada fila explica el porqué («Sigues a X», «Parecido a Y»).
- Ventana Hoy / 7 / 14 / 30 días; oculta por defecto lo que ya tienes; enlace a Spotify +
  Buscar/Descargar/Descartar por fila.
- Backend: tabla `global_releases`, módulo `globalradar.js`
  (`refreshGlobalReleases`/`globalReleases`/`dismissGlobalRelease`), `spotifyNewReleases()` en
  `spotify.js` (pagina el feed, con todos los artistas acreditados para cruzar afinidad),
  rutas `GET/POST /api/globalreleases[...]`, y nuevo paso nocturno en `refresh.js` (si Spotify
  está configurado). Deezer no tiene feed global fiable (su API editorial devuelve 0), así que
  la fuente es Spotify.

---

## [0.9.19] — 2026-08-25

**Canciones nuevas de toda tu colección (no solo los seguidos).**

### Cambiado
- **El radar de «Canciones nuevas» cubre ahora TODA tu colección**, no solo los artistas
  que sigues. Antes, `refreshExternalReleases` sembraba únicamente desde `tracked_artists`,
  así que un single de un artista que tienes en la biblioteca pero no seguías (p. ej. una
  novedad de Olivia Rodrigo) no aparecía jamás. Ahora la semilla es **seguidos ∪ colección**
  (artistas con álbumes no descartados).
- Como la colección puede tener **miles** de artistas, el barrido es **por rotación**: cada
  pasada sondea a los seguidos (siempre) más un lote de la colección ordenado por «el que
  lleva más tiempo sin mirarse» (`artists.ext_checked_at`), con throttle para respetar el
  límite de Deezer. Varias pasadas (nocturnas o manuales) cubren la colección entera.

### Añadido
- **Caché del id de Deezer por artista** (`artists.deezer_id`, `deezer_checked_at`): se
  resuelve una vez y se reutiliza, en vez de re-buscar en cada refresco. `-1` marca «buscado
  y no hallado» y se reintenta pasado un mes.
- **Refresco de novedades no bloqueante**: `POST /api/newreleases/refresh` lanza el barrido
  en segundo plano y devuelve al instante; nuevo `GET /api/newreleases/refresh/status` con
  progreso (artistas sondeados, novedades nuevas). El botón «Buscar novedades ahora» sigue el
  avance y va rellenando la lista.

### Notas
- Las canciones que salen **dentro de un álbum** recién estrenado se clasifican como `album`
  en Deezer/Spotify y aparecen en «Estrenados recientemente», no en «Canciones nuevas» (que
  es solo para singles sueltos). Se aclara en el texto de la pestaña.

---

## [0.9.18] — 2026-08-25

**Canciones nuevas (singles), copias de cajas y navegación.**

### Añadido
- **Canciones nuevas (singles) en Lanzamientos**: nueva pestaña «🎵 Canciones nuevas» que
  lista los **singles** recién publicados por tus artistas seguidos (Deezer/Spotify), con
  ventana **Hoy / Últimos 7 días / Últimos 30 días**. Antes los singles se descartaban; ahora
  se guardan (`record_type='single'`, retención 45 días) pero **no** ensucian la vista de
  discos (esa sigue mostrando solo álbumes/EPs). Endpoint `GET /api/newsongs?days=N`.
- **Botón a Spotify/Deezer** en las filas de Lanzamientos y «Canciones nuevas»: el enlace a
  la fuente ahora es un botón etiquetado (p. ej. «Spotify»), junto a «Buscar»/«Descargar».

### Mejorado
- **Identificar cajas**: al buscar una caja en MusicBrainz se quitan del título los sufijos de
  disco de la carpeta («… CD1», «… (Disc 2)», «… Disco 3», «… (1)»), así se identifican cajas
  que antes fallaban (p. ej. *Los Amaya … CD1*, *Steve McQueen (CD 1)*, *OK Computer (2)*).
  Conservador: no toca números que son parte del título («M83», «1984», «Blade Runner 2049»).

### Cambiado
- **Copias de una caja multidisco**: las distintas representaciones de la MISMA release
  (misma en una carpeta de N pistas, la misma en N carpetas de disco, etc.) ahora se
  reconocen como **copias** en «Copias de este disco» (una caja se muestra como una fila
  «caja de N discos») y se pueden descartar/borrar de una vez. Ya no aparecen como
  «Otras ediciones» distintas. (Conservador: solo agrupa contenido idéntico —mismo nº de
  discos y de pistas—, así no mezcla una original con su deluxe ni una copia parcial.)

### Arreglado
- **Discoteca**: la búsqueda y los filtros ahora viven en la URL (`?q=…`), así que al entrar
  a un disco y volver con «atrás» del navegador se **restaura tu búsqueda** en vez de la
  vista global.

---

## [0.9.17] — 2026-08-25

**Multidiscos (modelo Roon), copias y pulido de móvil.**

### Añadido
- **Multidiscos por DISCNUMBER**: la auto-agrupación de cajas ya no depende solo del nombre
  de carpeta; ahora agrupa discos hermanos por sus **tags** (mismo álbum/artista + DISCTOTAL,
  con números de disco distintos), completando cajas cuyo disco suelto no se llamaba «CD N»
  (p. ej. «Coser i cantar (1)» + «(Disc 2)»). Salvaguarda anti-duplicados (dos «disc 1» =
  copias, no se funden). No toca ficheros. (Medido sobre una biblioteca real: +119 discos
  recuperados en 53 cajas, sin falsos.)
- **Cajas identificadas como una unidad en MusicBrainz**: una caja multidisco se puede
  identificar como **un release-group / release** de MB (botón «Identificar caja» en la
  ficha) y muestra el completismo a nivel de caja: **«N de M discos»** (M = nº de medios de
  la edición de MB, o el DISCTOTAL de las etiquetas). Nueva tabla `disc_boxes`. Cero falsos
  (exige score≥80 en la búsqueda del RG).
- **«Copias de este disco»**: ahora puedes **elegir a mano** cuál es la mejor con el botón
  **«★ Marcar como la mejor»** (gana sobre el criterio automático; útil cuando las copias
  empatan). Reversible con «usar la automática». Nueva columna `albums.preferred_copy` +
  `POST /api/albums/:id/prefer`. Y una **explicación** de por qué una copia es la ★ mejor
  (más completa → sin pérdida → más pistas → mayor tamaño; o «empatadas, elegida
  automáticamente»).
- **Nombres largos en táctil**: en móvil/tablet (sin hover) los títulos que se cortaban con
  «…» ahora **se ajustan a varias líneas** para verlos enteros (`clamp-mobile` bajo
  `@media (hover: none)`); en escritorio se siguen cortando, con tooltip al pasar el ratón.

### Arreglado
- **Móvil en horizontal**: el menú lateral ya se puede **ocultar**. El corte del shell pasa
  de `md` (768px) a `lg` (1024px), así que el móvil apaisado —cuyo ancho supera 768px— usa
  el drawer plegable (con hamburguesa) en vez de una barra fija imposible de cerrar.

---

## [0.9.16] — 2026-08-25

**AcoustID (huella de audio) más fino y seguro.** AcoustID **no** modifica tus ficheros:
solo los lee para calcular la huella; el resultado va a la base de datos.

### Añadido
- **Consenso multipista** en la identificación por AcoustID (`identify.js`): en vez de fiarse
  de una sola pista (una grabación aparece en muchos discos: álbum + recopilatorios), se
  huellan hasta 4 pistas y gana el release-group que aparece en **más** de ellas, exigiendo
  que **≥2 coincidan**. El disco real es el único RG común a varias pistas.
- Umbral de score de AcoustID subido a **0.8** (menos coincidencias débiles).
- **«Sin identificar»**: botón **«Reintentar» por disco** (además del masivo), que re-lanza la
  cadena de identificación de un solo álbum. Útil tras activar AcoustID o corregir datos.

### Arreglado
- **Corrupción de la ficha comodín «Artista desconocido»**: `anchorArtist` escribía el MBID
  del artista resuelto sobre la ficha compartida por cientos de discos, arrastrándolos todos
  a un mismo artista. Ahora, si la ficha es un comodín (Artista desconocido / Various /
  Unknown…), se **crea una ficha propia** para el artista real y se mueve **solo ese disco**.

### Notas
- Para usar AcoustID: Ajustes → API key de AcoustID + activar «Usar AcoustID al identificar»,
  y luego «Reintentar identificación». Es lento (huella fichero a fichero, cacheada). + tests.

---

## [0.9.15] — 2026-08-24

**Identificación de recopilatorios (Various Artists)** — sin bajar la precisión.

### Añadido
- `searchReleaseGroup`: cuando el artista es un comodín de recopilatorio (Varios / Various /
  VA / V.A. / AA.VV. / Artistas Varios / Compilation), la búsqueda se **acota al artista
  «Various Artists» de MusicBrainz** (por su MBID). Recupera comps que antes fallaban
  porque el filtro por nombre de artista no casaba.
- Para VA se exige **coincidencia exacta del título normalizado**: evita casar un título de
  recopilatorio genérico con un **volumen concreto equivocado** de una serie (p. ej.
  «Momentos Rockdelux» → «…Vol. 3/2019»). Sigue el principio de **cero falsos positivos**.

---

## [0.9.14] — 2026-08-24

**Motor de identificación más certero** (sin bajar la precisión: cero falsos positivos).

### Cambiado
- `cleanAlbumTitle` (limpieza del título para buscar en MusicBrainz) ahora quita, de forma
  **conservadora**, sufijos de edición de la **misma obra** —también en español
  («Remasterizado», «Versión», «Edición», «Reedición»)— más bandas sonoras entre
  paréntesis y prefijos de listas/rippers («2021 - », «1. »). **No** toca `(Live)`/`(Remix)`
  (podrían ser obras distintas y arriesgarían un match erróneo).

### Añadido
- **Respaldo por título en `searchReleaseGroup`**: si la búsqueda «artista + título» no da
  un resultado fuerte, se busca **solo por título** y se acepta un candidato cuyo **artista
  coincida al normalizar el nombre** (sin acentos ni signos). Recupera variantes como
  **ACDC ↔ AC/DC**, acentos y puntuación. Umbral alto + verificación → sin falsos positivos.
- Tests de regresión de `cleanAlbumTitle`.

### Notas
- Validado contra una base real: recupera discos como *Apollo (Atmospheres & Soundtracks)*,
  *Crestone (Original Score)*, AC/DC *Rock or Bust* y varios de *Florence + The Machine*,
  sin identificar ninguno mal. Pulsa **«Reintentar identificación»** para reprocesar.

---

## [0.9.13] — 2026-08-24

### Añadido
- La página de **Retos** muestra arriba la sección **«Siguiente por escuchar de tus
  retos»**: el próximo disco de **cada** reto que ya tienes y aún no has oído (uno por
  reto, con el nombre del reto), para ir directo a escucharlos.

---

## [0.9.12] — 2026-08-23

### Arreglado
- Ficha de disco: los menús opcionales del botón «⋯» (Multidisco, Versiones, Corregir
  emparejamiento, Etiquetas MusicBrainz) no se ocultaban al volver a pinchar la misma
  opción. Ahora el clic hace *toggle* (mostrar/ocultar).

---

## [0.9.11] — 2026-08-23

**Importar (restaurar) la base de datos.** El complemento del exportar existente.

### Añadido
- **Ajustes → Copia de seguridad → «Restaurar base de datos»**: sube el `.db` que
  exportaste y reemplaza la base actual. Pensado como red de seguridad si una
  actualización deja la base en mal estado.
- El fichero subido se **valida** (`integrity_check` + tablas clave) antes de aceptarlo; se
  guarda un **respaldo automático** de la base actual (`liderarrr.db.bak-<fecha>`), y el
  intercambio se hace **al arrancar** (cuando la base no está abierta), reiniciando el
  proceso. En Docker con política de reinicio, la app vuelve sola.

### Cambiado
- La **descarga** de la base hace `wal_checkpoint(TRUNCATE)` antes de servir el fichero,
  para que la copia incluya siempre las escrituras más recientes (modo WAL).

### Interno
- Registrado `@fastify/multipart` (ya era dependencia) para la subida en streaming.

---

## [0.9.10] — 2026-08-23

**Bootlegs con espacio propio.** La clasificación de «rarezas» se divide en dos.

### Añadido
- Nuevo estado de álbum **`bootleg`** (directos no oficiales, sesiones de radio, ROIOs),
  paralelo a `orphan` (rarezas: demos, maquetas, inéditos, tomas perdidas). Ambos cuentan
  en lo descriptivo (totales, escuchas) pero **no** en el completismo, y nunca reciben
  escritura de etiquetas.
- Página **«Bootlegs»** propia (menú *Identikit*, ruta `/bootlegs`), distintivo rosa en
  las tarjetas, filtro **«Bootleg»** en la Discoteca, y recuento aparte en el Dashboard.
- Marcar como **rareza** o como **bootleg** (y volver a pendiente) desde la ficha del
  álbum y desde «Sin identificar».

### Notas
- Sin migración: las rarezas existentes siguen como `orphan`; reclasifica a `bootleg` las
  que quieras, disco a disco.

---

## [0.9.9] — 2026-08-23

**Crear fichas en MusicBrainz desde tu colección.** Cuando un disco no existe en
MusicBrainz, ahora puedes sembrarlo con un clic y devolver a la comunidad lo que la app
aprovecha de ella. (La página in-app «Novedades» cubre el detalle de 0.9.1–0.9.8.)

### Añadido
- **«Crear ficha en MusicBrainz»** en la ficha del disco (sin identificar) y por fila en
  **«Sin identificar»**. Abre el *release editor* de MusicBrainz **ya relleno** con la
  tracklist, duraciones, artista(s), año y sello de tu copia — el POST sale de tu
  navegador para usar **tu sesión** de MusicBrainz (MB exige revisión humana; no se
  automatiza esa parte, a propósito).
- **Bucle cerrado.** Al guardar en MusicBrainz, este te devuelve a Liderarr
  (`/mb-nueva`): el álbum se **enlaza solo** a su nuevo release-group (deja de estar «sin
  identificar»), y se ofrece **subir la portada** con un clic (seeding del userscript
  *Enhanced Cover Art Uploads* de ROpdebee, apuntando a la portada de tu copia) y
  **importar en record.club**.
- **Aviso de duplicado** antes de sembrar: si MusicBrainz ya tiene algo casi idéntico
  (≥90 %), ofrece **enlazarlo** en vez de crear un duplicado.
- Red de seguridad si MusicBrainz no devuelve el identificador: pegar la URL de MB a mano.

### Interno
- Nuevo `server/src/mbseed.js` (`buildReleaseSeed`) + rutas `GET /api/albums/:id/mb-seed`
  y `POST /api/albums/:id/link-release`. Primeras pruebas unitarias del proyecto
  (`server/test/mbseed.test.js`) y arreglado el script `npm test` (glob en vez de
  directorio, que fallaba en Node 24/Windows).

---

## [0.9.0] — 2026-08-16

Tanda grande centrada en el **radar multifuente** (descubrir novedades curadas fuera de Bandcamp),
el pulido de la **importación de descargas** y la **velocidad de los retos**.

### Añadido
- **Radar multifuente.** Además de los curadores de buymusic.club, el radar sigue ahora a tres sitios más,
  cruzados con tu biblioteca igual que el resto:
  - **Rosy Overdrive · Pressing Concerns** (auto): sondea la columna y trae los discos reseñados con fecha y sello.
  - **Raven Sings the Blues · Reseñas** (auto): lee su RSS de reseñas (artista/álbum del enlace de Bandcamp).
  - **Hipersónica · Tier List** (manual): como es Substack de pago y no se puede leer desde el servidor, se
    **pega** el texto de la tier list; cada disco entra con su **nivel** (badge de color: Directo al Excel / Sí /
    OK / Meh / No) y su género.
- **Retos desde una tier list de Hipersónica.** Al pegar la tier list puedes mandar los niveles que elijas
  (por defecto **Excel + Sí**) a un **reto ampliable** por nombre (p. ej. «Los Excels 2026 de Hipersónica»):
  se crea o se le añaden los discos nuevos **sin duplicar**, semana a semana.
- **Importar listas de Rosy Overdrive como reto** por URL (parseo directo del post).
- **Prioridad de trackers** (Ajustes → «3e»): con el mismo disco a la misma calidad en varios trackers, la
  descarga de un clic y el auto-grab eligen el del tracker que pongas más arriba. Orden: calidad → prioridad de
  tracker → seeders.
- **Filtros combinables en Artistas**: «Seguidos» y «Faltan discos» (activables a la vez), orden «Más discos por
  completar» y contador «faltan N» por tarjeta.
- **Dashboard · «Siguiente por escuchar de tus retos»**: sugiere los discos de tus retos que ya tienes y aún no
  has escuchado, con carátulas clicables.

### Cambiado
- **Importar descargas: se cierran los pedidos de verdad.** Importar (manual o auto) marca el pedido como
  «importado»; además, un cruce con la biblioteca cierra cualquier pedido cuyo álbum ya tengas, sin depender de
  qBittorrent. La cola se **autolimpia**: lo importado desaparece pasados unos días y la basura se poda sola.
- **Retos más rápidos.** Abrir un reto ya no rehace el índice de toda la biblioteca ni consulta las escuchas disco
  a disco (era lento en listas largas): ambos índices se calculan de una vez y se cachean.
- Renombres de secciones de navegación: **«La caza» → «I Hear a New World»** y **«El gusto» → «Losing My Edge»**.

### Arreglado
- **Identificación álbum vs single homónimo.** Cuando un artista tiene un single y un álbum con el mismo título
  (p. ej. Cocteau Twins «Heaven or Las Vegas»), se elegía a veces el single y el disco quedaba archivado como
  «single» (oculto en la sección plegada de la ficha). Ahora, a igualdad de título, se prefiere el álbum de estudio.

---

## [0.8.2] — 2026-08-16

### Añadido
- **Buscador rápido en el Dashboard**: el punto de entrada. Escribe un artista o un disco y salen al instante
  los de **tu colección** (a su ficha) y, debajo, los que **aún no tienes** vía MusicBrainz — un artista con
  «Seguir» (entra en completismo y te lleva a su ficha) y un disco con «Descargar». Cada resultado externo
  lleva un enlace a **MusicBrainz** para desambiguar (hay muchos «Beef» o «La Bohème» distintos). La app va
  de lo que tienes y, sobre todo, de lo que te falta.

### Limpieza
- Fuera código muerto: `lidarrRecent` (se calculaba en cada carga del dashboard sin usarse) y los huérfanos
  del onboarding retirado (`/api/setup-state`, `api.setupState`).

---

## [0.8.1] — 2026-08-15

Ronda de UX y arreglos tras la 0.8.0: carga de carátulas fiable y ágil, mejor manejo de multidiscos y de
discos con varias copias, filtros y ordenaciones nuevos, el calendario en sintonía con tu disco, y la
brecha de escuchas acotable por fecha.

### Añadido
- **Dashboard: «Próximos lanzamientos»** en vez de «Últimas en Lidarr»: los estrenos por venir de tus
  artistas y sellos seguidos, con enlace al calendario.
- **Discoteca: filtrar por año** (además de por década). El año concreto tiene prioridad sobre la década.
- **Artistas: más formas de ordenar**: recientes, seguidos primero, nombre A-Z / Z-A y aleatorio (antes solo
  por nº de álbumes, pistas o nombre).
- **Discoteca: la tarjeta de un disco con varias copias**: la carátula y el título llevan a la ficha del
  disco, y el nombre del artista a su ficha. Para limpiar copias, la **insignia ×N es un botón** que abre
  el panel de copias (borrado rápido). Además, la propia **ficha del disco tiene una sección «Copias de
  este disco»** con la ★ mejor y las acciones descartar/borrar.
- **Ficha de álbum: menú «⋯»** para las opciones secundarias que se usan a veces (Multidisco, Versiones,
  Etiquetas MusicBrainz, Corregir emparejamiento). Ya no están siempre presentes: se revelan al elegirlas.
- **Escuchas: acotar la brecha por fecha** (último mes / 3 meses / año) y nueva sección **«Discos que
  escuchas y no tienes»** (a nivel de álbum, con «Buscar»), para pasar a propios lo que oyes ahora en
  streaming y aún no tienes.
- **Multidisco «Combinar con…»: buscador** para encontrar cualquier disco de tu colección con el que
  combinar (antes solo listaba los del mismo artista/carpeta, difícil de usar si eran muchos). La
  selección se conserva al cambiar entre la lista por defecto y los resultados de búsqueda.
- **Multidiscos ripeados limpios: mejor detección automática**. Las cajas cuyas carpetas se llaman
  explícitamente «CD1 / CD2 / CD3» (o «Disc N») ahora se agrupan aunque cada disco traiga su propia cuenta
  de pistas limpia (antes solo se agrupaban las de «total contaminado»). Ej.: *Seamonsters* (edición
  expandida en CD1/CD2/CD3) se reconoce como una caja de 3 discos **53/53** —no como 53/19 ni como cuatro
  «duplicados» sueltos—, dejando el MP3 de otra edición como disco aparte. El conteo de la caja suma las
  pistas de discos limpios y usa el total de caja cuando las etiquetas vienen contaminadas. (Se aplica en
  el próximo escaneo o «Actualizar todo».)

### Corregido
- **Calidad y disco: los duplicados ahora se pueden pinchar** para abrir el panel de copias y limpiarlas
  (descartar o borrar), en vez de solo listarlos sin poder actuar.
- **Lanzamientos/Huecos: «en disco» en vez de «pedido»**: un disco que ya tienes (importado o escaneado)
  se marca al instante como propio en el calendario y deja de ofrecerse para descargar, cruzando en vivo
  con tu biblioteca (por MBID y por artista+título) en lugar del flag guardado, que envejecía. Evita
  descargar dos veces el mismo disco.
- **Carga de carátulas inconsistente y lenta**: las portadas ya no «desaparecen» al volver a la Discoteca
  con el botón atrás, ni faltan al entrar en un disco, y sin penalizar la navegación. El componente de
  carátula usa un *lazy* fiable (IntersectionObserver + comprobación de visibilidad al montar): solo pide
  las visibles (no las ~470 fuera de pantalla, que era lo que ralentizaba), y las re-pide al volver atrás.
  Por dentro: el servidor cachea el escaneo de carpeta (antes hacía un `readdirSync` por cada petición, que
  bloqueaba el hilo) y el 404 de una carátula aún sin resolver no se cachea (antes se servía el 404 viejo).

---

## [0.8.0] — 2026-08-15

Objetivo: **la página de disco al nivel de Roon**, con datos libres. La ficha ahora reúne reseña y
valoración, créditos por persona con foto, roles e instrumentos, recomendaciones y todas las versiones.
Además: varios artistas por álbum (splits) con completismo para cada uno, fotos de artista, y combinar
multidiscos a mano. Y la independencia de Lidarr de la 0.7 se consolida (incluye lo que quedó sin taguear
de 0.7.1).

### Añadido
- **Artistas seguidos resaltados** en la lista de artistas (fondo dorado + estrella), como los sellos.
- **Discografía del artista colapsable por tipo**: Álbumes, EPs y Singles se pliegan; por defecto solo
  Álbumes queda abierto.
- **Ajustes: barra de guardado flotante** que aparece al cambiar cualquier ajuste (antes el único
  botón Guardar quedaba arriba, lejos y fácil de olvidar).
- **Jackett: categoría configurable** (Ajustes → Jackett). Por defecto 3000 (música); **déjala vacía**
  si un tracker (p. ej. Orpheus) no aparece: buscará en todas las categorías (algunos indexers no
  declaran la categoría 3000 en Jackett y el filtro los excluía del agregado «all»).
- **Ficha de álbum: enlaces a Discogs y Record Club** en la cabecera, junto al de MusicBrainz.
  Búsqueda directa por artista + álbum (Discogs apunta a la referencia *master*).
- **Añadir carátula a mano** desde la ficha del álbum: botón sobre la portada que abre un buscador
  online (Cover Art Archive por MBID + iTunes por texto, editable) o permite subir una imagen desde
  tu equipo. Lo elegido se guarda como `cover.jpg` en la carpeta del álbum (permanente, solo añade el
  fichero; no toca el audio).
- **Enlazar un artista con MusicBrainz a mano** desde su ficha: cuando la identificación no pilla su
  MBID (duplicados, mayúsculas… p. ej. «Florence + the Machine»), un buscador por nombre —o pegando el
  MBID— lo enlaza y recalcula su discografía y completismo al instante. Queda fijado (un reescaneo no
  lo pisa).
- **Varios artistas por álbum** (singles compartidos del emo, colaboraciones), al modo MusicBrainz
  («A / B»): en la ficha del álbum se editan uno o varios artistas; cada uno se enlaza a su ficha. Un
  split **cuenta en el completismo de cada artista**, aparece en la colección de ambos y, si lo tienes,
  no sale como «single que te falta» para ninguno. Se autopobla desde el *artist-credit* de MusicBrainz
  al identificar y también se puede poner a mano. (Por dentro: tabla `album_artists` y `release_groups`
  pasa a clave compuesta `(rg_mbid, artist_id)` para que un release-group pueda contar en varios
  artistas; la migración conserva los datos y se aplica sola.)
- **Créditos ricos en la ficha del álbum** (estilo Roon): quién tocó qué, desde MusicBrainz — intérpretes
  con su instrumento, además de producción, ingeniería y composición, agrupados por persona y con en
  cuántas pistas aparece cada uno. Cada músico enlaza a su ficha si lo tienes en la biblioteca, o a
  MusicBrainz. Se carga bajo demanda.
- **«Sobre el disco» en la ficha del álbum** (estilo Roon): reseña/descripción del disco (o, si no la hay,
  del artista) desde Last.fm, con «Leer más», y valoración de la comunidad de Discogs (estrellas + nº de
  votos). Se autocarga; ambas fuentes son opcionales (aparecen si tienes configuradas Last.fm/Discogs).
- **Recomendaciones en la ficha del álbum** (estilo Valence de Roon): «Más de este artista» (otros discos
  suyos que tienes, con carátula, enlazados) y «Te podría gustar» (artistas afines vía Last.fm, resaltando
  los que ya tienes). Se carga bajo demanda.
- **«Versiones» en la ficha del álbum** (antes «Ediciones (Discogs)»): ahora unifica todas las ediciones
  oficiales de MusicBrainz (prensaje por país, año, formato y sello, cada una enlazada) con las de Discogs
  y su radar de posibles upgrades. Cada fuente es opcional.
- **Fotos de artista** (como las carátulas): se resuelven automáticamente desde Deezer (sin clave) y puedes
  cambiarlas a mano (buscar en Deezer o subir una imagen) desde la ficha del artista. Aparecen en la ficha
  del artista y como avatar en los créditos de los discos. Se guardan en la caché de la app.
- **Combinar multidiscos a mano** (estilo Plex/Roon): para los dobles/triples que la heurística no agrupó
  bien. Dos vías: en la **Discoteca**, «Combinar discos» activa un modo selección (cada disco por separado)
  para elegir varios y unirlos en una caja; y en la **ficha del álbum**, «Combinar con…» ofrece los discos
  del mismo artista o carpeta, y «Separar la caja» la deshace. Lo decidido a mano queda protegido de la
  heurística de reescaneo. Las cajas se muestran como un solo álbum, con insignia del nº de discos.

### Corregido
- **Completismo del artista en vivo**: «faltan», «por estrenar» y el % se calculan cruzando en vivo
  con tu biblioteca, no con una estadística guardada que envejecía. Efectos: al importar un disco
  desaparece de «faltan» sin reescanear, y un estreno ya salido deja de contar como «por estrenar».

### Rendimiento
- **Carga de carátulas en la lista de artistas**: sin la tormenta de reintentos por cada miniatura
  (una sola petición cacheable por carátula) y con caché negativa corta en el servidor para las que
  faltan. La parrilla de artistas carga más ágil.

---

## [0.7.0] — 2026-08-14

Objetivo: **independencia de Lidarr**. La app ya funciona entera sin él — descubre (MusicBrainz +
radar), busca (Prowlarr/Jackett con freeleech), descarga (qBittorrent), importa (hardlink) y
automatiza, todo nativo. Lidarr queda como integración opcional.

### Cambiado
- **Lidarr ahora es opcional (independencia).** Si no tienes Lidarr configurado, la app funciona
  entera con el flujo nativo: los botones «Lidarr» de la ficha del álbum, huecos del artista,
  calendario, radar y retos pasan a **«Descargar»** (agarra la mejor release por Prowlarr/Jackett y
  el auto-import la coloca en la biblioteca). Con Lidarr configurado, todo sigue igual que antes.

### Añadido
- **Auto-descarga nativa, sin Lidarr (camino a 1.0).** Alternativa al auto-Lidarr: en el refresco
  nocturno busca en tus indexers (Jackett/Prowlarr) los estrenos/huecos de tus artistas seguidos,
  **elige la mejor release** con una heurística propia (sin pérdida primero: FLAC > 320 > V0 > 256;
  **descarta las que no tienen semillas**; exige coincidencia con el álbum) y la agarra. El registro
  de descargas + el auto-import cierran el bucle (hardlink a la biblioteca). Se activa y configura en
  Ajustes → «4b · Auto-descargar sin Lidarr» (horizonte, margen, semillas mínimas, tope por tanda),
  con «Simular ahora» para ver qué agarraría sin descargar nada. Salta lo que ya tienes o ya pediste.
- **Al agarrar, qBittorrent arranca la descarga** (antes se quedaba en «Stopped» si qB estaba
  configurado para añadir en pausa): se envía `stopped=false`/`paused=false`.
- **Freeleech.** Las búsquedas marcan las releases **freeleech** (no cuentan para el ratio, atributo
  `downloadvolumefactor` de Torznab/Prowlarr) con una insignia. La auto-descarga tiene una opción
  **«Solo freeleech»** (Ajustes → 4b): solo agarra releases freeleech confirmadas —protege tu cuenta
  en trackers privados—; si el indexer no informa el freeleech, se descarta por seguridad.
  Nota: los **tokens de freeleech** los gestiona **Prowlarr por indexer** (Never/Preferred/Required);
  como Liderarr agarra vía Prowlarr (no bypassa), ese ajuste se respeta tal cual. Con **Jackett** no
  hay tokens, así que ahí el filtro «Solo freeleech» es la protección de ratio.


- **Auto-import: cerrar el bucle de descargas sin Lidarr (camino a la independencia).** Con
  «Auto-importar al terminar» activado (Ajustes → Importar descargas), Liderarr sondea qBittorrent
  cada pocos minutos y, por cada torrent **completado** que cuelgue de tu carpeta de torrents, lo
  **enlaza (hardlink)** a tu biblioteca organizada `{artist}/{album} ({year})` y relanza el escaneo
  — como hacía Lidarr, pero nativo. No borra ni copia el origen (sigues sembrando). También en
  «Actualizar todo» y con un botón «Importar terminadas ahora» en la pestaña Importar.
- **Registro de descargas.** Cuando agarras una release, se apunta el pedido (artista/álbum, título
  de la release, hash) para: casar el torrent terminado con su álbum (destino correcto aunque las
  etiquetas fallen), evitar re-pedir, y ver el estado (pedido → importando → importado) en Importar.


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
