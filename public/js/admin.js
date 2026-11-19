// Panel de administración. Muestra las secciones según el rol:
//  - admin_secundario: estadísticas, validación de psicólogos y gestión de cuentas.
//  - admin_principal: lo mismo + administradores secundarios, preguntas y niveles de riesgo.
// El servidor vuelve a revisar todos los permisos; ocultar secciones aquí es solo comodidad.

let usuarioActual = null;
let paginaCuentas = 1;

const NOMBRES_ROL = {
  padre: 'Padre o tutor',
  psicologo: 'Psicólogo',
  admin_principal: 'Administrador principal',
  admin_secundario: 'Administrador secundario',
};

const NOMBRES_ESTADO_CITA = {
  solicitada: 'Solicitadas',
  confirmada: 'Confirmadas',
  cancelada: 'Canceladas',
  completada: 'Completadas',
};

const mensajeGeneral = document.getElementById('mensaje-general');

// ---------- Utilidades ----------

/** Crea un elemento con clase y texto (siempre textContent para no inyectar HTML). */
function crear(etiqueta, clase, texto) {
  const elemento = document.createElement(etiqueta);
  if (clase) elemento.className = clase;
  if (texto !== undefined && texto !== null) elemento.textContent = texto;
  return elemento;
}

function crearBoton(texto, clase, alPulsar) {
  const boton = crear('button', `boton ${clase} boton-chico`, texto);
  boton.type = 'button';
  boton.addEventListener('click', alPulsar);
  return boton;
}

function formatearFecha(fechaIso) {
  return new Date(fechaIso).toLocaleDateString('es-MX', {
    timeZone: 'America/Mexico_City',
    dateStyle: 'medium',
  });
}

/** "2026-03" -> "mar 2026" */
function formatearMes(mesTexto) {
  const [anio, mes] = mesTexto.split('-').map(Number);
  return new Date(anio, mes - 1, 1).toLocaleDateString('es-MX', { month: 'short', year: 'numeric' });
}

function avisar(texto) {
  mensajeGeneral.textContent = texto;
}

/** Etiqueta de estado con texto y borde (no depende solo del color). */
function crearEstado(texto, clase) {
  return crear('span', `estado-cuenta ${clase}`, texto);
}

// ---------- Estadísticas ----------

/**
 * Pinta una lista de barras horizontales.
 * filas: [{ etiqueta: Node|string, total, porcentaje?, claseBarra? }]
 * El número siempre aparece en texto; la barra es solo una ayuda visual (aria-hidden).
 */
function pintarBarras(idLista, filas) {
  const lista = document.getElementById(idLista);
  lista.textContent = '';
  const maximo = Math.max(1, ...filas.map((f) => f.total));

  for (const fila of filas) {
    const item = crear('li', 'barra-fila');

    const etiqueta = crear('div', 'barra-etiqueta');
    etiqueta.append(
      typeof fila.etiqueta === 'string' ? crear('span', null, fila.etiqueta) : fila.etiqueta,
      crear('span', 'barra-valor', fila.porcentaje === undefined ? `${fila.total}` : `${fila.total} (${fila.porcentaje} %)`)
    );

    const fondo = crear('div', 'barra-fondo');
    fondo.setAttribute('aria-hidden', 'true');
    const relleno = crear('div', `barra-relleno ${fila.claseBarra || ''}`);
    relleno.style.width = `${(fila.total / maximo) * 100}%`;
    fondo.append(relleno);

    item.append(etiqueta, fondo);
    lista.append(item);
  }
}

function pintarResumen(datos) {
  const contenedor = document.getElementById('tarjetas-resumen');
  contenedor.textContent = '';
  const { resumen, usuarios } = datos;

  const tarjetas = [
    [resumen.completados, 'Cuestionarios completados'],
    [`${resumen.porcentaje_vinculados} %`, 'Vinculados a una cuenta'],
    [resumen.puntaje_promedio ?? '—', 'Puntaje promedio (0 a 20)'],
    [resumen.en_curso, 'Cuestionarios sin terminar'],
    [usuarios.padres, 'Padres o tutores registrados'],
    [usuarios.psicologos_validados, 'Psicólogos validados'],
    [usuarios.psicologos_pendientes, 'Psicólogos por validar'],
    [usuarios.cuentas_suspendidas, 'Cuentas suspendidas'],
  ];
  for (const [numero, descripcion] of tarjetas) {
    const tarjeta = crear('div', 'dato-resumen');
    tarjeta.append(crear('span', 'numero', String(numero)), crear('span', 'descripcion', descripcion));
    contenedor.append(tarjeta);
  }
}

