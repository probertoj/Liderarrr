# Registro de cambios — Liderarr

Todo lo notable del proyecto. Principio rector: **tus ficheros mandan, MusicBrainz
anota, Lidarr solo ejecuta.** Nunca borra música.

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/).

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
