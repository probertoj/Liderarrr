# 📙 Instalar Liderarrr en UNRAID

Guía para añadir Liderarrr como contenedor Docker en UNRAID sin plantilla de
Community Applications (se configura a mano una sola vez). Al final tendrás
Liderarrr en `http://IP-DE-TU-SERVIDOR:3861`.

> **Lo único imprescindible que no puede fallar:** el mapeo a `/data` es donde vive
> TODO (ajustes, credenciales, biblioteca, caché). Mientras ese recurso exista, tu
> configuración sobrevive a reinicios y actualizaciones de la imagen.

## 1 · Añade el contenedor

**Docker → Add Container**, y rellena:

| Campo | Valor |
|---|---|
| **Name** | `Liderarrr` |
| **Repository** | `ghcr.io/probertoj/liderarrr:latest` |
| **Network Type** | `bridge` |
| **WebUI** | `http://[IP]:[PORT:3861]/` |

## 2 · Puerto, rutas y variables

Pulsa **Add another Path, Port, Variable, Label or Device** por cada fila:

**Puerto**
| Tipo | Nombre | Container Port | Host Port |
|---|---|---|---|
| Port | WebUI | `3861` | `3861` |

**Rutas (Path)**
| Nombre | Container Path | Host Path | Access Mode |
|---|---|---|---|
| Datos | `/data` | `/mnt/user/appdata/liderarrr` | Read/Write |
| Música | `/music` | `/mnt/user/Musica` | **Read Only** |

> La música **siempre en Read Only**: Liderarrr no escribe nunca en tus ficheros.

**Variables (Variable)**
| Nombre | Key | Value |
|---|---|---|
| Zona horaria | `TZ` | `Europe/Madrid` |
| Cifrado de credenciales | `LIDERARRR_SECRET` | *una frase larga y secreta* |
| Autenticación (opcional) | `LIDERARRR_AUTH` | `usuario:contraseña` |

- `LIDERARRR_SECRET` (recomendado) cifra en disco las credenciales que guardes.
  Elígela una vez y **no la cambies** después: si cambia, no se podrán descifrar
  las que ya estén guardadas.
- `LIDERARRR_AUTH` protege el panel con usuario y contraseña. Ponla si expones el
  servidor fuera de tu red local.

Pulsa **Apply**. UNRAID descargará la imagen y arrancará el contenedor.

## 3 · Primeros pasos en la app

1. Abre `http://IP-DE-TU-SERVIDOR:3861` (o pulsa el icono → **WebUI**).
2. Ve a **Ajustes** y en «Tu música» escribe la ruta **dentro del contenedor**:
   `/music` (no `/mnt/user/Musica`).
3. Rellena lo que quieras usar (AcoustID, Discogs, Last.fm, Lidarr) y **Guarda**.
4. En **Ajustes → Tu música** pulsa **Escanear**. Después, **Identificar y
   sincronizar** (barra lateral) la cruza con MusicBrainz, Last.fm y Lidarr. Todo
   corre en segundo plano.

Después, Liderarrr se actualiza solo cada noche a las 03:00.

## 4 · Actualizar a una versión nueva

Con la imagen en `:latest`, basta con **Docker → clic en Liderarrr → Force update**
(o activa *auto-update* con el plugin CA Auto Update Applications). El recurso
`appdata/liderarrr` no se toca, así que no pierdes nada.

## Notas

- **Permisos:** si ves un aviso de que `/data` no es escribible, asegúrate de que
  `/mnt/user/appdata/liderarrr` pertenece a `nobody:users` (lo normal en appdata) o
  ejecuta `chown -R nobody:users /mnt/user/appdata/liderarrr` desde el terminal.
- **AcoustID:** la huella acústica ya funciona sin instalar nada: `fpcalc` viene
  dentro de la imagen.
- **Copia de seguridad:** **Ajustes → Copia de seguridad** descarga la base de
  datos entera cuando quieras.