async function cargarEstadisticas() {
  const error = document.getElementById('error-estadisticas');
  error.textContent = '';
  try {
    const datos = await llamarApi('GET', '/api/admin/estadisticas');
    pintarResumen(datos);

    pintarBarras('barras-nivel', datos.por_nivel.map((n) => ({
      etiqueta: crearEtiquetaNivel(n.nivel), // ícono + texto
      total: n.total,
      porcentaje: n.porcentaje,
      claseBarra: `nivel-${claveNivel(n.nivel)}`,
    })));

    pintarBarras('barras-edad', datos.por_edad.map((e) => ({
      etiqueta: `${e.rango} meses`,
      total: e.total,
      porcentaje: e.porcentaje,
    })));

    pintarBarras('barras-mes', datos.por_mes.map((m) => ({ etiqueta: formatearMes(m.mes), total: m.total })));

    pintarBarras('barras-citas', datos.citas_por_estado.map((c) => ({
      etiqueta: NOMBRES_ESTADO_CITA[c.estado] || c.estado,
      total: c.total,
    })));

    const s = datos.seguimiento;
    pintarBarras('barras-seguimiento', [
      { etiqueta: 'Entrevistas completadas', total: s.completadas },
      { etiqueta: 'Seguimiento positivo (2 o más)', total: s.positivas },
      { etiqueta: 'Seguimiento negativo (0 o 1)', total: s.negativas },
      { etiqueta: 'Sin puntaje registrado', total: s.sin_puntaje },
    ]);
  } catch (err) {
    error.textContent = err.message;
  }
}

document.getElementById('boton-actualizar').addEventListener('click', cargarEstadisticas);

// ---------- Psicólogos ----------

async function cambiarValidacion(psicologo, validado) {
  const accion = validado ? 'validar' : 'revocar la validación de';
  if (!window.confirm(`¿Seguro que quieres ${accion} a ${psicologo.nombre} ${psicologo.apellidos}?`)) return;
  try {
    const respuesta = await llamarApi('PATCH', `/api/admin/psicologos/${psicologo.id_usuario}/validacion`, { validado });
    avisar(respuesta.mensaje);
    await Promise.all([cargarPsicologos(), cargarEstadisticas()]);
  } catch (err) {
    document.getElementById('error-psicologos').textContent = err.message;
  }
}

async function cargarPsicologos() {
  const lista = document.getElementById('lista-psicologos');
  const error = document.getElementById('error-psicologos');
  const estado = document.getElementById('filtro-psicologos').value;
  error.textContent = '';

  try {
    const psicologos = await llamarApi('GET', `/api/admin/psicologos?estado=${encodeURIComponent(estado)}`);
    lista.textContent = '';
    document.getElementById('sin-psicologos').classList.toggle('oculto', psicologos.length > 0);

    for (const p of psicologos) {
      const item = crear('li', 'elemento-admin');
      item.append(
        crear('h3', null, `${p.nombre} ${p.apellidos}`),
        crear('p', null, `Cédula profesional: ${p.cedula_profesional}`),
        crear('p', null, `Especialidad: ${p.especialidad || 'No indicada'}`),
        crear('p', null, `Correo: ${p.correo}${p.telefono ? ` · Teléfono: ${p.telefono}` : ''}`),
        crear('p', null, `Registro: ${formatearFecha(p.fecha_registro)}` +
          (p.validado && p.fecha_validacion ? ` · Validado el ${formatearFecha(p.fecha_validacion)}` : ''))
      );

      const estados = crear('p');
      estados.append(p.validado ? crearEstado('Validado', 'estado-activa') : crearEstado('Pendiente', 'estado-pendiente'));
      if (!p.activo) estados.append(' ', crearEstado('Cuenta suspendida', 'estado-suspendida'));
      item.append(estados);

      const acciones = crear('div', 'acciones-admin');
      acciones.append(p.validado
        ? crearBoton('Revocar validación', 'boton-secundario', () => cambiarValidacion(p, false))
        : crearBoton('Validar', 'boton-primario', () => cambiarValidacion(p, true)));
      item.append(acciones);

      lista.append(item);
    }
  } catch (err) {
    error.textContent = err.message;
  }
}

document.getElementById('filtro-psicologos').addEventListener('change', cargarPsicologos);

// ---------- Cuentas ----------

