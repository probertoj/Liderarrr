import { useEffect, useState, lazy, Suspense } from 'react';
import { Routes, Route, NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Disc, Users, HardDrive, PackageOpen, HelpCircle,
  Sparkles, Settings as SettingsIcon, Menu, X, RefreshCw, Star, Compass, CalendarClock,
  Headphones, Trophy, ArrowUpCircle, Building2, Sun, Moon, Stethoscope, Trash2, DownloadCloud, ExternalLink, Wrench, Rocket, PartyPopper, Radio, Library as LibraryIcon,
} from 'lucide-react';
import { api } from './api.js';
import { Spinner, ErrorBoundary } from './components.jsx';

const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const Library = lazy(() => import('./pages/Library.jsx'));
const AlbumDetail = lazy(() => import('./pages/AlbumDetail.jsx'));
const Artists = lazy(() => import('./pages/Artists.jsx'));
const ArtistDetail = lazy(() => import('./pages/ArtistDetail.jsx'));
const Incomplete = lazy(() => import('./pages/Incomplete.jsx'));
const Quality = lazy(() => import('./pages/Quality.jsx'));
const Unidentified = lazy(() => import('./pages/Unidentified.jsx'));
const Rarities = lazy(() => import('./pages/Rarities.jsx'));
const Bootlegs = lazy(() => import('./pages/Bootlegs.jsx'));
const Tracked = lazy(() => import('./pages/Tracked.jsx'));
const Discover = lazy(() => import('./pages/Discover.jsx'));
const Calendar = lazy(() => import('./pages/Calendar.jsx'));
const Listening = lazy(() => import('./pages/Listening.jsx'));
const Challenges = lazy(() => import('./pages/Challenges.jsx'));
const Upgrades = lazy(() => import('./pages/Upgrades.jsx'));
const Labels = lazy(() => import('./pages/Labels.jsx'));
const Diagnostics = lazy(() => import('./pages/Diagnostics.jsx'));
const Imports = lazy(() => import('./pages/Imports.jsx'));
const HowItWorks = lazy(() => import('./pages/HowItWorks.jsx'));
const Corrections = lazy(() => import('./pages/Corrections.jsx'));
const Changelog = lazy(() => import('./pages/Changelog.jsx'));
const Wrapped = lazy(() => import('./pages/Wrapped.jsx'));
const Streaming = lazy(() => import('./pages/Streaming.jsx'));
const Trash = lazy(() => import('./pages/Trash.jsx'));
const Settings = lazy(() => import('./pages/Settings.jsx'));
const MbSeedCallback = lazy(() => import('./pages/MbSeedCallback.jsx'));

const NAV = [
  {
    label: 'Coleccionista de discos',
    items: [
      { to: '/', label: 'Dashboard', Icon: LayoutDashboard, end: true },
      { to: '/discoteca', label: 'Discoteca', Icon: Disc },
      { to: '/artistas', label: 'Artistas', Icon: Users },
      { to: '/incompletos', label: 'Álbumes incompletos', Icon: PackageOpen },
      { to: '/calidad', label: 'Calidad y disco', Icon: HardDrive },
      { to: '/upgrades', label: 'Candidatos a upgrade', Icon: ArrowUpCircle },
      { to: '/sellos', label: 'Sellos', Icon: Building2 },
    ],
  },
  {
    label: 'I Hear a New World',
    items: [
      { to: '/seguidos', label: 'Seguidos', Icon: Star },
      { to: '/huecos', label: 'Huecos', Icon: Compass },
      { to: '/proximos', label: 'Lanzamientos', Icon: CalendarClock },
      { to: '/importar', label: 'Importar descargas', Icon: DownloadCloud },
    ],
  },
  {
    label: 'Losing My Edge',
    items: [
      { to: '/escuchas', label: 'Escuchas', Icon: Headphones },
      { to: '/streaming', label: 'Streaming', Icon: LibraryIcon },
      { to: '/resumen', label: 'Resumen', Icon: PartyPopper },
      { to: '/retos', label: 'Retos', Icon: Trophy },
    ],
  },
  {
    label: 'Identikit',
    items: [
      { to: '/sin-identificar', label: 'Sin identificar', Icon: HelpCircle },
      { to: '/correcciones', label: 'Correcciones', Icon: Wrench },
      { to: '/rarezas', label: 'Rarezas e inéditos', Icon: Sparkles },
      { to: '/bootlegs', label: 'Bootlegs', Icon: Radio },
      { to: '/papelera', label: 'Papelera', Icon: Trash2 },
    ],
  },
  {
    label: 'How did I get here?',
    items: [
      { to: '/novedades-app', label: 'Novedades de la app', Icon: Rocket },
      { to: '/como-funciona', label: '¿Cómo funciona todo esto?', Icon: HelpCircle },
      { to: '/ajustes', label: 'Ajustes', Icon: SettingsIcon },
      { to: '/diagnostico', label: 'Diagnóstico', Icon: Stethoscope },
    ],
  },
];

