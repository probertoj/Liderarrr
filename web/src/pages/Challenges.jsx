import { useEffect, useState } from 'react';
import { Trophy, Plus, Trash2, ArrowLeft, Check, Send, Search, Download } from 'lucide-react';
import { api } from '../api.js';
import { PageTitle, Spinner, ErrorMsg, Button, SearchModal } from '../components.jsx';

// Retos: listas de álbumes "que hay que tener/oír". Anillos concéntricos de lo
// que tienes vs lo que has escuchado, y envío en bloque a Lidarr de lo que falta.
export default function Challenges() {
  const [list, setList] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [err, setErr] = useState(null);
  const [adding, setAdding] = useState(false);

  const load = () => api.challenges().then(setList).catch((e) => setErr(e.message));
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

      {adding && <AddForm onDone={() => { setAdding(false); load(); }} />}

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

  const submit = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await api.addChallenge(name, text);
      onDone();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };
  const importUrl = async () => {
    if (!url.trim()) return;
    setBusy(true);
    try {
      const r = await api.importChallengeUrl(url, name);
      alert(
        `Importados ${r.count} álbumes como reto.` +
          (r.partial
            ? '\n\n⚠️ Esa lista carga por scroll y puede haber venido a medias. Para la completa: ábrela, baja hasta el final, copia todo y usa «pegar la lista».'
            : '')
      );
      onDone();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
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
        <div className="text-xs text-neutral-400 mb-1">Importar una lista por URL (AlbumOfTheYear y similares)</div>
        <div className="flex gap-2">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && importUrl()}
            placeholder="https://www.albumoftheyear.org/list/…"
            className="flex-1 bg-ink-850 border border-ink-800 rounded-lg px-2.5 py-1.5 text-sm"
          />
          <Button onClick={importUrl} disabled={busy}>
            {busy ? '…' : 'Importar'}
          </Button>
        </div>
        <div className="text-[11px] text-neutral-600 mt-1">
          Usa un lector externo para pasar protecciones anti-bot (AOTY tiene Cloudflare). Las listas largas con scroll
          pueden venir a medias; para la completa, usa «pegar» de abajo.
        </div>
      </div>

      <div>
        <div className="text-xs text-neutral-400 mb-1">…o pega la lista (una línea «Artista - Álbum»)</div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={7}
          placeholder={'Radiohead - OK Computer (1997)\nThe Beatles - Revolver\nMiles Davis — Kind of Blue'}
          className="w-full bg-ink-850 border border-ink-800 rounded-lg px-2.5 py-1.5 text-sm font-mono"
        />
        <div className="flex justify-end mt-2">
          <Button variant="gold" onClick={submit} disabled={busy}>
            {busy ? 'Creando…' : 'Crear reto'}
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

  const load = () => api.challenge(id).then(setC).catch((e) => setErr(e.message));
  useEffect(() => {
    load();
  }, [id]);

  const sendMissing = async () => {
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
  };

  // Envío no bloqueante de UN ítem: resuelve en MB y encola a Lidarr.
  const sendOne = async (it) => {
    setQueued((p) => ({ ...p, [it.position]: 'sending' }));
    try {
      const r = await api.lidarrAddByName(it.artist, it.album);
      setQueued((p) => ({ ...p, [it.position]: r.ok ? 'ok' : 'fail' }));
      if (!r.ok) alert(`No se pudo enviar: ${r.reason || 'sin coincidencia en MusicBrainz'}`);
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
          <Button variant="gold" onClick={sendMissing} disabled={sending}>
            <span className="inline-flex items-center gap-1.5">
              <Send size={14} /> {sending ? 'Enviando…' : 'Faltantes a Lidarr'}
            </span>
          </Button>
          <Button variant="ghost" onClick={remove}>
            <Trash2 size={14} />
          </Button>
        </div>
      </div>

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
              {it.artist} — {it.album}
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
                      <Download size={12} /> {queued[it.position] === 'sending' ? '…' : 'Lidarr'}
                    </button>
                  )}
                </>
              )}
              {it.listened && <span className="text-emerald-400">oído</span>}
            </div>
          </div>
        ))}
      </div>

      {search != null && <SearchModal initialQuery={search} onClose={() => setSearch(null)} />}
    </div>
  );
}
