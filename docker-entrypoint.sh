#!/bin/sh
set -e

# Aviso temprano si fpcalc no está: la identificación por huella (AcoustID) se
# apagará sola, pero el resto de la cadena sigue funcionando.
if ! command -v fpcalc >/dev/null 2>&1; then
  echo "[Liderarrr] AVISO: fpcalc no encontrado; AcoustID (huella acústica) quedará desactivado."
fi

exec "$@"
