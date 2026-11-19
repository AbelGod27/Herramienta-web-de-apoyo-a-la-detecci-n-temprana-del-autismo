// Página de resultado: muestra el nivel de riesgo (ícono + texto) y la recomendación.
// Sirve para dos casos:
//  - Cuestionario anónimo recién terminado (el id está en sessionStorage).
//  - Cuestionario ya guardado de un hijo (el id llega en la URL: resultado.html?id=...).

const idEnUrl = new URLSearchParams(window.location.search).get('id');
const idAplicacion = idEnUrl || sessionStorage.getItem(CLAVE_APLICACION);

const cargando = document.getElementById('cargando');
const errorResultado = document.getElementById('error-resultado');

/** Convierte una fecha ISO en texto legible en español. */
function formatearFecha(fechaIso) {
  return new Date(fechaIso).toLocaleString('es-MX', {
    timeZone: 'America/Mexico_City',
    dateStyle: 'long',
    timeStyle: 'short',
  });
}

function mostrarDato(idEtiqueta, idValor, texto) {
  document.getElementById(idValor).textContent = texto;
  document.getElementById(idEtiqueta).classList.remove('oculto');
  document.getElementById(idValor).classList.remove('oculto');
}

function mostrarResultado(datos) {
  const clave = claveNivel(datos.nivel);

  // Nivel: clase de color + ícono + texto
  document.getElementById('nivel').classList.add(`nivel-${clave}`);
  document.getElementById('nivel-icono').innerHTML = ICONOS_NIVEL[clave]; // SVG fijo de iconos.js
  document.getElementById('nivel-texto').textContent = `Riesgo ${datos.nivel}`;

  // textContent (no innerHTML) para los datos que vienen del servidor
  document.getElementById('puntaje').textContent =
    `${datos.puntaje_total} de ${datos.total_preguntas} respuestas indican una posible señal de alerta.`;
  document.getElementById('recomendacion').textContent = datos.recomendacion;

  if (datos.nombre_nino) mostrarDato('etiqueta-nino', 'dato-nino', datos.nombre_nino);
  document.getElementById('dato-edad').textContent = `${datos.edad_meses} meses`;
  document.getElementById('dato-fecha').textContent = formatearFecha(datos.fecha_fin);
  if (datos.semanas_gestacion) {
    mostrarDato('etiqueta-semanas', 'dato-semanas', `${datos.semanas_gestacion} semanas de embarazo`);
  }

  mostrarRespuestas(datos.respuestas);

  cargando.classList.add('oculto');
  document.getElementById('resultado').classList.remove('oculto');
}

/** Lista cada pregunta con la respuesta (Sí/No) y, si suma al puntaje, una marca con ícono + texto. */
function mostrarRespuestas(respuestas) {
  const lista = document.getElementById('lista-respuestas');
  lista.textContent = '';

  for (const r of respuestas) {
    const item = document.createElement('li');
    item.className = r.es_riesgo ? 'respuesta respuesta-alerta' : 'respuesta';

    const pregunta = document.createElement('p');
    pregunta.className = 'respuesta-pregunta';
    pregunta.textContent = `${r.numero}. ${r.texto}`;

    const valor = document.createElement('p');
    valor.className = 'respuesta-valor';
    valor.textContent = `Respuesta: ${r.valor ? 'Sí' : 'No'}`;

    item.append(pregunta, valor);

    if (r.es_riesgo) {
      const alerta = document.createElement('span');
      alerta.className = 'etiqueta-nivel nivel-medio';
      const icono = document.createElement('span');
      icono.className = 'icono-nivel';
      icono.setAttribute('aria-hidden', 'true');
      icono.innerHTML = ICONOS_NIVEL.medio; // triángulo de advertencia (SVG fijo)
      const texto = document.createElement('span');
      texto.textContent = 'Posible señal de alerta';
      alerta.append(icono, texto);
      item.append(alerta);
    }

    lista.append(item);
  }
}

/** Ajusta los botones según haya sesión de padre o no. */
async function ajustarBotones() {
  const usuario = await obtenerSesion();
  if (usuario && usuario.rol === 'padre') {
    // Con sesión, el seguimiento se gestiona desde su panel
    document.getElementById('boton-seguimiento').href = '/padre.html';
  }
  if (idEnUrl) {
    // Resultado guardado de un hijo: volver al panel (del padre o del psicólogo) en lugar de "contestar otro"
    const volver = document.getElementById('boton-nuevo');
    volver.textContent = 'Volver a mi panel';
    volver.href = usuario ? rutaPanel(usuario.rol) : '/padre.html';
  }
  if (usuario && usuario.rol === 'psicologo') {
    // El psicólogo consulta el resultado; pedir una entrevista no aplica para él
    document.getElementById('boton-seguimiento').classList.add('oculto');
  }
}

document.getElementById('boton-imprimir').addEventListener('click', () => window.print());

// Al empezar otro cuestionario se olvida la aplicación anónima actual
document.getElementById('boton-nuevo').addEventListener('click', () => {
  if (!idEnUrl) sessionStorage.removeItem(CLAVE_APLICACION);
});

async function iniciar() {
  if (!idAplicacion) {
    cargando.classList.add('oculto');
    errorResultado.textContent = 'No hay un cuestionario reciente en esta pestaña. Vuelve al inicio para contestar uno.';
    return;
  }
  try {
    const datos = await llamarApi('GET', `/api/aplicaciones/${encodeURIComponent(idAplicacion)}/resultado`);
    mostrarResultado(datos);
    await ajustarBotones();
  } catch (err) {
    cargando.classList.add('oculto');
    if (err.estado === 409 && !idEnUrl) {
      // Aún no termina: regresar al cuestionario
      window.location.replace('/cuestionario.html');
      return;
    }
    errorResultado.textContent = err.message;
  }
}

iniciar();
