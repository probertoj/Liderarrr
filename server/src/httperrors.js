// Un único sitio donde se decide qué ve la interfaz cuando algo revienta en el servidor.
// Sin manejador propio, Fastify responde {error:'Internal Server Error', message:'<el motivo
// de verdad>'} y la interfaz, que lee `error`, enseñaba justo la mitad inútil: un aviso que
// no dice nada y no deja rastro en Diagnóstico. De las 200+ rutas solo un puñado atrapa sus
// propios fallos, así que esto cubre todas las demás de una vez.

// Los nombres de estado de HTTP no son un motivo: si el mensaje es uno de estos, el error
// venía sin explicación y es mejor mandar a Diagnóstico, donde sí está la traza.
const GENERICOS = new Set([
  'Internal Server Error',
  'Bad Request',
  'Not Found',
  'Unauthorized',
  'Forbidden',
  'Conflict',
  'Unprocessable Entity',
  'Service Unavailable',
]);

// Los únicos mensajes de Fastify que un usuario puede provocar de verdad (subir una copia
// enorme, o un cliente que manda el cuerpo vacío). El resto llega ya explicado por nosotros.
const TRADUCCIONES = [
  [/too large/i, 'El archivo es demasiado grande'],
  [/body cannot be empty/i, 'La petición llegó sin datos'],
];

export function motivoDeError(err) {
  const bruto = String(err?.message ?? err ?? '').trim();
  if (!bruto || GENERICOS.has(bruto)) return 'Error inesperado en el servidor (mira Diagnóstico)';
  for (const [re, texto] of TRADUCCIONES) if (re.test(bruto)) return texto;
  return bruto.slice(0, 500);
}

export function codigoDeError(err) {
  const n = Number(err?.statusCode);
  return Number.isInteger(n) && n >= 400 && n <= 599 ? n : 500;
}

export function errorPayload(err) {
  const code = codigoDeError(err);
  const error = motivoDeError(err);
  // `message` va con el mismo texto: es el nombre que usa Fastify y el que miran los
  // clientes antiguos, y así ninguno de los dos acaba enseñando lo genérico.
  return { code, body: { error, message: error, statusCode: code } };
}

export function installErrorHandler(app) {
  app.setErrorHandler((err, req, reply) => {
    const { code, body } = errorPayload(err);
    const donde = `${req.method} ${(req.raw.url || '').split('?')[0]}`;
    // console.error/warn pasan por diag.js, así que el fallo queda en Diagnóstico con su traza.
    if (code >= 500) console.error(`[api] ${donde} falló:`, err);
    else console.warn(`[api] ${donde} — ${code}: ${body.error}`);
    // Si la respuesta ya iba en camino (una carátula a medio enviar, por ejemplo) no se puede
    // cambiar por un JSON: solo queda cortar la conexión.
    if (reply.raw.headersSent) {
      reply.raw.destroy();
      return;
    }
    return reply.code(code).type('application/json; charset=utf-8').send(body);
  });
}
