import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PartyPopper } from 'lucide-react';
import { BarChart, Bar, ResponsiveContainer, XAxis, Tooltip } from 'recharts';
import { api, coverUrl } from '../api.js';
import { PageTitle, Spinner, StatCard, ArtistPhoto } from '../components.jsx';

// «Resumen» tipo Wrapped: crea el resumen de un periodo (semana / mes / 3 meses / año /
// un año concreto / todo) con un mosaico de las portadas de tus discos más escuchados.
const DAY = 86400000;

export default function Wrapped() {
  const now = useMemo(() => Date.now(), []);
  const presets = useMemo(
    () => [
      { key: 'week', label: 'Última semana', since: now - 7 * DAY, until: null },
      { key: 'month', label: 'Último mes', since: now - 30 * DAY, until: null },
      { key: 'quarter', label: 'Últimos 3 meses', since: now - 90 * DAY, until: null },
      { key: 'year', label: 'Último año', since: now - 365 * DAY, until: null },
    ],
    [now]
  );
  const [sel, setSel] = useState(presets[3]); // por defecto: último año
  const [data, setData] = useState(null);

  useEffect(() => {
    setData(null);
    api.wrapped(sel.since, sel.until).then(setData).catch(() => setData({ empty: true }));
  }, [sel]);

  if (data?.empty) {
    return (
      <div>
        <PageTitle icon={PartyPopper} title="Resumen" />
        <div className="card p-8 text-center text-neutral-400">
          Aún no hay escuchas importadas. Conecta Last.fm en Ajustes y trae tu historial para crear tu resumen.
        </div>
      </div>
    );
  }

  const years = data?.years || [];
  const yearPreset = (y) => ({ key: `y${y}`, label: String(y), since: Date.UTC(y, 0, 1), until: Date.UTC(y + 1, 0, 1) - 1 });
  const fmtMonth = (m) => {
    if (!/^\d{4}-\d{2}$/.test(m)) return m;
    const [y, mm] = m.split('-');
    return new Date(y, mm - 1).toLocaleDateString('es', { month: 'short' });
  };

  const Chip = ({ p }) => (
    <button
      onClick={() => setSel(p)}
      className={`text-sm px-3 py-1.5 rounded-lg border ${
        sel.key === p.key ? 'border-gold-500/50 bg-gold-500/15 text-gold-300' : 'border-ink-800 bg-ink-850 text-neutral-400 hover:border-gold-500/30'
      }`}
    >
      {p.label}
    </button>
  );

  return (
    <div>
      <PageTitle icon={PartyPopper} title="Resumen" sub={`Tu ${sel.label.toLowerCase()} en música`} />

      <div className="flex flex-wrap gap-2 mb-6">
        {presets.map((p) => (
          <Chip key={p.key} p={p} />
        ))}
        {years.map((y) => (
          <Chip key={y} p={yearPreset(y)} />
        ))}
        <Chip p={{ key: 'all', label: 'Todo el tiempo', since: null, until: null }} />
      </div>

      {!data ? (
        <Spinner label="Montando tu resumen…" />
      ) : data.totals.scrobbles === 0 && data.addedCount === 0 ? (
        <div className="card p-8 text-center text-neutral-400">Nada registrado en «{sel.label}».</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
            <StatCard label="Escuchas" value={data.totals.scrobbles.toLocaleString('es')} />
            <StatCard label="Artistas distintos" value={data.totals.artists.toLocaleString('es')} />
            <StatCard label="Álbumes distintos" value={data.totals.albums.toLocaleString('es')} />
            <StatCard label="Añadidos a tu colección" value={data.addedCount.toLocaleString('es')} />
          </div>

          {/* Mosaico de portadas de los discos más escuchados */}
          {data.topAlbums.length > 0 && (
            <div className="mb-8">
              <h2 className="text-sm text-neutral-400 mb-3">Tus discos más escuchados</h2>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                {data.topAlbums.map((a, i) => (
                  <MosaicCell key={i} a={a} rank={i + 1} />
                ))}
              </div>
            </div>
          )}

          <div className="grid md:grid-cols-2 gap-6 mb-8">
            <div className="card p-4">
              <h2 className="text-sm text-neutral-400 mb-3">Artistas más escuchados</h2>
              <div className="space-y-1.5">
                {data.topArtists.map((a, i) => (
                  <div key={a.artist} className="flex items-center gap-2.5 text-sm">
                    <span className={`shrink-0 w-5 text-right font-display ${i < 3 ? 'text-gold-400' : 'text-neutral-600'}`}>{i + 1}</span>
                    <ArtistPhoto id={a.artist_id} name={a.artist} size={30} />
                    <div className="min-w-0 flex-1 truncate">
                      {a.artist_id ? (
                        <Link to={`/artista/${a.artist_id}`} className="hover:text-gold-400">
                          {a.artist}
                        </Link>
                      ) : (
                        <span>{a.artist}</span>
                      )}
                      {a.owned_albums === 0 && <span className="text-amber-500/80 text-xs ml-1">0 en disco</span>}
                    </div>
                    <span className="text-neutral-500 shrink-0 tabular-nums">{a.plays.toLocaleString('es')}</span>
                  </div>
                ))}
              </div>
            </div>

            {data.byMonth.length > 1 ? (
              <div className="card p-4">
                <h2 className="text-sm text-neutral-400 mb-3">Escuchas por mes</h2>
                <ResponsiveContainer width="100%" height={230}>
                  <BarChart data={data.byMonth.map((m) => ({ ...m, m: fmtMonth(m.month) }))}>
                    <XAxis dataKey="m" tick={{ fill: '#888', fontSize: 12 }} />
                    <Tooltip contentStyle={{ background: '#191921', border: '1px solid #2c2c39', borderRadius: 8 }} />
                    <Bar dataKey="plays" fill="#d4a24a" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="card p-4 flex items-center justify-center text-sm text-neutral-600">
                Elige un periodo más largo para ver tu evolución por mes.
              </div>
            )}
          </div>

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

// Celda del mosaico: portada del disco (local si lo tienes; Deezer si no) con su nº de
// escuchas y, al pasar el ratón, artista y título. Enlaza a la ficha si lo tienes.
function MosaicCell({ a, rank }) {
  const [failed, setFailed] = useState(false);
  const src = a.album_id ? coverUrl(a.album_id) : a.cover;
  const inner = (
    <div className="relative aspect-square rounded-lg overflow-hidden bg-ink-850 border border-ink-800 group">
      {src && !failed ? (
        <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} className="absolute inset-0 w-full h-full object-cover" />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-neutral-700 p-1 text-center">
          <span className="text-[10px] text-neutral-500 leading-tight">
            {a.artist}
            <br />
            {a.album}
          </span>
        </div>
      )}
      {rank <= 3 && (
        <span className="absolute top-1 left-1 text-[10px] font-display px-1.5 rounded bg-gold-500 text-black">#{rank}</span>
      )}
      <span className="absolute top-1 right-1 text-[10px] px-1.5 py-0.5 rounded-full bg-black/65 text-white tabular-nums">{a.plays}</span>
      <div className="absolute inset-x-0 bottom-0 p-1.5 bg-gradient-to-t from-black/85 to-transparent opacity-0 group-hover:opacity-100 transition">
        <div className="text-[11px] text-white truncate">{a.album}</div>
        <div className="text-[10px] text-white/70 truncate">{a.artist}</div>
      </div>
      {!a.owned && (
        <span className="absolute bottom-1 left-1 text-[9px] px-1 py-px rounded bg-amber-600/90 text-amber-50 group-hover:opacity-0">
          no la tienes
        </span>
      )}
    </div>
  );
  return a.album_id ? (
    <Link to={`/album/${a.album_id}`} className="block" title={`${a.artist} — ${a.album}`}>
      {inner}
    </Link>
  ) : (
    <div title={`${a.artist} — ${a.album}`}>{inner}</div>
  );
}
