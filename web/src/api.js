// Cliente HTTP mínimo contra la API. Todo cuelga de /api (Vite hace proxy en dev,
// y en producción el propio servidor sirve la SPA, así que es el mismo origen).
async function req(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = `Error ${res.status}`;
    try {
      const j = await res.json();
      msg = j.error || msg;
    } catch {
      /* noop */
    }
    throw new Error(msg);
  }
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : res.text();
}

export const api = {
  version: () => req('/version'),
  setupState: () => req('/setup-state'),
  settings: () => req('/settings'),
  saveSettings: (body) => req('/settings', { method: 'PUT', body }),
  test: (svc) => req(`/settings/test/${svc}`, { method: 'POST' }),
  lidarrProfiles: () => req('/lidarr/profiles'),

  scan: () => req('/scan', { method: 'POST' }),
  scanStatus: () => req('/scan/status'),
  identify: (force) => req('/identify', { method: 'POST', body: { force } }),
  identifyStatus: () => req('/identify/status'),
  refresh: (trigger) => req('/refresh', { method: 'POST', body: { trigger } }),
  refreshStatus: () => req('/refresh/status'),

  overview: () => req('/stats/overview'),
  charts: () => req('/stats/charts'),

  library: (params) => req(`/library?${new URLSearchParams(params)}`),
  libraryFilters: () => req('/library/filters'),
  album: (id) => req(`/albums/${id}`),
  albumState: (id, state) => req(`/albums/${id}/state`, { method: 'POST', body: { state } }),
  candidates: (id) => req(`/albums/${id}/candidates`),
  match: (id, rg_mbid) => req(`/albums/${id}/match`, { method: 'POST', body: { rg_mbid } }),

  artists: (params) => req(`/artists?${new URLSearchParams(params)}`),
  artist: (id) => req(`/artists/${id}`),

  incomplete: () => req('/incomplete'),
  quality: () => req('/quality/overview'),
  duplicates: () => req('/quality/duplicates'),
  unidentified: () => req('/unidentified'),
  rarities: () => req('/rarities'),

  lidarrSync: () => req('/lidarr/sync', { method: 'POST' }),
  lidarrAdd: (rg_mbid, artist_mbid) => req('/lidarr/add', { method: 'POST', body: { rg_mbid, artist_mbid } }),
  lidarrAddBulk: (items) => req('/lidarr/add-bulk', { method: 'POST', body: { items } }),

  // fase 2 — la caza
  tracked: () => req('/tracked'),
  suggestions: () => req('/tracked/suggestions'),
  follow: (id, facet) => req(`/tracked/${id}`, { method: 'POST', body: { facet } }),
  unfollow: (id, facet = 'artist') => req(`/tracked/${id}?facet=${facet}`, { method: 'DELETE' }),
  followMbid: (mbid, facet) => req('/tracked/by-mbid', { method: 'POST', body: { mbid, facet } }),
  searchArtistMb: (q) => req(`/artists/search-mb?q=${encodeURIComponent(q)}`),
  refreshArtistDisco: (id) => req(`/artists/${id}/refresh-discography`, { method: 'POST' }),
  discographyRefresh: (onlyTracked) => req('/discography/refresh', { method: 'POST', body: { onlyTracked } }),
  discographyStatus: () => req('/discography/status'),
  gaps: (all) => req(`/discover/gaps${all ? '?all=1' : ''}`),
  upcoming: (all) => req(`/discover/upcoming${all ? '?all=1' : ''}`),
  dismiss: (rg_mbid, title) => req('/discover/dismiss', { method: 'POST', body: { rg_mbid, title } }),
  autoLidarr: () => req('/lidarr/auto'),
  autoLidarrRun: (dryRun) => req('/lidarr/auto/run', { method: 'POST', body: { dryRun } }),

  // fase 3 — el gusto
  scrobblesImport: (full) => req('/scrobbles/import', { method: 'POST', body: { full } }),
  scrobblesStatus: () => req('/scrobbles/status'),
  listening: () => req('/listening/overview'),
  gap: (minPlays) => req(`/listening/gap${minPlays ? `?minPlays=${minPlays}` : ''}`),
  unplayed: () => req('/listening/unplayed'),
  challenges: () => req('/challenges'),
  addChallenge: (name, text) => req('/challenges', { method: 'POST', body: { name, text } }),
  challenge: (id) => req(`/challenges/${id}`),
  deleteChallenge: (id) => req(`/challenges/${id}`, { method: 'DELETE' }),
  challengeToLidarr: (id) => req(`/challenges/${id}/radarr`, { method: 'POST' }),

  // fase 4 — refinado
  editions: (id) => req(`/albums/${id}/editions`),
  relations: (id) => req(`/artists/${id}/relations`),
  upgrades: () => req('/quality/upgrades'),
  labels: () => req('/labels'),
  label: (name) => req(`/labels/${encodeURIComponent(name)}`),
};

export const coverUrl = (id) => `/api/cover/${id}`;

export function fmtBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
}

export function fmtDuration(ms) {
  const days = ms / 86400000;
  if (days >= 1) return `${days.toFixed(1)} días`;
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h} h ${m} min`;
}
