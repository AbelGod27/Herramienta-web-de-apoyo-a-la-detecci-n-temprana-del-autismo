// Panel del padre o tutor: hijos, historial de cuestionarios, vinculación del cuestionario anónimo
// y citas de seguimiento con un psicólogo.

const mensajeGeneral = document.getElementById('mensaje-general');
const listaHijos = document.getElementById('lista-hijos');
const sinHijos = document.getElementById('sin-hijos');
const errorHijos = document.getElementById('error-hijos');

const seccionVincular = document.getElementById('seccion-vincular');
const formVincular = document.getElementById('form-vincular');
const selectVincular = document.getElementById('nino-vincular');
const errorVincular = document.getElementById('error-vincular');

const seccionRegistrar = document.getElementById('seccion-registrar');
const tituloRegistrar = document.getElementById('titulo-registrar');
const botonAgregarHijo = document.getElementById('boton-agregar-hijo');
const botonCancelarHijo = document.getElementById('boton-cancelar-hijo');
const formNino = document.getElementById('form-nino');
const errorNino = document.getElementById('error-nino');
const casillaPrematuro = document.getElementById('prematuro-nino');
const campoSemanas = document.getElementById('campo-semanas-nino');

let hijos = [];
let citas = []; // citas de todos mis hijos
let aplicacionPendiente = null; // resultado anónimo terminado y sin vincular

/** Fecha y hora legibles en español (zona de la Ciudad de México). */
function formatearFecha(fechaIso) {
  return new Date(fechaIso).toLocaleDateString('es-MX', {
    timeZone: 'America/Mexico_City',
    dateStyle: 'long',
  });
}

/** Texto de edad: "1 año 8 meses (20 meses)". */
function textoEdad(meses) {
  const anios = Math.floor(meses / 12);
  const resto = meses % 12;
  const partes = [];
  if (anios > 0) partes.push(`${anios} ${anios === 1 ? 'año' : 'años'}`);
  if (resto > 0 || anios === 0) partes.push(`${resto} ${resto === 1 ? 'mes' : 'meses'}`);
  return `${partes.join(' ')} (${meses} meses)`;
}

/** Crea un elemento con clase y texto (siempre con textContent para evitar inyección de HTML). */
function crear(etiqueta, clase, texto) {
  const elemento = document.createElement(etiqueta);
  if (clase) elemento.className = clase;
  if (texto !== undefined) elemento.textContent = texto;
  return elemento;
}

// ---------- Hijos e historial ----------

async function cargarHistorial(nino, contenedor) {
  contenedor.textContent = 'Cargando…';
  try {
    const aplicaciones = await llamarApi('GET', `/api/ninos/${nino.id_nino}/aplicaciones`);
    contenedor.textContent = '';
    if (aplicaciones.length === 0) {
      contenedor.append(crear('p', null, 'Aún no hay cuestionarios guardados.'));
      return;
    }
    const lista = crear('ul', 'lista-historial');
    for (const a of aplicaciones) {
      const item = crear('li');
      const enlace = crear('a', null, 'Ver resultado');
      enlace.href = `/resultado.html?id=${encodeURIComponent(a.id_aplicacion)}`;

      item.append(
        crear('span', null, `${formatearFecha(a.fecha_fin)} · ${a.edad_meses} meses`),
        crearEtiquetaNivel(a.nivel), // ícono + texto
        crear('span', null, `${a.puntaje_total} puntos`),
        enlace
      );
      lista.append(item);
    }
    contenedor.append(lista);
  } catch (err) {
    contenedor.textContent = err.message;
  }
}

// Rango de edad del cuestionario y edad sugerida para repetirlo
const EDAD_MINIMA = 16;
const EDAD_MAXIMA = 30;
const EDAD_REPETIR = 24;

/** Empieza el cuestionario para un hijo concreto: la edad se llena sola y al volver se preselecciona. */
function contestarPara(nino) {
  sessionStorage.removeItem(CLAVE_APLICACION);
  sessionStorage.setItem(
    CLAVE_NINO_CUESTIONARIO,
    JSON.stringify({ id_nino: nino.id_nino, fecha_nacimiento: nino.fecha_nacimiento })
  );
  window.location.href = '/';
}

