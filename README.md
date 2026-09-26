# 🎵 Liderarrr

> **v1.0** · Panel de **completismo** para tu colección de música digital. Escanea tus
> ficheros, los identifica contra MusicBrainz / AcoustID / Discogs / Last.fm, y te enseña qué
> tienes, qué te falta y qué es una rareza — y te ayuda a **conseguirlo y ordenarlo**, con o
> sin Lidarr.

Liderarrr es primo musical de [PowaFlex](https://github.com/ForeverRamone/PowaFlex) (que hace
lo mismo para cine con Plex). Su principio rector:

> **Tus ficheros mandan. MusicBrainz anota. Tú decides.**

Tu disco duro es la única fuente de verdad. Un álbum existe en Liderarrr aunque no esté en
ninguna base de datos: maquetas, bootlegs e inéditos son ciudadanos de primera clase (estados
*rareza* y *bootleg*), cuentan en tus estadísticas y no se pierden nunca. Liderarrr **nunca
borra ni reescribe tu audio** sin que se lo pidas.

Desde la 0.7 es **independiente de Lidarr**: busca, descarga e importa por su cuenta. Lidarr
sigue soportado, pero es **opcional**. La **1.0** cierra el círculo con dos piezas: saber qué
tienes en **streaming y no en disco** (y al revés), y **«Lo quiero»**, una lista de deseos que
se descarga sola en cuanto el disco aparece en tus trackers.

---

## Índice