function RefreshButton() {
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState(null);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(async () => {
      const [s, id] = await Promise.all([
        api.refreshStatus().catch(() => null),
        api.identifyStatus().catch(() => null),
      ]);
      // la identificación es el paso largo: mostramos su progreso concreto
      if (id?.running && id.total) {
        setStep(`Identificando ${id.done.toLocaleString('es')}/${id.total.toLocaleString('es')}`);
      } else if (s) {
        setStep(s.step);
      }
      if (s && !s.running) {
        setRunning(false);
        setStep(null);
      }
    }, 1500);
    return () => clearInterval(t);
  }, [running]);
  return (
    <button
      onClick={async () => {
        setRunning(true);
        await api.refresh('manual').catch(() => {});
      }}
      disabled={running}
      className="w-full flex items-center gap-2 text-sm px-3 py-2 rounded-lg border border-gold-500/40 bg-gold-500/10 text-gold-300 hover:bg-gold-500/20 disabled:opacity-60"
      title="Identifica contra MusicBrainz, importa tus escuchas de Last.fm y sincroniza Lidarr y las discografías (también recoge cambios del disco)."
    >
      <RefreshCw size={15} className={running ? 'animate-spin' : ''} />
      <span className="truncate">{running ? step || 'Trabajando…' : 'Identificar y sincronizar'}</span>
    </button>
  );
}

// Logo punk "Fuck Design": LIDER en tipos recortados sobre ARRR gritado (el chiste
// pirata del sufijo -arrr). SVG inline para que escale sin pixelar y siga el tema:
// las cajas de LIDER y el subrayado usan --text-body (se voltean claro/oscuro), las
// letras de LIDER usan --color-ink-900 (el fondo de la barra, así quedan "recortadas");
// el oro y el rojo son constantes. El grano de fotocopia es un filtro SVG, no imagen.
// Aviso de nueva versión: compara la que corre con el último tag de GitHub. Descartable
// por versión (reaparece cuando salga una más nueva). Si no hay novedad, no muestra nada.
function UpdateBanner() {
  const [info, setInfo] = useState(null);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    api.updateCheck().then(setInfo).catch(() => {});
  }, []);
  if (!info?.updateAvailable || hidden || localStorage.getItem('update_dismissed') === info.latest) return null;
  return (
    <div className="mb-6 flex items-center gap-3 rounded-lg border border-gold-500/40 bg-gold-500/10 px-4 py-2.5 text-sm">
      <Sparkles size={16} className="text-gold-400 shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="text-gold-300">Nueva versión v{info.latest} disponible</span>
        <span className="text-neutral-400">
          {' '}(tienes v{info.current}). Actualiza el contenedor:{' '}
          <code className="text-neutral-300">docker compose pull &amp;&amp; docker compose up -d</code>
        </span>
      </div>
      <a
        href={info.url}
        target="_blank"
        rel="noreferrer"
        className="shrink-0 text-gold-300 hover:underline inline-flex items-center gap-1"
      >
        Ver novedades <ExternalLink size={13} />
      </a>
      <button
        onClick={() => {
          localStorage.setItem('update_dismissed', info.latest);
          setHidden(true);
        }}
        className="shrink-0 text-neutral-500 hover:text-neutral-200"
        aria-label="Descartar aviso"
      >
        <X size={16} />
      </button>
    </div>
  );
}

