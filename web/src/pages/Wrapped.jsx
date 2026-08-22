import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { BarChart, Bar, ResponsiveContainer, XAxis, Tooltip } from 'recharts';
import { api } from '../api.js';
import { PageTitle, Spinner, StatCard } from '../components.jsx';

// «Resumen» tipo Wrapped: la foto de un año (o de todo el tiempo) de tus escuchas y de lo
// que añadiste a la colección. Datos de la brecha escucha↔propiedad que ya cruzamos.
export default function Wrapped() {
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [data, setData] = useState(null);

  useEffect(() => {
    setData(null);
    api.wrapped(year).then(setData).catch(() => setData({ empty: true }));
  }, [year]);

  if (data?.empty) {
    return (
      <div>
        <PageTitle icon={Sparkles} title="Resumen" />
        <div className="card p-8 text-center text-neutral-400">
          Aún no hay escuchas importadas. Conecta Last.fm en Ajustes y trae tu historial para ver tu resumen.
        </div>
      </div>
    );
  }

  const years = data?.years || [];
  const fmtMonth = (m) => {
    if (!/^\d{4}-\d{2}$/.test(m)) return m;
    const [y, mm] = m.split('-');
    return new Date(y, mm - 1).toLocaleDateString('es', { month: 'short' });
  };

  return (
    <div>
      <PageTitle icon={Sparkles} title="Resumen" sub={`Tu ${data ? data.label.toLowerCase() : '…'} en música`} />

      <div className="flex flex-wrap gap-2 mb-6">
        {years.map((y) => (
          <button
            key={y}
            onClick={() => setYear(String(y))}
            className={`text-sm px-3 py-1.5 rounded-lg border ${
              String(y) === year ? 'border-gold-500/50 bg-gold-500/15 text-gold-300' : 'border-ink-800 bg-ink-850 text-neutral-400'
            }`}
          >
            {y}
          </button>
        ))}
        <button
          onClick={() => setYear('all')}
          className={`text-sm px-3 py-1.5 rounded-lg border ${
            year === 'all' ? 'border-gold-500/50 bg-gold-500/15 text-gold-300' : 'border-ink-800 bg-ink-850 text-neutral-400'
          }`}
        >
          Todo el tiempo
        </button>
      </div>

      {!data ? (
        <Spinner />
      ) : data.totals.scrobbles === 0 && data.addedCount === 0 ? (
        <div className="card p-8 text-center text-neutral-400">Nada registrado en «{data.label}».</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
            <StatCard label="Escuchas" value={data.totals.scrobbles.toLocaleString('es')} />
            <StatCard label="Artistas distintos" value={data.totals.artists.toLocaleString('es')} />
            <StatCard label="Álbumes distintos" value={data.totals.albums.toLocaleString('es')} />
            <StatCard label="Añadidos a tu colección" value={data.addedCount.toLocaleString('es')} />
          </div>

          <div className="grid md:grid-cols-2 gap-6 mb-8">
            <RankList title="Artistas más escuchados">
              {data.topArtists.map((a, i) => (
                <RankRow key={a.artist} pos={i + 1} plays={a.plays}>
                  {a.artist_id ? (
                    <Link to={`/artista/${a.artist_id}`} className="hover:text-gold-400 truncate">
                      {a.artist}
                    </Link>
                  ) : (
                    <span className="truncate">{a.artist}</span>
                  )}
                  {a.owned_albums === 0 && <span className="text-amber-500/80 text-xs ml-1 shrink-0">0 en disco</span>}
                </RankRow>
              ))}
            </RankList>

            <RankList title="Álbumes más escuchados">
              {data.topAlbums.map((a, i) => (
                <RankRow key={i} pos={i + 1} plays={a.plays}>
                  <span className="truncate">
                    {a.artist} <span className="text-neutral-500">— {a.album}</span>
                  </span>
                  {!a.owned && <span className="text-amber-500/80 text-xs ml-1 shrink-0">no lo tienes</span>}
                </RankRow>
              ))}
            </RankList>
          </div>

          {data.byMonth.length > 1 && (
            <div className="card p-4 mb-8">
              <h2 className="text-sm text-neutral-400 mb-3">Escuchas por mes</h2>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data.byMonth.map((m) => ({ ...m, m: fmtMonth(m.month) }))}>
                  <XAxis dataKey="m" tick={{ fill: '#888', fontSize: 12 }} />
                  <Tooltip contentStyle={{ background: '#191921', border: '1px solid #2c2c39', borderRadius: 8 }} />
                  <Bar dataKey="plays" fill="#d4a24a" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {data.addedTop.length > 0 && (
            <div className="card p-4">
              <h2 className="text-sm text-neutral-400 mb-3">Nuevos en tu colección</h2>
              <div className="flex flex-wrap gap-1.5">
                {data.addedTop.map((a) => (
                  <Link
                    key={a.id}
                    to={`/album/${a.id}`}
                    className="text-xs px-2 py-1 rounded-full bg-ink-850 border border-ink-800 hover:border-gold-500/40"
                  >
                    {a.album_artist} — {a.title}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function RankList({ title, children }) {
  return (
    <div className="card p-4">
      <h2 className="text-sm text-neutral-400 mb-3">{title}</h2>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function RankRow({ pos, plays, children }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className={`shrink-0 w-6 text-right font-display ${pos <= 3 ? 'text-gold-400' : 'text-neutral-600'}`}>{pos}</span>
      <div className="min-w-0 flex-1 flex items-center gap-1 truncate">{children}</div>
      <span className="text-neutral-500 shrink-0 tabular-nums">{plays.toLocaleString('es')}</span>
    </div>
  );
}
