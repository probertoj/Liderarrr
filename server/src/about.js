import { db } from './db.js';
import * as lastfm from './lastfm.js';
import { releaseRating, discogsConfigured } from './discogs.js';

// «Sobre el disco» (estilo Roon): reseña/descripción + valoración de la comunidad.
// - Reseña: wiki de álbum de Last.fm; si no hay, bio del artista (CC-BY-SA). Texto plano.
// - Valoración: media de la comunidad de Discogs (sobre 5) + nº de votos.
// Bajo demanda desde la ficha; ambas fuentes son opcionales (degradan si no hay clave).
export async function albumAbout(albumId) {
  const a = db
    .prepare('SELECT a.title, a.album_artist, ar.name AS artist FROM albums a LEFT JOIN artists ar ON ar.id = a.artist_id WHERE a.id = ?')
    .get(albumId);
  if (!a) throw new Error('Álbum no encontrado');
  // para splits, album_artist es "A / B": para buscar en Last.fm/Discogs conviene el
  // artista PRINCIPAL (ar.name), con album_artist como respaldo.
  const artist = a.artist || a.album_artist || '';

  let review = null;
  if (lastfm.lastfmConfigured()) {
    const info = await lastfm.albumInfo(artist, a.title).catch(() => null);
    if (info?.wiki) {
      review = { text: info.wiki, source: 'Last.fm', url: info.url, about: 'album' };
    } else {
      const ai = await lastfm.artistInfo(artist).catch(() => null);
      if (ai?.bio) review = { text: ai.bio, source: 'Last.fm', url: ai.url, about: 'artist' };
    }
  }

  let rating = null;
  if (discogsConfigured()) rating = await releaseRating(artist, a.title).catch(() => null);

  return {
    review,
    rating,
    lastfm: lastfm.lastfmConfigured(),
    discogs: discogsConfigured(),
  };
}
