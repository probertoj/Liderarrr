import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart, Bar, LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip,
} from 'recharts';
import { CalendarClock } from 'lucide-react';
import { api, coverUrl, fmtBytes } from '../api.js';
import { PageHeader, StatCard, Section, Spinner, ErrorMsg } from '../components.jsx';
import { useChartTheme } from '../charts.js';

const fmtDate = (ms) =>
  ms ? new Date(ms).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

// Baldosa de carátula para las tiras de "recientes".
function CoverTile({ id, title, artist, sub }) {
  const [err, setErr] = useState(false);
  return (
    <Link to={id ? `/album/${id}` : '#'} className="group block">
      <div className="aspect-square rounded-lg overflow-hidden bg-ink-850 border border-ink-800 group-hover:border-gold-400 transition-colors flex items-center justify-center">
        {id && !err ? (
          <img src={coverUrl(id)} alt="" loading="lazy" onError={() => setErr(true)} className="w-full h-full object-cover" />
        ) : (
          <span className="text-[11px] text-neutral-600 text-center p-2 leading-tight">{title}</span>
        )}
      </div>
      <div className="mt-1 text-[11px] text-neutral-300 truncate">{title}</div>
      <div className="text-[11px] text-neutral-600 truncate">{artist || sub}</div>
    </Link>
  );
}

function CoverStrip({ items, render }) {
  if (!items?.length) return null;
  return <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-4 xl:grid-cols-5 gap-2.5">{items.map(render)}</div>;
}