/** ¿Este administrador puede suspender o reactivar la cuenta? (el servidor lo vuelve a revisar) */
function puedeGestionar(cuenta) {
  if (cuenta.id_usuario === usuarioActual.id_usuario) return false;
  if (cuenta.rol === 'admin_principal') return false;
  if (cuenta.rol === 'admin_secundario') return usuarioActual.rol === 'admin_principal';
  return true;
}

async function cambiarEstadoCuenta(cuenta, activo, alTerminar) {
  const accion = activo ? 'reactivar' : 'suspender';
  if (!window.confirm(`¿Seguro que quieres ${accion} la cuenta de ${cuenta.nombre} ${cuenta.apellidos}?`)) return;
  try {
    const respuesta = await llamarApi('PATCH', `/api/admin/usuarios/${cuenta.id_usuario}/activo`, { activo });
    avisar(respuesta.mensaje);
    await alTerminar();
    cargarEstadisticas();
  } catch (err) {
    document.getElementById('error-general').textContent = err.message;
  }
}

/** Elemento de lista para una cuenta, con su botón de suspender/reactivar si aplica. */
function crearElementoCuenta(cuenta, alTerminar) {
  const item = crear('li', 'elemento-admin');
  item.append(
    crear('h3', null, `${cuenta.nombre} ${cuenta.apellidos}`),
    crear('p', null, `${NOMBRES_ROL[cuenta.rol] || cuenta.rol} · ${cuenta.correo}`),
    crear('p', null, `Registro: ${formatearFecha(cuenta.fecha_registro)}`)
  );
  const estado = crear('p');
  estado.append(cuenta.activo ? crearEstado('Activa', 'estado-activa') : crearEstado('Suspendida', 'estado-suspendida'));
  item.append(estado);

  if (puedeGestionar(cuenta)) {
    const acciones = crear('div', 'acciones-admin');
    acciones.append(cuenta.activo
      ? crearBoton('Suspender', 'boton-secundario', () => cambiarEstadoCuenta(cuenta, false, alTerminar))
      : crearBoton('Reactivar', 'boton-primario', () => cambiarEstadoCuenta(cuenta, true, alTerminar)));
    item.append(acciones);
  }
  return item;
}

async function cargarCuentas() {
  const lista = document.getElementById('lista-cuentas');
  const error = document.getElementById('error-cuentas');
  error.textContent = '';

  const parametros = new URLSearchParams({ pagina: String(paginaCuentas) });
  const buscar = document.getElementById('buscar-texto').value.trim();
  const rol = document.getElementById('buscar-rol').value;
  if (buscar) parametros.set('buscar', buscar);
  if (rol) parametros.set('rol', rol);

  try {
    const datos = await llamarApi('GET', `/api/admin/usuarios?${parametros}`);
    lista.textContent = '';
    for (const cuenta of datos.usuarios) lista.append(crearElementoCuenta(cuenta, cargarCuentas));

    document.getElementById('total-cuentas').textContent =
      `${datos.total} cuenta(s) · página ${datos.pagina} de ${datos.total_paginas}`;
    document.getElementById('pagina-anterior').disabled = datos.pagina <= 1;
    document.getElementById('pagina-siguiente').disabled = datos.pagina >= datos.total_paginas;
  } catch (err) {
    error.textContent = err.message;
  }
}

document.getElementById('form-buscar').addEventListener('submit', (evento) => {
  evento.preventDefault();
  paginaCuentas = 1;
  cargarCuentas();
});
document.getElementById('pagina-anterior').addEventListener('click', () => {
  paginaCuentas = Math.max(1, paginaCuentas - 1);
  cargarCuentas();
});
document.getElementById('pagina-siguiente').addEventListener('click', () => {
  paginaCuentas += 1;
  cargarCuentas();
});

// ---------- Administradores secundarios (solo principal) ----------

async function cargarAdministradores() {
  const lista = document.getElementById('lista-administradores');
  try {
    const administradores = await llamarApi('GET', '/api/admin/administradores');
    lista.textContent = '';
    document.getElementById('sin-administradores').classList.toggle('oculto', administradores.length > 0);
    for (const admin of administradores) {
      lista.append(crearElementoCuenta({ ...admin, rol: 'admin_secundario' }, cargarAdministradores));
    }
  } catch (err) {
    document.getElementById('error-admin').textContent = err.message;
  }
}