const IMPACT = "Impact,'Haettenschweiler','Arial Narrow',sans-serif";
function Logo() {
  return (
    <svg viewBox="0 0 640 236" className="w-full h-auto" role="img" aria-label="Liderarr">
      <defs>
        <filter id="logogrit" x="-5%" y="-5%" width="110%" height="118%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="4" />
        </filter>
      </defs>
      <g filter="url(#logogrit)">
        <polygon
          className="fill-[#E0342A]"
          points="300,150 330,96 344,150 400,120 372,166 452,150 380,182 448,214 360,196 372,236 322,200 300,236 288,200 250,214 276,178 214,182 268,158 214,132 286,150"
        />
        <g style={{ fontFamily: IMPACT }} textAnchor="middle">
          {[
            ['L', 55, 52, -4], ['I', 142, 50, 4], ['D', 229, 53, -3], ['E', 316, 50, 5], ['R', 403, 52, -2],
          ].map(([ch, x, y, r]) => (
            <g key={ch + x} transform={`translate(${x},${y}) rotate(${r})`}>
              <rect x="-40" y="-40" width="80" height="80" className="fill-[var(--text-body)]" />
              <text y="22" fontSize="64" className="fill-[var(--color-ink-900)]">{ch}</text>
            </g>
          ))}
          {[
            ['A', 96, 164, 3], ['R', 214, 160, -4], ['R', 332, 164, 5], ['R', 450, 160, -3],
          ].map(([ch, x, y, r], i) => (
            <g key={'a' + i} transform={`translate(${x},${y}) rotate(${r})`}>
              <rect x="-54" y="-58" width="108" height="118" className="fill-gold-400" />
              <text y="34" fontSize="98" className="fill-[#14110E]">{ch}</text>
            </g>
          ))}
        </g>
        <path
          d="M20,224 L90,216 L150,226 L230,214 L300,228 L380,216 L470,228 L520,218"
          fill="none" strokeWidth="7" strokeLinecap="round" className="stroke-[var(--text-body)]"
        />
        <g strokeWidth="5" strokeLinecap="round" className="stroke-[var(--text-body)]">
          <path d="M516,96 L556,74" /><path d="M520,120 L566,116" /><path d="M512,140 L552,152" />
        </g>
      </g>
    </svg>
  );
}

