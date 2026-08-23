// Sembrado del editor de releases de MusicBrainz desde el navegador.
//
// MusicBrainz no tiene API de escritura: se crea un release con un POST de formulario a
// /release/add que el usuario revisa y confirma en SU sesión de MB. Por eso el POST sale
// del navegador (no del servidor): construimos un <form target="_blank"> con un input
// oculto por campo y lo enviamos. Los campos los da el servidor (buildReleaseSeed); aquí
// solo añadimos el redirect_uri, que MB usa para devolver al usuario a Liderarr con el
// release_mbid recién creado.
//
// Verificado en el código de MB (y en el Rellenator): MB añade `&release_mbid=` al
// redirect_uri respetando el query string existente, así que llevar `?album=` es seguro.

const MB_ADD_URL = 'https://musicbrainz.org/release/add';

// seed: dict plano { campo: valor | [valores] }. Los arrays se emiten como varios inputs
// con el mismo name (así MB recibe p. ej. varios `type`).
export function openMbReleaseEditor(seed, albumId) {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = MB_ADD_URL;
  form.target = '_blank';
  form.style.display = 'none';
  form.rel = 'noopener';

  const addField = (name, value) => {
    if (value == null || value === '') return;
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = String(value);
    form.appendChild(input);
  };

  for (const [name, value] of Object.entries(seed || {})) {
    if (Array.isArray(value)) value.forEach((v) => addField(name, v));
    else addField(name, value);
  }

  // Vuelta a Liderarr tras crear el release: la página /mb-nueva enlaza el álbum y ofrece
  // subir la portada. location.origin funciona tanto en dev (Vite) como en producción.
  addField('redirect_uri', `${window.location.origin}/mb-nueva?album=${albumId}`);

  document.body.appendChild(form);
  form.submit();
  form.remove();
}
