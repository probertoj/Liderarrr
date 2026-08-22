import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Search, Download, ExternalLink, Loader2, Check } from 'lucide-react';
import { api } from '../api.js';
import { Spinner } from '../components.jsx';

// Vista MES tipo Google Calendar: una rejilla mensual que junta TODAS las fuentes de
// lanzamientos en su día — Próximos y Estrenados recientemente (MusicBrainz), De tus
// sellos, Radar (curadores) y Novedades de Spotify/Deezer. Se cargan una vez con una
// ventana amplia y se re-agrupan al navegar de mes (sin repetir peticiones).

const KIND = {
  upcoming: { label: 'Próximo', dot: '#0ea5e9' },
  recent: { label: 'Estreno', dot: '#b9852f' },
  label: { label: 'Sello', dot: '#d97706' },
  radar: { label: 'Radar', dot: '#8b5cf6' },
  novedad: { label: 'Spotify', dot: '#10b981' },
};
const KIND_ORDER = ['upcoming', 'recent', 'label', 'novedad', 'radar'];
const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const nkey = (s) => String(s || '').normalize('NFD').toLowerCase().replace(/[^a-z0-9]+/g, '');
const iso = (d) => d.toISOString().slice(0, 10);
const monthsAgoIso = (n) => iso(new Date(Date.now() - n * 30 * 86400000));

// Normaliza y deduplica los eventos de todas las fuentes. Un mismo disco puede venir de
// varias fuentes: se funde en uno solo (mayor prioridad manda la fecha; se acumulan las
// «kinds» para pintar varios puntitos).
function mergeEvents({ upcoming, recent, labels, radar, novedades }) {
  const byKey = new Map();
  const add = (date, artist, title, kind, extra = {}) => {
    const d = (date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !artist || !title) return;
    const key = `${nkey(artist)}::${nkey(title)}`;
    const cur = byKey.get(key);
    if (!cur) {
      byKey.set(key, { date: d, artist, title, kinds: [kind], ...extra });
      return;
    }
    if (!cur.kinds.includes(kind)) cur.kinds.push(kind);
    // completa metadatos que falten (rg_mbid, artist_id, url…), sin pisar los existentes
    for (const [k, v] of Object.entries(extra)) if (cur[k] == null && v != null) cur[k] = v;
  };
  // orden de prioridad: la primera fuente que aporta un disco fija su fecha
  for (const r of upcoming || []) add(r.first_release, r.artist, r.title, 'upcoming', { rg_mbid: r.rg_mbid, artist_id: r.artist_id, artist_mbid: r.artist_mbid, is_owned: r.is_owned });
  for (const r of recent || []) add(r.first_release, r.artist, r.title, 'recent', { rg_mbid: r.rg_mbid, artist_id: r.artist_id, is_owned: r.is_owned });
  for (const r of labels || []) add(r.first_release, r.artist, r.title, 'label', { rg_mbid: r.rg_mbid, artist_id: r.artist_id, labels: r.labels, is_owned: r.is_owned });
  for (const r of novedades || []) add(r.release_date, r.artist, r.title, 'novedad', { artist_id: r.artist_id, url: r.url, source: r.source, ahead: r.ahead });
  for (const r of radar || []) add(r.release_date, r.artist, r.title, 'radar', { url: r.url });
  // primary kind = el de mayor prioridad presente (para el color principal del punto)
  const evs = [...byKey.values()];
  for (const e of evs) e.primary = KIND_ORDER.find((k) => e.kinds.includes(k)) || e.kinds[0];
  return evs;
}

