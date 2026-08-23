import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Music2, Sparkles, RotateCcw, Disc3, ExternalLink, Tag, AlertTriangle, Search, Download, Check, Send, Trash2, Pencil, X, Loader2, FolderInput, Image as ImageIcon, Upload, Users, Star, BookOpen, Layers, MoreHorizontal, Copy, Trophy, Database, Radio } from 'lucide-react';
import { api, fmtBytes, pollLidarrQueue } from '../api.js';
import { openMbReleaseEditor } from '../mb.js';
import { Cover, ArtistPhoto, StateBadge, Spinner, ErrorMsg, Button, useLidarrEnabled, DuplicateCopies } from '../components.jsx';

// orphan y bootleg son «de primera clase»: material fuera de catálogo (rarezas y
// directos no oficiales) que cuenta en lo descriptivo pero no en el completismo. En toda
// la ficha se tratan igual — ninguno se identifica ni se le escriben etiquetas.
const isRarity = (s) => s === 'orphan' || s === 'bootleg';

export default function AlbumDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [album, setAlbum] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [names, setNames] = useState([]);
  const [creditModal, setCreditModal] = useState(false);
  const [editTitle, setEditTitle] = useState(false);
  const [titleVal, setTitleVal] = useState('');
  const [labels, setLabels] = useState([]);
  const [labelTried, setLabelTried] = useState(false);
  const [coverModal, setCoverModal] = useState(false);
  const [coverBust, setCoverBust] = useState(0);
  const [secMenu, setSecMenu] = useState(false); // menú «⋯» de opciones secundarias
  const [shownSec, setShownSec] = useState(() => new Set()); // secciones secundarias reveladas
  const lidarrOn = useLidarrEnabled();

  const load = () => api.album(id).then(setAlbum).catch((e) => setErr(e.message));
  useEffect(() => {
    setAlbum(null);
    setCreditModal(false);
    setSecMenu(false);
    setShownSec(new Set());
    setEditTitle(false);
    setLabels([]);
    setLabelTried(false);
    load();
  }, [id]);

  // El sello se muestra junto a «Origen». Si los ficheros no traían la etiqueta y el
  // álbum está identificado, se resuelve desde MusicBrainz (una vez, cacheado).
  useEffect(() => {
    if (!album) return;
    if (album.labels?.length) {
      setLabels(album.labels);
      return;
    }
    if ((album.rg_mbid || album.release_mbid) && !labelTried) {
      setLabelTried(true);
      api.resolveAlbumLabel(album.id).then((r) => setLabels(r.labels || [])).catch(() => {});
    }
  }, [album, labelTried]);
  useEffect(() => {
    api.artistNames().then(setNames).catch(() => {});
  }, []);

  const setState = async (state) => {
    setBusy(true);
    try {
      await api.albumState(id, state);
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  // Borrado de disco: acción de limpieza/mantenimiento. Irreversible (sin Papelera) y
  // con guardarraíles en el backend (solo dentro de music_dirs, nunca torrents/). Doble
  // confirmación dura antes de tocar nada.
  const deleteFromDisk = async () => {
    if (!window.confirm(`¿Borrar del disco «${album.album_artist} — ${album.title}»?\n\nSe eliminan los ficheros de su carpeta en la biblioteca. Esto NO se puede deshacer.`))
      return;
    setBusy(true);
    try {
      await api.deleteAlbum(id);
      navigate('/discoteca');
    } catch (e) {
      alert(e.message);
      setBusy(false);
    }
  };

  // Renombrar el disco (para discos mal nombrados que no casan). Metadato interno.
  const saveTitle = async () => {
    const t = titleVal.trim();
    if (!t || t === album.title) {
      setEditTitle(false);
      return;
    }
    setBusy(true);
    try {
      await api.setAlbumTitle(id, t);
      setEditTitle(false);
      await load();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  // Re-ubicar en disco: mueve la carpeta a {artista}/{álbum} ({año}) dentro de la
  // biblioteca. Útil para limpiar lo antiguo mal archivado (p. ej. tras corregir el
  // artista). No toca el origen de descargas; el seeding sobrevive (mismo volumen).
  const refile = async () => {
    if (
      !window.confirm(
        `¿Ordenar en su carpeta «${album.album_artist} — ${album.title}»?\n\nMueve la carpeta del álbum a la estructura {artista}/{álbum} dentro de la biblioteca. No toca el origen de descargas.`
      )
    )
      return;
    setBusy(true);
    try {
      const r = await api.refileAlbum(id);
      alert(r.moved ? `Movido a:\n${r.to}` : r.message || 'Ya estaba en su carpeta.');
      await load();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (err) return <ErrorMsg>{err}</ErrorMsg>;
  if (!album) return <Spinner label="Cargando álbum…" />;

  const incomplete = album.track_file_count < album.track_count;
  const min = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;

  return (
    <div>
      <Link to="/discoteca" className="inline-flex items-center gap-1.5 text-sm text-neutral-400 hover:text-gold-400 mb-4">
        <ArrowLeft size={15} /> Discoteca
      </Link>

      <div className="flex flex-col md:flex-row gap-6 mb-6">
        <div className="w-full md:w-64 shrink-0">
          <div className="rounded-xl overflow-hidden card relative group">
            <Cover id={album.id} bust={coverBust || undefined} />
            <button
              onClick={() => setCoverModal(true)}
              className="absolute bottom-2 right-2 inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-ink-900/85 border border-ink-700 text-neutral-200 hover:bg-ink-800 hover:border-gold-500/50 backdrop-blur opacity-90 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
              title="Buscar una carátula online o subir una desde tu equipo"
            >
              <ImageIcon size={13} /> Carátula
            </button>
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <StateBadge state={album.match_state} />
            {album.primary_type && <span className="text-xs text-neutral-500">{album.primary_type}</span>}
            {album.secondary_types?.map((t) => (
              <span key={t} className="text-xs text-neutral-600">· {t}</span>
            ))}
            {album.rg_mbid && (
              <a
                href={`https://musicbrainz.org/release-group/${album.rg_mbid}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-gold-400 hover:underline inline-flex items-center gap-1"
              >
                MusicBrainz <ExternalLink size={11} />
              </a>
            )}
            {(() => {
              const q = `${album.artist?.name || album.album_artist || ''} ${album.title || ''}`.trim();
              if (!q) return null;
              return (
                <>
                  <a
                    href={`https://www.discogs.com/search/?q=${encodeURIComponent(q)}&type=master`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-gold-400 hover:underline inline-flex items-center gap-1"
                    title="Buscar la referencia maestra en Discogs"
                  >
                    Discogs <ExternalLink size={11} />
                  </a>
                  <a
                    href={
                      album.rg_mbid
                        ? `https://record.club/import/${album.rg_mbid}`
                        : `https://record.club/search?q=${encodeURIComponent(q)}`
                    }
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-gold-400 hover:underline inline-flex items-center gap-1"
                    title={
                      album.rg_mbid
                        ? 'Abrir este disco en Record Club (por su MBID; requiere sesión iniciada allí)'
                        : 'Buscar este disco en Record Club'
                    }
                  >
                    Record Club <ExternalLink size={11} />
                  </a>
                  <SpotifyLink artist={album.artist?.name || album.album_artist} title={album.title} />
                </>
              );
            })()}
          </div>
          {editTitle ? (
            <div className="flex items-center gap-1.5 my-1">
              <input
                value={titleVal}
                autoFocus
                disabled={busy}
                onChange={(e) => setTitleVal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveTitle();
                  if (e.key === 'Escape') setEditTitle(false);
                }}
                className="text-xl font-display bg-ink-850 border border-ink-800 rounded px-2 py-0.5 outline-none focus:border-gold-500/60 w-full max-w-md"
              />
              <button onClick={saveTitle} disabled={busy} className="text-gold-300 hover:text-gold-200 disabled:opacity-50" title="Guardar">
                {busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={18} />}
              </button>
              <button onClick={() => setEditTitle(false)} className="text-neutral-500 hover:text-neutral-300" title="Cancelar">
                <X size={16} />
              </button>
            </div>
          ) : (
            <h1 className="text-2xl font-display inline-flex items-center gap-2 group">
              {album.title}
              <button
                onClick={() => {
                  setTitleVal(album.title || '');
                  setEditTitle(true);
                }}
                title="Renombrar el disco"
                className="text-neutral-600 hover:text-gold-400"
              >
                <Pencil size={15} />
              </button>
            </h1>
          )}
          <datalist id="artist-names">
            {names.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
          <span className="inline-flex items-center gap-1.5 flex-wrap">
            <span className="text-sm">
              {album.artists?.length ? (
                album.artists.map((c, i) => (
                  <span key={c.artist_id ?? i}>
                    <Link to={`/artista/${c.artist_id}`} className="text-gold-400 hover:underline">
                      {c.credit_name || c.name}
                    </Link>
                    <span className="text-neutral-500">{c.join_phrase || (i < album.artists.length - 1 ? ' / ' : '')}</span>
                  </span>
                ))
              ) : (
                <Link to={`/artista/${album.artist_id}`} className="text-gold-400 hover:underline">
                  {album.artist?.name || album.album_artist}
                </Link>
              )}
            </span>
            <button
              onClick={() => setCreditModal(true)}
              title="Editar artista(s) — pon varios para singles compartidos y colaboraciones"
              className="text-neutral-500 hover:text-gold-400"
            >
              <Pencil size={13} />
            </button>
          </span>
          {album.year && <span className="text-neutral-500"> · {album.year}</span>}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 text-sm">
            <div>
              <div className="text-neutral-500 text-xs">Pistas</div>
              <div className={incomplete ? 'text-amber-400' : ''}>
                {album.track_file_count}
                {incomplete ? ` / ${album.track_count}` : ''}
              </div>
            </div>
            <div>
              <div className="text-neutral-500 text-xs">Tamaño</div>
              <div>{fmtBytes(album.size_bytes)}</div>
            </div>
            <div>
              <div className="text-neutral-500 text-xs">Discos</div>
              <div>{album.disc_count}</div>
            </div>
            <div>
              <div className="text-neutral-500 text-xs">Origen</div>
              <div>{album.match_source || '—'}</div>
            </div>
            <div>
              <div className="text-neutral-500 text-xs">Sello</div>
              <div className="truncate">
                {labels.length ? (
                  labels.map((l, i) => (
                    <span key={l}>
                      {i > 0 ? ', ' : ''}
                      <Link to={`/sellos?label=${encodeURIComponent(l)}`} className="text-gold-400 hover:underline">
                        {l}
                      </Link>
                    </span>
                  ))
                ) : (
                  <span className="text-neutral-600">—</span>
                )}
              </div>
            </div>
          </div>

          {album.genres?.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-4">
              {album.genres.map((g) => (
                <span key={g} className="text-xs px-2 py-0.5 rounded-full bg-ink-850 border border-ink-800">
                  {g}
                </span>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-2 mt-5">
            {album.match_state !== 'orphan' && (
              <Button variant="default" onClick={() => setState('orphan')} disabled={busy}>
                <span className="inline-flex items-center gap-1.5">
                  <Sparkles size={14} /> Marcar como rareza
                </span>
              </Button>
            )}
            {album.match_state !== 'bootleg' && (
              <Button variant="default" onClick={() => setState('bootleg')} disabled={busy}>
                <span className="inline-flex items-center gap-1.5">
                  <Radio size={14} /> Marcar como bootleg
                </span>
              </Button>
            )}
            {isRarity(album.match_state) && (
              <Button variant="default" onClick={() => setState('pending')} disabled={busy}>
                <span className="inline-flex items-center gap-1.5">
                  <RotateCcw size={14} /> Devolver a pendiente
                </span>
              </Button>
            )}
            {lidarrOn && album.inLidarr && <span className="text-sm text-emerald-400 self-center">✓ en Lidarr</span>}
            <button
              onClick={refile}
              disabled={busy}
              title="Mueve la carpeta a {artista}/{álbum} dentro de la biblioteca"
              className="text-sm px-3 py-1.5 rounded-lg border border-ink-700 bg-ink-850 hover:bg-ink-800 inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              <FolderInput size={14} /> Ordenar en su carpeta
            </button>
            <button
              onClick={deleteFromDisk}
              disabled={busy}
              title="Elimina los ficheros de este álbum de la biblioteca (irreversible)"
              className="text-sm px-3 py-1.5 rounded-lg border border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20 inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              <Trash2 size={14} /> Borrar del disco
            </button>
            <AddToChallenge artist={album.artist?.name || album.album_artist} title={album.title} />
            <div className="relative">
              <button
                onClick={() => setSecMenu((v) => !v)}
                title="Más opciones"
                className={`text-sm px-2.5 py-1.5 rounded-lg border inline-flex items-center gap-1.5 ${
                  secMenu ? 'border-gold-500/50 bg-gold-500/15 text-gold-300' : 'border-ink-700 bg-ink-850 hover:bg-ink-800'
                }`}
              >
                <MoreHorizontal size={16} />
              </button>
              {secMenu && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setSecMenu(false)} />
                  <div className="absolute right-0 mt-1 z-40 w-56 card p-1 shadow-lg border border-ink-700">
                    {[
                      { key: 'disc', label: 'Multidisco', icon: Layers, show: true },
                      { key: 'versions', label: 'Versiones', icon: Disc3, show: true },
                      {
                        key: 'rematch',
                        label: 'Corregir emparejamiento',
                        icon: Sparkles,
                        show: album.match_state === 'matched' || isRarity(album.match_state),
                      },
                      { key: 'tags', label: 'Etiquetas MusicBrainz', icon: Tag, show: album.match_state === 'matched' },
                    ]
                      .filter((i) => i.show)
                      .map((i) => (
                        <button
                          key={i.key}
                          onClick={() => {
                            setShownSec((s) => new Set(s).add(i.key));
                            setSecMenu(false);
                          }}
                          className="w-full text-left px-2.5 py-1.5 rounded text-sm text-neutral-300 hover:bg-ink-800 inline-flex items-center gap-2"
                        >
                          <i.icon size={14} className="text-neutral-500" />
                          {i.label}
                          {shownSec.has(i.key) && <Check size={13} className="text-emerald-400 ml-auto" />}
                        </button>
                      ))}
                  </div>
                </>
              )}
            </div>
          </div>
          <p className="text-xs text-neutral-600 mt-2 break-all">{album.path}</p>
        </div>
      </div>

      <AboutSection albumId={album.id} />

      <DupCopiesSection albumId={album.id} onChange={load} />

      <OwnedEditionsSection albumId={album.id} />

      {/* secciones secundarias: solo si se revelan desde el menú «⋯» */}
      {shownSec.has('disc') && <DiscBox album={album} onDone={load} />}
      {shownSec.has('rematch') && (album.match_state === 'matched' || isRarity(album.match_state)) && (
        <ReMatch album={album} onDone={load} />
      )}
      {shownSec.has('versions') && <Editions albumId={album.id} />}
      {shownSec.has('tags') && album.match_state === 'matched' && <TagWriter albumId={album.id} />}

      {album.match_state !== 'matched' && !isRarity(album.match_state) && (
        <IdentifySection album={album} onDone={load} />
      )}

      {lidarrOn && album.match_state === 'matched' && <LidarrSection album={album} onDone={load} />}

      <SearchSection album={album} />

      {album.match_state === 'matched' && <AlbumCreditsSection albumId={album.id} />}

      <div className="card overflow-hidden mb-6">
        <div className="px-4 py-2.5 border-b border-ink-800 flex items-center gap-2 text-sm text-neutral-400">
          <Music2 size={15} /> Pistas
        </div>
        <table className="w-full text-sm">
          <tbody>
            {album.tracks.map((t) => (
              <tr key={t.id} className="border-b border-ink-850/60 last:border-0 hover:bg-ink-850/40">
                <td className="py-2 px-4 text-neutral-600 w-10 text-right">{t.num || '·'}</td>
                <td className="py-2 pr-4">
                  <div className="truncate">{t.title}</div>
                </td>
                <td className="py-2 pr-4 text-neutral-500 whitespace-nowrap">
                  <span className={t.lossless ? 'text-emerald-400/80' : ''}>{t.format}</span>
                  {t.bitrate ? ` · ${Math.round(t.bitrate / 1000)}k` : ''}
                  {t.bit_depth ? ` · ${t.bit_depth}bit` : ''}
                </td>
                <td className="py-2 pr-4 text-neutral-600 text-right whitespace-nowrap">
                  {t.duration_ms ? min(t.duration_ms) : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Recommendations albumId={album.id} artistName={album.artist?.name || album.album_artist} />

      {coverModal && (
        <CoverPickerModal
          album={album}
          onClose={() => setCoverModal(false)}
          onApplied={() => {
            setCoverBust((n) => n + 1);
            setCoverModal(false);
            load();
          }}
        />
      )}

      {creditModal && (
        <CreditEditor
          album={album}
          names={names}
          onClose={() => setCreditModal(false)}
          onSaved={async () => {
            setCreditModal(false);
            await load();
          }}
        />
      )}
    </div>
  );
}

// Editor del artist-credit de un álbum: uno o VARIOS artistas (singles compartidos del
// emo, colaboraciones). El primero es el principal. Se resuelven por nombre en el backend
// (reusa el artista local si existe, o lo crea). Para completismo fino de un co-artista sin
// MBID, luego se puede «Enlazar con MusicBrainz» desde su ficha.
function CreditEditor({ album, names, onClose, onSaved }) {
  const initial = album.artists?.length
    ? album.artists.map((c) => c.credit_name || c.name)
    : [album.artist?.name || album.album_artist || ''];
  const [rows, setRows] = useState(initial.length ? initial : ['']);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const setRow = (i, v) => setRows((r) => r.map((x, j) => (j === i ? v : x)));
  const addRow = () => setRows((r) => [...r, '']);
  const removeRow = (i) => setRows((r) => (r.length > 1 ? r.filter((_, j) => j !== i) : r));

  const save = async () => {
    const list = rows.map((n) => n.trim()).filter(Boolean);
    if (!list.length) {
      setErr('Hace falta al menos un artista.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await api.setAlbumArtists(album.id, list.map((name) => ({ name })));
      await onSaved();
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 p-4 overflow-y-auto" onClick={onClose}>
      <div className="card w-full max-w-md mt-16 p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm text-neutral-300 flex items-center gap-2">
            <Pencil size={14} /> Artista(s) del álbum
          </h2>
          <button onClick={onClose} className="text-neutral-500 hover:text-neutral-300" title="Cerrar">
            <X size={18} />
          </button>
        </div>
        <p className="text-xs text-neutral-600 mb-3">
          Pon <b className="font-normal text-neutral-400">varios</b> para singles compartidos o colaboraciones (al modo
          MusicBrainz: «A / B»). El primero es el principal. No toca los ficheros.
        </p>

        <div className="space-y-2">
          {rows.map((val, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-xs text-neutral-600 w-4 text-right">{i + 1}</span>
              <input
                list="artist-names"
                value={val}
                autoFocus={i === rows.length - 1}
                disabled={busy}
                onChange={(e) => setRow(i, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') save();
                  if (e.key === 'Escape') onClose();
                }}
                placeholder={i === 0 ? 'Artista principal…' : 'Otro artista…'}
                className="flex-1 bg-ink-850 border border-ink-800 rounded px-2 py-1.5 text-sm outline-none focus:border-gold-500/60"
              />
              <button
                onClick={() => removeRow(i)}
                disabled={busy || rows.length <= 1}
                title="Quitar"
                className="text-neutral-600 hover:text-red-400 disabled:opacity-30"
              >
                <X size={15} />
              </button>
            </div>
          ))}
        </div>

        <button onClick={addRow} disabled={busy} className="mt-2 text-xs text-gold-400 hover:underline inline-flex items-center gap-1">
          + Añadir artista
        </button>

        {err && <p className="text-sm text-red-400 mt-3">{err}</p>}

        <div className="flex justify-end gap-2 mt-4">
          <Button onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button variant="gold" onClick={save} disabled={busy}>
            <span className="inline-flex items-center gap-1.5">
              {busy && <Loader2 size={14} className="animate-spin" />} Guardar
            </span>
          </Button>
        </div>
      </div>
    </div>
  );
}

// Modal para poner carátula a mano: busca candidatos online (Cover Art Archive por MBID
// + iTunes por texto, con caja editable) o sube una imagen desde el equipo. Lo elegido
// se escribe como cover.jpg en la carpeta del álbum (backend). Cierra al aplicar.
function CoverPickerModal({ album, onClose, onApplied }) {
  const [q, setQ] = useState(`${album.artist?.name || album.album_artist || ''} ${album.title || ''}`.trim());
  const [candidates, setCandidates] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [applying, setApplying] = useState(null);

  const search = async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await api.coverCandidates(album.id, q);
      setCandidates(r.candidates || []);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  // primera búsqueda automática al abrir
  useEffect(() => {
    search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyUrl = async (url) => {
    setApplying(url);
    setErr(null);
    try {
      const r = await api.applyCover(album.id, { url });
      if (!r.savedToFolder) setErr('Guardada en la app, pero no se pudo escribir en la carpeta (¿solo lectura?).');
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
        const r = await api.applyCover(album.id, { dataUrl: reader.result });
        if (!r.savedToFolder) setErr('Guardada en la app, pero no se pudo escribir en la carpeta (¿solo lectura?).');
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
            <ImageIcon size={15} /> Añadir carátula
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
            placeholder="Artista y álbum…"
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
        <p className="text-xs text-neutral-600 mt-1">
          Se guarda como <span className="text-neutral-500">cover.jpg</span> en la carpeta del álbum (permanente, no toca el
          audio). Fuentes: Cover Art Archive (oficial) e iTunes.
        </p>

        {err && <p className="text-sm text-amber-400 mt-3">{err}</p>}

        {candidates && candidates.length === 0 && !loading && (
          <p className="text-sm text-neutral-600 mt-4">Sin candidatos online. Prueba a cambiar el texto o sube una imagen.</p>
        )}

        {candidates && candidates.length > 0 && (
          <div className="mt-4 grid grid-cols-3 sm:grid-cols-4 gap-3 max-h-[26rem] overflow-y-auto pr-1">
            {candidates.map((c) => (
              <button
                key={c.url}
                onClick={() => applyUrl(c.url)}
                disabled={!!applying}
                className="relative rounded-lg overflow-hidden border border-ink-800 hover:border-gold-500/70 disabled:opacity-50 group/cand aspect-square bg-ink-850"
                title={`${c.source === 'caa' ? 'Cover Art Archive' : 'iTunes'}${c.title ? ` · ${c.title}` : ''}${c.year ? ` (${c.year})` : ''}`}
              >
                <img src={c.thumb} alt="" className="h-full w-full object-cover" loading="lazy" />
                {applying === c.url ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                    <Loader2 size={20} className="animate-spin text-gold-300" />
                  </div>
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover/cand:bg-black/40 transition-colors opacity-0 group-hover/cand:opacity-100">
                    <Check size={22} className="text-gold-200" />
                  </div>
                )}
                {c.front === true && (
                  <span className="absolute top-1 left-1 text-[10px] px-1 rounded bg-emerald-500/80 text-black">oficial</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Escritura de etiquetas (MBID): la única parte que toca tus ficheros. Opt-in,
// con preview del diff y confirmación. Solo se muestra en álbumes 'matched'.
function TagWriter({ albumId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [writing, setWriting] = useState(false);
  const [done, setDone] = useState(null);
  const [err, setErr] = useState(null);

  const load = async () => {
    setLoading(true);
    setErr(null);
    setDone(null);
    try {
      setData(await api.tagPreview(albumId));
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  const write = async () => {
    if (!confirm('Se escribirán los identificadores de MusicBrainz en los ficheros de este álbum. ¿Continuar?')) return;
    setWriting(true);
    try {
      const r = await api.writeTags(albumId);
      setDone(r);
      await load();
    } catch (e) {
      alert(e.message);
    } finally {
      setWriting(false);
    }
  };

  const notWritable = data?.tracks?.some((t) => !t.writable);

  return (
    <div className="card p-4 mb-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm text-neutral-400 flex items-center gap-2">
          <Tag size={15} /> Etiquetas MusicBrainz (escritura)
        </h2>
        {!data && (
          <Button onClick={load} disabled={loading}>
            {loading ? 'Comprobando…' : 'Previsualizar'}
          </Button>
        )}
      </div>
      <p className="text-xs text-neutral-600 mt-1">
        Escribe los MBID en tus ficheros para que el próximo escaneo los identifique al instante. Nunca borra otras
        etiquetas ni toca rarezas.
      </p>

      {err && <p className="text-sm text-red-400 mt-3">{err}</p>}

      {data && !data.eligible && <p className="text-sm text-neutral-500 mt-3">{data.reason}</p>}

      {data && data.eligible && (
        <div className="mt-3">
          {done && (
            <div className="mb-3 text-sm text-emerald-400">
              ✓ Escrito en {done.written} de {done.total} ficheros
              {done.errors?.length > 0 && <span className="text-amber-400"> · {done.errors.length} con error</span>}
            </div>
          )}

          {data.totalChanges === 0 ? (
            <p className="text-sm text-neutral-500">Los ficheros ya tienen estos MBID. Nada que escribir.</p>
          ) : (
            <>
              <div className="text-sm text-neutral-400 mb-2">
                {data.totalChanges} cambios en {data.tracks.filter((t) => t.changes.length).length} ficheros:
              </div>
              <div className="max-h-52 overflow-y-auto text-xs space-y-1 mb-3">
                {data.tracks
                  .filter((t) => t.changes.length)
                  .slice(0, 3)
                  .map((t, i) => (
                    <div key={i} className="text-neutral-500">
                      {t.changes.map((c, j) => (
                        <div key={j}>
                          <span className="text-neutral-400">{c.field.replace('MusicBrainz ', '')}:</span>{' '}
                          {c.from ? <span className="line-through text-neutral-700">{c.from.slice(0, 8)}…</span> : <span className="text-neutral-700">(vacío)</span>}{' '}
                          → <span className="text-emerald-400/80">{c.to.slice(0, 8)}…</span>
                        </div>
                      ))}
                    </div>
                  ))}
                <div className="text-neutral-600">…igual en el resto de pistas.</div>
              </div>

              {!data.writingEnabled ? (
                <div className="text-xs text-amber-400/90 flex items-start gap-1.5 bg-amber-950/20 border border-amber-900/40 rounded p-2">
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                  <span>
                    La escritura está desactivada. Actívala en{' '}
                    <Link to="/ajustes" className="underline">Ajustes</Link> (requiere montar la música en modo escritura).
                  </span>
                </div>
              ) : notWritable ? (
                <div className="text-xs text-amber-400/90 flex items-start gap-1.5">
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                  Los ficheros son de solo lectura. Monta tu música en modo escritura (`:rw`) para poder etiquetar.
                </div>
              ) : (
                <Button variant="gold" onClick={write} disabled={writing}>
                  {writing ? 'Escribiendo…' : `Escribir MBID en ${data.tracks.filter((t) => t.changes.length).length} ficheros`}
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Copias de este disco (dentro de la ficha): si tienes varias copias de este álbum, las
// lista con la ★ mejor y acciones para descartar/borrar el resto. Misma gestión que el
// panel de la insignia ×N de la Discoteca, pero aquí en la propia página del disco.
function DupCopiesSection({ albumId, onChange }) {
  const [group, setGroup] = useState(null);
  const load = () => api.dupGroup(albumId).then(setGroup).catch(() => setGroup(null));
  useEffect(() => {
    setGroup(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [albumId]);

  if (!group || !group.copies || group.copies.length < 2) return null;
  return (
    <div className="card p-4 mb-6">
      <h2 className="text-sm text-neutral-400 flex items-center gap-2">
        <Copy size={15} className="text-sky-400" /> Copias de este disco · {group.copies.length}
      </h2>
      <p className="text-xs text-neutral-600 mt-1 mb-3">
        Tienes varias copias. Conserva la <span className="text-emerald-400/90">★ mejor</span> y descarta o borra el resto.
        «Descartar» solo la oculta (reversible desde la Papelera); «Descartar y borrar» elimina los ficheros
        (irreversible).
      </p>
      <DuplicateCopies
        copies={group.copies}
        onChange={() => {
          load();
          onChange?.();
        }}
      />
    </div>
  );
}

// Otras EDICIONES del mismo disco que tienes (original + reediciones/expandidas/remasters),
// cada una con release-group propio. NO son duplicados a limpiar: son ediciones que
// conservas, y desde aquí saltas a la ficha de cada una. Complementa a «Copias de este
// disco» (que sí son copias de la MISMA edición).
function OwnedEditionsSection({ albumId }) {
  const [eds, setEds] = useState(null);
  useEffect(() => {
    setEds(null);
    api.ownedEditions(albumId).then(setEds).catch(() => setEds(null));
  }, [albumId]);
  if (!eds || !eds.length) return null;
  return (
    <div className="card p-4 mb-6">
      <h2 className="text-sm text-neutral-400 flex items-center gap-2">
        <Layers size={15} className="text-gold-400" /> Otras ediciones que tienes · {eds.length}
      </h2>
      <p className="text-xs text-neutral-600 mt-1 mb-3">
        Otras ediciones de este mismo disco en tu colección (reediciones, expandidas, remasters…). Cada una es un disco
        aparte con su propia ficha.
      </p>
      <div className="divide-y divide-ink-850/60">
        {eds.map((e) => (
          <Link key={e.id} to={`/album/${e.id}`} className="flex items-center gap-2 py-2 text-sm hover:text-gold-400">
            <Disc3 size={14} className="text-neutral-500 shrink-0" />
            <span className="truncate flex-1">
              {e.title}
              {e.year ? <span className="text-neutral-600"> · {e.year}</span> : ''}
              {e.tracks ? <span className="text-neutral-600"> · {e.tracks} pistas</span> : ''}
            </span>
            {e.format && <span className="text-xs text-neutral-600 shrink-0">{e.format}</span>}
          </Link>
        ))}
      </div>
    </div>
  );
}

// Multidisco a mano (estilo Plex/Roon): combina este disco con otros (los discos de un
// doble/triple que la heurística no agrupó) o separa la caja. Metadato interno, no toca
// ficheros. La Discoteca muestra la caja como un solo álbum.
function DiscBox({ album, onDone }) {
  const [modal, setModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const inBox = !!album.disc_group && album.discMembers?.length > 1;

  const separate = async () => {
    if (!window.confirm('¿Separar la caja multidisco? Cada disco vuelve a ser un álbum independiente.')) return;
    setBusy(true);
    try {
      await api.uncombineAlbum(album.id);
      await onDone();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card p-4 mb-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-sm text-neutral-400 flex items-center gap-2">
          <Layers size={15} /> Multidisco
        </h2>
        <div className="flex gap-2">
          <Button onClick={() => setModal(true)} disabled={busy}>
            <span className="inline-flex items-center gap-1.5">
              <Layers size={14} /> Combinar con…
            </span>
          </Button>
          {inBox && (
            <button
              onClick={separate}
              disabled={busy}
              className="text-sm px-3 py-1.5 rounded-lg border border-ink-700 bg-ink-850 hover:bg-ink-800 inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              Separar la caja
            </button>
          )}
        </div>
      </div>
      <p className="text-xs text-neutral-600 mt-1">
        {inBox
          ? 'Este disco es parte de una caja multidisco: la Discoteca la cuenta como un solo álbum.'
          : 'Combínalo con otros discos (un doble/triple que no se agrupó bien) para que la Discoteca los cuente como uno solo.'}
      </p>

      {inBox && (
        <div className="mt-3 divide-y divide-ink-850/60">
          {album.discMembers.map((m) => (
            <div key={m.id} className="py-1.5 flex items-center justify-between text-sm">
              <Link to={`/album/${m.id}`} className={m.id === album.id ? 'text-gold-300' : 'text-neutral-300 hover:text-gold-400'}>
                {m.title}
              </Link>
              <span className="text-neutral-500">
                {m.track_file_count}/{m.track_count} pistas
              </span>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <CombineModal
          album={album}
          onClose={() => setModal(false)}
          onDone={async () => {
            setModal(false);
            await onDone();
          }}
        />
      )}
    </div>
  );
}

// Modal para elegir con qué discos combinar (candidatos = mismo artista o misma carpeta).
function CombineModal({ album, onClose, onDone }) {
  const [cands, setCands] = useState(null); // candidatos por defecto (mismo artista/carpeta)
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null); // resultados de buscar en toda la biblioteca
  const [searching, setSearching] = useState(false);
  const [sel, setSel] = useState(() => new Map()); // id -> {title} de lo seleccionado (para no perderlo al cambiar de lista)
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    api
      .combineCandidates(album.id)
      .then(setCands)
      .catch((e) => setErr(e.message));
  }, [album.id]);

  // buscar en TODA la biblioteca (por si el disco a combinar no es del mismo artista/carpeta)
  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setResults(null);
      return;
    }
    setSearching(true);
    const t = setTimeout(() => {
      api
        .library({ q: term, flat: '1', limit: 40 })
        .then((r) => setResults((r.albums || []).filter((a) => a.id !== album.id)))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(t);
  }, [q, album.id]);

  const toggle = (a) =>
    setSel((m) => {
      const n = new Map(m);
      if (n.has(a.id)) n.delete(a.id);
      else n.set(a.id, { title: a.title });
      return n;
    });

  const combine = async () => {
    if (!sel.size) return;
    setBusy(true);
    setErr(null);
    try {
      await api.combineAlbums([album.id, ...sel.keys()]);
      await onDone();
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  };

  const list = q.trim() ? results : cands;
  const Row = (c) => (
    <label key={c.id} className="py-2 flex items-center gap-3 text-sm cursor-pointer">
      <input type="checkbox" checked={sel.has(c.id)} onChange={() => toggle(c)} className="accent-gold-500" />
      <span className="min-w-0 flex-1">
        <span className="truncate block text-neutral-200">{c.title}</span>
        <span className="text-xs text-neutral-600">
          {q.trim() && c.album_artist ? `${c.album_artist} · ` : ''}
          {c.track_file_count}/{c.track_count} pistas
          {c.in_box ? ' · ya en otra caja' : ''}
        </span>
      </span>
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 p-4 overflow-y-auto" onClick={onClose}>
      <div className="card w-full max-w-lg mt-16 p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm text-neutral-300 flex items-center gap-2">
            <Layers size={14} /> Combinar «{album.title}» con…
          </h2>
          <button onClick={onClose} className="text-neutral-500 hover:text-neutral-300" title="Cerrar">
            <X size={18} />
          </button>
        </div>
        <p className="text-xs text-neutral-600 mb-3">
          Marca los discos que forman la misma caja. Abajo salen los del mismo artista o carpeta; usa el buscador para
          encontrar cualquier otro disco de tu colección.
        </p>

        <div className="flex items-center gap-2 mb-2 bg-ink-850 border border-ink-800 rounded px-2">
          <Search size={14} className="text-neutral-600 shrink-0" />
          <input
            value={q}
            autoFocus
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar un disco en tu colección…"
            className="flex-1 bg-transparent py-1.5 text-sm outline-none"
          />
          {q && (
            <button onClick={() => setQ('')} className="text-neutral-600 hover:text-neutral-300" title="Limpiar">
              <X size={14} />
            </button>
          )}
        </div>

        {err && <p className="text-sm text-red-400 mb-2">{err}</p>}
        {sel.size > 0 && (
          <p className="text-xs text-gold-300/90 mb-1">
            {sel.size} seleccionado{sel.size === 1 ? '' : 's'}: {[...sel.values()].map((v) => v.title).join(', ')}
          </p>
        )}

        {q.trim() ? (
          searching ? (
            <Spinner label="Buscando…" />
          ) : results && results.length === 0 ? (
            <p className="text-sm text-neutral-600">Nada coincide con «{q}».</p>
          ) : null
        ) : !cands ? (
          <Spinner label="Buscando discos…" />
        ) : cands.length === 0 ? (
          <p className="text-sm text-neutral-600">No hay otros discos del mismo artista o carpeta. Usa el buscador de arriba.</p>
        ) : null}

        {list && list.length > 0 && (
          <div className="max-h-80 overflow-y-auto divide-y divide-ink-850/60">{list.map(Row)}</div>
        )}

        <div className="flex justify-end gap-2 mt-4">
          <Button onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button variant="gold" onClick={combine} disabled={busy || !sel.size}>
            <span className="inline-flex items-center gap-1.5">
              {busy && <Loader2 size={14} className="animate-spin" />} Combinar {sel.size ? `(${sel.size + 1})` : ''}
            </span>
          </Button>
        </div>
      </div>
    </div>
  );
}

// Recomendaciones (estilo «Valence Recommendations» de Roon): más de este artista (de
// tu biblioteca) + artistas afines (Last.fm). Bajo demanda (consulta Last.fm).
function Recommendations({ albumId, artistName }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      setData(await api.albumRecommendations(albumId));
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card p-4 mb-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm text-neutral-400 flex items-center gap-2">
          <Sparkles size={15} /> Recomendaciones
        </h2>
        {!data && (
          <Button onClick={load} disabled={loading}>
            {loading ? 'Cargando…' : 'Ver recomendaciones'}
          </Button>
        )}
      </div>
      <p className="text-xs text-neutral-600 mt-1">
        Más de este artista (tu biblioteca), artistas afines y <b className="font-normal text-neutral-500">discos que aún no
        tienes</b> de ellos, para seguir o descargar (Last.fm).
      </p>

      {err && <p className="text-sm text-red-400 mt-3">{err}</p>}

      {data && (
        <>
          {data.moreFromArtist?.length > 0 && (
            <div className="mt-4">
              <h3 className="text-xs uppercase tracking-wider text-neutral-600 mb-2">Más de {data.artist?.name || artistName}</h3>
              <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-6 gap-3">
                {data.moreFromArtist.map((al) => (
                  <Link key={al.id} to={`/album/${al.id}`} className="group">
                    <div className="rounded-lg overflow-hidden border border-ink-800 group-hover:border-gold-500/40">
                      <Cover id={al.id} />
                    </div>
                    <div className="text-xs mt-1 truncate text-neutral-300" title={al.title}>
                      {al.title}
                    </div>
                    {al.year ? <div className="text-[11px] text-neutral-600">{al.year}</div> : null}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {data.similar?.length > 0 && (
            <div className="mt-4">
              <h3 className="text-xs uppercase tracking-wider text-neutral-600 mb-2">Te podría gustar</h3>
              <div className="flex flex-wrap gap-1.5">
                {data.similar.map((s) =>
                  s.artist_id ? (
                    <Link
                      key={s.name}
                      to={`/artista/${s.artist_id}`}
                      className="text-xs px-2 py-1 rounded-full border border-gold-500/30 bg-gold-500/10 text-gold-200 hover:bg-gold-500/20"
                      title="Lo tienes en tu biblioteca"
                    >
                      {s.name}
                    </Link>
                  ) : (
                    <a
                      key={s.name}
                      href={s.url || '#'}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs px-2 py-1 rounded-full border border-ink-800 bg-ink-850 text-neutral-300 hover:border-gold-500/40 inline-flex items-center gap-1"
                    >
                      {s.name} <ExternalLink size={10} />
                    </a>
                  )
                )}
              </div>
            </div>
          )}

          {data.recommendedAlbums?.length > 0 && (
            <div className="mt-4">
              <h3 className="text-xs uppercase tracking-wider text-neutral-600 mb-1">Discos que quizá te gusten</h3>
              <p className="text-[11px] text-neutral-600 mb-2">Top de artistas afines que aún no tienes.</p>
              <div className="space-y-1.5">
                {data.recommendedAlbums.map((r, i) => (
                  <RecAlbumRow key={i} r={r} />
                ))}
              </div>
            </div>
          )}

          {!data.moreFromArtist?.length && !data.similar?.length && !data.recommendedAlbums?.length && (
            <p className="text-sm text-neutral-600 mt-3">
              {data.lastfm ? 'Sin recomendaciones por ahora.' : 'Configura Last.fm en Ajustes para ver artistas afines.'}
            </p>
          )}
        </>
      )}
    </div>
  );
}

// Fila de disco recomendado (de un artista afín que no tienes): seguir al artista y/o
// descargar el disco (grabBest nativo).
function RecAlbumRow({ r }) {
  const [grabState, setGrabState] = useState(null); // busy | done
  const [followed, setFollowed] = useState(r.tracked);
  const [fbusy, setFbusy] = useState(false);
  const grab = async () => {
    setGrabState('busy');
    try {
      const res = await api.grabBest(`${r.artist} ${r.album}`, { artist: r.artist, album: r.album });
      if (!res.grabbed) {
        alert(`No se pudo agarrar: ${res.reason || 'sin release'}`);
        setGrabState(null);
        return;
      }
      setGrabState('done');
    } catch (e) {
      alert(e.message);
      setGrabState(null);
    }
  };
  const follow = async () => {
    setFbusy(true);
    try {
      if (r.artist_id) await api.follow(r.artist_id);
      else if (r.artist_mbid) await api.followMbid(r.artist_mbid);
      else {
        const hits = await api.searchArtistMb(r.artist);
        if (!hits?.[0]?.mbid) throw new Error('MusicBrainz no encuentra a este artista.');
        await api.followMbid(hits[0].mbid);
      }
      setFollowed(true);
    } catch (e) {
      alert(e.message);
    } finally {
      setFbusy(false);
    }
  };
  return (
    <div className="flex items-center gap-3 text-sm bg-ink-850/40 rounded px-2.5 py-1.5">
      <div className="min-w-0 flex-1 truncate">
        {r.artist_id ? (
          <Link to={`/artista/${r.artist_id}`} className="hover:text-gold-400">
            {r.artist}
          </Link>
        ) : (
          <span>{r.artist}</span>
        )}
        <span className="text-neutral-500"> — {r.album}</span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {followed ? (
          <span className="text-xs text-gold-400/80 inline-flex items-center gap-1">
            <Star size={12} className="fill-current" /> sigues
          </span>
        ) : (
          <button
            onClick={follow}
            disabled={fbusy}
            className="text-xs px-1.5 py-0.5 rounded border border-ink-700 bg-ink-850 hover:bg-ink-800 inline-flex items-center gap-1 disabled:opacity-50"
          >
            <Star size={12} /> Seguir
          </button>
        )}
        {grabState === 'done' ? (
          <span className="text-emerald-400 text-xs inline-flex items-center gap-1">
            <Check size={13} /> pedido
          </span>
        ) : (
          <button
            onClick={grab}
            disabled={grabState === 'busy'}
            className="text-xs px-1.5 py-0.5 rounded border border-gold-500/40 bg-gold-500/10 text-gold-300 hover:bg-gold-500/20 inline-flex items-center gap-1 disabled:opacity-50"
          >
            {grabState === 'busy' ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} Descargar
          </button>
        )}
      </div>
    </div>
  );
}

// «Sobre el disco» (estilo Roon): reseña/descripción (Last.fm) + valoración de la
// comunidad (Discogs). Se autocarga al abrir la ficha; si no hay nada, no se muestra.
function Stars({ value }) {
  const full = Math.round(value || 0);
  return (
    <span className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} size={13} className={n <= full ? 'text-gold-400 fill-current' : 'text-neutral-700'} />
      ))}
    </span>
  );
}

function AboutSection({ albumId }) {
  const [data, setData] = useState(null);
  const [expand, setExpand] = useState(false);

  useEffect(() => {
    let alive = true;
    setData(null);
    setExpand(false);
    api
      .albumAbout(albumId)
      .then((d) => alive && setData(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [albumId]);

  if (!data) return null;
  const { review, rating } = data;
  const hasRating = rating && rating.average != null && rating.count > 0;
  if (!review && !hasRating) return null;

  const text = review?.text || '';
  const long = text.length > 420;
  const shown = expand || !long ? text : `${text.slice(0, 420).trimEnd()}…`;

  return (
    <div className="card p-4 mb-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-sm text-neutral-400 flex items-center gap-2">
          <BookOpen size={15} /> Sobre el disco
        </h2>
        {hasRating && (
          <a
            href={rating.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-neutral-400 hover:text-gold-300"
            title={`Valoración de la comunidad de Discogs (${rating.count} votos)`}
          >
            <Stars value={rating.average} />
            <span className="text-neutral-500">
              {rating.average.toFixed(2)}/5 · {rating.count} · Discogs
            </span>
          </a>
        )}
      </div>
      {review && (
        <div className="mt-2">
          <p className="text-sm text-neutral-300 whitespace-pre-line leading-relaxed">{shown}</p>
          <div className="mt-1.5 flex items-center gap-3">
            {long && (
              <button onClick={() => setExpand((v) => !v)} className="text-xs text-gold-400 hover:underline">
                {expand ? 'Leer menos' : 'Leer más'}
              </button>
            )}
            <a
              href={review.url}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-neutral-600 hover:text-neutral-400 inline-flex items-center gap-0.5"
            >
              {review.about === 'artist' ? 'Sobre el artista · Last.fm' : 'vía Last.fm'} <ExternalLink size={10} />
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

// Créditos ricos del álbum (estilo Roon): personal con sus roles/instrumentos, desde
// MusicBrainz. Cada persona enlaza a su ficha si la tienes en la biblioteca, o a MB.
// Se carga bajo demanda (varias peticiones a MB).
function AlbumCreditsSection({ albumId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      setData(await api.albumCredits(albumId));
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card p-4 mb-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm text-neutral-400 flex items-center gap-2">
          <Users size={15} /> Créditos
        </h2>
        {!data && (
          <Button onClick={load} disabled={loading}>
            {loading ? 'Cargando…' : 'Ver créditos'}
          </Button>
        )}
      </div>
      <p className="text-xs text-neutral-600 mt-1">
        Quién tocó qué, desde MusicBrainz: intérpretes con su instrumento, producción e ingeniería. Cada persona enlaza a
        su ficha si la tienes.
      </p>

      {err && <p className="text-sm text-red-400 mt-3">{err}</p>}
      {data && !data.found && <p className="text-sm text-neutral-600 mt-3">{data.reason || 'MusicBrainz no tiene créditos para este álbum.'}</p>}

      {data && data.found && (
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {data.people.map((p) => {
            const inner = (
              <div className="flex items-center gap-2.5 p-2 rounded-lg border border-ink-800 bg-ink-850/60 hover:border-gold-500/40 h-full">
                <ArtistPhoto id={p.artist_id} name={p.name} size={40} />
                <div className="min-w-0">
                  <div className="text-sm truncate text-neutral-200">{p.name}</div>
                  <div className="text-xs text-neutral-500 truncate" title={p.role_text}>
                    {p.role_text || '—'}
                  </div>
                  <div className="text-[11px] text-neutral-600">{p.all_tracks ? 'Todas las pistas' : `${p.track_count} pista${p.track_count === 1 ? '' : 's'}`}</div>
                </div>
              </div>
            );
            return p.artist_id ? (
              <Link key={p.mbid} to={`/artista/${p.artist_id}`}>
                {inner}
              </Link>
            ) : (
              <a key={p.mbid} href={`https://musicbrainz.org/artist/${p.mbid}`} target="_blank" rel="noreferrer">
                {inner}
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Versiones del disco (estilo Roon): todas las ediciones oficiales de MusicBrainz
// (prensajes por país/año/formato/sello) unificadas con las de Discogs (que además
// marcan posibles upgrades). Cada fuente es opcional. Se carga bajo demanda.
function Editions({ albumId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      setData(await api.editions(albumId));
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  const dc = data?.discogs || {};
  const nothing = data && !data.mbVersions?.length && !dc.found && dc.configured !== false;

  return (
    <div className="card p-4 mb-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm text-neutral-400 flex items-center gap-2">
          <Disc3 size={15} /> Versiones
        </h2>
        {!data && (
          <Button onClick={load} disabled={loading}>
            {loading ? 'Buscando…' : 'Ver versiones'}
          </Button>
        )}
      </div>
      <p className="text-xs text-neutral-600 mt-1">
        Todas las ediciones de este disco: las oficiales de <span className="text-neutral-500">MusicBrainz</span> (prensaje
        por país, año, formato y sello) y las de <span className="text-neutral-500">Discogs</span>, con radar de posibles
        upgrades. No toca tus ficheros: solo te informa.
      </p>

      {err && <p className="text-sm text-red-400 mt-3">{err}</p>}

      {data && (
        <div className="mt-3 space-y-4">
          {data.mbVersions?.length > 0 && (
            <div>
              <h3 className="text-xs uppercase tracking-wider text-neutral-600 mb-2">MusicBrainz · {data.mbVersions.length}</h3>
              <div className="max-h-72 overflow-y-auto divide-y divide-ink-850/60">
                {data.mbVersions.map((v) => (
                  <a
                    key={v.mbid}
                    href={`https://musicbrainz.org/release/${v.mbid}`}
                    target="_blank"
                    rel="noreferrer"
                    className="py-1.5 px-1 -mx-1 rounded flex items-center justify-between text-sm hover:bg-ink-850/40"
                  >
                    <span className="min-w-0 truncate text-neutral-300">
                      {v.formats.join(', ') || '—'}
                      {v.label ? <span className="text-neutral-600"> · {v.label}</span> : ''}
                      {v.disambiguation ? <span className="text-neutral-600"> · {v.disambiguation}</span> : ''}
                    </span>
                    <span className="text-neutral-500 shrink-0 ml-2">
                      {v.country ? `${v.country} ` : ''}
                      {v.year || ''}
                    </span>
                  </a>
                ))}
              </div>
            </div>
          )}

          {dc.configured === false && (
            <p className="text-xs text-neutral-600">
              Añade un token de <span className="text-neutral-500">Discogs</span> en Ajustes para ver también sus ediciones
              y el radar de upgrades.
            </p>
          )}

          {dc.found && (
            <div>
              <h3 className="text-xs uppercase tracking-wider text-neutral-600 mb-2 flex items-center gap-2">
                Discogs
                {dc.discogsUrl && (
                  <a
                    href={dc.discogsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="normal-case tracking-normal text-gold-400 hover:underline inline-flex items-center gap-0.5"
                  >
                    master <ExternalLink size={10} />
                  </a>
                )}
              </h3>
              {dc.upgradeHints?.length > 0 && (
                <div className="mb-2 text-sm">
                  <span className="text-gold-400">Posibles upgrades:</span>{' '}
                  {dc.upgradeHints.map((u, i) => (
                    <span key={i} className="text-neutral-400">
                      {u.format}
                      {u.year ? ` (${u.year})` : ''}
                      {i < dc.upgradeHints.length - 1 ? ' · ' : ''}
                    </span>
                  ))}
                </div>
              )}
              <div className="max-h-60 overflow-y-auto divide-y divide-ink-850/60">
                {dc.editions.map((e, i) => (
                  <div key={i} className="py-1.5 flex items-center justify-between text-sm">
                    <span className="text-neutral-300 min-w-0 truncate">
                      {e.format}
                      {e.label ? <span className="text-neutral-600"> · {e.label}</span> : ''}
                    </span>
                    <span className="text-neutral-500 shrink-0 ml-2">
                      {e.country ? `${e.country} ` : ''}
                      {e.year || ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {nothing && <p className="text-sm text-neutral-600">No se encontraron versiones.</p>}
        </div>
      )}
    </div>
  );
}

// Identificar ESTE álbum bajo demanda (para álbumes pending/unmatched). Auto corre
// la cadena (MB/Last.fm/AcoustID) por el carril rápido; manual abre un buscador de
// MusicBrainz donde el usuario escribe y elige entre una lista de candidatos.
function IdentifySection({ album, onDone }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);
  const [showManual, setShowManual] = useState(false);

  const auto = async () => {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const r = await api.identifyAlbum(album.id);
      if (r.matched) {
        setMsg(`Identificado vía ${r.source}.`);
        await onDone();
      } else {
        setMsg('Ninguna base lo reconoció automáticamente. Búscalo tú abajo y elige el correcto.');
        setShowManual(true);
      }
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card p-4 mb-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-sm text-neutral-400 flex items-center gap-2">
          <Sparkles size={15} /> Identificar este álbum
        </h2>
        <div className="flex gap-2">
          <Button variant="gold" onClick={auto} disabled={busy}>
            {busy ? 'Identificando…' : 'Identificar automáticamente'}
          </Button>
          <Button onClick={() => setShowManual((v) => !v)} disabled={busy}>
            Elegir a mano
          </Button>
        </div>
      </div>
      <p className="text-xs text-neutral-600 mt-1">
        Busca este disco en MusicBrainz, Last.fm y AcoustID para asignarle su MBID (lo que activa carátula oficial,
        completismo y envío a Lidarr). Si nada casa, «Elegir a mano» abre un buscador de MusicBrainz.
      </p>
      {msg && <p className="text-sm text-neutral-400 mt-3">{msg}</p>}
      {err && <p className="text-sm text-red-400 mt-3">{err}</p>}
      {showManual && (
        <ManualSearch
          album={album}
          onDone={async () => {
            setShowManual(false);
            await onDone();
          }}
        />
      )}
      <div className="mt-4 pt-4 border-t border-ink-800">
        <CreateInMusicBrainz album={album} onDone={onDone} />
      </div>
    </div>
  );
}

// ¿No está en MusicBrainz? Crea su ficha desde la colección (release editor seeding):
// abre el editor de MB PRE-RELLENO con la tracklist/duraciones/artista(s)/año/sello del
// disco local. El usuario revisa y confirma en su sesión de MB; al guardar, MB devuelve
// a /mb-nueva, que enlaza el álbum y ofrece subir la portada. Así se devuelve a la
// comunidad lo que la app aprovecha de ella. Antes de sembrar, avisa si MB ya tiene un
// candidato muy parecido (para no crear duplicados).
function CreateInMusicBrainz({ album, onDone }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [dup, setDup] = useState(null); // posible duplicado detectado por el servidor
  const [seed, setSeed] = useState(null); // campos cacheados tras el aviso
  const [linking, setLinking] = useState(false);

  const start = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.mbSeed(album.id);
      if (r.possibleDuplicate) {
        // primer clic: no sembrar aún; avisar del candidato y guardar los campos
        setDup(r.possibleDuplicate);
        setSeed(r.fields);
      } else {
        openMbReleaseEditor(r.fields, album.id);
      }
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const linkExisting = async () => {
    setLinking(true);
    setErr(null);
    try {
      await api.match(album.id, dup.rg_mbid);
      await onDone();
    } catch (e) {
      setErr(e.message);
      setLinking(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="text-sm text-neutral-400 flex items-center gap-2">
          <Database size={15} /> ¿No está en MusicBrainz?
        </h3>
        {!dup && (
          <Button onClick={start} disabled={busy}>
            <span className="inline-flex items-center gap-1.5">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Database size={14} />}
              {busy ? 'Preparando…' : 'Crear ficha en MusicBrainz'}
            </span>
          </Button>
        )}
      </div>
      <p className="text-xs text-neutral-600 mt-1">
        Crea su ficha en MusicBrainz con la tracklist, duraciones, artista(s), año y sello de tu copia. Revisas y
        confirmas en MusicBrainz (con tu sesión); al guardar, volverás aquí para enlazarlo y subir la portada.
      </p>

      {dup && (
        <div className="mt-3 rounded border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          <p className="text-amber-300/90 flex items-center gap-2">
            <AlertTriangle size={14} /> MusicBrainz ya tiene algo muy parecido ({dup.score}%):
          </p>
          <p className="mt-1 text-neutral-300">
            {dup.artist} — {dup.title}
            <a
              href={`https://musicbrainz.org/release-group/${dup.rg_mbid}`}
              target="_blank"
              rel="noreferrer"
              className="ml-2 text-gold-400 hover:underline inline-flex items-center gap-0.5"
            >
              Ver en MusicBrainz <ExternalLink size={11} />
            </a>
          </p>
          <p className="text-xs text-neutral-600 mt-2">
            Si es este disco, enlázalo (no crees un duplicado). Si de verdad es otro, créala igualmente.
          </p>
          <div className="flex gap-2 mt-3 flex-wrap">
            <Button variant="gold" onClick={linkExisting} disabled={linking}>
              <span className="inline-flex items-center gap-1.5">
                {linking ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Es este: enlazar
              </span>
            </Button>
            <Button
              onClick={() => {
                openMbReleaseEditor(seed, album.id);
                setDup(null);
              }}
            >
              <span className="inline-flex items-center gap-1.5">
                <Database size={14} /> Es otro: crear igualmente
              </span>
            </Button>
            <Button variant="default" onClick={() => setDup(null)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {err && <p className="text-sm text-red-400 mt-2">{err}</p>}
    </div>
  );
}

// Corregir el emparejamiento de un álbum YA identificado: cuando MusicBrainz lo casó
// con la referencia equivocada (p. ej. un single en vez del álbum). Reabre el buscador
// manual para elegir otra referencia; manualMatch fija su tipo/año reales.
function ReMatch({ album, onDone }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card p-4 mb-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-sm text-neutral-400 flex items-center gap-2">
          <Sparkles size={15} /> Emparejamiento con MusicBrainz
        </h2>
        <Button onClick={() => setOpen((v) => !v)}>{open ? 'Cerrar' : 'Corregir emparejamiento'}</Button>
      </div>
      <p className="text-xs text-neutral-600 mt-1">
        ¿Lo casó con la referencia equivocada (p. ej. un <b className="font-normal text-neutral-500">single</b> en vez del
        álbum)? Elige a mano la correcta y se re-emparejará con su tipo y año reales.
      </p>
      {open && (
        <ManualSearch
          album={album}
          onDone={async () => {
            setOpen(false);
            await onDone();
          }}
        />
      )}
    </div>
  );
}

// Buscador manual de MusicBrainz: caja de texto (prerrellena con el título, editable)
// que devuelve una LISTA de release groups del artista para elegir el correcto. Es el
// «elegir a mano» de verdad — no la sugerencia única del automático.
function ManualSearch({ album, onDone }) {
  const [q, setQ] = useState(album.title || '');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [saving, setSaving] = useState(null);
  const [url, setUrl] = useState('');
  const [urlBusy, setUrlBusy] = useState(false);

  // Salvaguarda final: pega el enlace de MusicBrainz (release-group o release) y lo fija.
  const linkUrl = async () => {
    if (!url.trim()) return;
    setUrlBusy(true);
    setErr(null);
    try {
      await api.matchByUrl(album.id, url.trim());
      await onDone();
    } catch (e) {
      setErr(e.message);
      setUrlBusy(false);
    }
  };

  const run = async () => {
    if (!q.trim()) return;
    setLoading(true);
    setErr(null);
    try {
      setResults(await api.mbReleaseGroups(q, album.album_artist || '', album.artist?.mbid || null));
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  // primera búsqueda automática al abrir el panel
  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pick = async (rgMbid) => {
    setSaving(rgMbid);
    setErr(null);
    try {
      await api.match(album.id, rgMbid);
      await onDone();
    } catch (e) {
      setErr(e.message);
      setSaving(null);
    }
  };

  return (
    <div className="mt-3 pt-3 border-t border-ink-800">
      <div className="flex gap-2">
        <input
          className="flex-1 bg-ink-850 border border-ink-800 rounded px-2 py-1.5 text-sm outline-none focus:border-gold-500/60"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && run()}
          placeholder="Buscar álbum en MusicBrainz…"
        />
        <Button onClick={run} disabled={loading}>
          <span className="inline-flex items-center gap-1.5">
            <Search size={14} /> {loading ? 'Buscando…' : 'Buscar'}
          </span>
        </Button>
      </div>
      <p className="text-xs text-neutral-600 mt-1">
        Acotado a <span className="text-neutral-500">{album.album_artist || 'el artista'}</span>. Edita el texto si el
        título está mal etiquetado.
      </p>

      {/* salvaguarda final: pegar el enlace de MusicBrainz directamente */}
      <div className="mt-3 pt-3 border-t border-ink-850/60">
        <div className="flex gap-2">
          <input
            className="flex-1 bg-ink-850 border border-ink-800 rounded px-2 py-1.5 text-sm outline-none focus:border-gold-500/60"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && linkUrl()}
            placeholder="…o pega el enlace de MusicBrainz (release-group o release)"
          />
          <Button onClick={linkUrl} disabled={urlBusy || !url.trim()}>
            <span className="inline-flex items-center gap-1.5">
              {urlBusy ? <Loader2 size={14} className="animate-spin" /> : <ExternalLink size={14} />} Enlazar
            </span>
          </Button>
        </div>
        <p className="text-xs text-neutral-600 mt-1">
          Si sabes cuál es en MusicBrainz, pega su URL (p. ej. <span className="text-neutral-500">musicbrainz.org/release-group/…</span>)
          y se fija directamente, sin depender del buscador.
        </p>
      </div>

      {err && <p className="text-sm text-red-400 mt-2">{err}</p>}
      {results && results.length === 0 && !loading && (
        <p className="text-sm text-neutral-600 mt-3">Sin resultados. Prueba a cambiar el texto de búsqueda.</p>
      )}
      {results && results.length > 0 && (
        <div className="mt-3 max-h-80 overflow-y-auto divide-y divide-ink-850/60">
          {results.map((r) => (
            <div key={r.rg_mbid} className="py-2 flex items-center gap-3 text-sm">
              <div className="min-w-0 flex-1">
                <div className="truncate">
                  <span className="text-neutral-300">{r.artist}</span>
                  <span className="text-neutral-500"> — {r.title}</span>
                  {r.year ? <span className="text-neutral-600"> · {r.year}</span> : null}
                </div>
                <div className="text-xs text-neutral-600">
                  <span className="text-emerald-400/80">{r.score}%</span>
                  {r.primary_type && <span className="ml-2">{r.primary_type}</span>}
                  {r.secondary_types?.length ? <span className="ml-1 text-neutral-700">· {r.secondary_types.join(', ')}</span> : null}
                  <a
                    href={`https://musicbrainz.org/release-group/${r.rg_mbid}`}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-2 text-gold-400 hover:underline inline-flex items-center gap-0.5"
                  >
                    MusicBrainz <ExternalLink size={11} />
                  </a>
                </div>
              </div>
              <Button variant="gold" disabled={saving === r.rg_mbid} onClick={() => pick(r.rg_mbid)}>
                <span className="inline-flex items-center gap-1.5">
                  <Check size={14} /> {saving === r.rg_mbid ? '…' : 'Es este'}
                </span>
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Acciones de Lidarr para un álbum ya identificado: envío con búsqueda AUTOMÁTICA, y
// búsqueda INTERACTIVA (releases de los indexers para elegir y descargar a mano).
function LidarrSection({ album, onDone }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);
  const [queue, setQueue] = useState(null);
  const [releases, setReleases] = useState(null);
  const [searching, setSearching] = useState(false);
  const [grabbing, setGrabbing] = useState(null);

  // Lidarr es lento (su servidor de metadatos): el envío se encola y responde al
  // instante; sondeamos el progreso para dar feedback sin bloquear el clic.
  const sendAuto = async () => {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      await api.lidarrAdd(album.rg_mbid, album.artist?.mbid || null);
      setMsg('En cola de Lidarr — se procesa en segundo plano.');
      pollLidarrQueue(setQueue);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const search = async () => {
    setSearching(true);
    setErr(null);
    setMsg(null);
    setReleases(null);
    try {
      const r = await api.lidarrReleases(album.id);
      if (!r.inLibrary) {
        setMsg('El álbum aún no está en la biblioteca de Lidarr. Envíalo primero (botón de arriba) y espera unos segundos a que Lidarr importe la discografía del artista.');
        setReleases([]);
      } else {
        setReleases(r.releases);
      }
    } catch (e) {
      setErr(e.message);
    } finally {
      setSearching(false);
    }
  };

  const grab = async (rel) => {
    setGrabbing(rel.guid);
    setErr(null);
    try {
      await api.lidarrGrab(rel.guid, rel.indexerId);
      setMsg(`Descarga enviada a Lidarr: ${rel.title}`);
    } catch (e) {
      setErr(e.message);
    } finally {
      setGrabbing(null);
    }
  };

  return (
    <div className="card p-4 mb-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-sm text-neutral-400 flex items-center gap-2">
          <Send size={15} /> Lidarr
          {album.inLidarr && <span className="text-xs text-emerald-400">· ya en Lidarr</span>}
        </h2>
        <div className="flex gap-2">
          <Button variant="gold" onClick={sendAuto} disabled={busy}>
            <span className="inline-flex items-center gap-1.5">
              <Send size={14} /> {busy ? 'Enviando…' : 'Enviar (automática)'}
            </span>
          </Button>
          <Button onClick={search} disabled={searching}>
            <span className="inline-flex items-center gap-1.5">
              <Search size={14} /> {searching ? 'Buscando…' : 'Búsqueda interactiva'}
            </span>
          </Button>
        </div>
      </div>
      <p className="text-xs text-neutral-600 mt-1">
        <span className="text-neutral-500">Automática</span>: Lidarr elige la mejor release y la descarga.{' '}
        <span className="text-neutral-500">Interactiva</span>: te trae la lista de los indexers para que elijas tú
        (requiere que el álbum ya esté en Lidarr; la búsqueda consulta los indexers en vivo y puede tardar).
      </p>

      {msg && <p className="text-sm text-neutral-400 mt-3">{msg}</p>}
      {queue &&
        (queue.running ? (
          <p className="text-xs text-gold-300/90 mt-1">Lidarr: procesando {queue.done}/{queue.total}…</p>
        ) : (
          <p className="text-xs text-neutral-500 mt-1">
            Lidarr: {queue.added} enviados
            {queue.pending ? ` · ${queue.pending} pendientes de importar` : ''}
            {queue.errors?.length ? ` · ${queue.errors.length} con error` : ''}.
          </p>
        ))}
      {err && <p className="text-sm text-red-400 mt-3">{err}</p>}

      {releases && releases.length > 0 && (
        <div className="mt-3 max-h-96 overflow-y-auto divide-y divide-ink-850/60">
          {releases.map((r) => (
            <div key={r.guid} className="py-2 flex items-center gap-3 text-sm">
              <div className="min-w-0 flex-1">
                <div className={`truncate ${r.approved ? '' : 'text-neutral-500'}`}>{r.title}</div>
                <div className="text-xs text-neutral-600 flex flex-wrap gap-x-2">
                  {r.quality && <span className="text-neutral-400">{r.quality}</span>}
                  <span>{fmtBytes(r.size)}</span>
                  {r.protocol && <span>{r.protocol}</span>}
                  {r.seeders != null && <span>{r.seeders} seeders</span>}
                  {r.indexer && <span>· {r.indexer}</span>}
                  {!r.approved && r.rejections.length > 0 && (
                    <span className="text-amber-500/80" title={r.rejections.join('\n')}>
                      rechazada: {r.rejections[0]}
                    </span>
                  )}
                </div>
              </div>
              <Button onClick={() => grab(r)} disabled={grabbing === r.guid}>
                <span className="inline-flex items-center gap-1.5">
                  <Download size={14} /> {grabbing === r.guid ? '…' : 'Descargar'}
                </span>
              </Button>
            </div>
          ))}
        </div>
      )}
      {releases && releases.length === 0 && !msg && (
        <p className="text-sm text-neutral-600 mt-3">Los indexers no devolvieron releases para este álbum.</p>
      )}
    </div>
  );
}

// Buscar y descargar vía Prowlarr, SIN pasar por el filtro de metadatos de Lidarr.
// Busca en todos tus indexers (RED, OPS, Jackett), listas todas las releases y la
// que elijas la agarra Prowlarr y la manda a su cliente de descarga. Es la vía para
// pedir lo que Lidarr veta (compilaciones, directos, ediciones que su perfil excluye).
function SearchSection({ album }) {
  const [q, setQ] = useState(`${album.artist?.name || album.album_artist || ''} ${album.title || ''}`.trim());
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [grabbing, setGrabbing] = useState(null);
  const [grabbed, setGrabbed] = useState({});
  const [msg, setMsg] = useState(null);
  const [engine, setEngine] = useState(null);

  const search = async () => {
    if (!q.trim()) return;
    setLoading(true);
    setErr(null);
    setMsg(null);
    setResults(null);
    try {
      const r = await api.search(q);
      setEngine(r.engine);
      setResults(r.results);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  const grab = async (r) => {
    setGrabbing(r.guid);
    setErr(null);
    try {
      const res = await api.searchGrab({
        engine,
        guid: r.guid,
        indexerId: r.indexerId,
        downloadUrl: r.downloadUrl,
        // contexto para el registro de descargas + auto-import (destino correcto)
        context: {
          album_id: album.id,
          rg_mbid: album.rg_mbid || null,
          artist: album.album_artist || album.artist?.name || null,
          album: album.title || null,
          year: album.year || null,
          release_title: r.title || null,
        },
      });
      setGrabbed((p) => ({ ...p, [r.guid]: true }));
      setMsg(res?.via === 'qbittorrent' ? 'Enviado a qBittorrent.' : 'Enviado a tu cliente de descarga.');
    } catch (e) {
      setErr(e.message);
    } finally {
      setGrabbing(null);
    }
  };

  return (
    <div className="card p-4 mb-6">
      <h2 className="text-sm text-neutral-400 flex items-center gap-2">
        <Search size={15} /> Buscar y descargar
        {engine && (
          <span className="text-xs text-neutral-600">({engine === 'jackett' ? 'Jackett → qBittorrent' : 'Prowlarr'})</span>
        )}
      </h2>
      <p className="text-xs text-neutral-600 mt-1">
        Busca en <b className="font-normal text-neutral-500">todos tus indexers</b> sin el filtro de Lidarr, con el motor
        que elijas en Ajustes. Elige la release y se envía a tu cliente de descarga (Prowlarr al suyo; Jackett a
        qBittorrent). La búsqueda consulta los trackers en vivo: puede tardar.
      </p>
      <div className="flex gap-2 mt-3">
        <input
          className="flex-1 bg-ink-850 border border-ink-800 rounded px-2 py-1.5 text-sm outline-none focus:border-gold-500/60"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()}
          placeholder="Artista y álbum…"
        />
        <Button variant="gold" onClick={search} disabled={loading}>
          <span className="inline-flex items-center gap-1.5">
            <Search size={14} /> {loading ? 'Buscando…' : 'Buscar'}
          </span>
        </Button>
      </div>

      {msg && <p className="text-sm text-emerald-400 mt-3">{msg}</p>}
      {err && <p className="text-sm text-red-400 mt-3">{err}</p>}
      {results && results.length === 0 && !loading && (
        <p className="text-sm text-neutral-600 mt-3">Tus indexers no devolvieron nada. Prueba a cambiar el texto.</p>
      )}
      {results && results.length > 0 && (
        <div className="mt-3 max-h-[30rem] overflow-y-auto divide-y divide-ink-850/60">
          {results.map((r) => (
            <div key={`${r.indexerId}:${r.guid}`} className="py-2 flex items-start gap-3 text-sm">
              <div className="min-w-0 flex-1">
                <div className="truncate" title={r.title}>
                  {r.title}
                </div>
                <div className="text-xs text-neutral-600 flex flex-wrap gap-x-2 mt-0.5">
                  <span className="text-neutral-400">{r.indexer}</span>
                  <span>{fmtBytes(r.size)}</span>
                  {r.seeders != null && (
                    <span className={r.seeders > 0 ? 'text-emerald-400/70' : 'text-red-400/70'}>{r.seeders} seeders</span>
                  )}
                  {r.grabs != null && <span>{r.grabs} grabs</span>}
                  {r.protocol && <span>{r.protocol}</span>}
                  {r.freeleech && <span className="text-emerald-400" title="No cuenta para el ratio">freeleech</span>}
                </div>
              </div>
              {grabbed[r.guid] ? (
                <span className="text-emerald-400 text-xs inline-flex items-center gap-1 shrink-0 self-center">
                  <Check size={14} /> enviado
                </span>
              ) : (
                <Button variant="gold" disabled={grabbing === r.guid} onClick={() => grab(r)}>
                  <span className="inline-flex items-center gap-1.5">
                    <Download size={14} /> {grabbing === r.guid ? '…' : 'Descargar'}
                  </span>
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Botón «Añadir a reto»: despliega tus retos activos y añade este disco al que elijas
// (dedupe por artista+álbum en el servidor; avisa si ya estaba).
function AddToChallenge({ artist, title }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    setMsg(null);
    if (next && list === null) {
      try {
        setList(await api.challenges());
      } catch {
        setList([]);
      }
    }
  };
  const addTo = async (ch) => {
    setBusy(true);
    try {
      const r = await api.addChallengeItems(ch.id, `${artist} - ${title}`);
      setMsg(r.added > 0 ? `Añadido a «${ch.name}»` : `Ya estaba en «${ch.name}»`);
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };

  return (
    <div className="relative inline-flex items-center gap-1.5">
      <button
        onClick={toggle}
        title="Añadir este disco a uno de tus retos"
        className={`text-sm px-3 py-1.5 rounded-lg border inline-flex items-center gap-1.5 ${
          open ? 'border-gold-500/50 bg-gold-500/15 text-gold-300' : 'border-ink-700 bg-ink-850 hover:bg-ink-800'
        }`}
      >
        <Trophy size={14} /> Añadir a reto
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-1 z-40 w-64 card p-1 shadow-lg border border-ink-700 max-h-72 overflow-y-auto">
            {list === null ? (
              <div className="px-2.5 py-2 text-sm text-neutral-500">Cargando…</div>
            ) : list.length === 0 ? (
              <div className="px-2.5 py-2 text-sm text-neutral-500">
                No tienes retos.{' '}
                <Link to="/retos" className="text-gold-400 hover:underline">
                  Crear uno →
                </Link>
              </div>
            ) : (
              list.map((ch) => (
                <button
                  key={ch.id}
                  onClick={() => addTo(ch)}
                  disabled={busy}
                  className="w-full text-left px-2.5 py-1.5 rounded text-sm text-neutral-300 hover:bg-ink-800 inline-flex items-center gap-2 disabled:opacity-50"
                >
                  <Trophy size={13} className="text-neutral-500 shrink-0" />
                  <span className="truncate">{ch.name}</span>
                  <span className="text-xs text-neutral-600 ml-auto shrink-0">{ch.item_count}</span>
                </button>
              ))
            )}
          </div>
        </>
      )}
      {msg && <span className="text-xs text-emerald-400">{msg}</span>}
    </div>
  );
}

// Enlace a Spotify: si hay conexión con Spotify, resuelve el ÁLBUM concreto (enlace
// directo); si no (o no se encuentra), cae al buscador. La resolución va cacheada 30 días
// en el servidor, así que es barata.
function SpotifyLink({ artist, title }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let live = true;
    if (artist && title) {
      api
        .spotifyAlbum(artist, title)
        .then((r) => live && setUrl(r?.url || null))
        .catch(() => {});
    }
    return () => {
      live = false;
    };
  }, [artist, title]);
  const q = `${artist || ''} ${title || ''}`.trim();
  const direct = !!url;
  return (
    <a
      href={direct ? url : `https://open.spotify.com/search/${encodeURIComponent(q)}/albums`}
      target="_blank"
      rel="noreferrer"
      className="text-xs text-gold-400 hover:underline inline-flex items-center gap-1"
      title={direct ? 'Abrir este disco en Spotify' : 'Buscar este disco en Spotify'}
    >
      Spotify <ExternalLink size={11} />
    </a>
  );
}
