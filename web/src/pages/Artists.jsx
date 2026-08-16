import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users, Star } from 'lucide-react';
import { api } from '../api.js';
import { PageTitle, Spinner, ErrorMsg, Cover } from '../components.jsx';

export default function Artists() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('albums');
  const [onlyTracked, setOnlyTracked] = useState(false);
  const [onlyMissing, setOnlyMissing] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      const params = { q, sort, limit: 5000 };
      if (onlyTracked) params.tracked = 1;
      if (onlyMissing) params.missing = 1;
      setRows(null);
      api
        .artists(params)
        .then(setRows)
        .catch((e) => setErr(e.message));
    }, 200);
    return () => clearTimeout(t);
  }, [q, sort, onlyTracked, onlyMissing]);

  const chip = (on) =>
    `px-3 py-1.5 rounded-lg text-sm border inline-flex items-center gap-1.5 transition-colors ${
      on
        ? 'border-gold-500/60 bg-gold-500/15 text-gold-300'
        : 'border-ink-800 bg-ink-850 text-neutral-400 hover:border-gold-500/40'
    }`;

  return (
    <div>
      <PageTitle icon={Users} title="Artistas" sub={rows ? `${rows.length} en tu colección` : ''} />
      <div className="flex gap-2 mb-3 flex-wrap">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar artista…"
          className="bg-ink-850 border border-ink-800 rounded-lg px-2.5 py-1.5 text-sm flex-1 min-w-[10rem]"
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className="bg-ink-850 border border-ink-800 rounded-lg px-2.5 py-1.5 text-sm"
        >
          <option value="albums">Más álbumes</option>
          <option value="tracks">Más pistas</option>
          <option value="missing">Más discos por completar</option>
          <option value="added">Recientes</option>
          <option value="tracked">Seguidos primero</option>
          <option value="name">Nombre (A-Z)</option>
          <option value="name_desc">Nombre (Z-A)</option>
          <option value="random">Aleatorio</option>
        </select>
      </div>
      <div className="flex gap-2 mb-5 flex-wrap">
        <button type="button" onClick={() => setOnlyTracked((v) => !v)} className={chip(onlyTracked)} title="Solo artistas que sigues">
          <Star size={13} className={onlyTracked ? 'fill-current' : ''} /> Seguidos
        </button>
        <button
          type="button"
          onClick={() => setOnlyMissing((v) => !v)}
          className={chip(onlyMissing)}
          title="Solo artistas de los que faltan discos (según el último cruce de discografía con MusicBrainz)"
        >
          Faltan discos
        </button>
        {(onlyTracked || onlyMissing) && (
          <button
            type="button"
            onClick={() => {
              setOnlyTracked(false);
              setOnlyMissing(false);
            }}
            className="px-2.5 py-1.5 rounded-lg text-sm text-neutral-500 hover:text-neutral-300"
          >
            Limpiar filtros
          </button>
        )}
      </div>

      {err && <ErrorMsg>{err}</ErrorMsg>}
      {!rows && !err && <Spinner />}
      {rows && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {rows.map((a) => (
            <Link
              key={a.id}
              to={`/artista/${a.id}`}
              className={`card p-2.5 flex items-center gap-3 ${
                a.tracked ? 'border-gold-500/50 bg-gold-500/10 hover:border-gold-500/70' : 'hover:border-gold-500/40'
              }`}
              title={a.tracked ? 'Sigues a este artista' : undefined}
            >
              <div className="w-11 h-11 rounded-md overflow-hidden shrink-0">
                <Cover id={a.cover_album_id} size="sm" noRetry />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate flex items-center gap-1.5">
                  {a.tracked ? <Star size={12} className="fill-current text-gold-400 shrink-0" /> : null}
                  {a.name}
                </div>
                <div className="text-xs text-neutral-600 truncate">
                  {a.mbid ? 'en MusicBrainz' : 'artista local'}
                  {a.country ? ` · ${a.country}` : ''}
                </div>
              </div>
              <div className="text-sm text-neutral-500 shrink-0 text-right">
                <div>{a.albums} álb</div>
                {a.missing > 0 ? (
                  <div className="text-xs text-amber-400/80" title="Álbumes de estudio que faltan">faltan {a.missing}</div>
                ) : (
                  <div className="text-xs text-neutral-600">{a.tracks} pistas</div>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