export default function MonthCalendar({ onSearch }) {
  const [events, setEvents] = useState(null);
  const [err, setErr] = useState(null);
  const [cursor, setCursor] = useState(() => {
    const n = new Date();
    return { y: n.getFullYear(), m: n.getMonth() };
  });
  const [selected, setSelected] = useState(iso(new Date()));
  const [grab, setGrab] = useState({}); // key -> 'busy' | 'done'

  useEffect(() => {
    const since = monthsAgoIso(14); // ventana amplia; navegar de mes solo re-agrupa
    Promise.all([
      api.upcoming(true).catch(() => []),
      api.recentReleases(since, true).catch(() => []),
      api.labelReleases(since).catch(() => []),
      api.radar(since, false).catch(() => []),
      api.newReleases().catch(() => []),
    ])
      .then(([upcoming, recent, labels, radar, novedades]) =>
        setEvents(mergeEvents({ upcoming, recent, labels, radar, novedades }))
      )
      .catch((e) => setErr(e.message));
  }, []);

  // agrupa por día (YYYY-MM-DD) — se recalcula solo si cambian los eventos
  const byDay = useMemo(() => {
    const m = {};
    for (const e of events || []) (m[e.date] ||= []).push(e);
    for (const k of Object.keys(m)) m[k].sort((a, b) => KIND_ORDER.indexOf(a.primary) - KIND_ORDER.indexOf(b.primary));
    return m;
  }, [events]);

  // celdas de la rejilla: 6 semanas (42 días) desde el lunes de la 1ª semana del mes
  const cells = useMemo(() => {
    const first = new Date(Date.UTC(cursor.y, cursor.m, 1));
    const offset = (first.getUTCDay() + 6) % 7; // 0 = lunes
    const start = new Date(first);
    start.setUTCDate(1 - offset);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setUTCDate(start.getUTCDate() + i);
      return { key: iso(d), day: d.getUTCDate(), inMonth: d.getUTCMonth() === cursor.m };
    });
  }, [cursor]);

  const today = iso(new Date());
  const go = (delta) => setCursor((c) => {
    const d = new Date(Date.UTC(c.y, c.m + delta, 1));
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
  });
  const goToday = () => {
    const n = new Date();
    setCursor({ y: n.getFullYear(), m: n.getMonth() });
    setSelected(today);
  };

  const doGrab = async (e) => {
    const key = `${e.date}:${nkey(e.artist)}:${nkey(e.title)}`;
    setGrab((p) => ({ ...p, [key]: 'busy' }));
    try {
      const ctx = { artist: e.artist, album: e.title };
      if (e.rg_mbid) ctx.rg_mbid = e.rg_mbid;
      const res = await api.grabBest(`${e.artist} ${e.title}`, ctx);
      if (!res.grabbed) {
        alert(`No se pudo agarrar: ${res.reason || 'sin release'}`);
        setGrab((p) => ({ ...p, [key]: undefined }));
        return;
      }
      setGrab((p) => ({ ...p, [key]: 'done' }));
    } catch (err) {
      alert(err.message);
      setGrab((p) => ({ ...p, [key]: undefined }));
    }
  };

  if (err) return <div className="card p-4 text-red-300">{err}</div>;
  if (!events) return <Spinner label="Reuniendo todas las fuentes…" />;

  const selEvents = byDay[selected] || [];

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-1">
          <button onClick={() => go(-1)} className="p-1.5 rounded-lg border border-ink-800 bg-ink-850 hover:bg-ink-800" aria-label="Mes anterior">
            <ChevronLeft size={16} />
          </button>
          <button onClick={() => go(1)} className="p-1.5 rounded-lg border border-ink-800 bg-ink-850 hover:bg-ink-800" aria-label="Mes siguiente">
            <ChevronRight size={16} />
          </button>
          <button onClick={goToday} className="text-xs px-2 py-1.5 rounded-lg border border-ink-800 bg-ink-850 hover:bg-ink-800 ml-1">
            Hoy
          </button>
        </div>
        <h2 className="font-display text-lg capitalize">
          {MONTHS[cursor.m]} {cursor.y}
        </h2>
      </div>

      {/* leyenda de fuentes */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3 text-xs text-neutral-500">
        {KIND_ORDER.map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ background: KIND[k].dot }} /> {KIND[k].label}
          </span>
        ))}
      </div>

      {/* rejilla */}
      <div className="grid grid-cols-7 gap-px bg-ink-800 rounded-lg overflow-hidden border border-ink-800">
        {WEEKDAYS.map((w) => (
          <div key={w} className="bg-ink-900 text-[11px] uppercase tracking-wide text-neutral-600 px-2 py-1.5 text-center">
            {w}
          </div>
        ))}
        {cells.map((c) => {
          const evs = byDay[c.key] || [];
          const isToday = c.key === today;
          const isSel = c.key === selected;
          return (
            <button
              key={c.key}
              onClick={() => setSelected(c.key)}
              className={`bg-ink-900 min-h-[68px] md:min-h-[92px] p-1.5 text-left align-top flex flex-col gap-1 transition ${
                c.inMonth ? '' : 'opacity-40'
              } ${isSel ? 'ring-2 ring-gold-500/60 ring-inset' : 'hover:bg-ink-850'}`}
            >
              <div className="flex items-center justify-between">
                <span
                  className={`text-xs ${isToday ? 'bg-gold-500 text-black rounded-full w-5 h-5 inline-flex items-center justify-center' : 'text-neutral-400'}`}
                >
                  {c.day}
                </span>
                {evs.length > 0 && <span className="text-[10px] text-neutral-600 md:hidden">{evs.length}</span>}
              </div>
              {/* móvil: puntitos; escritorio: pastillas con texto */}
              <div className="flex flex-wrap gap-1 md:hidden">
                {evs.slice(0, 6).map((e, i) => (
                  <span key={i} className="w-1.5 h-1.5 rounded-full" style={{ background: KIND[e.primary].dot }} />
                ))}
              </div>
              <div className="hidden md:flex md:flex-col gap-0.5 min-w-0">
                {evs.slice(0, 3).map((e, i) => (
                  <span
                    key={i}
                    title={`${e.artist} — ${e.title}`}
                    className="text-[11px] text-neutral-300 truncate inline-flex items-center gap-1"
                  >
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: KIND[e.primary].dot }} />
                    <span className="truncate">
                      {e.artist} — {e.title}
                    </span>
                  </span>
                ))}
                {evs.length > 3 && <span className="text-[10px] text-neutral-600">+{evs.length - 3} más</span>}
              </div>
            </button>
          );
        })}
      </div>

      {/* detalle del día seleccionado */}
      <div className="mt-4">
        <h3 className="text-sm text-neutral-400 mb-2 capitalize">
          {new Date(selected + 'T00:00:00Z').toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}
        </h3>
        {selEvents.length === 0 ? (
          <p className="text-sm text-neutral-600">Sin lanzamientos este día.</p>
        ) : (
          <div className="space-y-1.5">
            {selEvents.map((e, i) => {
              const key = `${e.date}:${nkey(e.artist)}:${nkey(e.title)}`;
              return (
                <div key={i} className="card px-3 py-2 flex items-center gap-3 text-sm">
                  <div className="flex flex-col gap-1 shrink-0">
                    {e.kinds.map((k) => (
                      <span key={k} className="w-2 h-2 rounded-full" style={{ background: KIND[k].dot }} title={KIND[k].label} />
                    ))}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate">
                      {e.artist_id ? (
                        <Link to={`/artista/${e.artist_id}`} className="hover:text-gold-400">
                          {e.artist}
                        </Link>
                      ) : (
                        <span>{e.artist}</span>
                      )}
                      <span className="text-neutral-500"> — {e.title}</span>
                    </div>
                    <div className="text-xs text-neutral-600 flex items-center gap-2 flex-wrap">
                      <span>{e.kinds.map((k) => KIND[k].label).join(' · ')}</span>
                      {e.ahead && <span className="text-amber-400/80" title="MusicBrainz aún no lo lista">⚡ MB no lo tiene</span>}
                      {e.is_owned && <span className="text-emerald-400/70">ya lo tienes</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => onSearch(`${e.artist} ${e.title}`)}
                      className="text-xs px-1.5 py-0.5 rounded border border-ink-700 bg-ink-850 hover:bg-ink-800 inline-flex items-center gap-1"
                    >
                      <Search size={12} /> Buscar
                    </button>
                    {grab[key] === 'done' ? (
                      <span className="text-emerald-400 text-xs inline-flex items-center gap-1">
                        <Check size={13} /> pedido
                      </span>
                    ) : (
                      <button
                        onClick={() => doGrab(e)}
                        disabled={grab[key] === 'busy'}
                        className="text-xs px-1.5 py-0.5 rounded border border-gold-500/40 bg-gold-500/10 text-gold-300 hover:bg-gold-500/20 inline-flex items-center gap-1 disabled:opacity-50"
                      >
                        {grab[key] === 'busy' ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} Descargar
                      </button>
                    )}
                    {e.url && (
                      <a href={e.url} target="_blank" rel="noreferrer" className="text-xs text-gold-400 hover:underline inline-flex items-center gap-0.5">
                        <ExternalLink size={12} />
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