/**
 * Nota sobre el cuestionario según la edad del hijo (o null si no hace falta).
 * Solo se ofrece contestarlo si está en la edad del instrumento (16 a 30 meses).
 */
function notaCuestionario(nino) {
  if (nino.edad_meses < EDAD_MINIMA) {
    return `Podrá contestar el cuestionario a partir de los ${EDAD_MINIMA} meses.`;
  }
  if (nino.edad_meses > EDAD_MAXIMA) {
    return `Ya no está en la edad del cuestionario (${EDAD_MINIMA} a ${EDAD_MAXIMA} meses). ` +
      'Si tienes dudas sobre su desarrollo, consulta a un profesional de la salud.';
  }
  // Sugerencia: si el último se hizo antes de los 24 meses y ya los cumplió
  if (nino.total_cuestionarios > 0 && nino.edad_ultimo_cuestionario < EDAD_REPETIR && nino.edad_meses >= EDAD_REPETIR) {
    return `Se recomienda repetirlo a los ${EDAD_REPETIR} meses.`;
  }
  return null;
}

/** Botón para contestar el cuestionario, o null si el hijo no está en la edad. */
function crearBotonCuestionario(nino) {
  if (nino.edad_meses < EDAD_MINIMA || nino.edad_meses > EDAD_MAXIMA) return null;

  const primeraVez = nino.total_cuestionarios === 0;
  const boton = crear(
    'button',
    primeraVez ? 'boton boton-primario' : 'boton boton-secundario',
    primeraVez ? 'Contestar el cuestionario' : 'Contestar de nuevo'
  );
  boton.type = 'button';
  boton.addEventListener('click', () => contestarPara(nino));
  return boton;
}

/** Botón que despliega u oculta el historial (solo si ya hay cuestionarios guardados). */
function crearBotonHistorial(nino, historial) {
  if (nino.total_cuestionarios === 0) return null;

  const boton = crear('button', 'boton boton-secundario');
  boton.type = 'button';
  boton.setAttribute('aria-expanded', 'false');

  const texto = crear('span', null, 'Ver historial');
  const flecha = crear('span', 'flecha', '▾'); // decorativa; el estado lo anuncia aria-expanded
  flecha.setAttribute('aria-hidden', 'true');
  boton.append(texto, flecha);

  boton.addEventListener('click', () => {
    const abrir = historial.classList.contains('oculto');
    historial.classList.toggle('oculto', !abrir);
    boton.setAttribute('aria-expanded', String(abrir));
    texto.textContent = abrir ? 'Ocultar historial' : 'Ver historial';
    flecha.textContent = abrir ? '▴' : '▾';
    if (abrir) cargarHistorial(nino, historial);
  });
  return boton;
}

function pintarHijos() {
  listaHijos.textContent = '';
  sinHijos.classList.toggle('oculto', hijos.length > 0);

  for (const nino of hijos) {
    const item = crear('li', 'hijo');
    const total = nino.total_cuestionarios;
    item.append(
      crear('h3', null, nino.nombre),
      crear('p', 'hijo-datos', `${textoEdad(nino.edad_meses)} · ${total} ${total === 1 ? 'cuestionario' : 'cuestionarios'}`)
    );

    const nota = notaCuestionario(nino);
    if (nota) item.append(crear('p', 'ayuda', nota));

    // Si su último cuestionario ya tiene una cita activa, se indica en la tarjeta
    const citaActiva = citaActivaDe(nino);
    if (citaActiva) {
      item.append(crear(
        'p',
        'ayuda',
        `Cita ${citaActiva.estado} el ${formatearFechaCita(citaActiva.fecha)} a las ${citaActiva.hora_inicio}.`
      ));
    }

    // Acciones del hijo, juntas en una fila del mismo tamaño
    const historial = crear('div', 'historial oculto');
    const acciones = crear('div', 'acciones-hijo');
    for (const boton of [crearBotonCuestionario(nino), crearBotonHistorial(nino, historial), crearBotonCita(nino)]) {
      if (boton) acciones.append(boton);
    }
    if (acciones.children.length > 0) item.append(acciones);

    item.append(historial);
    listaHijos.append(item);
  }

  // Opciones del selector de vinculación
  selectVincular.textContent = '';
  selectVincular.append(new Option('Elige a tu hijo o hija', ''));
  for (const nino of hijos) {
    selectVincular.append(new Option(`${nino.nombre} – ${nino.edad_meses} meses`, nino.id_nino));
  }
}

