# 🎵 Liderarrr

> **v0.9.1** · Panel de **completismo** para tu colección de música digital. Escanea tus
> ficheros, los identifica contra MusicBrainz / AcoustID / Discogs / Last.fm, y te enseña qué
> tienes, qué te falta y qué es una rareza — y te ayuda a **conseguirlo y ordenarlo**, con o
> sin Lidarr.

Liderarrr es primo musical de [PowaFlex](https://github.com/ForeverRamone/PowaFlex) (que hace
lo mismo para cine con Plex). Su principio rector:

> **Tus ficheros mandan. MusicBrainz anota. Tú decides.**

Tu disco duro es la única fuente de verdad. Un álbum existe en Liderarrr aunque no esté en
ninguna base de datos: maquetas, bootlegs e inéditos son ciudadanos de primera clase (estado
*rareza*), cuentan en tus estadísticas y no se pierden nunca. Liderarrr **nunca borra ni
reescribe tu audio** sin que se lo pidas.

Desde la 0.7 es **independiente de Lidarr**: busca, descarga (Prowlarr/Jackett + qBittorrent)
e importa por su cuenta. Lidarr sigue soportado, pero es **opcional**.

---

## Índice

1. [Instalación](#-instalación)
2. [Primeros pasos](#-primeros-pasos)
3. [Cómo funciona (el recorrido)](#-cómo-funciona-el-recorrido)
4. [Manual de uso, sección por sección](#-manual-de-uso-sección-por-sección)
5. [Cómo identifica tu música](#-cómo-identifica-tu-música)
6. [Conseguir lo que te falta (descargas)](#-conseguir-lo-que-te-falta)
7. [Importar descargas a la biblioteca](#-importar-descargas-a-la-biblioteca)
8. [En el móvil](#-en-el-móvil)
9. [Privacidad y seguridad](#-privacidad-y-seguridad)
10. [Desarrollo local](#-desarrollo-local)
11. [Créditos](#-créditos)

---

## 🚀 Instalación

Liderarrr es una imagen Docker. Corre en cualquier máquina de tu red con acceso a tu música.

```yaml
services:
  liderarrr:
    image: ghcr.io/probertoj/liderarrr:latest
    container_name: liderarrr
    restart: unless-stopped
    ports:
      - '3861:3861'
    volumes:
      # Estructura TRaSH Guides (recomendada): una carpeta «data» con torrents/ y media/
      # dentro, montada en /data — y con EL MISMO PATH (/data) en qBittorrent. Así los
      # hardlinks funcionan y el auto-import va solo. La BD vive en /data/liderarrr.db.
      - /ruta/a/tu/data:/data
    environment:
      - TZ=Europe/Madrid
      # Recomendado: cifra las credenciales en disco (elige una frase larga y no la cambies).
      # - LIDERARRR_SECRET=una-frase-larga-y-secreta
```

```bash
docker compose up -d
```

**Estructura de carpetas ([TRaSH Guides](https://trash-guides.info/File-and-Folder-Structure/)):**
monta una sola carpeta `data` en `/data`, **con el mismo path en Liderarr y en qBittorrent**,
para que descargas y biblioteca compartan sistema de ficheros (hardlinks) y las rutas coincidan:

```
data/
├── torrents/music/   ← qBittorrent descarga aquí   → Ajustes: /data/torrents/music
└── media/music/      ← biblioteca organizada         → Ajustes: /data/media/music
```

> Es la cura de raíz del problema de auto-import: si Liderarr y qBittorrent ven la misma ruta,
> los torrents terminados se enlazan solos. Si tu qBittorrent reporta otra ruta (p. ej.
> `/downloads`), no pasa nada: hay un **remapeo de rutas** en Ajustes (`/downloads => /data/...`).

### Actualizar el contenedor

La imagen se reconstruye en cada publicación. Para traer la última:

```bash
docker compose pull && docker compose up -d
```

El **badge de versión** de la barra lateral confirma qué estás corriendo. Liderarrr también te
avisa dentro de la app cuando hay una versión nueva.

### Guías paso a paso por plataforma

- 📗 **[Synology DSM (Container Manager)](docs/synology.md)**
- 📙 **[UNRAID](docs/unraid.md)**

> **Persistencia:** todo (ajustes, credenciales, biblioteca, caché) vive en un único fichero
> SQLite dentro de `/data`. Mientras montes esa carpeta como volumen, tu configuración sobrevive
> a reinicios y actualizaciones. Liderarrr avisa al arrancar si `/data` no es escribible.

---

## 🧭 Primeros pasos

1. Abre `http://IP-DEL-HOST:3861`.
2. Ve a **Ajustes** y define:
   - **Carpeta de música** (tu biblioteca organizada, p. ej. `/data/media/music`). Por defecto
     en solo lectura: Liderarrr no toca tu audio.
   - *(Opcional pero recomendado)* claves gratuitas de **AcoustID**, **Discogs** y **Last.fm**
     para mejor identificación, valoraciones/reseñas, tus escuchas y las sugerencias de artistas.
   - *(Opcional)* credenciales de **Spotify** (client id/secret) para sumar sus novedades a las
     de **Deezer** (que ya funciona sin ninguna clave).
   - *(Opcional)* **Prowlarr** o **Jackett** + **qBittorrent** para buscar y descargar desde la
     propia app; y las carpetas de **importar descargas** (origen de torrents + destino).
   - *(Opcional)* **Lidarr**, si prefieres delegar en él las descargas.
3. Pulsa **«Identificar y sincronizar»** (arriba a la izquierda). Es la pasada completa: escanea,
   identifica contra MusicBrainz, importa tus escuchas de Last.fm, recalcula discografías y
   completismo, refresca el radar… Corre en segundo plano y **se repite sola cada noche a las 03:00**.

La primera identificación de una biblioteca grande tarda (MusicBrainz limita a ~1 consulta/segundo).
Puedes navegar mientras tanto; los discos aparecen identificados poco a poco.

---

## 🔧 Cómo funciona (el recorrido)

Dentro de la app tienes esto mismo en **«¿Cómo funciona todo esto?»**.

| Paso | Qué pasa |
|---|---|
| **1. Escaneo** | Recorre tus carpetas. **Una carpeta = un álbum.** Lee etiquetas y vuelca artistas, discos y pistas. No consulta nada externo: aquí solo cuentan tus ficheros. |
| **2. Identificación** | Cruza cada disco con MusicBrainz (artista, álbum, año, tipo). Escribe en la BD de Liderarr, **nunca en tus ficheros**. Un disco sin identificar existe igual. |
| **3. Completismo** | De los artistas y sellos que sigues, mira su discografía en MusicBrainz y la cruza con lo que tienes: qué álbumes te faltan y qué está por salir. |
| **4. Descargas + importación** | Buscas y descargas por Prowlarr/Jackett + qBittorrent (sin el veto de Lidarr). Al terminar un torrent, el **auto-import** lo enlaza (hardlink) a tu biblioteca, sin copiar ni dejar de sembrar. |
| **5. Radar y novedades** | Sigue a curadores y sitios de novedades; además, para tus artistas seguidos detecta en **Deezer/Spotify** los estrenos que **MusicBrainz aún no lista** (se adelanta a su retraso). Todo marcando lo que ya tienes. |
| **6. Escuchas y retos** | Conecta Last.fm para cruzar lo que TIENES con lo que has ESCUCHADO, monta retos con anillos de progreso, y recibe **sugerencias de artistas similares** para seguir. |

**¿Cuándo pasa cada cosa?**

- **Cada pocos minutos (auto-import, por defecto 3 min):** revisa qBittorrent, enlaza lo terminado,
  reescanea esas carpetas nuevas e identifica ligero lo recién llegado. Si no hay nada nuevo, no hace nada.
- **Cada noche a las 03:00 (refresco completo):** auto-importar → escanear → identificar todo lo
  pendiente → importar escuchas → (si usas Lidarr) sincronizar → recalcular discografías y
  completismo → sellos → radar → auto-descargar estrenos. Es lo que hace **«Identificar y sincronizar»** a mano.

---

## 📚 Manual de uso, sección por sección

El menú está agrupado con guiños musicales; aquí va cada sección con lo que hace.

### 🗄️ Coleccionista de discos — tu colección

| Sección | Qué encuentras |
|---|---|
| **Dashboard** | Totales (álbumes, artistas, pistas, tamaño en disco, duración), % sin pérdida y gráficas por década, formato y género. Incluye un **buscador rápido**: escribe y ves al instante lo que tienes; si no lo tienes, busca en MusicBrainz y te deja **seguir** al artista o **descargar** el álbum. |
| **Discoteca** | Toda la colección en parrilla de carátulas, con filtros por género, década, formato, calidad, estado y **«con duplicados»**, y orden configurable. Las **ediciones** distintas (original vs. deluxe, por nº de pistas) se agrupan bien; los discos con varias copias muestran un badge **×N** que abre el panel de copias. |
| **Ficha de álbum** | Carátula, pistas, calidad y un panel tipo *Roon*: **créditos** y roles, **reseña** (Last.fm) y **valoración** (Discogs), **recomendaciones**, y otras **versiones/ediciones** (MusicBrainz + Discogs). Puedes renombrar el título, corregir el artista, añadir carátula, ver **«otras ediciones que tienes»** y gestionar copias. Enlaces directos a MusicBrainz, Discogs, Record Club y Spotify. |
| **Artistas** | Ranking por nº de álbumes/pistas, con foto (Deezer). Filtros combinables **«Seguidos»** + **«Faltan discos»** y orden **«Más discos por completar»**. Los artistas locales (sin MBID) conviven con los de MusicBrainz. |
| **Ficha de artista** | Discografía por tipo (álbum, EP, single, directo…), con lo que tienes marcado **en vivo**, ámbito de completismo configurable, y **«Descargar todos»** los que faltan. |
| **Álbumes incompletos** | *La feature estrella:* álbumes a los que les falta alguna pista (las que hay en disco vs. las que deberían), ordenados por cuántas faltan. |
| **Calidad y disco** | Formatos, sin pérdida vs. con pérdida, sin ReplayGain, sin carátula, formatos mezclados, **duplicados** (clicables) y los más pesados. |
| **Candidatos a upgrade** | Álbumes que podrías mejorar de calidad (p. ej. de MP3 a FLAC), con descarga nativa a un clic. |
| **Sellos** | Sigue sellos discográficos y ve su catálogo cruzado con lo que tienes; el sello aparece también en la ficha del álbum. |

### 🌍 I Hear a New World — descubrir y conseguir

| Sección | Qué encuentras |
|---|---|
| **Seguidos** | Los artistas y sellos que sigues, base del completismo y del radar. Incluye **«Quizá quieras seguir a…»**: artistas similares (Last.fm) que aún no tienes, para seguir de un clic (resuelve a MusicBrainz y calcula su discografía). |
| **Huecos** | Álbumes que te **faltan** de las discografías de tus artistas seguidos. Descarga nativa a un clic; puedes descartar huecos que no te interesen. |
| **Lanzamientos** | Calendario de **próximos** estrenos y recién salidos de tus seguidos, más el **radar** de novedades curadas: [buymusic.club](https://www.buymusic.club), **Rosy Overdrive**, **Raven Sings the Blues** e **Hipersónica** (esta, pegando su tier list). La pestaña **«⚡ Novedades»** trae los estrenos que **MusicBrainz aún no lista**, detectados en **Deezer/Spotify** para tus artistas seguidos (se adelanta al retraso de MB), con descarga a un clic. Todo marca lo que ya tienes. |
| **Importar descargas** | El cierre del bucle: enlaza (hardlink) tus descargas a la biblioteca organizada. Ver [sección propia](#-importar-descargas-a-la-biblioteca). |

### 🎧 Losing My Edge — escuchas y retos

| Sección | Qué encuentras |
|---|---|
| **Escuchas** | Con Last.fm conectado, cruza lo que **tienes** con lo que has **escuchado**: discos que tienes y no has oído, artistas que escuchas y no tienes, brecha por fecha… |
| **Retos** | Listas de escucha con **anillos de progreso**. Crea un reto vacío y añade discos a mano, o **importa listas** por URL (Album of the Year, listas públicas de Record Club, Rosy Overdrive) o pegando (RYM). El Dashboard sugiere **«lo siguiente por escuchar»** de tus retos. |

### 🧩 Identikit — identificación y orden

| Sección | Qué encuentras |
|---|---|
| **Sin identificar** | Cola de resolución: candidatos de MusicBrainz/Discogs, **fijar a mano**, **pegar una URL de MusicBrainz** para enlazar exacto, o marcar como **rareza**. Botón para reintentar la identificación de todo lo pendiente. |
| **Correcciones** | Lista de álbumes que corregiste a mano (artista/título) y los **reubica** en `{artista}/{álbum}` — todos o uno a uno. |
| **Rarezas e inéditos** | Las maquetas, bootlegs y directos no oficiales que marcaste. Material que en otras herramientas se pierde: aquí cuenta y no se toca. |
| **Papelera** | Copias/álbumes descartados. Descartar **oculta y saca de los recuentos** — no borra el fichero; puedes **deshacer** desde aquí. |

### 🛠️ How did I get here? — sistema

| Sección | Qué encuentras |
|---|---|
| **¿Cómo funciona todo esto?** | El recorrido de la app y cuándo pasa cada cosa, en cristiano. |
| **Ajustes** | Carpetas, servicios (MusicBrainz/AcoustID/Discogs/Last.fm/Spotify, Prowlarr/Jackett/qBittorrent, Lidarr), importación (auto-import, intervalo, remapeo de rutas, plantilla de nombres), prioridad de trackers, tema claro/oscuro y más. |
| **Diagnóstico** | Estado de las conexiones y de los procesos de fondo, para cazar problemas. |

---

## 🔎 Cómo identifica tu música

Cada álbum recorre una cadena, de más fiable a último recurso:

1. **MBID en las etiquetas** (si pasaste Picard) — exacto y gratis.
2. **Discografía conocida del artista** — casa el álbum contra los lanzamientos que ya sabemos del
   artista (offline), útil para nombres con caracteres raros.
3. **AcoustID** — huella del audio *real*, caza carpetas mal etiquetadas (necesita `fpcalc`).
4. **MusicBrainz** — búsqueda por texto artista + título (prefiere el álbum de estudio ante singles/EP homónimos).
5. **Last.fm** — cola larga, resuelve nombres.
6. **Discogs** — red de seguridad para ediciones raras.

Si nada coincide, queda **sin identificar** y decides tú: **rareza** o **emparejado manual**
(incluye pegar la URL de MusicBrainz para fijarlo exacto).

---

## ⬇️ Conseguir lo que te falta

Desde cualquier hueco, upgrade, ficha de artista o sello puedes **buscar y descargar** sin salir
de la app:

- **Nativo (recomendado):** **Prowlarr** o **Jackett** buscan en tus indexers (Torznab) y
  **qBittorrent** materializa la descarga. Eliges la release, con soporte de **freeleech** y
  **prioridad de trackers** (a igual calidad, tira de tu tracker preferido y luego por seeders).
- **Lidarr (opcional):** si lo tienes configurado, puedes seguir delegando en él.

El **auto-grab** puede descargar estrenos automáticamente en el refresco nocturno.

---

## 📥 Importar descargas a la biblioteca

Liderarrr **enlaza (hardlink)** lo que bajas a tu biblioteca organizada `{artista}/{álbum (año)}`,
como hace Lidarr pero **sin su veto de metadatos**. Reglas de oro: **nunca borra ni copia el
origen** (sigues sembrando) y solo enlaza (0 espacio extra si comparten volumen).

- **Auto-import:** al terminar un torrent en qBittorrent, se enlaza solo (cada pocos minutos). El
  panel muestra un **diagnóstico** de la última pasada (cuántos completados, bajo la carpeta,
  importados, ya estaban, errores).
- **Diagnóstico por ítem:** cada descarga «sin importar» dice **por qué** no se auto-importó —
  *«El auto-import no la ve»* (qBittorrent no la lista), *«Varios álbumes en una carpeta»* (vertedero),
  *«Ya en tu biblioteca»*, *«Pendiente del auto-import»* o *«Lista para importar»* — mostrando la
  carpeta que mira.
- **Importar por álbumes:** si una carpeta contiene varios discos (un vertedero o carpeta de
  artista), la despliega en sus subcarpetas y las importa **una a una** como álbumes sueltos, en
  vez de colapsarlas en uno mal etiquetado.
- **Ocultar / «Ya la tengo»:** saca de la lista lo que no quieras importar; ni se importa ni lo
  coge el auto-import (reversible).
- **Remapeo de rutas:** si qBittorrent reporta una ruta distinta a la que Liderarr tiene montada,
  una regla `rutaQB => rutaLocal` en Ajustes lo traduce.

---

## 📱 En el móvil

La interfaz está adaptada a móviles modernos (iPhone incluido): barra superior con menú
deslizable, respeto del *notch* y el área segura, y los campos no provocan zoom al enfocarlos.
Puedes usar toda la app desde el teléfono.

---

## 🔒 Privacidad y seguridad

- Todo corre y se guarda en tu máquina (SQLite en `/data`). **Sin cuentas, sin telemetría.**
- Por defecto Liderarrr **nunca escribe** en tus ficheros de música (monta la carpeta en `:ro`).
  Existe una opción **opt-in** para escribir *solo los MBID* en álbumes ya identificados, con
  previsualización y confirmación, y nunca sobre rarezas (requiere activarla **y** montar la
  música en `:rw`).
- Credenciales cifradas en disco con `LIDERARRR_SECRET` (AES-256-GCM).
- Autenticación básica opcional con `LIDERARRR_AUTH="usuario:contraseña"`.

---

## 🧑‍💻 Desarrollo local

```bash
npm install
npm run dev        # API en :3861 + frontend Vite en :5174 (proxy /api → 3861)
```

Para AcoustID en local necesitas `fpcalc` (Chromaprint) en el PATH. En Windows:
`choco install chromaprint` o `scoop install chromaprint`.

**Stack:** Node 24 · Fastify · better-sqlite3 · music-metadata · React 19 · Vite · Tailwind 4 ·
Recharts. Los datos van a `/data` en el contenedor (o `server/data/` en local, configurable con
`DATA_DIR`).

---

## 🙏 Créditos

Liderarrr es un **fork conceptual de [PowaFlex](https://github.com/ForeverRamone/PowaFlex)**, la
idea original de **[ForeverRamone](https://github.com/ForeverRamone)** para cine sobre Plex. Todo
el planteamiento —leer tu biblioteca en local, cruzarla con una base de datos externa, calcular
completismo y cazar lo que falta— nace de su trabajo; Liderarrr solo lo lleva al terreno de la
música.

Gracias en especial:

- A **ForeverRamone**, por PowaFlex y por la idea de la que sale todo esto.
- A **[calltheranger](https://www.buymusic.club/user/calltheranger)**, por su selección semanal de
  novedades en Bandcamp, que alimenta el radar de la app.
- A **los hipersónicos**.
- A **Sanpitopato**. Seguimosseguimos.

Datos por cortesía de [MusicBrainz](https://musicbrainz.org), [AcoustID](https://acoustid.org),
[Discogs](https://discogs.com), [Last.fm](https://last.fm), [Deezer](https://deezer.com) y
[Spotify](https://spotify.com). Gracias a [Lidarr](https://lidarr.audio) por su API, y a
[Cmdarr](https://github.com/DeviantEng/Cmdarr) por la inspiración del descubrimiento de novedades.

Licencia [MIT](LICENSE).

---

*The enemy is everywhere.*