const formAdmin = document.getElementById('form-admin');
formAdmin.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const error = document.getElementById('error-admin');
  error.textContent = '';

  const datos = {
    nombre: formAdmin.nombre.value.trim(),
    apellidos: formAdmin.apellidos.value.trim(),
    correo: formAdmin.correo.value.trim(),
    contrasena: formAdmin.contrasena.value,
  };
  if (!datos.nombre || !datos.apellidos || !datos.correo) {
    error.textContent = 'Completa nombre, apellidos y correo';
    return;
  }

  try {
    const admin = await llamarApi('POST', '/api/admin/administradores', datos);
    formAdmin.reset();
    avisar(`Se creó la cuenta de ${admin.nombre} ${admin.apellidos}. Compártele su contraseña inicial de forma segura.`);
    await cargarAdministradores();
  } catch (err) {
    error.textContent = err.message;
  }
});

// ---------- Preguntas (solo principal) ----------

let preguntaEnEdicion = null; // número de la pregunta abierta (solo una a la vez)

function crearFormularioPregunta(pregunta) {
  const form = crear('form');
  form.noValidate = true;
  const id = `pregunta-${pregunta.numero}`;

  const campoTexto = crear('div', 'campo');
  const etiquetaTexto = crear('label', null, 'Texto de la pregunta');
  etiquetaTexto.htmlFor = `${id}-texto`;
  const texto = crear('textarea');
  texto.id = `${id}-texto`;
  texto.maxLength = 1000;
  texto.value = pregunta.texto;
  campoTexto.append(etiquetaTexto, texto);

  const campoEjemplo = crear('div', 'campo');
  const etiquetaEjemplo = crear('label', null, 'Ejemplo (opcional)');
  etiquetaEjemplo.htmlFor = `${id}-ejemplo`;
  const ejemplo = crear('textarea');
  ejemplo.id = `${id}-ejemplo`;
  ejemplo.maxLength = 1000;
  ejemplo.value = pregunta.ejemplo || '';
  campoEjemplo.append(etiquetaEjemplo, ejemplo);

  const campoRiesgo = crear('div', 'campo');
  const etiquetaRiesgo = crear('label', null, '¿Qué respuesta indica riesgo?');
  etiquetaRiesgo.htmlFor = `${id}-riesgo`;
  const riesgo = crear('select');
  riesgo.id = `${id}-riesgo`;
  riesgo.append(new Option('Responder "No"', 'false'), new Option('Responder "Sí"', 'true'));
  riesgo.value = String(pregunta.riesgo_si_responde);
  campoRiesgo.append(etiquetaRiesgo, riesgo);

  const error = crear('p', 'mensaje-error');
  error.setAttribute('role', 'alert');

  const acciones = crear('div', 'acciones-admin');
  const guardar = crear('button', 'boton boton-primario boton-chico', 'Guardar');
  guardar.type = 'submit';
  acciones.append(guardar, crearBoton('Cancelar', 'boton-secundario', () => {
    preguntaEnEdicion = null;
    cargarPreguntas();
  }));

  form.append(campoTexto, campoEjemplo, campoRiesgo, error, acciones);
  form.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    error.textContent = '';
    try {
      await llamarApi('PUT', `/api/admin/preguntas/${pregunta.numero}`, {
        texto: texto.value.trim(),
        ejemplo: ejemplo.value.trim() || null,
        riesgo_si_responde: riesgo.value === 'true',
      });
      preguntaEnEdicion = null;
      avisar(`Se guardó la pregunta ${pregunta.numero}.`);
      await cargarPreguntas();
    } catch (err) {
      error.textContent = err.message;
    }
  });

  // Al abrir el formulario, el foco va al texto
  setTimeout(() => texto.focus(), 0);
  return form;
}

async function cargarPreguntas() {
  const lista = document.getElementById('lista-preguntas');
  const error = document.getElementById('error-preguntas');
  error.textContent = '';
  try {
    const preguntas = await llamarApi('GET', '/api/admin/preguntas');
    lista.textContent = '';
    for (const p of preguntas) {
      const item = crear('li', 'elemento-admin');
      item.append(crear('h3', null, `Pregunta ${p.numero}`));

      if (preguntaEnEdicion === p.numero) {
        item.append(crearFormularioPregunta(p));
      } else {
        item.append(
          crear('p', 'texto-pregunta', p.texto),
          crear('p', 'ayuda', p.ejemplo ? `Ejemplo: ${p.ejemplo}` : 'Sin ejemplo'),
          crear('p', null, `Indica riesgo si responde: ${p.riesgo_si_responde ? 'Sí' : 'No'}`)
        );
        const acciones = crear('div', 'acciones-admin');
        acciones.append(crearBoton('Editar', 'boton-secundario', () => {
          preguntaEnEdicion = p.numero;
          cargarPreguntas();
        }));
        item.append(acciones);
      }
      lista.append(item);
    }
  } catch (err) {
    error.textContent = err.message;
  }
}

