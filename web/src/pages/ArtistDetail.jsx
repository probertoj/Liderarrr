import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Star, RefreshCw, Plus, Check, CalendarClock, Network, Loader2, ExternalLink, ChevronDown, ChevronRight, Link2, Search, X, Image as ImageIcon, Upload } from 'lucide-react';
import { api, fmtBytes, pollLidarrQueue } from '../api.js';
import { AlbumCard, ArtistPhoto, Spinner, ErrorMsg, Button, ProgressBar, SearchModal, DuplicateGroupPanel, useLidarrEnabled } from '../components.jsx';

export default function ArtistDetail() {
  const { id } = useParams();
  const [artist, setArtist] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [openKey, setOpenKey] = useState(null); // grupo de duplicados desplegado
  const [openTypes, setOpenTypes] = useState(() => new Set(['Álbumes'])); // por defecto solo Álbumes
  const [mbidModal, setMbidModal] = useState(false);
  const [photoModal, setPhotoModal] = useState(false);
  const [photoBust, setPhotoBust] = useState(0);
  const lidarrOn = useLidarrEnabled();
  const toggleType = (t) =>
    setOpenTypes((s) => {
      const n = new Set(s);
      if (n.has(t)) n.delete(t);
      else n.add(t);
      return n;
    });

  const load = () => api.artist(id).then(setArtist).catch((e) => setErr(e.message));
  useEffect(() => {
    setArtist(null);
    load();
  }, [id]);

  const following = artist?.tracked?.includes('artist');

  const toggleFollow = async () => {
    setBusy(true);
    try {
      if (following) await api.unfollow(id, 'artist');
      else await api.follow(id, 'artist');
      await load();
    } finally {
      setBusy(false);
    }
  };

  const refreshDisco = async () => {
    setBusy(true);
    try {
      await api.refreshArtistDisco(id);
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  // Ámbito de completismo, persistente por artista: 'albums' (solo álbumes) o 'all'
  // (además EPs y singles). De unos artistas quieres todo; de otros, solo los discos.
  const toggleScope = async () => {
    const cur = artist?.completism_scope || 'albums';
    setBusy(true);
    try {
      await api.setArtistScope(id, cur === 'all' ? 'albums' : 'all');
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (err) return <ErrorMsg>{err}</ErrorMsg>;
  if (!artist) return <Spinner />;

  const comp = artist.completeness || {};
  const noMbid = !artist.mbid;
  const scope = artist.completism_scope || 'albums';

  // Clasifica cada álbum de la colección por tipo (para agrupar la parrilla). Los que
  // tienen tipos secundarios (recopilatorio, directo, remezcla…) van a "Otros".
  const parseSec = (s) => {
    try {
      return typeof s === 'string' ? JSON.parse(s) : s || [];
    } catch {
      return [];
    }
  };
  const typeBucket = (a) => {
    if (parseSec(a.secondary_types).length) return 'Otros';
    if (a.primary_type === 'EP') return 'EPs';
    if (a.primary_type === 'Single') return 'Singles';
    if (a.primary_type === 'Album' || !a.primary_type) return 'Álbumes';
    return 'Otros';
  };
  const TYPE_ORDER = ['Álbumes', 'EPs', 'Singles', 'Otros'];

  // Duplicados: la rejilla muestra solo la copia representante (la mejor) de cada
  // grupo, con badge ×N; al pincharla se despliega el grupo. groupsByKey mapea la
  // clave del grupo a sus copias para el panel.
  const groupsByKey = {};
  for (const g of artist.duplicateGroups || []) groupsByKey[g.key] = g;
  const gridAlbums = artist.albums.filter((a) => !a.dup || a.dup.best);
  const dupCount = artist.duplicateGroups?.length || 0;
  const byType = {};
  for (const a of gridAlbums) (byType[typeBucket(a)] ||= []).push(a);
  const typeSections = TYPE_ORDER.filter((t) => byType[t]?.length);

  return (
    <div>
      <Link to="/artistas" className="inline-flex items-center gap-1.5 text-sm text-neutral-400 hover:text-gold-400 mb-4">
        <ArrowLeft size={15} /> Artistas
      </Link>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-4">
          <div className="relative group shrink-0">
            <ArtistPhoto id={artist.id} name={artist.name} size={84} bust={photoBust || undefined} retry className="shadow" />
            <button
              onClick={() => setPhotoModal(true)}
              title="Cambiar la foto del artista (buscar en Deezer o subir)"
              className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-ink-900 border border-ink-700 text-neutral-300 hover:border-gold-500/60 hover:text-gold-300 flex items-center justify-center"
            >
              <ImageIcon size={13} />
            </button>
          </div>
          <div>
          <h1 className="text-2xl font-display">{artist.name}</h1>
          <p className="text-sm text-neutral-500 mb-1 inline-flex items-center gap-1.5 flex-wrap">
            <span>
              {artist.mbid ? 'en MusicBrainz' : 'artista local (sin MBID)'}
              {artist.type ? ` · ${artist.type}` : ''}
              {artist.country ? ` · ${artist.country}` : ''}
              {artist.began ? ` · ${artist.began}${artist.ended ? `–${artist.ended}` : ''}` : ''}
            </span>
            {artist.mbid && (
              <>
                <a
                  href={`https://musicbrainz.org/artist/${artist.mbid}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-gold-400 hover:underline inline-flex items-center gap-0.5"
                >
                  MB <ExternalLink size={10} />
                </a>
                <button onClick={() => setMbidModal(true)} className="text-neutral-600 hover:text-gold-400 text-xs underline">
                  corregir
                </button>
              </>
            )}
          </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant={following ? 'gold' : 'default'} onClick={toggleFollow} disabled={busy}>
            <span className="inline-flex items-center gap-1.5">
              <Star size={14} className={following ? 'fill-current' : ''} />
              {following ? 'Siguiendo' : 'Seguir'}
            </span>
          </Button>
          {noMbid ? (
            <Button variant="gold" onClick={() => setMbidModal(true)} disabled={busy}>
              <span className="inline-flex items-center gap-1.5">
                <Link2 size={14} /> Enlazar con MusicBrainz
              </span>
            </Button>
          ) : (
            <Button onClick={refreshDisco} disabled={busy}>
              <span className="inline-flex items-center gap-1.5">
                <RefreshCw size={14} className={busy ? 'animate-spin' : ''} /> Discografía
              </span>
            </Button>
          )}
        </div>
      </div>

      {/* sin MBID: explica por qué no hay completismo y ofrece enlazar */}
      {noMbid && (
        <div className="card p-4 my-5 max-w-lg text-sm">
          <p className="text-neutral-400">
            Este artista no está enlazado con MusicBrainz, así que no hay discografía ni completismo. La identificación
            automática no siempre lo pilla (duplicados, mayúsculas…). Enlázalo a mano y se calcula al instante.
          </p>
          <div className="mt-3">
            <Button variant="gold" onClick={() => setMbidModal(true)}>
              <span className="inline-flex items-center gap-1.5">
                <Link2 size={14} /> Enlazar con MusicBrainz
              </span>
            </Button>
          </div>
        </div>
      )}

      {mbidModal && (
        <MbidLinkerModal
          artist={artist}
          onClose={() => setMbidModal(false)}
          onLinked={async () => {
            setMbidModal(false);
            await load();
          }}
        />
      )}

      {photoModal && (
        <PhotoPickerModal
          artist={artist}
          onClose={() => setPhotoModal(false)}
          onApplied={() => {
            setPhotoBust((n) => n + 1);
            setPhotoModal(false);
          }}
        />
      )}

      {/* completismo */}
      {!noMbid && (
        <div className="card p-4 my-5 max-w-lg">
          {comp.pct == null ? (
            <p className="text-sm text-neutral-500">
              Aún no se ha calculado la discografía. Pulsa «Discografía» para cruzarla con MusicBrainz.
            </p>
          ) : (
            <>
              <ProgressBar pct={comp.pct} label="Álbumes de estudio que tienes" />
              <p className="text-xs text-neutral-500 mt-2">
                {comp.stats?.studio_owned} de {comp.stats?.studio_total} · faltan {comp.stats?.missing}
                {comp.stats?.upcoming ? ` · ${comp.stats.upcoming} por estrenar` : ''}
              </p>
            </>
          )}
        </div>
      )}

      {/* ámbito de completismo (persistente por artista): solo álbumes vs todo */}
      {!noMbid && (
        <div className="flex items-center gap-2 flex-wrap mb-4 text-sm">
          <span className="text-neutral-500">Completismo:</span>
          <button
            onClick={toggleScope}
            disabled={busy}
            className={`px-2.5 py-1 rounded-lg border text-xs disabled:opacity-50 ${
              scope === 'all' ? 'border-gold-500/50 bg-gold-500/15 text-gold-300' : 'border-ink-800 bg-ink-850 text-neutral-400'
            }`}
          >
            {scope === 'all' ? 'Álbumes + EPs + singles' : 'Solo álbumes'}
          </button>
          <span className="text-xs text-neutral-600">
            {scope === 'all' ? 'sigues todo de este artista' : 'pulsa para seguir también EPs y singles'}
          </span>
        </div>
      )}

      {/* lo que falta */}
      {comp.missing?.length > 0 && (
        <MissingList items={comp.missing} artistMbid={artist.mbid} artistName={artist.name} lidarrOn={lidarrOn} />
      )}
      {scope === 'all' && comp.missingEps?.length > 0 && (
        <MissingList items={comp.missingEps} artistMbid={artist.mbid} artistName={artist.name} noun="EPs" singular="EP" lidarrOn={lidarrOn} />
      )}
      {scope === 'all' && comp.missingSingles?.length > 0 && (
        <MissingList items={comp.missingSingles} artistMbid={artist.mbid} artistName={artist.name} noun="singles" singular="single" lidarrOn={lidarrOn} />
      )}

      {/* por estrenar */}
      {comp.upcoming?.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm text-neutral-400 mb-2 flex items-center gap-1.5">
            <CalendarClock size={15} /> Por estrenar
          </h2>
          <div className="space-y-1.5">
            {comp.upcoming.map((u) => (
              <div key={u.rg_mbid} className="card px-3 py-2 flex items-center justify-between text-sm">
                <span>{u.title}</span>
                <span className="text-neutral-500">{u.first_release}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-sm text-neutral-500 mt-4 mb-3">
        {artist.albums.length} álbumes en tu colección
        {dupCount > 0 && (
          <span className="text-neutral-600">
            {' · '}
            {dupCount} con copias (agrupadas; pincha las <span className="text-sky-400">×N</span> para gestionarlas)
          </span>
        )}
      </p>
      {typeSections.length > 1 ? (
        <div className="space-y-4 mb-8">
          {typeSections.map((t) => {
            const open = openTypes.has(t);
            return (
              <div key={t}>
                <button
                  onClick={() => toggleType(t)}
                  className="w-full flex items-center gap-1.5 text-sm text-gold-400/80 mb-2 hover:text-gold-300"
                >
                  {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                  {t} <span className="text-neutral-600">· {byType[t].length}</span>
                </button>
                {open && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                    {byType[t].map((a) => (
                      <AlbumCard
                        key={a.id}
                        album={{ ...a, album_artist: artist.name }}
                        onClick={a.dup ? () => setOpenKey(a.dup.key) : undefined}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-8">
          {gridAlbums.map((a) => (
            <AlbumCard
              key={a.id}
              album={{ ...a, album_artist: artist.name }}
              onClick={a.dup ? () => setOpenKey(a.dup.key) : undefined}
            />
          ))}
        </div>
      )}

      {openKey && groupsByKey[openKey] && (
        <DuplicateGroupPanel group={groupsByKey[openKey]} onClose={() => setOpenKey(null)} />
      )}

      {!noMbid && <Relations artistId={id} />}
    </div>
  );
}

// Enlazar (o corregir) el artista con MusicBrainz a mano: busca por nombre y elige el
// correcto, o pega directamente su MBID. Al fijarlo, el backend recalcula la
// discografía en el acto. Resuelve casos que la identificación no pilla (duplicados,
// mayúsculas… p. ej. «Florence + the Machine»).
const MBID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Poner foto al artista: buscar candidatos en Deezer (por nombre, editable) o subir una
// imagen desde el equipo. Se guarda en la caché de la app (los artistas no tienen carpeta).
function PhotoPickerModal({ artist, onClose, onApplied }) {
  const [q, setQ] = useState(artist.name || '');
  const [candidates, setCandidates] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [applying, setApplying] = useState(null);

  const search = async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await api.artistPhotoCandidates(artist.id, q);
      setCandidates(r.candidates || []);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyUrl = async (url) => {
    setApplying(url);
    setErr(null);
    try {
      await api.applyArtistPhoto(artist.id, { url });
      onApplied();
    } catch (e) {
      setErr(e.message);
      setApplying(null);
    }
  };

  const onUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setErr('El fichero no es una imagen.');
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      setApplying('upload');
      setErr(null);
      try {
        await api.applyArtistPhoto(artist.id, { dataUrl: reader.result });
        onApplied();
      } catch (e2) {
        setErr(e2.message);
        setApplying(null);
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 p-4 overflow-y-auto" onClick={onClose}>
      <div className="card w-full max-w-2xl mt-10 p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm text-neutral-300 flex items-center gap-2">
            <ImageIcon size={15} /> Foto del artista
          </h2>
          <button onClick={onClose} className="text-neutral-500 hover:text-neutral-300" title="Cerrar">
            <X size={18} />
          </button>
        </div>

        <div className="flex gap-2">
          <input
            className="flex-1 bg-ink-850 border border-ink-800 rounded px-2 py-1.5 text-sm outline-none focus:border-gold-500/60"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search()}
            placeholder="Nombre del artista…"
          />
          <Button onClick={search} disabled={loading}>
            <span className="inline-flex items-center gap-1.5">
              <Search size={14} /> {loading ? 'Buscando…' : 'Buscar'}
            </span>
          </Button>
          <label className="text-sm px-3 py-1.5 rounded-lg border border-ink-700 bg-ink-850 hover:bg-ink-800 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap">
            <Upload size={14} /> Subir
            <input type="file" accept="image/*" className="hidden" onChange={onUpload} disabled={!!applying} />
          </label>
        </div>
        <p className="text-xs text-neutral-600 mt-1">Fuente: Deezer. Se guarda en la app (no toca tu música).</p>

        {err && <p className="text-sm text-amber-400 mt-3">{err}</p>}
        {candidates && candidates.length === 0 && !loading && (
          <p className="text-sm text-neutral-600 mt-4">Sin candidatos. Prueba a cambiar el texto o sube una imagen.</p>
        )}

        {candidates && candidates.length > 0 && (
          <div className="mt-4 grid grid-cols-3 sm:grid-cols-5 gap-3 max-h-[26rem] overflow-y-auto pr-1">
            {candidates.map((c, i) => (
              <button
                key={`${c.url}:${i}`}
                onClick={() => applyUrl(c.url)}
                disabled={!!applying}
                className="relative rounded-full overflow-hidden border border-ink-800 hover:border-gold-500/70 disabled:opacity-50 aspect-square bg-ink-850"
                title={c.name}
              >
                <img src={c.thumb} alt="" className="h-full w-full object-cover" loading="lazy" />
                {applying === c.url && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                    <Loader2 size={20} className="animate-spin text-gold-300" />
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MbidLinkerModal({ artist, onClose, onLinked }) {
  const [q, setQ] = useState(artist.name || '');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [saving, setSaving] = useState(null);
  const [raw, setRaw] = useState('');

  const run = async () => {
    if (!q.trim()) return;
    setLoading(true);
    setErr(null);
    try {
      setResults(await api.searchArtistMb(q));
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  // primera búsqueda automática al abrir
  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const link = async (mbid) => {
    setSaving(mbid);
    setErr(null);
    try {
      await api.setArtistMbid(artist.id, mbid);
      await onLinked();
    } catch (e) {
      setErr(e.message);
      setSaving(null);
    }
  };

  const rawValid = MBID_RE.test(raw.trim());

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 p-4 overflow-y-auto" onClick={onClose}>
      <div className="card w-full max-w-2xl mt-10 p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm text-neutral-300 flex items-center gap-2">
            <Link2 size={15} /> {artist.mbid ? 'Corregir enlace con MusicBrainz' : 'Enlazar con MusicBrainz'}
          </h2>
          <button onClick={onClose} className="text-neutral-500 hover:text-neutral-300" title="Cerrar">
            <X size={18} />
          </button>
        </div>

        <div className="flex gap-2">
          <input
            className="flex-1 bg-ink-850 border border-ink-800 rounded px-2 py-1.5 text-sm outline-none focus:border-gold-500/60"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && run()}
            placeholder="Nombre del artista en MusicBrainz…"
          />
          <Button onClick={run} disabled={loading}>
            <span className="inline-flex items-center gap-1.5">
              <Search size={14} /> {loading ? 'Buscando…' : 'Buscar'}
            </span>
          </Button>
        </div>

        {err && <p className="text-sm text-red-400 mt-3">{err}</p>}
        {results && results.length === 0 && !loading && (
          <p className="text-sm text-neutral-600 mt-3">Sin resultados. Cambia el texto o pega el MBID abajo.</p>
        )}
        {results && results.length > 0 && (
          <div className="mt-3 max-h-80 overflow-y-auto divide-y divide-ink-850/60">
            {results.map((r) => {
              const isCurrent = r.mbid === artist.mbid;
              return (
                <div key={r.mbid} className="py-2 flex items-center gap-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="truncate">
                      <span className="text-neutral-200">{r.name}</span>
                      {r.disambiguation ? <span className="text-neutral-500"> — {r.disambiguation}</span> : null}
                    </div>
                    <div className="text-xs text-neutral-600">
                      {r.type ? <span>{r.type}</span> : null}
                      {r.country ? <span className="ml-2">{r.country}</span> : null}
                      {r.began ? <span className="ml-2">{r.began}{r.ended ? `–${r.ended}` : ''}</span> : null}
                      <a
                        href={`https://musicbrainz.org/artist/${r.mbid}`}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-2 text-gold-400 hover:underline inline-flex items-center gap-0.5"
                      >
                        MB <ExternalLink size={11} />
                      </a>
                    </div>
                  </div>
                  {isCurrent ? (
                    <span className="text-xs text-emerald-400 shrink-0 inline-flex items-center gap-1">
                      <Check size={14} /> actual
                    </span>
                  ) : (
                    <Button variant="gold" disabled={saving === r.mbid} onClick={() => link(r.mbid)}>
                      <span className="inline-flex items-center gap-1.5">
                        <Check size={14} /> {saving === r.mbid ? '…' : 'Es este'}
                      </span>
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-4 pt-3 border-t border-ink-800">
          <p className="text-xs text-neutral-600 mb-1.5">¿Ya tienes el MBID? Pégalo aquí:</p>
          <div className="flex gap-2">
            <input
              className="flex-1 bg-ink-850 border border-ink-800 rounded px-2 py-1.5 text-xs font-mono outline-none focus:border-gold-500/60"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder="00000000-0000-0000-0000-000000000000"
            />
            <Button disabled={!rawValid || saving === raw.trim().toLowerCase()} onClick={() => link(raw.trim().toLowerCase())}>
              Enlazar
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Grafo de relaciones de MusicBrainz cruzado con tu colección: miembros, bandas,
// proyectos paralelos y colaboraciones, con lo que ya tienes o sigues.
function Relations({ artistId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      setData(await api.relations(artistId));
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm text-neutral-400 flex items-center gap-2">
          <Network size={15} /> Relaciones (MusicBrainz)
        </h2>
        {!data && (
          <Button onClick={load} disabled={loading}>
            {loading ? 'Cargando…' : 'Ver relaciones'}
          </Button>
        )}
      </div>
      {err && <p className="text-sm text-red-400 mt-3">{err}</p>}
      {data && !data.hasMbid && <p className="text-sm text-neutral-600 mt-3">Este artista no está en MusicBrainz.</p>}
      {data && data.hasMbid && data.groups.length === 0 && (
        <p className="text-sm text-neutral-600 mt-3">MusicBrainz no tiene relaciones para este artista.</p>
      )}
      {data?.groups?.map((g) => (
        <div key={g.key} className="mt-4">
          <h3 className="text-xs uppercase tracking-wider text-neutral-600 mb-2">{g.label}</h3>
          <div className="flex flex-wrap gap-1.5">
            {g.artists.map((a) => (
              <RelChip key={a.mbid} a={a} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function RelChip({ a }) {
  const [followed, setFollowed] = useState(a.tracked);
  const [busy, setBusy] = useState(false);
  const follow = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setBusy(true);
    try {
      await api.followMbid(a.mbid, 'artist');
      setFollowed(true);
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  };
  const inner = (
    <>
      {a.name}
      {a.owned_albums > 0 && <span className="text-emerald-400/80"> · {a.owned_albums}</span>}
      {a.attributes?.length > 0 && <span className="text-neutral-600"> · {a.attributes.join(', ')}</span>}
    </>
  );
  const cls =
    'text-xs px-2 py-1 rounded-full border inline-flex items-center gap-1 ' +
    (a.owned_albums > 0 || followed
      ? 'border-gold-500/30 bg-gold-500/10 text-gold-200'
      : 'border-ink-800 bg-ink-850 text-neutral-300');

  // si lo tienes en local, enlaza a su ficha; si no, botón de seguir
  if (a.artist_id) {
    return (
      <Link to={`/artista/${a.artist_id}`} className={cls}>
        {inner}
      </Link>
    );
  }
  return (
    <button onClick={follow} disabled={busy} className={cls} title="Seguir en Liderarrr">
      {inner}
      {followed ? <Check size={12} className="text-emerald-400" /> : <Plus size={12} />}
    </button>
  );
}

function MissingList({ items, artistMbid, artistName, noun = 'álbumes de estudio', singular = 'álbum de estudio', lidarrOn }) {
  const [added, setAdded] = useState({});
  const [busy, setBusy] = useState(null);
  const [queue, setQueue] = useState(null);
  const [search, setSearch] = useState(null); // query del modal de búsqueda manual

  // Con Lidarr → se lo mandamos (envío encolado, no bloqueante). Sin Lidarr (opcional)
  // → descarga nativa: agarra la mejor release por Prowlarr/Jackett y el auto-import
  // la coloca en la biblioteca.
  const add = async (rg) => {
    setBusy(rg.rg_mbid);
    try {
      if (lidarrOn) {
        await api.lidarrAdd(rg.rg_mbid, artistMbid);
        pollLidarrQueue(setQueue);
      } else {
        const res = await api.grabBest(`${artistName || ''} ${rg.title}`.trim(), { rg_mbid: rg.rg_mbid, artist: artistName, album: rg.title });
        if (!res.grabbed) {
          alert(`No se pudo agarrar: ${res.reason || 'sin release'}`);
          return;
        }
      }
      setAdded((p) => ({ ...p, [rg.rg_mbid]: true }));
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(null);
    }
  };

  const addAll = async () => {
    const toSend = items.filter((i) => !added[i.rg_mbid] && !i.in_lidarr);
    if (!toSend.length) return;
    setBusy('all');
    try {
      if (lidarrOn) {
        await api.lidarrAddBulk(toSend.map((i) => ({ rg_mbid: i.rg_mbid, artist_mbid: artistMbid })));
        pollLidarrQueue(setQueue);
        setAdded((p) => ({ ...p, ...Object.fromEntries(toSend.map((i) => [i.rg_mbid, true])) }));
      } else {
        // nativo: secuencial (los indexers se consultan en vivo). Marca las que agarra.
        for (const i of toSend) {
          try {
            const res = await api.grabBest(`${artistName || ''} ${i.title}`.trim(), { rg_mbid: i.rg_mbid, artist: artistName, album: i.title });
            if (res.grabbed) setAdded((p) => ({ ...p, [i.rg_mbid]: true }));
          } catch {
            /* uno que falla no corta la tanda */
          }
        }
      }
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm text-neutral-400">
          {items.length === 1 ? `Te falta 1 ${singular}` : `Te faltan ${items.length} ${noun}`}
        </h2>
        <Button variant="gold" onClick={addAll} disabled={busy === 'all'}>
          <span className="inline-flex items-center gap-1.5">
            {busy === 'all' && <Loader2 size={14} className="animate-spin" />}
            {busy === 'all' ? (lidarrOn ? 'Encolando…' : 'Descargando…') : lidarrOn ? 'Enviar todos a Lidarr' : 'Descargar todos'}
          </span>
        </Button>
      </div>
      {queue &&
        (queue.running ? (
          <p className="text-xs text-gold-300/90 mb-2">Lidarr: procesando {queue.done}/{queue.total}…</p>
        ) : (
          <p className="text-xs text-neutral-500 mb-2">
            Lidarr: {queue.added} enviados
            {queue.pending ? ` · ${queue.pending} pendientes de importar` : ''}
            {queue.errors?.length ? ` · ${queue.errors.length} con error` : ''}.
          </p>
        ))}
      <div className="space-y-1.5">
        {items.map((m) => {
          const done = added[m.rg_mbid] || m.in_lidarr;
          return (
            <div key={m.rg_mbid} className="card px-3 py-2 flex items-center gap-2 text-sm">
              <span className="truncate flex-1 min-w-0">
                {m.title}
                {m.year ? <span className="text-neutral-600"> · {m.year}</span> : ''}
              </span>
              <a
                href={`https://musicbrainz.org/release-group/${m.rg_mbid}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-gold-400 hover:underline inline-flex items-center gap-0.5 shrink-0"
              >
                MB <ExternalLink size={11} />
              </a>
              <button
                onClick={() => setSearch(`${artistName || ''} ${m.title}`.trim())}
                className="text-xs px-2 py-1 rounded border border-ink-700 bg-ink-850 hover:bg-ink-800 shrink-0"
              >
                Buscar
              </button>
              {done ? (
                <span className="text-emerald-400 text-xs inline-flex items-center gap-1 shrink-0">
                  <Check size={14} /> {lidarrOn ? 'en Lidarr' : 'pedido'}
                </span>
              ) : (
                <button
                  onClick={() => add(m)}
                  disabled={busy === m.rg_mbid}
                  className="text-xs px-2 py-1 rounded border border-gold-500/40 bg-gold-500/10 text-gold-300 hover:bg-gold-500/20 shrink-0 inline-flex items-center gap-1 disabled:opacity-50"
                >
                  {busy === m.rg_mbid ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                  {busy === m.rg_mbid ? (lidarrOn ? 'Enviando…' : 'Descargando…') : lidarrOn ? 'Lidarr' : 'Descargar'}
                </button>
              )}
            </div>
          );
        })}
      </div>
      {search != null && <SearchModal initialQuery={search} onClose={() => setSearch(null)} />}
    </div>
  );
}

