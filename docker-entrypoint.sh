#!/bin/sh
set -e

# Aviso temprano si fpcalc no está: la identificación por huella (AcoustID) se
# apagará sola, pero el resto de la cadena sigue funcionando.
if ! command -v fpcalc >/dev/null 2>&1; then
  echo "[Liderarrr] AVISO: fpcalc no encontrado; AcoustID (huella acústica) quedará desactivado."
fi

DATA_DIR="${DATA_DIR:-/data}"

# De fábrica el contenedor sigue arrancando como root, igual que siempre: en una
# instalación que ya existe los ficheros de /data los creó root, y cambiar de usuario
# por las bravas dejaría a la app sin poder escribir su propia base de datos. Con
# PUID/PGID —los mismos nombres que usan las demás *arr— suelta los privilegios.
if [ "$(id -u)" = "0" ] && { [ -n "$PUID" ] || [ -n "$PGID" ]; }; then
  uid="${PUID:-1000}"
  gid="${PGID:-1000}"

  # Solo los ficheros que son NUESTROS. Nunca "$DATA_DIR" entero: en la estructura
  # recomendada esa carpeta es la raíz de tu música y tus descargas, y un chown -R ahí
  # sería largo, ajeno y difícil de deshacer.
  for f in "$DATA_DIR/liderarrr.db" "$DATA_DIR/liderarrr.db-wal" "$DATA_DIR/liderarrr.db-shm"; do
    if [ -e "$f" ]; then chown "$uid:$gid" "$f" || true; fi
  done
  for d in "$DATA_DIR/img" "$DATA_DIR/backups"; do
    if [ -d "$d" ]; then chown -R "$uid:$gid" "$d" || true; fi
  done

  # Y antes de soltar el timón: ¿puede ese usuario escribir donde vive la base, y la base
  # misma si ya existe? Si no, seguir como root es mucho menos malo que arrancar sin ajustes
  # (o peor: que morir aquí y dejar el contenedor en bucle de reinicio).
  puede='test -w "$DATA_DIR" && { [ ! -e "$DATA_DIR/liderarrr.db" ] || [ -w "$DATA_DIR/liderarrr.db" ]; }'
  if DATA_DIR="$DATA_DIR" gosu "$uid:$gid" sh -c "$puede"; then
    echo "[Liderarrr] Sin privilegios: corriendo como uid=$uid gid=$gid."
    exec gosu "$uid:$gid" "$@"
  fi
  echo "[Liderarrr] AVISO: uid=$uid no puede escribir en $DATA_DIR, así que sigo como root"
  echo "[Liderarrr]        para no dejarte sin base de datos. Arréglalo con:"
  echo "[Liderarrr]        chown -R $uid:$gid <la carpeta que montas en $DATA_DIR>"
elif [ "$(id -u)" = "0" ]; then
  echo "[Liderarrr] Corriendo como root. Para que no lo haga, define PUID y PGID con los"
  echo "[Liderarrr] números de tu usuario (los que te da «id») o pon user: en el compose."
fi

exec "$@"
