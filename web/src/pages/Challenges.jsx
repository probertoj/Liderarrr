import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Trophy, Plus, Trash2, ArrowLeft, Check, Send, Search, Download, X, ListMusic, Headphones } from 'lucide-react';
import { api, coverUrl } from '../api.js';
import { PageTitle, Section, Spinner, ErrorMsg, Button, SearchModal, QuickSearch, useLidarrEnabled } from '../components.jsx';

// Retos: listas de álbumes "que hay que tener/oír". Anillos concéntricos de lo
// que tienes vs lo que has escuchado, y envío en bloque a Lidarr de lo que falta.
export default function Challenges() {
  const [list, setList] = useState(null);
  const [nextListens, setNextListens] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [err, setErr] = useState(null);
  const [adding, setAdding] = useState(false);

  const load = () => {
    api.nextChallengeListens(true).then(setNextListens).catch(() => {});
    return api.challenges().then(setList).catch((e) => setErr(e.message));
  };
  useEffect(() => {
    load();
  }, []);

  if (err) return <ErrorMsg>{err}</ErrorMsg>;
  if (!list) return <Spinner />;
  if (openId) return <Detail id={openId} onBack={() => { setOpenId(null); load(); }} />;

  return (
    <div>
      <PageTitle icon={Trophy} title="Retos" sub="Listas de discos imprescindibles, cruzadas con tu colección">
        <Button variant="gold" onClick={() => setAdding((v) => !v)}>
          <span className="inline-flex items-center gap-1.5">
            <Plus size={14} /> Nuevo reto
          </span>
        </Button>
      </PageTitle>
      <QuickSearch />

      {adding && <AddForm onDone={() => { setAdding(false); load(); }} />}

      {/* siguiente por escuchar de CADA reto: el próximo disco que tienes y no has oído */}
      {nextListens?.length > 0 && (
        <Section title="Siguiente por escuchar de tus retos" className="mb-8">
          <div className="card p-3">
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2.5">
              {nextListens.map((n) => (
                <Link key={n.challenge_id} to={`/album/${n.owned_album_id}`} className="group block" title={`De «${n.challenge}»`}>
                  <div className="text-[10px] text-gold-500/80 truncate mb-1">{n.challenge}</div>
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

      {list.length === 0 && !adding && (
        <div className="card p-6 text-center text-neutral-400">
          Aún no hay retos. Pega una lista (1001 Albums, Rolling Stone 500, la que sea) en formato
          «Artista - Álbum» por línea y verás cuánto tienes y cuánto has escuchado.
        </div>
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {list.map((c) => (
          <button
            key={c.id}
            onClick={() => setOpenId(c.id)}
            className="card p-4 text-left hover:border-gold-500/40 flex items-center gap-4"
          >
            <Ring pct={c.pct} />
            <div className="min-w-0">
              <div className="truncate font-medium">{c.name}</div>
              <div className="text-xs text-neutral-500">
                {c.owned} de {c.item_count} · {c.pct}%
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function Ring({ pct, listenedPct, size = 52 }) {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const r2 = r - 6;
  const c2 = 2 * Math.PI * r2;
  return (
    <svg width={size} height={size} className="shrink-0 -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#2c2c39" strokeWidth="4" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="#d4a24a"
        strokeWidth="4"
        strokeDasharray={c}
        strokeDashoffset={c - (c * (pct || 0)) / 100}
        strokeLinecap="round"
      />
      {listenedPct != null && (
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r2}
          fill="none"
          stroke="#5dcaa5"
          strokeWidth="4"
          strokeDasharray={c2}
          strokeDashoffset={c2 - (c2 * listenedPct) / 100}
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

function AddForm({ onDone }) {
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [importMsg, setImportMsg] = useState(null); // progreso/aviso de la importación por URL
  const poll = useRef(null);
  useEffect(() => () => clearInterval(poll.current), []);

  const submit = async () => {
    if (!text.trim() && !name.trim()) return;
    setBusy(true);
    try {
      // sin texto → reto VACÍO (para irlo rellenando luego)
      await api.addChallenge(name, text);
      onDone();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };
  // La importación por URL corre en SEGUNDO PLANO (AOTY tarda minutos): se lanza y se sigue el
  // progreso por sondeo, sin bloquear. Al terminar, recarga la lista de retos.
  const importUrl = async () => {
    if (!url.trim() || busy) return;
    setBusy(true);
    setImportMsg('Iniciando importación…');
    try {
      await api.importChallengeUrl(url, name);
    } catch (e) {
      setImportMsg(null);
      setBusy(false);
      alert(e.message);
      return;
    }
    clearInterval(poll.current);
    poll.current = setInterval(async () => {
      let st;
      try {
        st = await api.importChallengeStatus();
      } catch {
        return;
      }
      if (st.running) {
        setImportMsg(`Importando… ${st.page ? `página ${st.page} · ` : ''}${st.items} álbumes (puede tardar en listas largas).`);
        return;
      }
      clearInterval(poll.current);
      setBusy(false);
      if (st.error) {
        setImportMsg(null);
        alert(st.error);
        return;
      }
      setImportMsg(null);
      if (st.challengeId) {
        alert(
          `Importados ${st.count} álbumes como reto «${st.challengeName}».` +
            (st.partial
              ? '\n\n⚠️ Esa lista puede haber venido a medias. Para la completa: ábrela, baja hasta el final, copia todo y usa «pegar la lista».'
              : '')
        );
        onDone();
      }
    }, 2000);
  };

  return (
    <div className="card p-4 mb-5 space-y-4">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Nombre del reto (opcional; si importas por URL se coge el de la lista)"
        className="w-full bg-ink-850 border border-ink-800 rounded-lg px-2.5 py-1.5 text-sm"
      />

      <div>
        <div className="text-xs text-neutral-400 mb-1">Importar una lista por URL</div>
        <div className="flex gap-2">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && importUrl()}
            placeholder="Pega la URL de la lista (AOTY, record.club, Rosy Overdrive, Hip Hop Golden Age…)"
            className="flex-1 bg-ink-850 border border-ink-800 rounded-lg px-2.5 py-1.5 text-sm"
          />
          <Button onClick={importUrl} disabled={busy}>
            {busy ? 'Importando…' : 'Importar'}
          </Button>
        </div>
        {importMsg && <div className="text-xs text-gold-300/90 mt-1.5">{importMsg}</div>}
        <div className="text-[11px] text-neutral-600 mt-1 space-y-0.5">
          <div>
            <span className="text-neutral-500">Reconoce bien:</span> AlbumOfTheYear (listas con ranking, aunque sean
            largas), record.club (listas públicas de usuario), Rosy Overdrive (posts con «Artista – Álbum») y Hip Hop
            Golden Age (sus listas /list/…).
          </div>
          <div>
            Otras webs se intentan con un lector genérico (busca líneas «Artista - Álbum»). RateYourMusic bloquea a
            los bots: para esas, usa «pegar la lista» de abajo. Las listas largas con scroll pueden venir a medias.
          </div>
        </div>
      </div>

      <div>
        <div className="text-xs text-neutral-400 mb-1">
          …o pega la lista: una línea «Artista - Álbum», o directamente lo que copies de un chart de
          RateYourMusic (se detecta su formato).
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={7}
          placeholder={'Radiohead - OK Computer (1997)\nThe Beatles - Revolver\nMiles Davis — Kind of Blue'}
          className="w-full bg-ink-850 border border-ink-800 rounded-lg px-2.5 py-1.5 text-sm font-mono"
        />
        <div className="flex items-center justify-between mt-2 gap-2 flex-wrap">
          <span className="text-[11px] text-neutral-600">
            ¿Reto propio que irás rellenando? Pon solo un nombre y créalo vacío; luego añades discos desde el reto.
          </span>
          <Button variant="gold" onClick={submit} disabled={busy || (!text.trim() && !name.trim())}>
            {busy ? 'Creando…' : text.trim() ? 'Crear reto' : 'Crear reto vacío'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Detail({ id, onBack }) {
  const [c, setC] = useState(null);
  const [err, setErr] = useState(null);
  const [sending, setSending] = useState(false);
  const [filter, setFilter] = useState('all'); // all | missing | unheard
  const [search, setSearch] = useState(null); // query del modal de búsqueda manual
  const [queued, setQueued] = useState({}); // position -> 'sending' | 'ok' | 'fail'
  const [addOpen, setAddOpen] = useState(false);
  const [addText, setAddText] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  const lidarrOn = useLidarrEnabled();

  const load = () => api.challenge(id).then(setC).catch((e) => setErr(e.message));
  useEffect(() => {
    load();
  }, [id]);

  const sendMissing = async () => {
    if (lidarrOn) {
      if (!confirm('¿Resolver en MusicBrainz y enviar a Lidarr todos los que te faltan?')) return;
      setSending(true);
      try {
        const r = await api.challengeToLidarr(id);
        alert(`Encolados ${r.queued} para resolver y enviar en segundo plano.\nEl progreso está en la cola de Lidarr (Diagnóstico).`);
      } catch (e) {
        alert(e.message);
      } finally {
        setSending(false);
      }
      return;
    }
    // Nativo (sin Lidarr): agarra la mejor de cada faltante, secuencial (indexers en vivo).
    const missing = (c?.items || []).filter((i) => !i.owned);
    if (!missing.length || !confirm(`¿Buscar y descargar los ${missing.length} que te faltan? Puede tardar.`)) return;
    setSending(true);
    try {
      for (const it of missing) {
        setQueued((p) => ({ ...p, [it.position]: 'sending' }));
        try {
          const r = await api.grabBest(`${it.artist} ${it.album}`, { artist: it.artist, album: it.album });
          setQueued((p) => ({ ...p, [it.position]: r.grabbed ? 'ok' : 'fail' }));
        } catch {
          setQueued((p) => ({ ...p, [it.position]: 'fail' }));
        }
      }
    } finally {
      setSending(false);
    }
  };

  // UN ítem: con Lidarr resuelve en MB y encola; sin Lidarr agarra la mejor release.
  const sendOne = async (it) => {
    setQueued((p) => ({ ...p, [it.position]: 'sending' }));
    try {
      const r = lidarrOn
        ? await api.lidarrAddByName(it.artist, it.album)
        : await api.grabBest(`${it.artist} ${it.album}`, { artist: it.artist, album: it.album });
      const ok = lidarrOn ? r.ok : r.grabbed;
      setQueued((p) => ({ ...p, [it.position]: ok ? 'ok' : 'fail' }));
      if (!ok) alert(`No se pudo: ${r.reason || 'sin coincidencia / sin release'}`);
    } catch (e) {
      setQueued((p) => ({ ...p, [it.position]: 'fail' }));
      alert(e.message);
    }
  };

  const remove = async () => {
    if (!confirm('¿Borrar este reto?')) return;
    await api.deleteChallenge(id);
    onBack();
  };

  // Retos editables: añadir discos (texto «Artista - Álbum») y quitar uno.
  const addItems = async () => {
    if (!addText.trim()) return;
    setAddBusy(true);
    try {
      await api.addChallengeItems(id, addText);
      setAddText('');
      setAddOpen(false);
      await load();
    } catch (e) {
      alert(e.message);
    } finally {
      setAddBusy(false);
    }
  };
  const del = async (position) => {
    await api.removeChallengeItem(id, position);
    await load();
  };

  if (err) return <ErrorMsg>{err}</ErrorMsg>;
  if (!c) return <Spinner />;

  const items = c.items.filter((i) => (filter === 'missing' ? !i.owned : filter === 'unheard' ? !i.listened : true));

  return (
    <div>
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-neutral-400 hover:text-gold-400 mb-4">
        <ArrowLeft size={15} /> Retos
      </button>

      <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
        <div className="flex items-center gap-4">
          <Ring pct={c.pct} listenedPct={c.listenedPct} size={72} />
          <div>
            <h1 className="text-xl font-display">{c.name}</h1>
            <p className="text-sm text-neutral-400">
              <span className="text-gold-400">{c.owned}</span> tienes · <span className="text-emerald-400">{c.listened}</span> escuchados · de {c.item_count}
            </p>
            <p className="text-xs text-neutral-600">{c.pct}% en disco · {c.listenedPct}% oído</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setAddOpen((v) => !v)}>
            <span className="inline-flex items-center gap-1.5">
              <Plus size={14} /> Añadir discos
            </span>
          </Button>
          <Button variant="gold" onClick={sendMissing} disabled={sending}>
            <span className="inline-flex items-center gap-1.5">
              <Send size={14} /> {sending ? (lidarrOn ? 'Enviando…' : 'Descargando…') : lidarrOn ? 'Faltantes a Lidarr' : 'Descargar faltantes'}
            </span>
          </Button>
          {c.owned > 0 && (
            <a
              href={`/api/challenges/${id}/m3u`}
              className="text-sm px-3 py-1.5 rounded-lg border border-ink-700 bg-ink-850 hover:bg-ink-800 inline-flex items-center gap-1.5"
              title="Descargar como lista M3U los discos que tienes de este reto, para escucharlos en tu reproductor"
            >
              <ListMusic size={14} /> M3U
            </a>
          )}
          <Button variant="ghost" onClick={remove}>
            <Trash2 size={14} />
          </Button>
        </div>
      </div>

      {addOpen && (
        <div className="card p-3 mb-4 space-y-2">
          <div className="text-xs text-neutral-500">
            Pega o escribe discos, una línea «Artista - Álbum» (con año opcional). No duplica los que ya están.
          </div>
          <textarea
            value={addText}
            onChange={(e) => setAddText(e.target.value)}
            rows={4}
            placeholder={'The Cure - Disintegration\nBig Thief - Dragon New Warm Mountain I Believe in You (2022)'}
            className="w-full bg-ink-850 border border-ink-800 rounded px-2.5 py-1.5 text-sm font-mono"
          />
          <div className="flex justify-end">
            <Button variant="gold" onClick={addItems} disabled={addBusy || !addText.trim()}>
              {addBusy ? 'Añadiendo…' : 'Añadir al reto'}
            </Button>
          </div>
        </div>
      )}

      <div className="flex gap-2 mb-3 text-sm">
        {['all', 'missing', 'unheard'].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-2.5 py-1 rounded-lg border ${filter === f ? 'border-gold-500/50 bg-gold-500/15 text-gold-300' : 'border-ink-800 bg-ink-850'}`}
          >
            {f === 'all' ? 'Todos' : f === 'missing' ? 'Que faltan' : 'Sin escuchar'}
          </button>
        ))}
      </div>

      <div className="space-y-1">
        {items.map((it) => (
          <div key={it.position} className="card px-3 py-2 flex items-center justify-between text-sm">
            <span className="min-w-0 truncate">
              <span className="text-neutral-600 mr-2">{it.position + 1}.</span>
              {it.artist_id ? (
                <Link to={`/artista/${it.artist_id}`} className="hover:text-gold-400">{it.artist}</Link>
              ) : (
                it.artist
              )}
              {' — '}
              {it.album_id ? (
                <Link to={`/album/${it.album_id}`} className="hover:text-gold-400">{it.album}</Link>
              ) : (
                it.album
              )}
              {it.year ? <span className="text-neutral-600"> · {it.year}</span> : ''}
            </span>
            <div className="flex items-center gap-2 shrink-0 ml-2 text-xs">
              {it.owned ? (
                <span className="text-gold-400 inline-flex items-center gap-1">
                  <Check size={13} /> tienes
                </span>
              ) : (
                <>
                  <button
                    onClick={() => setSearch(`${it.artist} ${it.album}`)}
                    className="px-2 py-1 rounded border border-ink-700 bg-ink-850 hover:bg-ink-800 inline-flex items-center gap-1"
                  >
                    <Search size={12} /> Buscar
                  </button>
                  {queued[it.position] === 'ok' ? (
                    <span className="text-emerald-400 inline-flex items-center gap-1">
                      <Check size={13} /> en cola
                    </span>
                  ) : (
                    <button
                      onClick={() => sendOne(it)}
                      disabled={queued[it.position] === 'sending'}
                      className="px-2 py-1 rounded border border-gold-500/40 bg-gold-500/10 text-gold-300 hover:bg-gold-500/20 inline-flex items-center gap-1 disabled:opacity-50"
                    >
                      <Download size={12} /> {queued[it.position] === 'sending' ? '…' : lidarrOn ? 'Lidarr' : 'Descargar'}
                    </button>
                  )}
                </>
              )}
              {it.listened && <span className="text-emerald-400">oído</span>}
              <button
                onClick={() => del(it.position)}
                title="Quitar del reto"
                className="text-neutral-600 hover:text-red-400 shrink-0"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {search != null && <SearchModal initialQuery={search} onClose={() => setSearch(null)} />}
    </div>
  );
}
