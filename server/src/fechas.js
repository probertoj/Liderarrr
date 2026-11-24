// «Hoy» como lo entiende quien usa la app: la fecha del reloj del servidor (el contenedor
// lleva TZ=Europe/Madrid), no la de UTC. Con `new Date().toISOString().slice(0, 10)` la
// frontera entre «por salir» y «ya publicado» iba un día por detrás entre medianoche y la
// una o las dos de la madrugada.
export function hoyLocal(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
