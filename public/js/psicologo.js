// Panel del psicólogo: citas, horario semanal, bloqueos y perfil.

const mensajeGeneral = document.getElementById('mensaje-general');
const DIAS = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

let citas = [];

/** Crea un elemento con clase y texto (siempre con textContent para evitar inyección de HTML). */
function crear(etiqueta, clase, texto) {
  const elemento = document.createElement(etiqueta);
  if (clase) elemento.className = clase;
  if (texto !== undefined) elemento.textContent = texto;
  return elemento;
}

/** Botón con clase y texto que ejecuta `accion` al pulsarlo. */
function crearBoton(clase, texto, accion) {
  const boton = crear('button', clase, texto);
  boton.type = 'button';
  boton.addEventListener('click', accion);
  return boton;
}

/** 'AAAA-MM-DD' -> "lunes, 7 de diciembre de 2026" (se usa UTC para que no cambie el día). */
function formatearFechaCita(fecha) {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  return new Date(Date.UTC(anio, mes - 1, dia)).toLocaleDateString('es-MX', {
    timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

/** Fecha de hoy 'AAAA-MM-DD' (hora local). */
function fechaHoy() {
  const hoy = new Date();
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
}

const TEXTO_ESTADO = {
  solicitada: 'Solicitada',
  confirmada: 'Confirmada',
  completada: 'Completada',
  cancelada: 'Cancelada',
};

/** Etiqueta de estado con texto (el color solo acompaña). */
function crearEstado(estado) {
  return crear('span', `estado-cita estado-${estado}`, TEXTO_ESTADO[estado] || estado);
}

// =====================================================================
// Citas
// =====================================================================

const listaCitas = document.getElementById('lista-citas');
const filtroEstado = document.getElementById('filtro-estado');
const errorCitas = document.getElementById('error-citas');

/** Cambia el estado de una cita (confirmar o cancelar) y recarga la lista. */
async function cambiarEstado(cita, accion, mensaje) {
  errorCitas.textContent = '';
  try {
    await llamarApi('PATCH', `/api/citas/${cita.id_cita}/${accion}`);
    mensajeGeneral.textContent = mensaje;
    await cargarCitas();
  } catch (err) {
    errorCitas.textContent = err.message;
  }
}

/** Formulario para registrar la entrevista de seguimiento de una cita confirmada. */
function crearFormularioSeguimiento(cita, contenedor) {
  const formulario = crear('form', 'formulario-seguimiento');
  formulario.noValidate = true;
  const id = `seg-${cita.id_cita}`;

  // Se construye con elementos y textContent; ningún dato del servidor se inserta como HTML
  const campoPuntaje = crear('div', 'campo');
  const etiquetaPuntaje = crear('label', null, 'Puntaje de la entrevista de seguimiento (0 a 20)');
  etiquetaPuntaje.htmlFor = `${id}-puntaje`;
  const puntaje = crear('input');
  Object.assign(puntaje, { id: `${id}-puntaje`, type: 'number', min: 0, max: 20, required: true });
  campoPuntaje.append(etiquetaPuntaje, puntaje);

  const campoResultado = crear('div', 'campo');
  const etiquetaResultado = crear('label', null, 'Resultado de la entrevista');
  etiquetaResultado.htmlFor = `${id}-resultado`;
  const resultado = crear('select');
  resultado.id = `${id}-resultado`;
  resultado.append(
    new Option('Elige una opción', ''),
    new Option('Negativo: riesgo bajo tras la entrevista', 'negativo'),
    new Option('Positivo: se recomienda evaluación del desarrollo', 'positivo')
  );
  campoResultado.append(etiquetaResultado, resultado);

  const campoObservaciones = crear('div', 'campo');
  const etiquetaObs = crear('label', null, 'Observaciones (opcional)');
  etiquetaObs.htmlFor = `${id}-obs`;
  const observaciones = crear('textarea');
  Object.assign(observaciones, { id: `${id}-obs`, rows: 3, maxLength: 2000 });
  campoObservaciones.append(etiquetaObs, observaciones);

  const error = crear('p', 'mensaje-error');
  error.setAttribute('role', 'alert');

  const botones = crear('div', 'navegacion');
  const cancelar = crearBoton('boton boton-secundario', 'Cancelar', () => formulario.remove());
  const guardar = crear('button', 'boton boton-primario', 'Guardar seguimiento');
  guardar.type = 'submit';
  botones.append(cancelar, guardar);

  formulario.append(campoPuntaje, campoResultado, campoObservaciones, error, botones);

  formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    error.textContent = '';
    const valorPuntaje = Number(puntaje.value);
    if (puntaje.value === '' || !Number.isInteger(valorPuntaje) || valorPuntaje < 0 || valorPuntaje > 20) {
      error.textContent = 'Escribe un puntaje entero entre 0 y 20';
      puntaje.focus();
      return;
    }
    if (!resultado.value) {
      error.textContent = 'Elige el resultado de la entrevista';
      resultado.focus();
      return;
    }
    try {
      await llamarApi('PATCH', `/api/citas/${cita.id_cita}/completar`, {
        puntaje_seguimiento: valorPuntaje,
        resultado_seguimiento: resultado.value,
        observaciones: observaciones.value.trim(),
      });
      mensajeGeneral.textContent = 'Seguimiento registrado. La cita quedó completada.';
      await cargarCitas();
    } catch (err) {
      error.textContent = err.message;
    }
  });

  contenedor.append(formulario);
  puntaje.focus();
}

/** Tarjeta de una cita con sus datos y las acciones permitidas según su estado. */
function crearTarjetaCita(cita) {
  const item = crear('li', 'cita');

  const encabezado = crear('div', 'cita-encabezado');
  encabezado.append(
    crear('h3', null, `${formatearFechaCita(cita.fecha)} · ${cita.hora_inicio}–${cita.hora_fin}`),
    crearEstado(cita.estado)
  );
  item.append(encabezado);

  const datos = crear('dl', 'datos-resultado');
  const agregar = (termino, valor) => datos.append(crear('dt', null, termino), crear('dd', null, valor));
  agregar('Niño o niña', `${cita.nombre_nino} (${cita.edad_meses} meses al contestar)`);
  const ddNivel = crear('dd');
  ddNivel.append(crearEtiquetaNivel(cita.nivel), crear('span', null, ` · ${cita.puntaje_total} puntos`));
  datos.append(crear('dt', null, 'Resultado del cuestionario'), ddNivel);
  agregar('Modalidad', cita.modalidad === 'en_linea' ? 'En línea' : 'Presencial');
  agregar('Tutor', `${cita.nombre_tutor} ${cita.apellidos_tutor}`);
  agregar('Contacto', [cita.correo_tutor, cita.telefono_tutor].filter(Boolean).join(' · '));
  if (cita.motivo_padre) agregar('Motivo', cita.motivo_padre);
  if (cita.estado === 'completada') {
    agregar('Seguimiento', `${cita.resultado_seguimiento} · ${cita.puntaje_seguimiento} puntos`);
    if (cita.observaciones) agregar('Observaciones', cita.observaciones);
  }
  item.append(datos);

  // Acciones según el estado
  const acciones = crear('div', 'acciones-hijo');
  if (cita.estado !== 'cancelada') {
    const enlace = crear('a', 'boton boton-secundario', 'Ver resultado y respuestas');
    enlace.href = `/resultado.html?id=${encodeURIComponent(cita.id_aplicacion)}`;
    acciones.append(enlace);
  }
  if (cita.estado === 'solicitada') {
    acciones.append(crearBoton('boton boton-primario', 'Confirmar', () => cambiarEstado(cita, 'confirmar', 'Cita confirmada.')));
  }
  if (cita.estado === 'confirmada') {
    acciones.append(crearBoton('boton boton-primario', 'Registrar seguimiento', () => {
      if (!item.querySelector('.formulario-seguimiento')) crearFormularioSeguimiento(cita, item);
    }));
  }
  if (cita.estado === 'solicitada' || cita.estado === 'confirmada') {
    acciones.append(crearBoton('boton boton-secundario', 'Cancelar cita', () => {
      if (window.confirm('¿Seguro que quieres cancelar esta cita?')) {
        cambiarEstado(cita, 'cancelar', 'Cita cancelada.');
      }
    }));
  }
  if (acciones.children.length > 0) item.append(acciones);
  return item;
}

function pintarCitas() {
  const filtro = filtroEstado.value;
  const visibles = citas.filter((c) => {
    if (filtro === 'todas') return true;
    if (filtro === 'activas') return c.estado === 'solicitada' || c.estado === 'confirmada';
    return c.estado === filtro;
  });

  listaCitas.textContent = '';
  document.getElementById('sin-citas').classList.toggle('oculto', visibles.length > 0);
  for (const cita of visibles) listaCitas.append(crearTarjetaCita(cita));
}

async function cargarCitas() {
  try {
    citas = await llamarApi('GET', '/api/citas');
    pintarCitas();
  } catch (err) {
    errorCitas.textContent = err.message;
  }
}

filtroEstado.addEventListener('change', pintarCitas);

// =====================================================================
// Horario semanal
// =====================================================================

const listaHorario = document.getElementById('lista-horario');
const formHorario = document.getElementById('form-horario');
const errorHorario = document.getElementById('error-horario');

async function cargarHorario() {
  try {
    const bloques = await llamarApi('GET', '/api/psicologos/yo/horario');
    listaHorario.textContent = '';
    document.getElementById('sin-horario').classList.toggle('oculto', bloques.length > 0);

    for (const bloque of bloques) {
      const item = crear('li', bloque.activo ? 'fila' : 'fila fila-inactiva');
      const texto = crear('span', 'fila-texto', `${DIAS[bloque.dia_semana]} · ${bloque.hora_inicio}–${bloque.hora_fin}`);
      if (!bloque.activo) texto.append(crear('span', 'estado-cita estado-cancelada', 'Inactivo'));

      const botones = crear('span', 'fila-botones');
      botones.append(
        crearBoton('boton boton-secundario boton-chico', bloque.activo ? 'Desactivar' : 'Activar', async () => {
          await accionHorario('PATCH', bloque.id_horario, { activo: !bloque.activo });
        }),
        crearBoton('boton boton-secundario boton-chico', 'Eliminar', async () => {
          if (window.confirm('¿Eliminar este bloque de horario?')) await accionHorario('DELETE', bloque.id_horario);
        })
      );
      item.append(texto, botones);
      listaHorario.append(item);
    }
  } catch (err) {
    errorHorario.textContent = err.message;
  }
}

async function accionHorario(metodo, idHorario, cuerpo) {
  errorHorario.textContent = '';
  try {
    await llamarApi(metodo, `/api/psicologos/yo/horario/${idHorario}`, cuerpo);
    await cargarHorario();
  } catch (err) {
    errorHorario.textContent = err.message;
  }
}

formHorario.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  errorHorario.textContent = '';
  const datos = {
    dia_semana: Number(formHorario.dia_semana.value),
    hora_inicio: formHorario.hora_inicio.value,
    hora_fin: formHorario.hora_fin.value,
  };
  if (!datos.hora_inicio || !datos.hora_fin) {
    errorHorario.textContent = 'Escribe la hora de inicio y la de fin';
    return;
  }
  if (datos.hora_fin <= datos.hora_inicio) {
    errorHorario.textContent = 'La hora de fin debe ser posterior a la de inicio';
    return;
  }
  try {
    await llamarApi('POST', '/api/psicologos/yo/horario', datos);
    formHorario.hora_inicio.value = '';
    formHorario.hora_fin.value = '';
    mensajeGeneral.textContent = 'Bloque de horario agregado.';
    await cargarHorario();
  } catch (err) {
    errorHorario.textContent = err.message;
  }
});

