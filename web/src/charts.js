import { useEffect, useState } from 'react';

// Recharts pinta el SVG con strings de color literales, así que no puede usar
// clases de Tailwind ni seguir el cambio de tema por su cuenta. Todo lo que
// dibuja una gráfica sale de las variables --chart-* de index.css, resueltas
// aquí a hex/rgba. Por eso ningún componente de gráfica escribe un color propio:
// los tooltips oscuros se volvían ilegibles en modo claro.
function readChartVars() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name) => cs.getPropertyValue(`--chart-${name}`).trim();
  return {
    axis: v('axis') || '#71717a',
    grid: v('grid') || 'rgba(255,255,255,.08)',
    cursor: v('cursor') || 'rgba(255,255,255,.06)',
    accent: v('accent') || '#d4a24a',
    accent2: v('2') || '#c98a3a',
    positive: v('positive') || '#34d399',
    tooltip: {
      backgroundColor: v('tip-bg') || '#191921',
      border: `1px solid ${v('tip-border') || '#2c2c39'}`,
      borderRadius: 8,
      color: v('tip-fg') || '#e6e6ee',
    },
    tooltipLabel: { color: v('tip-fg') || '#e6e6ee', fontWeight: 600 },
    tooltipItem: { color: v('tip-fg') || '#e6e6ee' },
  };
}

// El tema se cambia añadiendo/quitando la clase .light en <html>: se relee ahí.
export function useChartTheme() {
  const [theme, setTheme] = useState(readChartVars);
  useEffect(() => {
    const obs = new MutationObserver(() => setTheme(readChartVars()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return theme;
}