1. [Instalación](#-instalación)
2. [Primeros pasos](#-primeros-pasos)
3. [Cómo funciona (el recorrido)](#-cómo-funciona-el-recorrido)
4. [Manual de uso, sección por sección](#-manual-de-uso-sección-por-sección)
5. [Cómo identifica tu música](#-cómo-identifica-tu-música)
6. [Conseguir lo que te falta (descargas)](#-conseguir-lo-que-te-falta)
7. [«Lo quiero»: la lista de deseos que se descarga sola](#-lo-quiero-la-lista-de-deseos-que-se-descarga-sola)
8. [Tu disco frente a tu streaming](#-tu-disco-frente-a-tu-streaming)
9. [Importar descargas a la biblioteca](#-importar-descargas-a-la-biblioteca)
10. [Avisos y copias de seguridad](#-avisos-y-copias-de-seguridad)
11. [En el móvil](#-en-el-móvil)
12. [Privacidad y seguridad](#-privacidad-y-seguridad)
13. [Desarrollo local](#-desarrollo-local)
14. [Créditos](#-créditos)

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
      # dentro, montada en /data — y con EL MISMO PATH (/data) en tu cliente de descargas.
      # Así los hardlinks funcionan y el auto-import va solo. La BD vive en /data/liderarrr.db.
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
monta una sola carpeta `data` en `/data`, **con el mismo path en Liderarr y en tu cliente de
descargas**, para que descargas y biblioteca compartan sistema de ficheros (hardlinks) y las
rutas coincidan:

```
data/
├── torrents/music/   ← tu cliente descarga aquí   → Ajustes: /data/torrents/music
└── media/music/      ← biblioteca organizada        → Ajustes: /data/media/music
```

> Es la cura de raíz del problema de auto-import: si Liderarr y tu cliente ven la misma ruta,
> los torrents terminados se enlazan solos. Si tu cliente reporta otra ruta (p. ej.
> `/downloads`), no pasa nada: hay un **remapeo de rutas** en Ajustes (`/downloads => /data/...`).

**¿No usas qBittorrent?** No hace falta. Liderarr **barre la carpeta de descargas** e importa lo
que esté completo, así que funciona igual con **Deluge, rTorrent, Transmission** o lo que sea.
Si además configuras qBittorrent, lo aprovecha para saber antes qué ha terminado.

### Actualizar el contenedor

La imagen se reconstruye en cada publicación. Para traer la última:

```bash
docker compose pull && docker compose up -d
```

También puedes fijar una versión concreta (`ghcr.io/probertoj/liderarrr:v1.0.0`). El **badge de
versión** de la barra lateral confirma qué estás corriendo, y Liderarrr te avisa dentro de la app
cuando hay una versión nueva.

### Guías paso a paso por plataforma

- 📗 **[Synology DSM (Container Manager)](docs/synology.md)**
- 📙 **[UNRAID](docs/unraid.md)**
- 🐧 **Sin Docker:** [aquí abajo](#sin-docker-linux-bare-metal)

### Sin Docker (Linux, bare metal)

Docker es solo el empaquetado cómodo: por dentro Liderarrr es una app **Node** normal, y la
imagen no es más que `node:22-slim` + `fpcalc`. Si prefieres correrlo a pelo:

```bash
sudo apt install -y nodejs npm build-essential python3 libchromaprint-tools
git clone https://github.com/probertoj/Liderarrr.git && cd Liderarrr
npm install          # compila better-sqlite3 si no hay binario para tu plataforma
npm run build        # genera web/dist (la interfaz)
DATA_DIR=/ruta/a/tus/datos PORT=3861 npm start
```

Y ya lo tienes en `http://IP:3861`. El servidor sirve **la interfaz y la API en el mismo puerto**,
y todo (ajustes, biblioteca, caché) vive en un único SQLite dentro de `DATA_DIR`.

- **Node 22 o 24.** Si tu distro trae uno más viejo, tira de
  [NodeSource](https://github.com/nodesource/distributions) o `nvm`.
- **`libchromaprint-tools`** es lo que aporta el `fpcalc` de AcoustID (identificar por huella del
  audio). Es **opcional**: sin él la app avisa al arrancar y sigue funcionando, solo que identifica
  por texto.

Para que arranque solo, una unidad de systemd:

```ini
# /etc/systemd/system/liderarrr.service
[Unit]
Description=Liderarrr
After=network.target

[Service]
WorkingDirectory=/opt/Liderarrr
Environment=DATA_DIR=/opt/Liderarrr/data
Environment=PORT=3861
Environment=TZ=Europe/Madrid
Environment=LIDERARRR_SECRET=una-frase-larga-y-secreta
ExecStart=/usr/bin/node server/src/index.js
Restart=on-failure
User=tu-usuario

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now liderarrr
```

> **La pega frente a Docker:** las actualizaciones te las comes tú —
> `git pull && npm install && npm run build && sudo systemctl restart liderarrr` — en vez de un
> `docker compose pull`. Y los hardlinks del auto-import siguen necesitando que las descargas y la
> biblioteca estén en el **mismo sistema de ficheros**, con o sin contenedor.

> **Persistencia:** todo (ajustes, credenciales, biblioteca, caché) vive en un único fichero
> SQLite dentro de tu carpeta de datos (`/data` en Docker, `DATA_DIR` sin él). Mientras esa
> carpeta sobreviva —montada como volumen, o simplemente fuera del directorio del código— tu
> configuración aguanta reinicios y actualizaciones. Liderarrr avisa al arrancar si no es escribible.

---

## 🧭 Primeros pasos

1. Abre `http://IP-DEL-HOST:3861`.
2. Ve a **Ajustes** y define:
   - **Carpeta de música** (tu biblioteca organizada, p. ej. `/data/media/music`). Por defecto
     en solo lectura: Liderarrr no toca tu audio.
   - *(Opcional pero recomendado)* claves gratuitas de **AcoustID**, **Discogs** y **Last.fm**
     (o **ListenBrainz**) para mejor identificación, valoraciones/reseñas, tus escuchas y las
     sugerencias de artistas.
   - *(Opcional)* **Prowlarr** o **Jackett** + tu cliente de descargas para buscar y descargar
     desde la propia app; y las carpetas de **importar descargas** (origen + destino).
   - *(Opcional)* **Spotify** (client id/secret) para conectar **tu biblioteca guardada** y ver
     la brecha disco ↔ streaming. El catálogo de novedades **no** lo necesita: va por Deezer,
     que funciona sin ninguna clave.
   - *(Opcional)* **Lidarr**, si prefieres delegar en él las descargas.
3. Pulsa **«Identificar y sincronizar»** (arriba a la izquierda). Es la pasada completa: escanea,
   identifica contra MusicBrainz, importa tus escuchas, recalcula discografías y completismo,
   refresca los radares… Corre en segundo plano y **se repite sola cada noche a las 03:00**.

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
| **4. Descargas + importación** | Buscas y descargas por Prowlarr/Jackett (sin el veto de Lidarr). Al terminar un torrent, el **auto-import** lo enlaza (hardlink) a tu biblioteca, sin copiar ni dejar de sembrar. |
| **5. «Lo quiero»** | El ♥ de cualquier disco que aún no tengas lo pone **en vigilancia**: Liderarr lo busca solo en tus indexers hasta que aparece, adelantándose a su estreno. |
| **6. Radar y novedades** | Estrenos de **toda tu colección** (los sigas o no) vía Deezer, separados en discos y canciones; radar de curadores; y **«Descubre»**, novedades por afinidad de artistas parecidos y de tus sellos. Todo marcando lo que ya tienes. |
| **7. Escuchas y retos** | Conecta Last.fm o ListenBrainz para cruzar lo que TIENES con lo que has ESCUCHADO, monta retos con anillos de progreso y saca tu **Resumen** tipo *Wrapped*. |
| **8. Streaming** | Conecta tu cuenta de Spotify y cruza tus **álbumes guardados** con tu colección local, en los dos sentidos. |

**¿Cuándo pasa cada cosa?**

- **Cada pocos minutos (auto-import, por defecto 3 min):** revisa tu cliente de descargas y la
  carpeta, enlaza lo terminado, reescanea esas carpetas nuevas e identifica ligero lo recién
  llegado. Si no hay nada nuevo, no hace nada.
- **Cada hora («Lo quiero»):** busca en tus indexers los discos de tu lista de deseos cuya
  ventana ya está abierta y agarra la mejor release en cuanto aparece. Si la lista está vacía,
  no hace nada.
- **Cada noche a las 03:00 (refresco completo):** auto-importar → escanear → identificar todo lo
  pendiente → importar escuchas → (si usas Lidarr) sincronizar → recalcular discografías y
  completismo → sellos → radar de curadores → discos y canciones nuevas de tu colección →
  radar de descubrimiento → sincronizar tu biblioteca de Spotify → sugerir artistas →
  buscar los discos de «Lo quiero» → auto-descargar estrenos. Es lo que hace
  **«Identificar y sincronizar»** a mano.

---

## 📚 Manual de uso, sección por sección

El menú está agrupado con guiños musicales; aquí va cada sección con lo que hace.

### 🗄️ Coleccionista de discos — tu colección

| Sección | Qué encuentras |
|---|---|
| **Dashboard** | Totales (álbumes, artistas, pistas, tamaño en disco, duración), % sin pérdida y gráficas por década, formato y género. Incluye un **buscador rápido**: escribe y ves al instante lo que tienes; si no lo tienes, busca en MusicBrainz y te deja **seguir** al artista, **descargar** el álbum o marcarlo con **♥ Lo quiero**. |
| **Discoteca** | Toda la colección en parrilla de carátulas, con filtros por género, década, formato, calidad, estado y **«con duplicados»**, y orden configurable. Las **ediciones** distintas se agrupan bien; los discos con varias copias muestran un badge **×N** que abre el panel de copias, y las **cajas multidisco** cuentan como un álbum. Clic derecho (o el botón al pasar el ratón) para **añadir a un reto**. |
| **Ficha de álbum** | Carátula, pistas, calidad y un panel tipo *Roon*: **créditos** y roles, **reseña** (Last.fm) y **valoración** (Discogs), **recomendaciones**, y otras **versiones/ediciones** (MusicBrainz + Discogs). Puedes renombrar el título, corregir el artista, añadir carátula, gestionar copias y cajas, y **crear su ficha en MusicBrainz** si no existe. Enlaces directos a MusicBrainz, Discogs, Record Club y Spotify. |
| **Artistas** | Ranking por nº de álbumes/pistas, con foto (Deezer). Filtros combinables **«Seguidos»** + **«Faltan discos»** y orden **«Más discos por completar»**. Los artistas locales (sin MBID) conviven con los de MusicBrainz. |
| **Ficha de artista** | Discografía por tipo (álbum, EP, single, directo…), con lo que tienes marcado **en vivo**, ámbito de completismo configurable, **«Descargar todos»** los que faltan y ♥ por disco. |
| **Álbumes incompletos** | Álbumes a los que les falta alguna pista (las que hay en disco vs. las que deberían), ordenados por cuántas faltan. El agujero que no se ve hasta que le das al play. |
| **Calidad y disco** | Formatos, sin pérdida vs. con pérdida, sin ReplayGain, sin carátula, formatos mezclados, **duplicados** (clicables) y los más pesados. |
| **Candidatos a upgrade** | Álbumes que podrías mejorar de calidad (p. ej. de MP3 a FLAC), con descarga nativa a un clic. |
| **Sellos** | Sigue sellos discográficos y ve su catálogo cruzado con lo que tienes; el sello aparece también en la ficha del álbum. |

### 🌍 I Hear a New World — descubrir y conseguir

| Sección | Qué encuentras |
|---|---|
| **Seguidos** | Los artistas y sellos que sigues, base del completismo y del radar. Incluye **«Quizá quieras seguir a…»**: artistas similares (Last.fm) que aún no tienes, para seguir de un clic. |
| **Huecos** | Álbumes que te **faltan** de las discografías de tus artistas seguidos. Descarga nativa a un clic, ♥ para vigilarlos, y puedes descartar los que no te interesen. |
| **Lanzamientos** | Nueve vistas del mismo mundo — ver [abajo](#las-nueve-vistas-de-lanzamientos). |
| **Importar descargas** | El cierre del bucle: enlaza (hardlink) tus descargas a la biblioteca organizada. Ver [sección propia](#-importar-descargas-a-la-biblioteca). |

#### Las nueve vistas de «Lanzamientos»

| Pestaña | Qué trae |
|---|---|
| **📅 Mes** | La panorámica, y con la que abre la sección: una rejilla mensual que junta **todas** las fuentes en su día. Cada etiqueta de la leyenda se enciende y se apaga, y tu elección se recuerda. |
| **Próximos** | Estrenos anunciados de tus artistas seguidos (MusicBrainz). |
| **Estrenados recientemente** | Lo ya salido dentro de una ventana que eliges. |
| **💿 Discos nuevos** | Álbumes y EPs recién estrenados por los artistas de **tu colección** (los sigas o no), vía Deezer, semana a semana. Incluye los que **MusicBrainz aún no lista** (marcados con ⚡). |
| **🎵 Canciones nuevas** | Lo mismo para **singles sueltos**, con ventana Hoy / 7 / 30 días. |
| **🌐 Descubre** | Novedades por **afinidad**: artistas parecidos a lo que escuchas (similares de Last.fm) y artistas de tus **sellos seguidos**, ordenados por cercanía a ti y con el porqué («En tu sello X», «Parecido a Y»). |
| **De tus sellos** | Estrenos de los sellos que sigues, aunque no sigas al artista. |
| **Radar** | Novedades curadas: [buymusic.club](https://www.buymusic.club), **Rosy Overdrive**, **Raven Sings the Blues** e **Hipersónica**. |
| **♥ Lo quiero** | Tu lista de deseos vigilada, con el estado de cada uno. Ver [sección propia](#-lo-quiero-la-lista-de-deseos-que-se-descarga-sola). |

> En todas las listas, **lo que ya tienes en disco se agrupa arriba y plegado** («Ya los tienes en
> disco · N»): un estreno que ya descargaste deja de ser noticia, pero sigue a un clic por si
> quieres comprobar que entró. Cada fila lleva **Buscar**, **Añadir a reto**, **♥ Lo quiero**,
> **Descargar** y enlaces a la fuente y a Spotify.

### 🎧 Losing My Edge — escuchas, streaming y retos

| Sección | Qué encuentras |
|---|---|
| **Escuchas** | Con Last.fm o ListenBrainz conectados, cruza lo que **tienes** con lo que has **escuchado**: discos que tienes y no has oído, artistas que escuchas y no tienes, los más escuchados por rango, brecha por fecha… Exportable a **M3U**. |
| **Streaming** | La brecha **disco ↔ streaming** con tu biblioteca de Spotify. Ver [sección propia](#-tu-disco-frente-a-tu-streaming). |
| **Resumen** | Tu *Wrapped* particular, del periodo que quieras (semana, mes, 3 meses, un año, todo): top artistas y álbumes, totales, evolución y un **mosaico de portadas** que puedes **descargar como PNG**. |
| **Retos** | Listas de escucha con **anillos de progreso**. Crea uno vacío y añade discos a mano, o **importa listas** por URL (Album of the Year, Record Club, Rosy Overdrive, Hip Hop Golden Age) o pegando (RYM). Te dice **«lo siguiente por escuchar»** de cada reto y exporta a **M3U**. El botón **«Añadir a reto»** está en cualquier disco de la app y se marca en dorado cuando ya está en uno. |

### 🧩 Identikit — identificación y orden

| Sección | Qué encuentras |
|---|---|
| **Sin identificar** | Cola de resolución: candidatos de MusicBrainz/Discogs, **fijar a mano**, **pegar una URL de MusicBrainz** para enlazar exacto, **crear la ficha en MusicBrainz** si no existe, o marcar como **rareza**/**bootleg**. Reintento masivo o por disco. |
| **Correcciones** | Lista de álbumes que corregiste a mano (artista/título) y los **reubica** en `{artista}/{álbum}` — todos o uno a uno. |
| **Rarezas e inéditos** | Demos, maquetas, inéditos y tomas perdidas. Material que en otras herramientas se pierde: aquí cuenta y no se toca. |
| **Bootlegs** | Directos no oficiales, sesiones de radio y ROIOs, con su propio espacio. Cuentan en tus estadísticas pero no en el completismo. |
| **Papelera** | Copias/álbumes descartados. Descartar **oculta y saca de los recuentos** — no borra el fichero; puedes **deshacer** desde aquí. |

### 🛠️ How did I get here? — sistema

| Sección | Qué encuentras |
|---|---|
| **Novedades de la app** | El changelog en cristiano, versión a versión, marcando en cuál estás. |
| **¿Cómo funciona todo esto?** | El recorrido de la app y cuándo pasa cada cosa. |
| **Ajustes** | Tu música · identificación · Lidarr, Prowlarr/Jackett, qBittorrent e importación · prioridad de trackers · auto-descarga · **vigilancia de «Lo quiero»** · **biblioteca de Spotify** · notificaciones · escritura de etiquetas (opt-in) · **copia de seguridad** · tema claro/oscuro. |
| **Diagnóstico** | Estado de las conexiones y de los procesos de fondo, para cazar problemas. |

---

## 🔎 Cómo identifica tu música

Cada álbum recorre una cadena, de más fiable a último recurso:

1. **MBID en las etiquetas** (si pasaste Picard) — exacto y gratis.
2. **Discografía conocida del artista** — casa el álbum contra los lanzamientos que ya sabemos del
   artista (offline), útil para nombres con caracteres raros.
3. **AcoustID** — huella del audio *real*, con **consenso multipista** (huella varias pistas y se
   queda con el disco que aparece en más de ellas). Caza carpetas mal etiquetadas; necesita `fpcalc`.
4. **MusicBrainz** — búsqueda por texto artista + título, limpiando sufijos de edición
   (Remasterizado, Deluxe, Reissue…) y con respaldo por título verificando el artista
   (AC/DC ↔ ACDC, acentos, signos). Los **recopilatorios** se acotan a *Various Artists*.
5. **Last.fm** — cola larga, resuelve nombres.
6. **Discogs** — red de seguridad para ediciones raras.

Si nada coincide, queda **sin identificar** y decides tú: **rareza**, **bootleg**, **emparejado
manual** (incluye pegar la URL de MusicBrainz), o **crear la ficha** en MusicBrainz desde tu copia
— con la tracklist, duraciones, artistas, año y sello ya rellenos.

**Cajas multidisco:** se auto-agrupan por nombre de carpeta (CD1/CD2…) y por los tags
`DISCNUMBER`, se pueden combinar y separar a mano, e identificarse como **una unidad** en
MusicBrainz para ver «N de M discos» y saber si te falta alguno.

---

## ⬇️ Conseguir lo que te falta

Desde cualquier hueco, upgrade, ficha de artista, sello o lanzamiento puedes **buscar y descargar**
sin salir de la app:

- **Nativo (recomendado):** **Prowlarr** o **Jackett** buscan en tus indexers (Torznab) y tu
  cliente materializa la descarga. Eliges la release, con soporte de **freeleech** y
  **prioridad de trackers** (a igual calidad, tira de tu tracker preferido y luego por seeders).
- **Lidarr (opcional):** si lo tienes configurado, puedes seguir delegando en él.

El **auto-grab** puede descargar estrenos de tus artistas seguidos automáticamente en el refresco
nocturno. Y para todo lo demás está **«Lo quiero»**.

---

## ♥ «Lo quiero»: la lista de deseos que se descarga sola

El botón **♥ Lo quiero** aparece en **cualquier disco que aún no tengas** — al buscarlo, en el
calendario, en el radar, en los huecos de un artista o en la brecha de streaming. Un clic y ese
disco queda **vigilado**: Liderarr lo busca solo en tus indexers y agarra la mejor release en
cuanto aparece, **aunque no sigas al artista**. Vuelves a pulsar y deja de vigilarlo.

**Se adelanta al estreno.** Un disco que sale el **viernes** empieza a aparecer en los indexers
el **jueves por la mañana** (sale antes en Oceanía y las promos se filtran). Por eso la vigilancia
abre **16 horas antes** de la fecha oficial —ajustable—: para un estreno del viernes, el jueves a
las 08:00. Lo que sale de madrugada te lo encuentras descargado por la mañana, con aviso.

**Con freno, para no machacar tus trackers.** La cadencia se mide desde que se abre la ventana:
cada hora las primeras 48 h, cada 3 h la primera semana, cada 12 h después. Antes de la ventana
no se gasta ni una sola llamada al indexer, y un disco ya pedido no se pide dos veces.

La lista vive en **Lanzamientos → ♥ Lo quiero**, con el estado de cada deseo (*sale el…*, *sin
release válida*, *pedido*, *ya en tu disco*), un botón para buscar ahora y otro para quitarlo. Los
deseos se cierran solos cuando el disco entra en tu biblioteca.

---

## 💿 Tu disco frente a tu streaming

La página **Streaming** conecta tu cuenta de Spotify (**solo lectura** para mirar; con permiso de
escritura si quieres guardar) y cruza tus **álbumes guardados** con tu colección local:

- **⬇️ En Spotify, no en tu disco** — lo que escuchas en streaming y no tienes. Botón **Descargar**,
  **♥ Lo quiero** y enlace a Spotify.
- **⬆️ En tu disco, no en Spotify** — lo que tienes y no está en tu biblioteca de streaming.
  **«Guardar en Spotify»** de un clic (o el enlace ↗ para hacerlo a mano).

Con contadores de guardados / en disco / en ambos / en la brecha, filtro de texto y un toggle
opcional **«Solo álbumes»** que deja fuera singles, EPs y recopilatorios.

**Cómo conectarla:** Ajustes → *Biblioteca de Spotify*. Por las reglas de Spotify (2025) el
redirect debe ser **HTTPS** o **loopback** (`http://127.0.0.1:puerto`) — una IP de tu LAN no vale —,
así que el flujo normal es **«pega el código»**: registras el redirect que te indica la app,
apruebas en Spotify y pegas el `code` que te devuelve. Si sirves Liderarr por HTTPS y registras
`…/callback`, se completa solo.

> Si tu app de Spotify está en *modo desarrollo*, añade tu cuenta en **User Management** o la
> autorización fallará con `server_error`. La app te lo dice con ese nombre y todo.

---

## 📥 Importar descargas a la biblioteca

Liderarrr **enlaza (hardlink)** lo que bajas a tu biblioteca organizada `{artista}/{álbum (año)}`,
como hace Lidarr pero **sin su veto de metadatos**. Reglas de oro: **nunca borra ni copia el
origen** (sigues sembrando) y solo enlaza (0 espacio extra si comparten volumen).

- **Auto-import:** cada pocos minutos enlaza lo que haya terminado. Funciona con **cualquier
  cliente**: barre la carpeta de descargas e importa lo que esté **completo** (estable: sin
  cambios en los últimos 5 minutos) y aún no importado. Si además configuras qBittorrent, lo
  consulta para enterarse antes. También coge **torrents de un solo fichero** (singles, remixes).
- **Diagnóstico por ítem:** cada descarga «sin importar» dice **por qué** no se auto-importó —
  *«Varios álbumes en una carpeta»* (vertedero), *«Ya en tu biblioteca»*, *«N aún bajando
  (esperando)»* o *«Lista para importar»* — mostrando la carpeta que mira.
- **Importar por álbumes:** si una carpeta contiene varios discos, la despliega en sus subcarpetas
  y las importa **una a una**, en vez de colapsarlas en un álbum mal etiquetado.
- **Ocultar / «Ya la tengo»:** saca de la lista lo que no quieras importar; ni se importa ni lo
  coge el auto-import (reversible).
- **Remapeo de rutas:** si tu cliente reporta una ruta distinta a la que Liderarr tiene montada,
  una regla `rutaCliente => rutaLocal` en Ajustes lo traduce.

---

## 🔔 Avisos y copias de seguridad

- **Notificaciones por webhook** (Discord, Slack, ntfy): Liderarr te avisa cuando **importa
  descargas** —diciendo **qué** discos entraron, no solo cuántos—, cuando hay **novedades** de tus
  artistas y cuando pilla algo de **«Lo quiero»**. En Ajustes → *Notificaciones*.
- **Copia de seguridad:** descarga tu base de datos completa desde Ajustes, y **restáurala**
  subiendo el `.db` cuando lo necesites. Al restaurar se valida el fichero, se guarda un respaldo
  automático de la base actual y la app se reinicia sola.

---

## 📱 En el móvil

La interfaz está adaptada a móviles modernos (iPhone incluido): barra superior con menú
deslizable, respeto del *notch* y el área segura, y los campos no provocan zoom al enfocarlos. En
pantallas estrechas las filas de lanzamientos y de streaming **se apilan** —título arriba con todo
el ancho, botones debajo— para que se lea el disco entero. Puedes usar toda la app desde el
teléfono.

---

## 🔒 Privacidad y seguridad

- Todo corre y se guarda en tu máquina (SQLite en `/data`). **Sin cuentas, sin telemetría.**
- Por defecto Liderarrr **nunca escribe** en tus ficheros de música (monta la carpeta en `:ro`).
  Existe una opción **opt-in** para escribir *solo los MBID* en álbumes ya identificados, con
  previsualización y confirmación, y nunca sobre rarezas (requiere activarla **y** montar la
  música en `:rw`).
- Credenciales cifradas en disco con `LIDERARRR_SECRET` (AES-256-GCM). Incluye el token de
  Spotify, que además solo se pide con los permisos mínimos.
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
- A **Serge**, por ser el mejor tester posible. Heaven knows you're miserable now. 
- A **los hipersónicos**, en general.
- A **Sanpitopato**. Seguimosseguimos.

Datos por cortesía de [MusicBrainz](https://musicbrainz.org), [AcoustID](https://acoustid.org),
[Discogs](https://discogs.com), [Last.fm](https://last.fm), [ListenBrainz](https://listenbrainz.org),
[Deezer](https://deezer.com) y [Spotify](https://spotify.com). Gracias a
[Lidarr](https://lidarr.audio) por su API, y a [Cmdarr](https://github.com/DeviantEng/Cmdarr) por
la inspiración del descubrimiento de novedades.

Licencia [MIT](LICENSE).

---

*The enemy is everywhere.*