async function cargarHijos() {
  try {
    hijos = await llamarApi('GET', '/api/ninos');
    pintarHijos();
    mostrarFormularioHijo(false);
  } catch (err) {
    errorHijos.textContent = err.message;
  }
}

// ---------- Vinculación del cuestionario anónimo ----------

async function revisarPendiente() {
  const idAplicacion = sessionStorage.getItem(CLAVE_APLICACION);
  if (!idAplicacion) return;

  try {
    aplicacionPendiente = await llamarApi('GET', `/api/aplicaciones/${idAplicacion}/resultado`);
  } catch (err) {
    // 403: ya estaba vinculada; 404: ya no existe. En ambos casos se olvida.
    // 409: aún no termina; se conserva para que pueda terminarlo.
    if (err.estado !== 409) {
      sessionStorage.removeItem(CLAVE_APLICACION);
      sessionStorage.removeItem(CLAVE_NINO_CUESTIONARIO);
    }
    return;
  }

  if (aplicacionPendiente.id_nino) {
    sessionStorage.removeItem(CLAVE_APLICACION);
    sessionStorage.removeItem(CLAVE_NINO_CUESTIONARIO);
    aplicacionPendiente = null;
    return;
  }

  // Si empezó el cuestionario desde la tarjeta de un hijo, dejarlo preseleccionado
  const destino = JSON.parse(sessionStorage.getItem(CLAVE_NINO_CUESTIONARIO) || 'null');
  if (destino && hijos.some((h) => h.id_nino === destino.id_nino)) {
    selectVincular.value = String(destino.id_nino);
  }

  document.getElementById('texto-pendiente').textContent =
    `Contestaste un cuestionario el ${formatearFecha(aplicacionPendiente.fecha_fin)} ` +
    `para un niño de ${aplicacionPendiente.edad_meses} meses (resultado: riesgo ${aplicacionPendiente.nivel}). ` +
    'Guárdalo en el perfil de tu hijo o hija para consultarlo después y pedir una cita.';
  seccionVincular.classList.remove('oculto');
}

formVincular.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  errorVincular.textContent = '';
  const idNino = Number(selectVincular.value);
  if (!idNino) {
    errorVincular.textContent = 'Elige a tu hijo o hija';
    selectVincular.focus();
    return;
  }

  try {
    await llamarApi('POST', `/api/aplicaciones/${aplicacionPendiente.id_aplicacion}/vincular`, { id_nino: idNino });
    sessionStorage.removeItem(CLAVE_APLICACION);
    sessionStorage.removeItem(CLAVE_NINO_CUESTIONARIO);
    aplicacionPendiente = null;
    seccionVincular.classList.add('oculto');
    mensajeGeneral.textContent = 'El cuestionario se guardó en el perfil de tu hijo o hija.';
    await cargarHijos();
  } catch (err) {
    errorVincular.textContent = err.message;
  }
});

// ---------- Registro de hijos ----------

/**
 * Muestra u oculta el formulario de registro de hijos.
 * - Sin hijos: siempre abierto (es lo primero que hay que hacer) y sin botón "Cancelar".
 * - Con hijos: cerrado; se abre con el botón "+ Agregar hijo".
 */
