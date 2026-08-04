import { useEffect, useState, lazy, Suspense } from 'react';
import { Routes, Route, NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Disc, Users, HardDrive, PackageOpen, HelpCircle,
  Sparkles, Settings as SettingsIcon, Menu, X, RefreshCw, Star, Compass, CalendarClock,
  Headphones, Trophy, ArrowUpCircle, Building2, Sun, Moon, Stethoscope,
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
const Tracked = lazy(() => import('./pages/Tracked.jsx'));
const Discover = lazy(() => import('./pages/Discover.jsx'));
const Calendar = lazy(() => import('./pages/Calendar.jsx'));
const Listening = lazy(() => import('./pages/Listening.jsx'));
const Challenges = lazy(() => import('./pages/Challenges.jsx'));
const Upgrades = lazy(() => import('./pages/Upgrades.jsx'));
const Labels = lazy(() => import('./pages/Labels.jsx'));
const Diagnostics = lazy(() => import('./pages/Diagnostics.jsx'));
const Settings = lazy(() => import('./pages/Settings.jsx'));

const NAV = [
  {
    label: 'Tu colección',
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
    label: 'La caza',
    items: [
      { to: '/seguidos', label: 'Seguidos', Icon: Star },
      { to: '/huecos', label: 'Huecos', Icon: Compass },
      { to: '/proximos', label: 'Próximos lanzamientos', Icon: CalendarClock },
    ],
  },
  {
    label: 'El gusto',
    items: [
      { to: '/escuchas', label: 'Escuchas', Icon: Headphones },
      { to: '/retos', label: 'Retos', Icon: Trophy },
    ],
  },
  {
    label: 'Identificación',
    items: [
      { to: '/sin-identificar', label: 'Sin identificar', Icon: HelpCircle },
      { to: '/rarezas', label: 'Rarezas e inéditos', Icon: Sparkles },
    ],
  },
  {
    label: 'Cuenta',
    items: [
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

  return (
    <div className="min-h-screen md:flex">
      <button
        onClick={() => setOpen((v) => !v)}
        className="md:hidden fixed top-3 left-3 z-30 p-2 rounded-lg bg-ink-850 border border-ink-800"
        aria-label="Menú"
      >
        {open ? <X size={18} /> : <Menu size={18} />}
      </button>

      <aside
        className={`fixed md:sticky top-0 z-20 h-screen w-64 shrink-0 bg-ink-900 border-r border-ink-800 flex flex-col
          transition-transform ${open ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}
      >
        <div className="px-5 py-5">
          <div className="font-display text-2xl tracking-wide">
            Lider<span className="text-gold-400">arrr</span>
          </div>
          <div className="text-[11px] text-neutral-600 mt-0.5">completismo musical · v{version}</div>
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
        <div className="p-3 border-t border-ink-800 space-y-2">
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

      <main className="flex-1 min-w-0 px-4 md:px-8 py-6 md:py-8 max-w-[1400px]">
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
            <Route path="/escuchas" element={<Listening />} />
            <Route path="/retos" element={<Challenges />} />
            <Route path="/upgrades" element={<Upgrades />} />
            <Route path="/sellos" element={<Labels />} />
            <Route path="/diagnostico" element={<Diagnostics />} />
            <Route path="/sin-identificar" element={<Unidentified />} />
            <Route path="/rarezas" element={<Rarities />} />
            <Route path="/ajustes" element={<Settings />} />
          </Routes>
          </Suspense>
        </ErrorBoundary>
      </main>
    </div>
  );
}