// =====================================================================
// Bloqueos
// =====================================================================

const listaBloqueos = document.getElementById('lista-bloqueos');
const formBloqueo = document.getElementById('form-bloqueo');
const errorBloqueo = document.getElementById('error-bloqueo');

async function cargarBloqueos() {
  try {
    const bloqueos = await llamarApi('GET', '/api/psicologos/yo/bloqueos');
    listaBloqueos.textContent = '';
    document.getElementById('sin-bloqueos').classList.toggle('oculto', bloqueos.length > 0);

    for (const bloqueo of bloqueos) {
      const horas = bloqueo.hora_inicio ? `${bloqueo.hora_inicio}–${bloqueo.hora_fin}` : 'Día completo';
      const motivo = bloqueo.motivo ? ` · ${bloqueo.motivo}` : '';
      const item = crear('li', 'fila');
      item.append(
        crear('span', 'fila-texto', `${formatearFechaCita(bloqueo.fecha)} · ${horas}${motivo}`),
        crearBoton('boton boton-secundario boton-chico', 'Eliminar', async () => {
          errorBloqueo.textContent = '';
          try {
            await llamarApi('DELETE', `/api/psicologos/yo/bloqueos/${bloqueo.id_bloqueo}`);
            await cargarBloqueos();
          } catch (err) {
            errorBloqueo.textContent = err.message;
          }
        })
      );
      listaBloqueos.append(item);
    }
  } catch (err) {
    errorBloqueo.textContent = err.message;
  }
}

