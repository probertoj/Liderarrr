# 📗 Instalar Liderarrr en Synology (Container Manager)

Guía para DSM 7.2 o superior con **Container Manager** (el antiguo «Docker»). Al
final tendrás Liderarrr en `http://IP-DE-TU-NAS:3861`, con la configuración guardada
para siempre y tu música montada en **solo lectura** (Liderarrr nunca la toca).

> **Lo único imprescindible que no puede fallar:** la carpeta que mapees a `/data`
> es donde vive TODO (ajustes, credenciales, biblioteca, caché). Mientras esa
> carpeta exista, tu configuración sobrevive a reinicios y actualizaciones.

## 1 · Prepara las carpetas

En **File Station** crea una carpeta para los datos de Liderarrr, por ejemplo dentro
de la carpeta compartida `docker`:

```
/docker/liderarrr/data
```

Localiza también la ruta de tu **música** (una carpeta compartida existente), por
ejemplo `/music` o `/volume1/Musica`.

## 2 · Crea el proyecto

1. Abre **Container Manager → Proyecto → Crear**.
2. **Nombre del proyecto:** `liderarrr`.
3. **Ruta:** elige `/docker/liderarrr`.
4. **Fuente:** «Crear docker-compose.yml» y pega esto (ajusta la ruta de la música):

```yaml
services:
  liderarrr:
    image: ghcr.io/probertoj/liderarrr:latest
    container_name: liderarrr
    restart: unless-stopped
    ports:
      - '3861:3861'
    volumes:
      - /volume1/docker/liderarrr/data:/data
      # Tu música, SIEMPRE en solo lectura (:ro). Liderarrr no escribe en ella.
      - /volume1/Musica:/music:ro
    environment:
      - TZ=Europe/Madrid
      # Recomendado: cifra las credenciales guardadas en /data.
      # Elige una frase larga y NO la cambies después (si cambia, no se
      # podrán descifrar las credenciales ya guardadas).
      - LIDERARRR_SECRET=cambia-esto-por-una-frase-larga-y-secreta
      # Si el NAS es accesible desde fuera de casa, protege el panel:
      # - LIDERARRR_AUTH=usuario:contraseña
```

5. Pulsa **Siguiente** hasta **Hecho**. Container Manager descargará la imagen y
   arrancará el contenedor (la primera vez tarda un poco).

## 3 · Permisos de la carpeta de datos

Si al abrir la app ves un aviso de que `/data` no es escribible, dale permisos a la
carpeta `docker/liderarrr/data`: **File Station → clic derecho → Propiedades →
Permiso**, y concede lectura/escritura al usuario que ejecuta Docker (o a
`everyone` si tu NAS está solo en la red local).

## 4 · Primeros pasos en la app

1. Abre `http://IP-DE-TU-NAS:3861`.
2. Ve a **Ajustes** y en «Tu música» escribe la ruta **dentro del contenedor**:
   `/music` (no la ruta del NAS).
3. Rellena lo que quieras usar (AcoustID, Discogs, Last.fm, Lidarr) y pulsa
   **Guardar**.
4. En la barra lateral, pulsa **Actualizar todo**. El primer escaneo e
   identificación corren en segundo plano; puedes ir mirando el Dashboard mientras.

A partir de ahí, Liderarrr se actualiza solo cada noche a las 03:00.

## 5 · Actualizar a una versión nueva

**Container Manager → Proyecto → liderarrr → Acción → Detener**, luego
**Construir/Descargar** de nuevo (o «Clean and rebuild»). Tus datos en
`docker/liderarrr/data` no se tocan.

## Notas

- **Puerto ocupado:** si el 3861 ya está en uso, cambia el mapeo a, p. ej.,
  `- '8961:3861'` y abre `http://IP:8961`.
- **Copia de seguridad:** en **Ajustes → Copia de seguridad** puedes descargar la
  base de datos entera cuando quieras.