export default function App() {
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState('');
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark');
  const location = useLocation();
  useEffect(() => {
    api.version().then((v) => setVersion(v.version)).catch(() => {});
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light');
    localStorage.setItem('theme', theme);
  }, [theme]);
  // Móvil: al abrir el menú, congela el scroll del fondo (si no, se desplaza «por debajo»
  // del drawer al arrastrar). Se restaura al cerrar o desmontar.
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);
  // Cierra el drawer al navegar (además del onClick de cada enlace): cubre navegación
  // programática y volver atrás con el menú abierto.
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  return (
    <div className="min-h-[100dvh] lg:flex">
      {/* Fondo oscuro en móvil/tablet: tocar fuera del drawer lo cierra. */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          className="lg:hidden fixed inset-0 z-10 bg-black/60 backdrop-blur-sm"
          aria-hidden="true"
        />
      )}

      <aside
        className={`drawer fixed lg:sticky top-0 z-20 h-[100dvh] w-72 max-w-[85vw] lg:w-64 shrink-0 bg-ink-900 border-r border-ink-800 flex flex-col
          pt-[env(safe-area-inset-top)] ${open ? '' : 'drawer-closed'}`}
      >
        <div className="px-5 py-5 flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <Logo />
            <div className="text-[11px] text-neutral-600 mt-1.5">completismo musical · v{version}</div>
          </div>
          {/* Cerrar (solo móvil): además del fondo y de elegir sección. */}
          <button
            onClick={() => setOpen(false)}
            className="lg:hidden -mr-1 -mt-1 p-2 rounded-lg text-neutral-500 hover:bg-ink-850 active:bg-ink-800"
            aria-label="Cerrar menú"
          >
            <X size={18} />
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 space-y-5">
          {NAV.map((group) => (
            <div key={group.label}>
              <div className="text-[11px] uppercase tracking-wider text-neutral-600 px-2 mb-1.5">{group.label}</div>
              <div className="space-y-0.5">
                {group.items.map(({ to, label, Icon, end }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={end}
                    onClick={() => setOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition ${
                        isActive ? 'bg-gold-500/15 text-gold-300' : 'text-neutral-300 hover:bg-ink-850'
                      }`
                    }
                  >
                    <Icon size={17} />
                    {label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="p-3 border-t border-ink-800 space-y-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <RefreshButton />
          <button
            onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
            className="w-full flex items-center justify-center gap-2 text-xs px-3 py-1.5 rounded-lg border border-ink-800 text-neutral-400 hover:bg-ink-850"
          >
            {theme === 'light' ? <Moon size={14} /> : <Sun size={14} />}
            {theme === 'light' ? 'Modo oscuro' : 'Modo claro'}
          </button>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Barra superior SOLO en móvil: abre el menú y muestra el logo. Sustituye a la
            hamburguesa flotante (que se solapaba con los títulos de página). Sticky y con
            hueco para el notch (safe-area-inset-top). */}
        <header className="lg:hidden sticky top-0 z-10 flex items-center gap-2 h-14 px-2 bg-ink-900/90 backdrop-blur border-b border-ink-800 pt-[env(safe-area-inset-top)] box-content">
          <button
            onClick={() => setOpen(true)}
            className="p-2 rounded-lg text-neutral-300 hover:bg-ink-850 active:bg-ink-800"
            aria-label="Abrir menú"
          >
            <Menu size={22} />
          </button>
          <div className="w-[84px] shrink-0">
            <Logo />
          </div>
        </header>

        <main className="min-w-0 px-4 md:px-8 py-6 md:py-8 max-w-[1400px] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <UpdateBanner />
        <ErrorBoundary key={location.pathname}>
          <Suspense fallback={<Spinner label="Cargando…" />}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/discoteca" element={<Library />} />
            <Route path="/album/:id" element={<AlbumDetail />} />
            <Route path="/artistas" element={<Artists />} />
            <Route path="/artista/:id" element={<ArtistDetail />} />
            <Route path="/incompletos" element={<Incomplete />} />
            <Route path="/calidad" element={<Quality />} />
            <Route path="/seguidos" element={<Tracked />} />
            <Route path="/huecos" element={<Discover />} />
            <Route path="/proximos" element={<Calendar />} />
            <Route path="/importar" element={<Imports />} />
            <Route path="/correcciones" element={<Corrections />} />
            <Route path="/escuchas" element={<Listening />} />
            <Route path="/streaming" element={<Streaming />} />
            <Route path="/resumen" element={<Wrapped />} />
            <Route path="/retos" element={<Challenges />} />
            <Route path="/upgrades" element={<Upgrades />} />
            <Route path="/sellos" element={<Labels />} />
            <Route path="/diagnostico" element={<Diagnostics />} />
            <Route path="/sin-identificar" element={<Unidentified />} />
            <Route path="/mb-nueva" element={<MbSeedCallback />} />
            <Route path="/rarezas" element={<Rarities />} />
            <Route path="/bootlegs" element={<Bootlegs />} />
            <Route path="/papelera" element={<Trash />} />
            <Route path="/ajustes" element={<Settings />} />
            <Route path="/como-funciona" element={<HowItWorks />} />
            <Route path="/novedades-app" element={<Changelog />} />
          </Routes>
          </Suspense>
        </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
