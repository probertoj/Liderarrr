import { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { Shapes, ArrowLeft, Search, Sparkles, ExternalLink, Download, Check, Loader2 } from 'lucide-react';
import { api } from '../api.js';
import {
  PageTitle,
  Spinner,
  ErrorMsg,
  AlbumCard,
  QuickSearch,
  SearchModal,
  WantButton,
  AddToChallengeButton,
} from '../components.jsx';

// GÉNEROS (1.1) — explorar la colección por género, al estilo del árbol de Roon: de lo ancho
// («Rock») a lo concreto («Shoegaze»), con todo lo tuyo dentro y, al lado, los discos buenos de
// ese género que AÚN NO TIENES. Los géneros se normalizan en vivo desde las etiquetas de tus
// ficheros (ver server/src/genres.js), que vienen en 1.081 grafías distintas.

// Un color por género, estable: el mismo color siempre para el mismo género, para que la vista
// se lea de un vistazo sin tener que ir leyendo nombres.
const TONO = {
  rock: 'from-red-500/25 to-red-900/5 border-red-500/30',
  indie: 'from-amber-500/25 to-amber-900/5 border-amber-500/30',
  pop: 'from-pink-500/25 to-pink-900/5 border-pink-500/30',
  electronica: 'from-cyan-500/25 to-cyan-900/5 border-cyan-500/30',
  hiphop: 'from-orange-500/25 to-orange-900/5 border-orange-500/30',
  soul: 'from-purple-500/25 to-purple-900/5 border-purple-500/30',
  jazz: 'from-blue-500/25 to-blue-900/5 border-blue-500/30',
  folk: 'from-lime-500/25 to-lime-900/5 border-lime-500/30',
  metal: 'from-neutral-400/25 to-neutral-800/5 border-neutral-500/30',
  punk: 'from-rose-500/25 to-rose-900/5 border-rose-500/30',
  blues: 'from-indigo-500/25 to-indigo-900/5 border-indigo-500/30',
  country: 'from-yellow-600/25 to-yellow-900/5 border-yellow-600/30',
  reggae: 'from-green-500/25 to-green-900/5 border-green-500/30',
  latina: 'from-fuchsia-500/25 to-fuchsia-900/5 border-fuchsia-500/30',
  clasica: 'from-stone-400/25 to-stone-800/5 border-stone-500/30',
  bso: 'from-sky-500/25 to-sky-900/5 border-sky-500/30',
  experimental: 'from-teal-500/25 to-teal-900/5 border-teal-500/30',
  mundo: 'from-emerald-500/25 to-emerald-900/5 border-emerald-500/30',
};
const tono = (slug) => TONO[slug] || 'from-ink-700/40 to-ink-900/5 border-ink-700';

// --- portada: el árbol de géneros -------------------------------------------

export default function Genres() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    api.genres().then(setData).catch((e) => setErr(e.message));
  }, []);

  if (err) return <ErrorMsg>{err}</ErrorMsg>;
  if (!data) return <Spinner />;

  const { genres, unclassified, stats } = data;

  return (
    <div>
      <PageTitle
        icon={Shapes}
        title="Géneros"
        sub={`${genres.length} géneros · ${stats.classified.toLocaleString('es')} de ${stats.albums.toLocaleString('es')} discos clasificados`}
      />

      <QuickSearch />

      {genres.length === 0 ? (
        <div className="card p-8 text-center text-neutral-400">
          Tus ficheros no traen etiqueta de género, así que no hay nada que explorar todavía. El género sale de las
          etiquetas de tu música; si las rellenas (con Picard, por ejemplo) y reescaneas, esta página se llena sola.
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {genres.map((g) => (
            <Link
              key={g.slug}
              to={`/generos/${g.slug}`}
              className={`rounded-xl border bg-gradient-to-br p-4 hover:brightness-125 transition ${tono(g.slug)}`}
            >
              <div className="text-base text-neutral-100">{g.name}</div>
              <div className="text-xs text-neutral-400 mt-0.5">{g.count.toLocaleString('es')} discos</div>
              {g.children.length > 0 && (
                <div className="text-[11px] text-neutral-500 mt-2 line-clamp-2">
                  {g.children.slice(0, 4).map((c) => c.sub).join(' · ')}
                </div>
              )}
            </Link>
          ))}
        </div>
      )}

      {unclassified.length > 0 && (
        <div className="card p-4 mt-6">
          <h2 className="text-sm text-neutral-300 mb-1">Etiquetas sin clasificar</h2>
          <p className="text-xs text-neutral-600 mb-3">
            {stats.unclassifiedTags} etiquetas de tus ficheros que no se reconocen como ningún género conocido
            ({stats.unclassifiedAlbums.toLocaleString('es')} apariciones). No se colocan a la fuerza en ningún sitio:
            preferimos dejarlas aquí a la vista antes que meter un disco en un género que no es. Si ves alguna que
            debería contar, dilo y se añade al diccionario.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {unclassified.map((u) => (
              <span key={u.name} className="text-xs px-2 py-0.5 rounded-full border border-ink-800 bg-ink-850 text-neutral-500">
                {u.name} <span className="text-neutral-700">{u.count}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// --- detalle de un género ----------------------------------------------------

export function GenreDetail() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [sub, setSub] = useState(null);
  const [sort, setSort] = useState('recientes');
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [recs, setRecs] = useState(null);
  const [recsLoading, setRecsLoading] = useState(false);
  const [search, setSearch] = useState(null);

  useEffect(() => {
    setData(null);
    setRecs(null);
    api.genre(slug, { sub, sort }).then(setData).catch((e) => setErr(e.message));
  }, [slug, sub, sort]);

  const verRecomendaciones = async () => {
    setRecsLoading(true);
    try {
      setRecs(await api.genreRecommendations(slug, sub));
    } catch (e) {
      setErr(e.message);
    } finally {
      setRecsLoading(false);
    }
  };

  if (err) return <ErrorMsg>{err}</ErrorMsg>;
  if (!data) return <Spinner />;

  return (
    <div>
      <button onClick={() => navigate('/generos')} className="text-sm text-neutral-500 hover:text-gold-400 inline-flex items-center gap-1 mb-3">
        <ArrowLeft size={14} /> Géneros
      </button>

      <PageTitle
        icon={Shapes}
        title={sub ? `${data.name} · ${sub}` : data.name}
        sub={`${data.total.toLocaleString('es')} discos tuyos${data.artists.length ? ` · ${data.artists.length >= 30 ? '30+' : data.artists.length} artistas` : ''}`}
      />

      {data.subgenres.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          <button
            onClick={() => setSub(null)}
            className={`text-xs px-2 py-1 rounded-full border ${!sub ? 'border-gold-500/50 bg-gold-500/15 text-gold-300' : 'border-ink-800 bg-ink-850 text-neutral-400'}`}
          >
            Todo {data.name}
          </button>
          {data.subgenres.map((c) => (
            <button
              key={c.sub}
              onClick={() => setSub(c.sub === sub ? null : c.sub)}
              className={`text-xs px-2 py-1 rounded-full border ${
                sub === c.sub ? 'border-gold-500/50 bg-gold-500/15 text-gold-300' : 'border-ink-800 bg-ink-850 text-neutral-400'
              }`}
            >
              {c.sub} <span className="text-neutral-600">{c.count}</span>
            </button>
          ))}
        </div>
      )}

      {/* Lo bueno de este género que aún no tienes. Se pide al pulsar, no al entrar: consulta
          Last.fm en vivo y no todo el mundo lo tiene configurado. */}
      <div className="card p-4 mb-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm text-neutral-300 flex items-center gap-2">
              <Sparkles size={15} className="text-gold-400/80" /> Lo mejor de {sub || data.name} que aún no tienes
            </h2>
            <p className="text-xs text-neutral-600 mt-1">
              Los discos más escuchados del género según Last.fm, quitando los que ya están en tu colección. Para
              descubrir los clásicos que te faltan, no solo las novedades.
            </p>
          </div>
          {!recs && (
            <button
              onClick={verRecomendaciones}
              disabled={recsLoading}
              className="text-xs px-2.5 py-1.5 rounded-lg border border-gold-500/40 bg-gold-500/10 text-gold-300 hover:bg-gold-500/20 inline-flex items-center gap-1.5 disabled:opacity-60 shrink-0"
            >
              {recsLoading ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
              {recsLoading ? 'Buscando…' : 'Ver recomendaciones'}
            </button>
          )}
        </div>

        {recs && !recs.configured && (
          <p className="text-sm text-neutral-500 mt-3">
            Configura Last.fm en Ajustes para ver las recomendaciones de este género.
          </p>
        )}
        {recs?.configured && recs.items.length === 0 && recs.considered > 0 && (
          <p className="text-sm text-neutral-500 mt-3">
            Nada que recomendarte aquí: ya tienes los {recs.considered} discos más escuchados de «{recs.tag}». Bien
            jugado.
          </p>
        )}
        {recs?.configured && !recs.considered && (
          <p className="text-sm text-neutral-500 mt-3">
            Last.fm no ha devuelto nada para «{recs.tag}». Puede ser una etiqueta con poco movimiento, o que tu clave
            de Last.fm no esté funcionando — compruébala en Ajustes.
          </p>
        )}
        {recs?.items?.length > 0 && (
          <>
            <p className="text-[11px] text-neutral-600 mt-3">
              {recs.items.length} de los {recs.considered} más escuchados de «{recs.tag}» no están en tu colección.
            </p>
            <div className="space-y-1.5 mt-2">
              {recs.items.map((r) => (
                <GenreRecRow key={`${r.artist}::${r.album}`} r={r} onSearch={setSearch} />
              ))}
            </div>
          </>
        )}
      </div>

      {data.artists.length > 0 && (
        <div className="mb-6">
          <h2 className="text-xs uppercase tracking-wider text-neutral-600 mb-2">Tus artistas de {sub || data.name}</h2>
          <div className="flex flex-wrap gap-1.5">
            {data.artists.map((a) => (
              <Link
                key={a.id}
                to={`/artista/${a.id}`}
                className="text-xs px-2 py-1 rounded-full border border-ink-800 bg-ink-850 text-neutral-300 hover:border-gold-500/40"
              >
                {a.name} <span className="text-neutral-600">{a.albums}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
        <h2 className="text-xs uppercase tracking-wider text-neutral-600">
          Tus discos <span className="text-neutral-700">· {data.total.toLocaleString('es')}</span>
        </h2>
        <div className="flex gap-1.5">
          {[
            { id: 'recientes', label: 'Más recientes' },
            { id: 'antiguos', label: 'Más antiguos' },
            { id: 'titulo', label: 'A–Z' },
          ].map((o) => (
            <button
              key={o.id}
              onClick={() => setSort(o.id)}
              className={`text-xs px-2 py-1 rounded-lg border ${
                sort === o.id ? 'border-gold-500/50 bg-gold-500/10 text-gold-300' : 'border-ink-800 bg-ink-850 text-neutral-500'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3">
        {data.albums.map((a) => (
          <AlbumCard key={a.id} album={a} />
        ))}
      </div>
      {data.total > data.albums.length && (
        <p className="text-xs text-neutral-600 mt-3">
          Mostrando {data.albums.length} de {data.total.toLocaleString('es')}. Afina con un subgénero para ver el resto.
        </p>
      )}

      {search != null && <SearchModal initialQuery={search} onClose={() => setSearch(null)} />}
    </div>
  );
}

// Fila de un disco recomendado del género: escucharlo fuera, quererlo o bajarlo ya.
function GenreRecRow({ r, onSearch }) {
  const [state, setState] = useState(null); // busy | done
  const grab = async () => {
    setState('busy');
    try {
      const res = await api.grabBest(`${r.artist} ${r.album}`, { artist: r.artist, album: r.album });
      if (!res.grabbed) {
        alert(`No se pudo agarrar: ${res.reason || 'sin release'}`);
        setState(null);
        return;
      }
      setState('done');
    } catch (e) {
      alert(e.message);
      setState(null);
    }
  };
  return (
    <div className="card px-3 py-2 release-row text-sm">
      <div className="release-main">
        <img
          src={r.cover || ''}
          alt=""
          loading="lazy"
          onError={(e) => {
            e.currentTarget.style.visibility = 'hidden';
          }}
          className="w-10 h-10 rounded object-cover bg-ink-850 shrink-0"
        />
        <div className="min-w-0 flex-1">
          <div className="truncate clamp-mobile" title={`${r.artist} — ${r.album}`}>
            {r.artist}
            <span className="text-neutral-500"> — {r.album}</span>
          </div>
        </div>
      </div>
      <div className="release-actions">
        <button
          onClick={() => onSearch(`${r.artist} ${r.album}`)}
          className="text-xs px-1.5 py-0.5 rounded border border-ink-700 bg-ink-850 hover:bg-ink-800 inline-flex items-center gap-1"
        >
          <Search size={12} /> Buscar
        </button>
        <AddToChallengeButton artist={r.artist} title={r.album} />
        <WantButton artist={r.artist} title={r.album} origin="generos" />
        {r.url && (
          <a
            href={r.url}
            target="_blank"
            rel="noreferrer"
            title="Abrir en Last.fm"
            className="text-xs px-1.5 py-0.5 rounded border border-ink-700 bg-ink-850 hover:bg-ink-800 inline-flex items-center gap-1"
          >
            <ExternalLink size={12} /> Last.fm
          </a>
        )}
        {state === 'done' ? (
          <span className="text-emerald-400 text-xs inline-flex items-center gap-1 shrink-0">
            <Check size={13} /> pedido
          </span>
        ) : (
          <button
            onClick={grab}
            disabled={state === 'busy'}
            className="text-xs px-1.5 py-0.5 rounded border border-gold-500/40 bg-gold-500/10 text-gold-300 hover:bg-gold-500/20 inline-flex items-center gap-1 shrink-0 disabled:opacity-50"
          >
            {state === 'busy' ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} Descargar
          </button>
        )}
      </div>
    </div>
  );
}
