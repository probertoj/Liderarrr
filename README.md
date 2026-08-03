# 🎵 Liderarrr

> **Alpha 0.1.0** · Panel de completismo para tu colección de música digital. Escanea tus
> ficheros, los identifica contra MusicBrainz / AcoustID / Discogs / Last.fm, y te enseña qué
> tienes, qué te falta y qué es una rareza. Junto a **Lidarr**, no dentro de él.

Liderarrr es primo musical de [PowaFlex](https://github.com/ForeverRamone/PowaFlex) (que hace
lo mismo para cine con Plex). La diferencia de fondo, y su principio rector:

> **Tus ficheros mandan. MusicBrainz anota. Lidarr solo ejecuta.**

Tu disco duro es la única fuente de verdad. Un álbum existe en Liderarrr aunque no esté en
ninguna base de datos profesional: las maquetas, bootlegs e inéditos son ciudadanos de primera
clase (estado *rareza*), cuentan en tus estadísticas y no se pierden nunca. Lidarr, como Radarr
en PowaFlex, es solo el actuador al que mandas lo que te falta.

## ✨ Qué hace (fase 1)

| Sección | Qué encuentras |
|---|---|
| 📊 **Dashboard** | Totales (álbumes, artistas, pistas, disco, duración), % sin pérdida, y gráficas por década, formato y género. |
| 💿 **Discoteca** | Toda la colección en parrilla de carátulas, con filtros por género, década, formato, calidad y estado. |
| 🧑‍🎤 **Artistas** | Ranking por nº de álbumes/pistas. Artistas locales (sin MBID) conviven con los de MusicBrainz. |
| 📦 **Álbumes incompletos** | *La feature estrella*: álbumes a los que les falta alguna pista (pistas en disco vs. las que deberían tener), ordenados por cuántas. |
| 💾 **Calidad y disco** | Formatos, sin pérdida vs. con pérdida, sin ReplayGain, sin carátula, formatos mezclados, duplicados y más pesados. |
| ❓ **Sin identificar** | Cola de resolución: candidatos de MusicBrainz/Discogs, fijar a mano o marcar como rareza. |
| ✨ **Rarezas e inéditos** | Las maquetas, bootlegs y directos no oficiales que marcaste. Material que en otras herramientas se pierde. |

## 🔎 Cómo identifica

Cada álbum recorre una cadena, de más fiable a último recurso (ver el flujo en los diagramas):

1. **MBID en las etiquetas** (si pasaste Picard) — exacto, gratis.
2. **AcoustID** — huella del audio *real*, caza carpetas mal etiquetadas (necesita `fpcalc`).
3. **MusicBrainz** — búsqueda por texto artista + título.
4. **Last.fm** — cola larga, resuelve nombres.
5. **Discogs** — red de seguridad para ediciones raras (resolución asistida).

Si nada coincide, queda *sin identificar* y decides tú: **rareza** o **emparejado manual**.

## 📋 Requisitos

- **Docker** en cualquier máquina de tu red, con acceso (solo lectura) a tu carpeta de música.
- Opcionales, todos gratuitos: clave de **AcoustID**, token de **Discogs**, clave de **Last.fm**.
- **Lidarr** (opcional, solo para enviar lo que te falta).

## 🚀 Instalación

```yaml
services:
  liderarrr:
    image: ghcr.io/probertoj/liderarrr:latest
    container_name: liderarrr
    restart: unless-stopped
    ports:
      - '3861:3861'
    volumes:
      - ./data:/data
      - /ruta/a/tu/musica:/music:ro
    environment:
      - TZ=Europe/Madrid
      # Recomendado: cifra las credenciales en disco (elige una frase larga y no la cambies).
      # - LIDERARRR_SECRET=una-frase-larga-y-secreta
```

```bash
docker compose up -d
```

Abre `http://IP-DEL-HOST:3861` → **Ajustes** → pon tu carpeta de música (`/music`) → «Actualizar
todo». El escaneo y la identificación corren en segundo plano y se repiten solos cada noche (03:00).

### Guías paso a paso por plataforma

- 📗 **[Synology DSM (Container Manager)](docs/synology.md)**
- 📙 **[UNRAID](docs/unraid.md)**

> **Persistencia:** todo (ajustes, credenciales, biblioteca, caché) vive en un único fichero SQLite
> dentro de `/data`. Mientras montes esa carpeta como volumen, tu configuración sobrevive a
> reinicios y actualizaciones de la imagen. Liderarrr avisa al arrancar si `/data` no es escribible.

## 🧑‍💻 Desarrollo local

```bash
npm install
npm run dev        # API en :3861 + frontend Vite en :5174
```

Para AcoustID en local necesitas `fpcalc` (Chromaprint) en el PATH. En Windows:
`choco install chromaprint` o `scoop install chromaprint`.

Stack: Node 24 · Fastify · better-sqlite3 · music-metadata · React 19 · Vite · Tailwind 4 · Recharts.
Los datos van a `server/data/` (configurable con `DATA_DIR`).

## 🔒 Privacidad y seguridad

- Todo corre y se guarda en tu máquina (SQLite en `/data`). Sin cuentas, sin telemetría.
- Liderarrr **nunca escribe** en tus ficheros de música (monta la carpeta en `:ro`).
- Credenciales cifradas en disco con `LIDERARRR_SECRET` (AES-256-GCM).
- Autenticación básica opcional con `LIDERARRR_AUTH="usuario:contraseña"`.

## 🙏 Créditos

Liderarrr es un **fork conceptual de [PowaFlex](https://github.com/ForeverRamone/PowaFlex)**, la
idea original de **[ForeverRamone](https://github.com/ForeverRamone)** para cine sobre Plex. Todo
el planteamiento —leer tu biblioteca en local, cruzarla con una base de datos externa, calcular
completismo y cazar lo que falta— nace de su trabajo; Liderarrr solo lo lleva al terreno de la
música y Lidarr.

Gracias en especial:

- A **ForeverRamone**, por PowaFlex y por la idea de la que sale todo esto.
- A **los hipersónicos**.
- A **Sanpitopato**. Seguimosseguimos. 

Datos por cortesía de [MusicBrainz](https://musicbrainz.org), [AcoustID](https://acoustid.org),
[Discogs](https://discogs.com) y [Last.fm](https://last.fm). Gracias a
[Lidarr](https://lidarr.audio) por su API.

Licencia [MIT](LICENSE).

---

*The enemy is everywhere.*
