// Página del cuestionario: muestra una pregunta por pantalla, guarda cada
// respuesta en el servidor y al final pide calcular el resultado.

const idAplicacion = sessionStorage.getItem(CLAVE_APLICACION);
if (!idAplicacion) {
  // Sin aplicación creada no se puede contestar: volver al inicio
  window.location.replace('/');
}

const formulario = document.getElementById('form-pregunta');
const textoPregunta = document.getElementById('texto-pregunta');
const ejemploPregunta = document.getElementById('ejemplo-pregunta');
const textoProgreso = document.getElementById('progreso-texto');
const barraProgreso = document.getElementById('barra-progreso');
const botonAnterior = document.getElementById('boton-anterior');
const botonSiguiente = document.getElementById('boton-siguiente');
const errorPregunta = document.getElementById('error-pregunta');
const errorGeneral = document.getElementById('error-general');

let preguntas = [];
let indice = 0; // posición de la pregunta que se muestra

// Respuestas ya contestadas { id_pregunta: true/false }.
// Se guardan también en sessionStorage para no perderlas si se recarga la página.
const respuestas = JSON.parse(sessionStorage.getItem(claveRespuestas(idAplicacion)) || '{}');

function guardarRespuestasLocales() {
  sessionStorage.setItem(claveRespuestas(idAplicacion), JSON.stringify(respuestas));
}

/** Pinta en pantalla la pregunta actual. */
function mostrarPregunta() {
  const pregunta = preguntas[indice];
  const total = preguntas.length;

  textoPregunta.textContent = `${pregunta.numero}. ${pregunta.texto}`;
  ejemploPregunta.textContent = pregunta.ejemplo || '';
  ejemploPregunta.classList.toggle('oculto', !pregunta.ejemplo);

  textoProgreso.textContent = `Pregunta ${indice + 1} de ${total}`;
  barraProgreso.max = total;
  barraProgreso.value = indice + 1;

  // Marcar la respuesta si ya se había contestado
  const valor = respuestas[pregunta.id_pregunta];
  for (const opcion of formulario.respuesta) {
    opcion.checked = (opcion.value === 'si' && valor === true) || (opcion.value === 'no' && valor === false);
  }

  botonAnterior.disabled = indice === 0;
  botonSiguiente.textContent = indice === total - 1 ? 'Ver resultado' : 'Siguiente';
  errorPregunta.textContent = '';

  // Llevar el foco a la pregunta para lectores de pantalla
  textoPregunta.focus();
}

/** Calcula el resultado en el servidor y pasa a la página de resultado. */
async function finalizar() {
  await llamarApi('POST', `/api/aplicaciones/${idAplicacion}/finalizar`);
  sessionStorage.removeItem(claveRespuestas(idAplicacion));
  window.location.href = '/resultado.html';
}

formulario.addEventListener('submit', async (evento) => {
  evento.preventDefault();

  const seleccion = formulario.respuesta.value;
  if (!seleccion) {
    errorPregunta.textContent = 'Elige "Sí" o "No" para continuar.';
    return;
  }

  const pregunta = preguntas[indice];
  const valor = seleccion === 'si';
  botonSiguiente.disabled = true;

  try {
    // Guardar la respuesta en el servidor
    await llamarApi('PUT', `/api/aplicaciones/${idAplicacion}/respuestas`, {
      respuestas: [{ id_pregunta: pregunta.id_pregunta, valor }],
    });
    respuestas[pregunta.id_pregunta] = valor;
    guardarRespuestasLocales();

    if (indice < preguntas.length - 1) {
      indice += 1;
      mostrarPregunta();
    } else {
      await finalizar();
    }
  } catch (err) {
    if (err.estado === 409) {
      // El cuestionario ya estaba terminado (por ejemplo, en otra pestaña)
      window.location.href = '/resultado.html';
      return;
    }
    errorPregunta.textContent = err.message;
  } finally {
    botonSiguiente.disabled = false;
  }
});

botonAnterior.addEventListener('click', () => {
  if (indice > 0) {
    indice -= 1;
    mostrarPregunta();
  }
});

/** Carga las preguntas y continúa en la primera sin contestar. */
async function iniciar() {
  try {
    preguntas = await llamarApi('GET', '/api/preguntas');
    if (preguntas.length === 0) {
      errorGeneral.textContent = 'El cuestionario no está disponible por el momento.';
      return;
    }
    const primeraSinResponder = preguntas.findIndex((p) => !(p.id_pregunta in respuestas));
    indice = primeraSinResponder === -1 ? preguntas.length - 1 : primeraSinResponder;

    formulario.classList.remove('oculto');
    mostrarPregunta();
  } catch (err) {
    errorGeneral.textContent = err.message;
  }
}

if (idAplicacion) iniciar();
