// Página de inicio: pide la fecha de nacimiento, muestra la edad calculada
// y crea la aplicación anónima.

const formulario = document.getElementById('form-inicio');
const campoFecha = document.getElementById('fecha-nacimiento');
const textoEdad = document.getElementById('edad-calculada');
const casillaPrematuro = document.getElementById('prematuro');
const contenedorSemanas = document.getElementById('campo-semanas');
const campoSemanas = document.getElementById('semanas-gestacion');
const textoError = document.getElementById('error-inicio');
const botonComenzar = document.getElementById('boton-comenzar');

const EDAD_MINIMA = 16;
const EDAD_MAXIMA = 30;

/** Fecha de hoy en texto 'AAAA-MM-DD' (hora local). */
function fechaHoy() {
  const hoy = new Date();
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
}

/** Meses cumplidos entre dos fechas 'AAAA-MM-DD' (mismo cálculo que el servidor). */
function calcularEdadMeses(fechaNacimiento, fechaReferencia) {
  const [anio1, mes1, dia1] = fechaNacimiento.split('-').map(Number);
  const [anio2, mes2, dia2] = fechaReferencia.split('-').map(Number);
  let meses = (anio2 - anio1) * 12 + (mes2 - mes1);
  if (dia2 < dia1) meses -= 1;
  return meses;
}

/** "1 año 8 meses (20 meses)" */
function describirEdad(meses) {
  const anios = Math.floor(meses / 12);
  const resto = meses % 12;
  const partes = [];
  if (anios > 0) partes.push(`${anios} ${anios === 1 ? 'año' : 'años'}`);
  if (resto > 0 || anios === 0) partes.push(`${resto} ${resto === 1 ? 'mes' : 'meses'}`);
  return `${partes.join(' ')} (${meses} meses)`;
}

/** Devuelve la edad en meses de la fecha escrita, o null si la fecha no es válida. */
function edadSeleccionada() {
  const fecha = campoFecha.value; // el navegador la entrega como 'AAAA-MM-DD'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || fecha > fechaHoy()) return null;
  return calcularEdadMeses(fecha, fechaHoy());
}

// No se pueden elegir fechas futuras
campoFecha.max = fechaHoy();

// Mostrar la edad calculada mientras escribe, para que pueda confirmarla
function actualizarEdad() {
  const edad = edadSeleccionada();
  textoEdad.textContent = edad === null ? '' : `Edad: ${describirEdad(edad)}`;
}
campoFecha.addEventListener('input', actualizarEdad);
campoFecha.addEventListener('change', actualizarEdad); // algunos navegadores solo lanzan "change"

// Si el padre viene desde la tarjeta de un hijo en su panel, la fecha ya se conoce
const ninoDestino = JSON.parse(sessionStorage.getItem(CLAVE_NINO_CUESTIONARIO) || 'null');
if (ninoDestino) {
  campoFecha.value = ninoDestino.fecha_nacimiento;
  actualizarEdad();
}

// Mostrar u ocultar el campo de semanas según la casilla de prematuro
casillaPrematuro.addEventListener('change', () => {
  contenedorSemanas.classList.toggle('oculto', !casillaPrematuro.checked);
  if (!casillaPrematuro.checked) campoSemanas.value = '';
});

/** Devuelve el número entero escrito en un campo, o null si no es un entero. */
function leerEntero(campo) {
  const texto = campo.value.trim();
  return /^\d+$/.test(texto) ? Number(texto) : null;
}

function mostrarError(mensaje, campo) {
  textoError.textContent = mensaje;
  if (campo) {
    campo.setAttribute('aria-invalid', 'true');
    campo.focus();
  }
}

formulario.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  textoError.textContent = '';
  campoFecha.removeAttribute('aria-invalid');
  campoSemanas.removeAttribute('aria-invalid');

  // 1. Validar la fecha y la edad (el servidor las vuelve a validar)
  const edad = edadSeleccionada();
  if (edad === null) {
    mostrarError('Escribe una fecha de nacimiento válida.', campoFecha);
    return;
  }
  if (edad < EDAD_MINIMA || edad > EDAD_MAXIMA) {
    mostrarError(
      `Tu hijo o hija tiene ${describirEdad(edad)}. Este cuestionario está pensado para niños de ` +
      `${EDAD_MINIMA} a ${EDAD_MAXIMA} meses. Si tienes dudas sobre su desarrollo, consulta a su pediatra.`,
      campoFecha
    );
    return;
  }

  // 2. Validar semanas de gestación solo si marcó "prematuro"
  let semanas = null;
  if (casillaPrematuro.checked) {
    semanas = leerEntero(campoSemanas);
    if (semanas === null || semanas < 22 || semanas > 36) {
      mostrarError('Escribe las semanas de embarazo al nacer: un número entre 22 y 36.', campoSemanas);
      return;
    }
  }

  // Si cambió la fecha a una que no es la del hijo elegido, se olvida esa preselección
  if (ninoDestino && campoFecha.value !== ninoDestino.fecha_nacimiento) {
    sessionStorage.removeItem(CLAVE_NINO_CUESTIONARIO);
  }

  // 3. Crear la aplicación anónima en el servidor (calcula y guarda solo la edad)
  botonComenzar.disabled = true;
  try {
    const datos = await llamarApi('POST', '/api/aplicaciones', {
      fecha_nacimiento: campoFecha.value,
      semanas_gestacion: semanas,
    });
    // Se guarda en sessionStorage para continuar el cuestionario y, después, vincularlo
    sessionStorage.setItem(CLAVE_APLICACION, datos.id_aplicacion);
    window.location.href = '/cuestionario.html';
  } catch (err) {
    mostrarError(err.message);
    botonComenzar.disabled = false;
  }
});
