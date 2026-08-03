import { useEffect, useState } from 'react';
import { Trophy, Plus, Trash2, ArrowLeft, Check, Send } from 'lucide-react';
import { api } from '../api.js';
import { PageTitle, Spinner, ErrorMsg, Button } from '../components.jsx';

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
  return (
    <div className="card p-4 mb-5">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Nombre del reto (p. ej. Rolling Stone 500)"
        className="w-full bg-ink-850 border border-ink-800 rounded-lg px-2.5 py-1.5 text-sm mb-2"
      />
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={8}
        placeholder={'Una línea por álbum, formato «Artista - Álbum»:\nRadiohead - OK Computer (1997)\nThe Beatles - Revolver\nMiles Davis — Kind of Blue'}
        className="w-full bg-ink-850 border border-ink-800 rounded-lg px-2.5 py-1.5 text-sm font-mono"
      />
      <div className="flex justify-end mt-2">
        <Button variant="gold" onClick={submit} disabled={busy}>
          {busy ? 'Creando…' : 'Crear reto'}
        </Button>
      </div>
    </div>
  );
}

function Detail({ id, onBack }) {
  const [c, setC] = useState(null);
  const [err, setErr] = useState(null);
  const [sending, setSending] = useState(false);
  const [filter, setFilter] = useState('all'); // all | missing | unheard

  const load = () => api.challenge(id).then(setC).catch((e) => setErr(e.message));
  useEffect(() => {
    load();
  }, [id]);

  const sendMissing = async () => {
    if (!confirm('¿Buscar en MusicBrainz y enviar a Lidarr todos los que te faltan?')) return;
    setSending(true);
    try {
      const r = await api.challengeToLidarr(id);
      alert(`${r.added} de ${r.total} enviados a Lidarr.` + (r.errors?.length ? `\n\nSin coincidencia:\n${r.errors.map((e) => e.item).join('\n')}` : ''));
    } catch (e) {
      alert(e.message);
    } finally {
      setSending(false);
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
                <span className="text-neutral-600">falta</span>
              )}
              {it.listened && <span className="text-emerald-400">oído</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