export default function Dashboard() {
  const ch = useChartTheme();
  const [ov, setOv] = useState(null);
  const [charts, setCharts] = useState(null);
  const [recent, setRecent] = useState(null);
  const [upcoming, setUpcoming] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    api.overview().then(setOv).catch((e) => setErr(e.message));
    api.charts().then(setCharts).catch(() => {});
    api.recent().then(setRecent).catch(() => {});
    api.upcoming().then(setUpcoming).catch(() => {});
  }, []);

  if (err) return <ErrorMsg>{err}</ErrorMsg>;
  if (!ov || !charts) return <Spinner label="Cargando tu discoteca…" />;

  if (ov.albums === 0) {
    return (
      <div>
        <PageHeader eyebrow="Colección" title="Tu discoteca" />
        <div className="card p-8 text-center">
          <p className="text-neutral-300 mb-2">Aún no hay nada escaneado.</p>
          <p className="text-neutral-500 text-sm mb-4">
            Configura tus carpetas de música en Ajustes y lanza el primer escaneo.
          </p>
          <Link to="/ajustes" className="text-gold-400 hover:underline">Ir a Ajustes →</Link>
        </div>
      </div>
    );
  }

  const hours = Math.round(ov.durationMs / 3600000);
  const listenedCol = recent?.recentlyListened?.length > 0;

  return (
    <div>
      <PageHeader eyebrow="Colección" title="Tu discoteca" />

      {/* stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
        <StatCard label="Álbumes" value={ov.albums.toLocaleString('es')} />
        <StatCard label="Artistas" value={ov.artists.toLocaleString('es')} />
        <StatCard label="Horas de música" value={hours.toLocaleString('es')} sub={`≈ ${Math.round(hours / 24)} días`} />
        <StatCard label="En disco" value={fmtBytes(ov.sizeBytes)} sub={`${ov.tracks.toLocaleString('es')} pistas`} />
        <StatCard label="Sin pérdida" value={`${ov.losslessPct}%`} sub="de las pistas" />
        <StatCard label="Incompletos" value={ov.incomplete} sub={ov.states?.orphan ? `${ov.states.orphan} rarezas` : 'les falta alguna pista'} />
      </div>

      {/* actividad reciente */}
      <div className="grid lg:grid-cols-3 gap-6 mb-4">
        <Section
          title="Últimas añadidas"
          action={<Link to="/discoteca" className="text-xs text-gold-400 hover:underline">Ver más →</Link>}
        >
          <CoverStrip
            items={recent?.recentlyAdded}
            render={(a) => <CoverTile key={a.id} id={a.id} title={a.title} artist={a.album_artist} sub={fmtDate(a.added_at)} />}
          />
        </Section>

        <Section
          title="Últimas escuchas"
          action={<Link to="/escuchas" className="text-xs text-gold-400 hover:underline">Ver más →</Link>}
        >
          {listenedCol ? (
            <CoverStrip
              items={recent.recentlyListened}
              render={(l, i) => (
                <CoverTile key={i} id={l.album_id} title={l.album} artist={l.artist} sub={fmtDate(l.ts)} />
              )}
            />
          ) : (
            <div className="text-neutral-600 text-sm py-8 text-center">
              Conecta tu usuario de Last.fm en <Link to="/ajustes" className="text-gold-400">Ajustes</Link> para ver aquí tus últimas escuchas.
            </div>
          )}
        </Section>

        <Section
          title="Próximos lanzamientos"
          action={<Link to="/proximos" className="text-xs text-gold-400 hover:underline">Ver calendario →</Link>}
        >
          {upcoming?.length ? (
            <div className="card divide-y divide-ink-800 max-h-[360px] overflow-y-auto">
              {upcoming.slice(0, 12).map((u) => (
                <Link
                  key={u.rg_mbid}
                  to="/proximos"
                  className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-ink-850/50"
                >
                  <CalendarClock size={14} className="text-gold-400/70 shrink-0" />
                  <span className="text-neutral-300 truncate flex-1">
                    {u.artist ? <span className="text-neutral-500">{u.artist} — </span> : ''}
                    {u.title}
                  </span>
                  <span className="text-[11px] text-neutral-600 shrink-0">{u.first_release}</span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="text-neutral-600 text-sm py-8 text-center">
              Sigue artistas y sellos para ver aquí sus próximos discos. También en{' '}
              <Link to="/proximos" className="text-gold-400">Lanzamientos</Link>.
            </div>
          )}
        </Section>
      </div>

      {/* gráficas */}
      <div className="grid lg:grid-cols-2 gap-6 mb-4">
        <Section title="Álbumes por década" className="min-w-0">
          <div className="card p-4 h-72 min-w-0">
            <ResponsiveContainer>
              <BarChart data={charts.byDecade} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                <XAxis dataKey="decade" stroke={ch.axis} fontSize={12} tickMargin={6} tickFormatter={(d) => `${d}s`} />
                <YAxis stroke={ch.axis} fontSize={12} width={32} />
                <Tooltip contentStyle={ch.tooltip} labelStyle={ch.tooltipLabel} itemStyle={ch.tooltipItem} cursor={{ fill: ch.cursor }} labelFormatter={(d) => `Década de ${d}`} />
                <Bar dataKey="n" name="Álbumes" fill={ch.accent} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Section>

        <Section title="Géneros principales" className="min-w-0">
          <div className="card p-4 h-72 min-w-0">
            {charts.byGenre.length ? (
              <ResponsiveContainer>
                <BarChart data={charts.byGenre.slice(0, 10)} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
                  <XAxis type="number" stroke={ch.axis} fontSize={12} />
                  <YAxis type="category" dataKey="name" width={110} stroke={ch.axis} fontSize={11} interval={0} tickMargin={4} />
                  <Tooltip contentStyle={ch.tooltip} labelStyle={ch.tooltipLabel} itemStyle={ch.tooltipItem} cursor={{ fill: ch.cursor }} />
                  <Bar dataKey="n" name="Álbumes" fill={ch.accent2} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-neutral-600 text-sm">Sin géneros en las etiquetas.</div>
            )}
          </div>
        </Section>
      </div>

      {charts.addedByMonth?.length > 1 && (
        <Section title="Crecimiento de la colección" className="min-w-0 mb-4">
          <div className="card p-4 h-64 min-w-0">
            <ResponsiveContainer>
              <LineChart data={charts.addedByMonth} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
                <XAxis dataKey="month" stroke={ch.axis} fontSize={10} tickMargin={6} minTickGap={24} />
                <YAxis stroke={ch.axis} fontSize={12} width={32} />
                <Tooltip contentStyle={ch.tooltip} labelStyle={ch.tooltipLabel} itemStyle={ch.tooltipItem} cursor={{ stroke: ch.axis }} />
                <Line type="monotone" dataKey="n" name="Añadidos" stroke={ch.accent} dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Section>
      )}

      {/* artistas destacados */}
      <Section
        title="Artistas con más álbumes"
        action={<Link to="/artistas" className="text-xs text-gold-400 hover:underline">Ver todos →</Link>}
      >
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {charts.topArtists.slice(0, 8).map((a) => (
            <Link key={a.id} to={`/artista/${a.id}`} className="card px-4 py-3 hover:border-gold-500/40 flex items-center justify-between">
              <span className="truncate">{a.name}</span>
              <span className="text-xs text-neutral-500 shrink-0 ml-2">{a.albums}</span>
            </Link>
          ))}
        </div>
      </Section>
    </div>
  );
}