formBloqueo.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  errorBloqueo.textContent = '';
  const datos = {
    fecha: formBloqueo.fecha.value,
    hora_inicio: formBloqueo.hora_inicio.value || null,
    hora_fin: formBloqueo.hora_fin.value || null,
    motivo: formBloqueo.motivo.value.trim(),
  };
  if (!datos.fecha) {
    errorBloqueo.textContent = 'Elige la fecha';
    return;
  }
  if ((datos.hora_inicio === null) !== (datos.hora_fin === null)) {
    errorBloqueo.textContent = 'Escribe las dos horas, o deja ambas vacías para bloquear el día completo';
    return;
  }
  try {
    await llamarApi('POST', '/api/psicologos/yo/bloqueos', datos);
    formBloqueo.reset();
    mensajeGeneral.textContent = 'Bloqueo agregado.';
    await cargarBloqueos();
  } catch (err) {
    errorBloqueo.textContent = err.message;
  }
});

// =====================================================================
// Perfil
// =====================================================================

const formPerfil = document.getElementById('form-perfil');
const errorPerfil = document.getElementById('error-perfil');

async function cargarPerfil() {
  const perfil = await llamarApi('GET', '/api/psicologos/yo');
  document.getElementById('dato-cedula').textContent = perfil.cedula_profesional;
  document.getElementById('dato-validado').textContent = perfil.validado
    ? 'Validada: apareces para los padres'
    : 'Pendiente de validación';
  document.getElementById('aviso-validacion').classList.toggle('oculto', perfil.validado);

  formPerfil.especialidad.value = perfil.especialidad || '';
  formPerfil.descripcion.value = perfil.descripcion || '';
  formPerfil.duracion_cita_min.value = perfil.duracion_cita_min;
}