function mostrarFormularioHijo(abrir) {
  const tieneHijos = hijos.length > 0;
  const visible = !tieneHijos || abrir;

  seccionRegistrar.classList.toggle('oculto', !visible);
  botonAgregarHijo.classList.toggle('oculto', !tieneHijos || visible);
  botonAgregarHijo.setAttribute('aria-expanded', String(visible));
  botonCancelarHijo.classList.toggle('oculto', !tieneHijos);
  tituloRegistrar.textContent = tieneHijos ? 'Registrar a otro hijo o hija' : 'Registra a tu hijo o hija';

  if (!visible) {
    formNino.reset();
    campoSemanas.classList.add('oculto');
    errorNino.textContent = '';
  }
}

function abrirFormularioHijo() {
  mostrarFormularioHijo(true);
  tituloRegistrar.focus(); // lleva la vista y el foco al formulario
}

botonAgregarHijo.addEventListener('click', abrirFormularioHijo);
document.getElementById('boton-registrar-desde-vincular').addEventListener('click', abrirFormularioHijo);

botonCancelarHijo.addEventListener('click', () => {
  mostrarFormularioHijo(false);
  botonAgregarHijo.focus();
});

casillaPrematuro.addEventListener('change', () => {
  campoSemanas.classList.toggle('oculto', !casillaPrematuro.checked);
  if (!casillaPrematuro.checked) formNino.semanas_gestacion.value = '';
});

formNino.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  errorNino.textContent = '';

  const datos = {
    nombre: formNino.nombre.value.trim(),
    fecha_nacimiento: formNino.fecha_nacimiento.value,
    sexo: formNino.sexo.value || null,
    semanas_gestacion: casillaPrematuro.checked ? Number(formNino.semanas_gestacion.value) : null,
  };

  if (!datos.nombre) {
    errorNino.textContent = 'Escribe el nombre del niño o niña';
    return;
  }
  if (!datos.fecha_nacimiento) {
    errorNino.textContent = 'Escribe la fecha de nacimiento';
    return;
  }

  try {
    const nino = await llamarApi('POST', '/api/ninos', datos);
    mensajeGeneral.textContent = `${nino.nombre} se registró correctamente.`;
    await cargarHijos(); // también vuelve a cerrar el formulario
    // Si hay un cuestionario pendiente, preseleccionar al hijo recién registrado
    if (aplicacionPendiente) {
      selectVincular.value = String(nino.id_nino);
      selectVincular.focus();
    }
  } catch (err) {
    errorNino.textContent = err.message;
  }
});

// ---------- Citas de seguimiento ----------

const seccionCita = document.getElementById('seccion-cita');
const tituloCita = document.getElementById('titulo-cita');
const formCita = document.getElementById('form-cita');
const selectPsicologo = document.getElementById('cita-psicologo');
const campoFechaCita = document.getElementById('cita-fecha');
const contenedorEspacios = document.getElementById('cita-espacios');
const mensajeEspacios = document.getElementById('cita-espacios-mensaje');
const errorCita = document.getElementById('error-cita');
const listaCitas = document.getElementById('lista-citas');
const errorCitas = document.getElementById('error-citas');

const DIAS_MAXIMOS_CITA = 60;
const TEXTO_ESTADO = {
  solicitada: 'Solicitada',
  confirmada: 'Confirmada',
  completada: 'Completada',
  cancelada: 'Cancelada',
};

let psicologos = [];
let ninoCita = null; // hijo para el que se está pidiendo la cita

