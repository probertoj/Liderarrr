import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

// Avisos y confirmaciones de la app, en lugar de alert() y confirm() del navegador.
// Los del navegador CONGELAN la pestaña entera (se para hasta el reloj del escaneo),
// salen con el título del dominio y un «localhost:3861 dice», no se pueden leer en el
// móvil sin aceptar, y no se parecen en nada al resto de la interfaz.
//
// La API es imperativa a propósito —`aviso(...)`, `await confirmar(...)`— porque así se
// llama desde donde se llamaba antes, incluidos los `catch` sueltos y los manejadores que
// no son componentes. Por dentro es una tienda minúscula fuera de React con un único
// suscriptor montado en la raíz.

let siguienteId = 1;
const oyentes = new Set();
let estado = { avisos: [], pregunta: null };

function publicar(siguiente) {
  estado = siguiente;
  for (const o of oyentes) o(estado);
}

const DURACION = { error: 9000, ok: 4000, info: 6000 };

/**
 * Enseña un aviso flotante. `tipo`: 'error' | 'ok' | 'info'.
 * Se va solo (los errores duran más) y se puede cerrar a mano.
 */
export function aviso(mensaje, tipo = 'info') {
  const texto = String(mensaje?.message ?? mensaje ?? '').trim() || 'Algo ha pasado, pero sin detalle.';
  const id = siguienteId++;
  // Más de cuatro a la vez no se leen: se quedan los últimos.
  const avisos = [...estado.avisos, { id, texto, tipo }].slice(-4);
  publicar({ ...estado, avisos });
  setTimeout(() => cerrarAviso(id), DURACION[tipo] ?? DURACION.info);
  return id;
}

export function cerrarAviso(id) {
  if (!estado.avisos.some((a) => a.id === id)) return;
  publicar({ ...estado, avisos: estado.avisos.filter((a) => a.id !== id) });
}

/**
 * Pregunta de sí o no. Devuelve una promesa que resuelve a true/false, así que en quien
 * llama es `if (!(await confirmar('¿...?'))) return;`.
 * Opciones: { aceptar, cancelar, peligro } — `peligro` pinta el botón en rojo.
 */
export function confirmar(mensaje, opciones = {}) {
  return new Promise((resolve) => {
    // Si ya había una pregunta en pantalla, la anterior se responde que no: nunca se
    // queda una promesa colgada esperando a alguien que ya no puede contestar.
    if (estado.pregunta) estado.pregunta.resolve(false);
    publicar({
      ...estado,
      pregunta: {
        texto: String(mensaje ?? ''),
        aceptar: opciones.aceptar || 'Sí',
        cancelar: opciones.cancelar || 'Cancelar',
        peligro: !!opciones.peligro,
        resolve,
      },
    });
  });
}

function responder(valor) {
  const p = estado.pregunta;
  if (!p) return;
  publicar({ ...estado, pregunta: null });
  p.resolve(valor);
}

const ESTILOS = {
  error: { icono: AlertTriangle, clase: 'aviso-error' },
  ok: { icono: CheckCircle2, clase: 'aviso-ok' },
  info: { icono: Info, clase: 'aviso-info' },
};

function Pila({ avisos }) {
  if (!avisos.length) return null;
  return (
    <div
      className="fixed z-[60] right-4 bottom-4 left-4 sm:left-auto flex flex-col gap-2 max-w-md sm:w-[26rem] pb-[env(safe-area-inset-bottom)]"
      aria-live="polite"
    >
      {avisos.map((a) => {
        const { icono: Icono, clase } = ESTILOS[a.tipo] || ESTILOS.info;
        return (
          <div
            key={a.id}
            role={a.tipo === 'error' ? 'alert' : 'status'}
            className={`aviso ${clase} px-3 py-2.5 shadow-xl flex items-start gap-2.5`}
          >
            <Icono size={16} className="mt-0.5 shrink-0" />
            {/* pre-line porque varios mensajes vienen con saltos de línea de cuando eran alert() */}
            <div className="text-sm leading-snug whitespace-pre-line break-words min-w-0 flex-1 max-h-[40vh] overflow-y-auto">{a.texto}</div>
            <button
              onClick={() => cerrarAviso(a.id)}
              className="opacity-60 hover:opacity-100 shrink-0"
              aria-label="Cerrar aviso"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function Pregunta({ pregunta }) {
  const botonRef = useRef(null);

  useEffect(() => {
    if (!pregunta) return;
    botonRef.current?.focus();
    const alPulsar = (e) => {
      if (e.key === 'Escape') responder(false);
      // Enter confirma solo si el foco sigue en el botón: evita aceptar sin querer.
      if (e.key === 'Enter' && document.activeElement === botonRef.current) responder(true);
    };
    window.addEventListener('keydown', alPulsar);
    return () => window.removeEventListener('keydown', alPulsar);
  }, [pregunta]);

  if (!pregunta) return null;
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/60"
      onClick={() => responder(false)}
      role="dialog"
      aria-modal="true"
    >
      <div className="card p-4 w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="text-sm leading-relaxed whitespace-pre-line text-neutral-200">{pregunta.texto}</div>
        <div className="flex items-center justify-end gap-2 mt-4">
          <button
            onClick={() => responder(false)}
            className="text-sm px-3 py-1.5 rounded-lg border border-ink-700 bg-ink-850 hover:bg-ink-800 transition"
          >
            {pregunta.cancelar}
          </button>
          <button
            ref={botonRef}
            onClick={() => responder(true)}
            className={`text-sm px-3 py-1.5 rounded-lg transition hover:brightness-110 ${
              pregunta.peligro ? 'boton-peligro' : 'boton-si'
            }`}
          >
            {pregunta.aceptar}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Va una sola vez, en la raíz de la app. */
export function Avisos() {
  const [v, setV] = useState(estado);
  useEffect(() => {
    oyentes.add(setV);
    setV(estado); // por si algo avisó entre el render y este efecto
    return () => oyentes.delete(setV);
  }, []);
  return (
    <>
      <Pila avisos={v.avisos} />
      <Pregunta pregunta={v.pregunta} />
    </>
  );
}