// ---------- Niveles de riesgo (solo principal) ----------

/** Crea un campo con etiqueta. */
function crearCampo(textoEtiqueta, control) {
  const campo = crear('div', 'campo');
  const etiqueta = crear('label', null, textoEtiqueta);
  etiqueta.htmlFor = control.id;
  campo.append(etiqueta, control);
  return campo;
}

function crearEntrada(id, tipo, valor) {
  const entrada = crear('input');
  entrada.id = id;
  entrada.type = tipo;
  entrada.value = valor;
  return entrada;
}

async function cargarNiveles() {
  const contenedor = document.getElementById('campos-niveles');
  try {
    const niveles = await llamarApi('GET', '/api/admin/niveles');
    contenedor.textContent = '';

    for (const n of niveles) {
      const grupo = crear('fieldset', 'fieldset-nivel');
      grupo.dataset.idNivel = n.id_nivel;
      grupo.append(crear('legend', null, `Nivel "${n.nombre}"`));

      const nombre = crearEntrada(`nivel-${n.id_nivel}-nombre`, 'text', n.nombre);
      nombre.maxLength = 20;
      nombre.name = 'nombre';

      const minimo = crearEntrada(`nivel-${n.id_nivel}-min`, 'number', n.puntaje_min);
      minimo.min = 0;
      minimo.max = 20;
      minimo.name = 'puntaje_min';
      const maximo = crearEntrada(`nivel-${n.id_nivel}-max`, 'number', n.puntaje_max);
      maximo.min = 0;
      maximo.max = 20;
      maximo.name = 'puntaje_max';

      const recomendacion = crear('textarea');
      recomendacion.id = `nivel-${n.id_nivel}-recomendacion`;
      recomendacion.name = 'recomendacion';
      recomendacion.maxLength = 2000;
      recomendacion.value = n.recomendacion;

      const rango = crear('div', 'rango-nivel');
      rango.append(crearCampo('Puntaje mínimo', minimo), crearCampo('Puntaje máximo', maximo));

      grupo.append(crearCampo('Nombre', nombre), rango, crearCampo('Recomendación', recomendacion));
      contenedor.append(grupo);
    }
  } catch (err) {
    document.getElementById('error-niveles').textContent = err.message;
  }
}

document.getElementById('form-niveles').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const error = document.getElementById('error-niveles');
  error.textContent = '';

  // Leer todos los niveles del formulario (se guardan juntos)
  const niveles = [...document.querySelectorAll('#campos-niveles fieldset')].map((grupo) => ({
    id_nivel: Number(grupo.dataset.idNivel),
    nombre: grupo.querySelector('[name="nombre"]').value.trim(),
    puntaje_min: Number(grupo.querySelector('[name="puntaje_min"]').value),
    puntaje_max: Number(grupo.querySelector('[name="puntaje_max"]').value),
    recomendacion: grupo.querySelector('[name="recomendacion"]').value.trim(),
  }));

  try {
    await llamarApi('PUT', '/api/admin/niveles', { niveles });
    avisar('Se guardaron los niveles de riesgo.');
    await Promise.all([cargarNiveles(), cargarEstadisticas()]);
  } catch (err) {
    error.textContent = err.message;
  }
});

// ---------- Inicio ----------

document.getElementById('boton-salir').addEventListener('click', cerrarSesion);

async function iniciar() {
  usuarioActual = await obtenerSesion();
  if (!usuarioActual) {
    window.location.replace('/login.html');
    return;
  }
  if (usuarioActual.rol !== 'admin_principal' && usuarioActual.rol !== 'admin_secundario') {
    window.location.replace(rutaPanel(usuarioActual.rol));
    return;
  }

  document.getElementById('texto-rol').textContent =
    `${usuarioActual.nombre} ${usuarioActual.apellidos} · ${NOMBRES_ROL[usuarioActual.rol]}`;

  const esPrincipal = usuarioActual.rol === 'admin_principal';
  document.querySelectorAll('.solo-principal').forEach((el) => el.classList.toggle('oculto', !esPrincipal));

  const tareas = [cargarEstadisticas(), cargarPsicologos(), cargarCuentas()];
  if (esPrincipal) tareas.push(cargarAdministradores(), cargarPreguntas(), cargarNiveles());
  await Promise.all(tareas);
}

iniciar();