formPerfil.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  errorPerfil.textContent = '';
  const duracion = Number(formPerfil.duracion_cita_min.value);
  if (!Number.isInteger(duracion) || duracion < 15 || duracion > 180) {
    errorPerfil.textContent = 'La duración debe estar entre 15 y 180 minutos';
    return;
  }
  try {
    await llamarApi('PUT', '/api/psicologos/yo', {
      especialidad: formPerfil.especialidad.value.trim(),
      descripcion: formPerfil.descripcion.value.trim(),
      duracion_cita_min: duracion,
    });
    mensajeGeneral.textContent = 'Perfil guardado.';
  } catch (err) {
    errorPerfil.textContent = err.message;
  }
});

// =====================================================================
// Inicio
// =====================================================================

document.getElementById('boton-salir').addEventListener('click', cerrarSesion);
document.getElementById('bloqueo-fecha').min = fechaHoy();

async function iniciar() {
  const usuario = await obtenerSesion();
  if (!usuario) {
    window.location.replace('/login.html');
    return;
  }
  if (usuario.rol !== 'psicologo') {
    window.location.replace(rutaPanel(usuario.rol));
    return;
  }
  document.getElementById('saludo').textContent = `Hola, ${usuario.nombre}`;

  try {
    await cargarPerfil();
  } catch (err) {
    errorPerfil.textContent = err.message;
  }
  await Promise.all([cargarCitas(), cargarHorario(), cargarBloqueos()]);
}

iniciar();
