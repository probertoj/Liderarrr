import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  BarChart, Bar, LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip,
} from 'recharts';
import { CalendarClock, Search, X, User, Disc3, Star, Download, Loader2, ExternalLink, Headphones } from 'lucide-react';
import { api, coverUrl, fmtBytes } from '../api.js';
import { PageHeader, StatCard, Section, Spinner, ErrorMsg, SearchModal } from '../components.jsx';

// Enlace a MusicBrainz para desambiguar los resultados externos (hay muchos «Beef» o «La
// Bohème» distintos; el MBID te dice cuál es cuál). stopPropagation por si va dentro de fila.
const MbLink = ({ url }) => (
  <a
    href={url}
    target="_blank"
    rel="noreferrer"
    onClick={(e) => e.stopPropagation()}
    className="text-[11px] text-neutral-600 hover:text-gold-400 inline-flex items-center gap-0.5 shrink-0"
    title="Ver en MusicBrainz"
  >
    MB <ExternalLink size={10} />
  </a>
);

// Buscador rápido del Dashboard: el punto de entrada. Busca al instante en tu colección
// (artista/disco → su ficha) y, debajo, fuera de ella en MusicBrainz (seguir artista /
// descargar disco). La app va de lo que tienes y, sobre todo, de lo que aún no tienes.
function QuickSearch() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [local, setLocal] = useState(null);
  const [ext, setExt] = useState(null);
  const [extLoading, setExtLoading] = useState(false);
  const [busy, setBusy] = useState(null);
  const [search, setSearch] = useState(null);

  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setLocal(null);
      setExt(null);
      return;
    }
    const t1 = setTimeout(() => api.findLocal(term).then(setLocal).catch(() => {}), 180);
    setExtLoading(true);
    setExt(null);
    const t2 = setTimeout(
      () =>
        api
          .findExternal(term)
          .then(setExt)
          .catch(() => setExt(null))
          .finally(() => setExtLoading(false)),
      550
    );
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [q]);

  const follow = async (a) => {
    setBusy(a.mbid);
    try {
      const r = await api.followMbid(a.mbid, 'artist');
      setQ('');
      navigate(`/artista/${r.artist_id}`);
    } catch (e) {
      alert(e.message);
      setBusy(null);
    }
  };

  const close = () => setQ('');
  const localHas = local && (local.artists.length || local.albums.length);
  const extArtistsNew = ext?.artists?.filter((a) => !a.artist_id) || [];
  const extArtistsOwned = ext?.artists?.filter((a) => a.artist_id) || [];
  const open = q.trim() && (local || ext || extLoading);

  return (
    <div className="relative mb-6">
      <div className="flex items-center gap-2 bg-ink-850 border border-ink-800 rounded-xl px-3 focus-within:border-gold-500/50">
        <Search size={18} className="text-neutral-500 shrink-0" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setQ('')}
          placeholder="Buscar un disco o un artista… (los tuyos y los que aún no tienes)"
          className="flex-1 bg-transparent py-2.5 outline-none text-sm"
        />
        {q && (
          <button onClick={close} className="text-neutral-600 hover:text-neutral-300" title="Limpiar">
            <X size={16} />
          </button>
        )}
      </div>

      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={close} />
          <div className="absolute z-30 mt-1.5 w-full card p-2 shadow-xl border border-ink-700 max-h-[70vh] overflow-y-auto">
            {localHas ? (
              <div className="mb-1">
                <div className="text-[11px] uppercase tracking-wider text-neutral-600 px-2 py-1">En tu colección</div>
                {local.artists.map((a) => (
                  <Link key={`a${a.id}`} to={`/artista/${a.id}`} onClick={close} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-ink-800 text-sm">
                    <User size={14} className="text-neutral-500 shrink-0" />
                    <span className="flex-1 truncate">{a.name}</span>
                    <span className="text-xs text-neutral-600 shrink-0">{a.albums} discos</span>
                  </Link>
                ))}
                {local.albums.map((al) => (
                  <Link key={`al${al.id}`} to={`/album/${al.id}`} onClick={close} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-ink-800 text-sm">
                    <Disc3 size={14} className="text-neutral-500 shrink-0" />
                    <span className="flex-1 truncate">
                      {al.title} <span className="text-neutral-600">· {al.album_artist}</span>
                    </span>
                    {al.year ? <span className="text-xs text-neutral-600 shrink-0">{al.year}</span> : null}
                  </Link>
                ))}
              </div>
            ) : null}

            <div className="text-[11px] uppercase tracking-wider text-neutral-600 px-2 py-1 flex items-center gap-2">
              Fuera de tu colección {extLoading && <Loader2 size={11} className="animate-spin" />}
            </div>
            {extArtistsOwned.map((a) => (
              <div key={`mao${a.mbid}`} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-ink-800 text-sm">
                <User size={14} className="text-neutral-500 shrink-0" />
                <Link to={`/artista/${a.artist_id}`} onClick={close} className="flex-1 truncate hover:text-gold-400">
                  {a.name}
                </Link>
                {a.mbid && <MbLink url={`https://musicbrainz.org/artist/${a.mbid}`} />}
                <span className="text-xs text-emerald-400/70 shrink-0">lo sigues/tienes</span>
              </div>
            ))}
            {extArtistsNew.map((a) => (
              <div key={`ma${a.mbid}`} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-ink-800 text-sm">
                <User size={14} className="text-neutral-500 shrink-0" />
                <span className="flex-1 truncate">
                  {a.name}
                  {a.disambiguation ? <span className="text-neutral-600"> · {a.disambiguation}</span> : ''}
                </span>
                {a.mbid && <MbLink url={`https://musicbrainz.org/artist/${a.mbid}`} />}
                <button
                  onClick={() => follow(a)}
                  disabled={busy === a.mbid}
                  className="text-xs px-2 py-0.5 rounded border border-gold-500/40 bg-gold-500/10 text-gold-300 hover:bg-gold-500/20 inline-flex items-center gap-1 shrink-0 disabled:opacity-50"
                >
                  {busy === a.mbid ? <Loader2 size={12} className="animate-spin" /> : <Star size={12} />} Seguir
                </button>
              </div>
            ))}
            {(ext?.albums || []).map((al) => (
              <div key={`mal${al.rg_mbid}`} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-ink-800 text-sm">
                <Disc3 size={14} className="text-neutral-500 shrink-0" />
                <span className="flex-1 truncate">
                  {al.title} <span className="text-neutral-600">· {al.artist}{al.year ? ` · ${al.year}` : ''}</span>
                </span>
                {al.rg_mbid && <MbLink url={`https://musicbrainz.org/release-group/${al.rg_mbid}`} />}
                {al.owned ? (
                  <span className="text-xs text-emerald-400/70 shrink-0">lo tienes</span>
                ) : (
                  <button
                    onClick={() => setSearch(`${al.artist} ${al.title}`)}
                    className="text-xs px-2 py-0.5 rounded border border-gold-500/40 bg-gold-500/10 text-gold-300 hover:bg-gold-500/20 inline-flex items-center gap-1 shrink-0"
                  >
                    <Download size={12} /> Descargar
                  </button>
                )}
              </div>
            ))}

            {!extLoading && ext && !ext.artists.length && !ext.albums.length && !localHas && (
              <div className="text-sm text-neutral-600 px-2 py-2">Nada en tu colección ni en MusicBrainz.</div>
            )}
          </div>
        </>
      )}

      {search != null && <SearchModal initialQuery={search} onClose={() => setSearch(null)} />}
    </div>
  );
}
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
  const [nextListens, setNextListens] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    api.overview().then(setOv).catch((e) => setErr(e.message));
    api.charts().then(setCharts).catch(() => {});
    api.recent().then(setRecent).catch(() => {});
    api.upcoming().then(setUpcoming).catch(() => {});
    api.nextChallengeListens().then(setNextListens).catch(() => {});
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

      <QuickSearch />

      {/* stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
        <StatCard label="Álbumes" value={ov.albums.toLocaleString('es')} />
        <StatCard label="Artistas" value={ov.artists.toLocaleString('es')} />
        <StatCard label="Horas de música" value={hours.toLocaleString('es')} sub={`≈ ${Math.round(hours / 24)} días`} />
        <StatCard label="En disco" value={fmtBytes(ov.sizeBytes)} sub={`${ov.tracks.toLocaleString('es')} pistas`} />
        <StatCard label="Sin pérdida" value={`${ov.losslessPct}%`} sub="de las pistas" />
        <StatCard label="Incompletos" value={ov.incomplete} sub={ov.states?.orphan ? `${ov.states.orphan} rarezas` : 'les falta alguna pista'} />
      </div>

      {/* siguiente por escuchar de tus retos */}
      {nextListens?.length > 0 && (
        <Section
          title="Siguiente por escuchar de tus retos"
          className="mb-8"
          action={<Link to="/retos" className="text-xs text-gold-400 hover:underline">Ver retos →</Link>}
        >
          <div className="card p-3">
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2.5">
              {nextListens.map((n) => (
                <Link key={n.owned_album_id} to={`/album/${n.owned_album_id}`} className="group block" title={`De «${n.challenge}»`}>
                  <div className="aspect-square rounded-lg overflow-hidden bg-ink-850 border border-ink-800 group-hover:border-gold-400 transition-colors flex items-center justify-center relative">
                    <img src={coverUrl(n.owned_album_id)} alt="" loading="lazy" className="w-full h-full object-cover" />
                    <span className="absolute bottom-1 right-1 bg-ink-900/80 rounded-full p-1">
                      <Headphones size={11} className="text-gold-300" />
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] text-neutral-300 truncate">{n.album}</div>
                  <div className="text-[11px] text-neutral-600 truncate">{n.artist}</div>
                </Link>
              ))}
            </div>
          </div>
        </Section>
      )}

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