/** 'AAAA-MM-DD' -> "lunes, 7 de diciembre de 2026" (UTC para que la zona horaria no cambie el día). */
function formatearFechaCita(fecha) {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  return new Date(Date.UTC(anio, mes - 1, dia)).toLocaleDateString('es-MX', {
    timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

/** Fecha 'AAAA-MM-DD' de hoy más `dias` días (hora local). */
function fechaMasDias(dias) {
  const fecha = new Date();
  fecha.setDate(fecha.getDate() + dias);
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`;
}

/** Cita solicitada o confirmada del último cuestionario del hijo (o undefined). */
function citaActivaDe(nino) {
  return citas.find((c) =>
    c.id_aplicacion === nino.id_ultimo_cuestionario && (c.estado === 'solicitada' || c.estado === 'confirmada'));
}

/** Botón "Pedir cita": solo si el hijo tiene un cuestionario guardado y este no tiene ya una cita activa. */
function crearBotonCita(nino) {
  if (!nino.id_ultimo_cuestionario || citaActivaDe(nino)) return null;
  const boton = crear('button', 'boton boton-acento', 'Pedir cita');
  boton.type = 'button';
  boton.addEventListener('click', () => abrirFormularioCita(nino));
  return boton;
}

async function cargarCitas() {
  try {
    citas = await llamarApi('GET', '/api/citas');
    pintarCitas();
  } catch (err) {
    errorCitas.textContent = err.message;
  }
}

function pintarCitas() {
  listaCitas.textContent = '';
  document.getElementById('sin-citas').classList.toggle('oculto', citas.length > 0);

  for (const cita of citas) {
    const item = crear('li', 'cita');
    const encabezado = crear('div', 'cita-encabezado');
    encabezado.append(
      crear('h3', null, `${formatearFechaCita(cita.fecha)} · ${cita.hora_inicio}–${cita.hora_fin}`),
      crear('span', `estado-cita estado-${cita.estado}`, TEXTO_ESTADO[cita.estado] || cita.estado)
    );

    const modalidad = cita.modalidad === 'en_linea' ? 'En línea' : 'Presencial';
    item.append(
      encabezado,
      crear('p', 'hijo-datos', `${cita.nombre_nino} · ${cita.nombre_psicologo} ${cita.apellidos_psicologo} · ${modalidad}`)
    );
    if (cita.estado === 'solicitada') {
      item.append(crear('p', 'ayuda', 'El psicólogo todavía debe confirmar la cita.'));
    }

    if (cita.estado === 'solicitada' || cita.estado === 'confirmada') {
      const cancelar = crear('button', 'boton boton-secundario boton-chico', 'Cancelar cita');
      cancelar.type = 'button';
      cancelar.addEventListener('click', () => cancelarCita(cita));
      item.append(cancelar);
    }
    listaCitas.append(item);
  }
}

async function cancelarCita(cita) {
  if (!window.confirm('¿Seguro que quieres cancelar esta cita?')) return;
  errorCitas.textContent = '';
  try {
    await llamarApi('PATCH', `/api/citas/${cita.id_cita}/cancelar`);
    mensajeGeneral.textContent = 'La cita se canceló.';
    await cargarCitas();
    pintarHijos(); // el hijo vuelve a mostrar "Pedir cita"
  } catch (err) {
    errorCitas.textContent = err.message;
  }
}

/** Abre el formulario de cita para un hijo; carga la lista de psicólogos validados. */
async function abrirFormularioCita(nino) {
  ninoCita = nino;
  errorCita.textContent = '';
  tituloCita.textContent = `Pedir cita para ${nino.nombre}`;
  document.getElementById('texto-cita').textContent =
    'La cita es una entrevista de seguimiento sobre su cuestionario más reciente.';
  campoFechaCita.min = fechaMasDias(0);
  campoFechaCita.max = fechaMasDias(DIAS_MAXIMOS_CITA);
  seccionCita.classList.remove('oculto');
  tituloCita.focus();

  try {
    psicologos = await llamarApi('GET', '/api/psicologos');
  } catch (err) {
    errorCita.textContent = err.message;
    return;
  }
  const hayPsicologos = psicologos.length > 0;
  document.getElementById('sin-psicologos').classList.toggle('oculto', hayPsicologos);
  formCita.classList.toggle('oculto', !hayPsicologos);

  selectPsicologo.textContent = '';
  selectPsicologo.append(new Option('Elige un psicólogo', ''));
  for (const p of psicologos) {
    const especialidad = p.especialidad ? ` – ${p.especialidad}` : '';
    selectPsicologo.append(new Option(`${p.nombre} ${p.apellidos}${especialidad}`, p.id_psicologo));
  }
  actualizarDescripcion();
  await cargarEspacios();
}

function cerrarFormularioCita() {
  seccionCita.classList.add('oculto');
  formCita.reset();
  contenedorEspacios.textContent = '';
  ninoCita = null;
}

function actualizarDescripcion() {
  const elegido = psicologos.find((p) => String(p.id_psicologo) === selectPsicologo.value);
  document.getElementById('cita-descripcion').textContent = elegido
    ? `${elegido.descripcion || ''} Citas de ${elegido.duracion_cita_min} minutos.`.trim()
    : '';
}

/** Muestra los horarios libres del psicólogo en la fecha elegida, como botones grandes seleccionables. */
async function cargarEspacios() {
  contenedorEspacios.textContent = '';
  const idPsicologo = selectPsicologo.value;
  const fecha = campoFechaCita.value;
  if (!idPsicologo || !fecha) {
    mensajeEspacios.textContent = 'Elige un psicólogo y una fecha para ver los horarios.';
    return;
  }

  mensajeEspacios.textContent = 'Buscando horarios…';
  try {
    const datos = await llamarApi('GET', `/api/psicologos/${idPsicologo}/disponibilidad?fecha=${encodeURIComponent(fecha)}`);
    if (datos.espacios.length === 0) {
      mensajeEspacios.textContent = 'No hay horarios disponibles ese día. Prueba con otra fecha.';
      return;
    }
    mensajeEspacios.textContent = `${datos.espacios.length} horarios disponibles:`;
    for (const espacio of datos.espacios) {
      const etiqueta = crear('label', 'opcion espacio');
      const radio = crear('input');
      Object.assign(radio, { type: 'radio', name: 'hora_inicio', value: espacio.hora_inicio });
      etiqueta.append(radio, crear('span', null, `${espacio.hora_inicio}–${espacio.hora_fin}`));
      contenedorEspacios.append(etiqueta);
    }
  } catch (err) {
    mensajeEspacios.textContent = err.message;
  }
}

selectPsicologo.addEventListener('change', () => {
  actualizarDescripcion();
  cargarEspacios();
});
campoFechaCita.addEventListener('change', cargarEspacios);
document.getElementById('boton-cancelar-cita').addEventListener('click', cerrarFormularioCita);

formCita.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  errorCita.textContent = '';

  const horaElegida = formCita.querySelector('input[name="hora_inicio"]:checked');
  if (!selectPsicologo.value) {
    errorCita.textContent = 'Elige un psicólogo';
    return;
  }
  if (!campoFechaCita.value) {
    errorCita.textContent = 'Elige una fecha';
    return;
  }
  if (!horaElegida) {
    errorCita.textContent = 'Elige un horario';
    return;
  }

  const botonSolicitar = document.getElementById('boton-solicitar-cita');
  botonSolicitar.disabled = true;
  try {
    await llamarApi('POST', '/api/citas', {
      id_aplicacion: ninoCita.id_ultimo_cuestionario,
      id_psicologo: Number(selectPsicologo.value),
      fecha: campoFechaCita.value,
      hora_inicio: horaElegida.value,
      modalidad: formCita.modalidad.value,
      motivo_padre: document.getElementById('cita-motivo').value.trim(),
    });
    mensajeGeneral.textContent = 'Tu cita fue solicitada. El psicólogo la confirmará.';
    cerrarFormularioCita();
    await cargarCitas();
    pintarHijos();
  } catch (err) {
    errorCita.textContent = err.message;
    // Si otro padre ganó el horario, se recargan los espacios libres
    if (err.estado === 409) await cargarEspacios();
  } finally {
    botonSolicitar.disabled = false;
  }
});

// ---------- Inicio ----------

document.getElementById('boton-salir').addEventListener('click', cerrarSesion);

async function iniciar() {
  const usuario = await obtenerSesion();
  if (!usuario) {
    window.location.replace('/login.html');
    return;
  }
  if (usuario.rol !== 'padre') {
    window.location.replace(rutaPanel(usuario.rol));
    return;
  }
  document.getElementById('saludo').textContent = `Hola, ${usuario.nombre}`;

  await cargarCitas(); // primero las citas: las tarjetas de los hijos indican si ya tienen una
  await cargarHijos();
  await revisarPendiente();
}

iniciar();
