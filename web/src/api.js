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
  updateCheck: () => req('/update-check'),
  diag: () => req('/diag'),
  setupState: () => req('/setup-state'),
  settings: () => req('/settings'),
  saveSettings: (body) => req('/settings', { method: 'PUT', body }),
  test: (svc) => req(`/settings/test/${svc}`, { method: 'POST' }),
  lidarrProfiles: () => req('/lidarr/profiles'),

  scan: (force) => req('/scan', { method: 'POST', body: { force } }),
  scanStatus: () => req('/scan/status'),
  retryCovers: () => req('/covers/retry-missing', { method: 'POST' }),
  identify: (force) => req('/identify', { method: 'POST', body: { force } }),
  identifyStatus: () => req('/identify/status'),
  refresh: (trigger) => req('/refresh', { method: 'POST', body: { trigger } }),
  refreshStatus: () => req('/refresh/status'),

  overview: () => req('/stats/overview'),
  charts: () => req('/stats/charts'),
  recent: () => req('/stats/recent'),

  library: (params) => req(`/library?${new URLSearchParams(params)}`),
  libraryFilters: () => req('/library/filters'),
  album: (id) => req(`/albums/${id}`),
  dupGroup: (id) => req(`/albums/${id}/dup-group`),
  albumState: (id, state) => req(`/albums/${id}/state`, { method: 'POST', body: { state } }),
  dismissed: () => req('/dismissed'),
  restoreAlbum: (id) => req(`/albums/${id}/restore`, { method: 'POST' }),
  deleteAlbum: (id) => req(`/albums/${id}/delete`, { method: 'POST', body: { confirm: true } }),
  refileAlbum: (id) => req(`/albums/${id}/refile`, { method: 'POST', body: { confirm: true } }),
  candidates: (id) => req(`/albums/${id}/candidates`),
  match: (id, rg_mbid) => req(`/albums/${id}/match`, { method: 'POST', body: { rg_mbid } }),
  mbReleaseGroups: (q, artist) =>
    req(`/mb/release-groups?q=${encodeURIComponent(q)}${artist ? `&artist=${encodeURIComponent(artist)}` : ''}`),
  identifyAlbum: (id) => req(`/albums/${id}/identify`, { method: 'POST' }),
  lidarrReleases: (id) => req(`/albums/${id}/lidarr-releases`),
  lidarrGrab: (guid, indexerId) => req('/lidarr/grab', { method: 'POST', body: { guid, indexerId } }),

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
  lidarrAddStatus: () => req('/lidarr/add/status'),
  // búsqueda unificada: usa el motor elegido en Ajustes (Prowlarr | Jackett). Toda la
  // UI pasa por aquí; no llamar a Prowlarr directo (se saltaría el selector de motor).
  search: (q) => req(`/search?q=${encodeURIComponent(q)}`),
  searchGrab: (item) => req('/search/grab', { method: 'POST', body: item }),
  importsPending: () => req('/imports/pending'),
  importRun: (sourceDir, override = {}) => req('/imports/run', { method: 'POST', body: { sourceDir, ...override } }),
  downloads: () => req('/downloads'),
  autoImportRun: () => req('/imports/auto-run', { method: 'POST' }),
  autograb: () => req('/autograb'),
  autograbRun: (dryRun) => req('/autograb/run', { method: 'POST', body: { dryRun } }),
  grabBest: (query, context) => req('/grab-best', { method: 'POST', body: { query, context } }),
  lidarrEnabled: () => req('/lidarr/enabled'),

  // fase 2 — la caza
  tracked: () => req('/tracked'),
  suggestions: () => req('/tracked/suggestions'),
  follow: (id, facet) => req(`/tracked/${id}`, { method: 'POST', body: { facet } }),
  unfollow: (id, facet = 'artist') => req(`/tracked/${id}?facet=${facet}`, { method: 'DELETE' }),
  followMbid: (mbid, facet) => req('/tracked/by-mbid', { method: 'POST', body: { mbid, facet } }),
  searchArtistMb: (q) => req(`/artists/search-mb?q=${encodeURIComponent(q)}`),
  setArtistMbid: (id, mbid) => req(`/artists/${id}/mbid`, { method: 'PUT', body: { mbid } }),
  refreshArtistDisco: (id) => req(`/artists/${id}/refresh-discography`, { method: 'POST' }),
  discographyRefresh: (onlyTracked) => req('/discography/refresh', { method: 'POST', body: { onlyTracked } }),
  discographyStatus: () => req('/discography/status'),
  gaps: (all) => req(`/discover/gaps${all ? '?all=1' : ''}`),
  upcoming: (all) => req(`/discover/upcoming${all ? '?all=1' : ''}`),
  recentReleases: (since, all) => {
    const p = new URLSearchParams();
    if (since) p.set('since', since);
    if (all) p.set('all', '1');
    const qs = p.toString();
    return req(`/discover/recent${qs ? `?${qs}` : ''}`);
  },
  dismiss: (rg_mbid, title) => req('/discover/dismiss', { method: 'POST', body: { rg_mbid, title } }),

  // sellos seguidos (0.6 fase 2)
  trackedLabels: () => req('/tracked-labels'),
  searchLabels: (q) => req(`/tracked-labels/search?q=${encodeURIComponent(q)}`),
  followLabel: (label) => req('/tracked-labels', { method: 'POST', body: label }),
  unfollowLabel: (mbid) => req(`/tracked-labels/${encodeURIComponent(mbid)}`, { method: 'DELETE' }),
  refreshLabel: (mbid) => req(`/tracked-labels/${encodeURIComponent(mbid)}/refresh`, { method: 'POST' }),
  labelReleases: (since) => req(`/tracked-labels/releases${since ? `?since=${since}` : ''}`),

  // radar de curadores / Bandcamp (0.6 fase 3)
  curators: () => req('/curators'),
  followCurator: (username) => req('/curators', { method: 'POST', body: { username } }),
  unfollowCurator: (id) => req(`/curators/${id}`, { method: 'DELETE' }),
  refreshCurator: (id) => req(`/curators/${id}/refresh`, { method: 'POST' }),
  radar: (since, unowned) => {
    const p = new URLSearchParams();
    if (since) p.set('since', since);
    if (unowned) p.set('unowned', '1');
    const qs = p.toString();
    return req(`/radar${qs ? `?${qs}` : ''}`);
  },
  radarResolve: (id) => req(`/radar/${id}/resolve`, { method: 'POST' }),
  radarDismiss: (id) => req(`/radar/${id}/dismiss`, { method: 'POST' }),
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
  importChallengeUrl: (url, name) => req('/challenges/import', { method: 'POST', body: { url, name } }),
  challenge: (id) => req(`/challenges/${id}`),
  deleteChallenge: (id) => req(`/challenges/${id}`, { method: 'DELETE' }),
  challengeToLidarr: (id) => req(`/challenges/${id}/radarr`, { method: 'POST' }),
  lidarrAddByName: (artist, album) => req('/lidarr/add-by-name', { method: 'POST', body: { artist, album } }),

  // fase 4 — refinado
  editions: (id) => req(`/albums/${id}/editions`),
  albumCredits: (id) => req(`/albums/${id}/credits`),
  relations: (id) => req(`/artists/${id}/relations`),
  upgrades: () => req('/quality/upgrades'),
  labels: () => req('/labels'),
  label: (name) => req(`/labels/${encodeURIComponent(name)}`),
  labelCompletism: (name) => req(`/labels/${encodeURIComponent(name)}/completism`),
  followLabelByName: (name) => req(`/labels/${encodeURIComponent(name)}/follow`, { method: 'POST' }),
  setArtistScope: (id, scope) => req(`/artists/${id}/scope`, { method: 'POST', body: { scope } }),
  artistNames: () => req('/artists/names'),
  setAlbumArtist: (id, name) => req(`/albums/${id}/artist`, { method: 'PUT', body: { name } }),
  setAlbumArtists: (id, artists) => req(`/albums/${id}/artists`, { method: 'PUT', body: { artists } }),
  setAlbumTitle: (id, title) => req(`/albums/${id}/title`, { method: 'PUT', body: { title } }),
  resolveAlbumLabel: (id) => req(`/albums/${id}/label`),
  coverCandidates: (id, q) => req(`/cover/${id}/candidates${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  applyCover: (id, body) => req(`/cover/${id}/apply`, { method: 'POST', body }),
  corrections: () => req('/corrections'),
  refileAllCorrections: () => req('/corrections/refile-all', { method: 'POST' }),
  tagPreview: (id) => req(`/albums/${id}/tag-preview`),
  writeTags: (id) => req(`/albums/${id}/write-tags`, { method: 'POST' }),
};

export const coverUrl = (id) => `/api/cover/${id}`;

// Sondea la cola de envío a Lidarr (que corre en segundo plano) hasta que termina,
// llamando a onUpdate(status) en cada paso. Devuelve una función para cancelar.
export function pollLidarrQueue(onUpdate) {
  let alive = true;
  const tick = async () => {
    if (!alive) return;
    const s = await api.lidarrAddStatus().catch(() => null);
    if (!alive) return;
    if (s) onUpdate(s);
    if (s?.running) setTimeout(tick, 2500);
  };
  tick();
  return () => {
    alive = false;
  };
}

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
