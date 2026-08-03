import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { LayoutDashboard } from 'lucide-react';
import { BarChart, Bar, PieChart, Pie, Cell, ResponsiveContainer, XAxis, Tooltip } from 'recharts';
import { api, fmtBytes, fmtDuration } from '../api.js';
import { PageTitle, Stat, Spinner, ErrorMsg } from '../components.jsx';

const GOLD = ['#d4a24a', '#b9852f', '#8a6220', '#6a4c1a', '#caa968', '#e0be7e'];

export default function Dashboard() {
  const [ov, setOv] = useState(null);
  const [ch, setCh] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    Promise.all([api.overview(), api.charts()])
      .then(([o, c]) => {
        setOv(o);
        setCh(c);
      })
      .catch((e) => setErr(e.message));
  }, []);

  if (err) return <ErrorMsg>{err}</ErrorMsg>;
  if (!ov || !ch) return <Spinner label="Cargando estadísticas…" />;

  const empty = ov.albums === 0;

  return (
    <div>
      <PageTitle icon={LayoutDashboard} title="Dashboard" sub="Tu colección de un vistazo" />

      {empty ? (
        <div className="card p-8 text-center">
          <p className="text-neutral-300 mb-2">Aún no hay nada escaneado.</p>
          <p className="text-neutral-500 text-sm mb-4">
            Configura tus carpetas de música en Ajustes y pulsa «Actualizar todo».
          </p>
          <Link to="/ajustes" className="text-gold-400 hover:underline">
            Ir a Ajustes →
          </Link>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <Stat label="Álbumes" value={ov.albums.toLocaleString('es')} />
            <Stat label="Artistas" value={ov.artists.toLocaleString('es')} />
            <Stat label="Pistas" value={ov.tracks.toLocaleString('es')} />
            <Stat label="En disco" value={fmtBytes(ov.sizeBytes)} sub={fmtDuration(ov.durationMs)} />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <Stat label="Sin pérdida" value={`${ov.losslessPct}%`} sub="pistas FLAC/ALAC/WAV" />
            <Stat label="Incompletos" value={ov.incomplete} sub="les falta alguna pista" />
            <Stat label="Rarezas" value={ov.states.orphan || 0} sub="maquetas e inéditos" />
            <Stat label="Sin identificar" value={(ov.states.unmatched || 0) + (ov.states.pending || 0)} />
          </div>

          <div className="grid md:grid-cols-2 gap-4 mb-4">
            <div className="card p-4">
              <h2 className="text-sm text-neutral-400 mb-3">Álbumes por década</h2>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={ch.byDecade}>
                  <XAxis dataKey="decade" tick={{ fill: '#888', fontSize: 12 }} tickFormatter={(d) => `${d}s`} />
                  <Tooltip
                    contentStyle={{ background: '#191921', border: '1px solid #2c2c39', borderRadius: 8 }}
                    labelFormatter={(d) => `Década de ${d}`}
                  />
                  <Bar dataKey="n" fill="#d4a24a" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="card p-4">
              <h2 className="text-sm text-neutral-400 mb-3">Formatos</h2>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={ch.byFormat} dataKey="n" nameKey="name" outerRadius={80} label={(e) => e.name}>
                    {ch.byFormat.map((_, i) => (
                      <Cell key={i} fill={GOLD[i % GOLD.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ background: '#191921', border: '1px solid #2c2c39', borderRadius: 8 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="card p-4">
              <h2 className="text-sm text-neutral-400 mb-3">Artistas con más álbumes</h2>
              <div className="space-y-1">
                {ch.topArtists.slice(0, 10).map((a) => (
                  <Link
                    key={a.id}
                    to={`/artista/${a.id}`}
                    className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-ink-850 text-sm"
                  >
                    <span className="truncate">{a.name}</span>
                    <span className="text-neutral-500 shrink-0 ml-3">{a.albums} álb · {a.tracks} pistas</span>
                  </Link>
                ))}
              </div>
            </div>

            <div className="card p-4">
              <h2 className="text-sm text-neutral-400 mb-3">Géneros principales</h2>
              <div className="flex flex-wrap gap-2">
                {ch.byGenre.map((g) => (
                  <span key={g.name} className="text-xs px-2.5 py-1 rounded-full bg-ink-850 border border-ink-800">
                    {g.name} <span className="text-neutral-600">{g.n}</span>
                  </span>
                ))}
                {!ch.byGenre.length && <span className="text-neutral-600 text-sm">Sin géneros en las etiquetas.</span>}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
