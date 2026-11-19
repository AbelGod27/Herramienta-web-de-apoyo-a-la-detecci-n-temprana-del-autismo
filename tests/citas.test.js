// Pruebas de integración de la Fase 4: psicólogos, horario, bloqueos, disponibilidad y citas.
// Usan la base de datos de PRUEBAS (PGDATABASE_TEST) y borran SOLO lo que crean.
const request = require('supertest');
const app = require('../src/app');
const { pool, consulta } = require('../src/config/db');
const { haceMeses } = require('./utilidades');
const { diaSemanaDeFecha } = require('../src/services/disponibilidad.service');

const PREFIJO = `prueba.f4.${Date.now()}`;
const CONTRASENA = 'Segura123';
let contador = 0;
let preguntas = [];

/** Próxima fecha (a partir de mañana) que cae en el día de la semana indicado (1 = lunes). */
function proximoDia(diaSemana) {
  const fecha = new Date();
  for (let i = 1; i <= 8; i += 1) {
    fecha.setDate(fecha.getDate() + 1);
    const texto = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`;
    if (diaSemanaDeFecha(texto) === diaSemana) return texto;
  }
  throw new Error('No se encontró el día');
}

const LUNES = proximoDia(1);

function correoNuevo() {
  contador += 1;
  return `${PREFIJO}.${contador}@ejemplo.com`;
}

/** Cédula única de esta corrida (letras y números, 5 a 20 caracteres). */
function cedulaNueva() {
  contador += 1;
  return `C${String(Date.now()).slice(-8)}${contador}`;
}

/** Registra un padre y devuelve su agente con sesión. */
async function padreConSesion() {
  const agente = request.agent(app);
  const res = await agente.post('/api/auth/registro').send({
    nombre: 'Ana', apellidos: 'Prueba', correo: correoNuevo(), contrasena: CONTRASENA,
    parentesco: 'madre', acepto_aviso: true,
  });
  expect(res.status).toBe(201);
  return agente;
}

/**
 * Registra un psicólogo (validado o no) con horario de lunes 09:00–12:00 y citas de 60 minutos.
 * Devuelve { agente, id }.
 */
async function psicologoConSesion({ validado = true, conHorario = true } = {}) {
  const agente = request.agent(app);
  const res = await agente.post('/api/psicologos/registro').send({
    nombre: 'Luis', apellidos: 'Psicólogo', correo: correoNuevo(), contrasena: CONTRASENA,
    cedula_profesional: cedulaNueva(), especialidad: 'Desarrollo infantil', duracion_cita_min: 60,
  });
  expect(res.status).toBe(201);
  const id = res.body.usuario.id_usuario;

  // La validación real la hace un administrador; en la prueba se simula directo en la BD
  if (validado) await consulta('UPDATE psicologo SET validado = TRUE WHERE id_usuario = $1', [id]);
  if (conHorario) {
    const horario = await agente.post('/api/psicologos/yo/horario').send({ dia_semana: 1, hora_inicio: '09:00', hora_fin: '12:00' });
    expect(horario.status).toBe(201);
  }
  return { agente, id };
}

/** Crea un hijo de 20 meses con un cuestionario terminado y vinculado. Devuelve el id de la aplicación. */
async function hijoConCuestionario(agentePadre) {
  const nino = await agentePadre.post('/api/ninos').send({ nombre: 'Leo', fecha_nacimiento: haceMeses(20) });
  const crear = await request(app).post('/api/aplicaciones').send({ fecha_nacimiento: haceMeses(20) });
  const id = crear.body.id_aplicacion;
  const respuestas = preguntas.map((p, i) => ({
    id_pregunta: p.id_pregunta,
    valor: i < 4 ? p.riesgo_si_responde : !p.riesgo_si_responde, // 4 respuestas de riesgo
  }));
  await request(app).put(`/api/aplicaciones/${id}/respuestas`).send({ respuestas });
  await request(app).post(`/api/aplicaciones/${id}/finalizar`);
  const vincular = await agentePadre.post(`/api/aplicaciones/${id}/vincular`).send({ id_nino: nino.body.id_nino });
  expect(vincular.status).toBe(200);
  return id;
}

function pedirCita(agentePadre, idAplicacion, idPsicologo, horaInicio = '09:00', fecha = LUNES) {
  return agentePadre.post('/api/citas').send({
    id_aplicacion: idAplicacion, id_psicologo: idPsicologo, fecha,
    hora_inicio: horaInicio, modalidad: 'presencial', motivo_padre: 'Prueba',
  });
}

beforeAll(async () => {
  const { rows } = await consulta('SELECT id_pregunta, riesgo_si_responde FROM pregunta ORDER BY numero');
  preguntas = rows;
});

afterAll(async () => {
  // Borrar en orden por las llaves foráneas, solo lo de esta corrida
  const usuarios = `SELECT id_usuario FROM usuario WHERE correo LIKE '${PREFIJO}%'`;
  const aplicaciones = `SELECT a.id_aplicacion FROM aplicacion a JOIN nino n ON n.id_nino = a.id_nino
                        WHERE n.id_tutor IN (${usuarios})`;
  await consulta(`DELETE FROM cita WHERE id_psicologo IN (${usuarios}) OR id_aplicacion IN (${aplicaciones})`);
  await consulta(`DELETE FROM aplicacion WHERE id_aplicacion IN (${aplicaciones})`);
  await consulta(`DELETE FROM nino WHERE id_tutor IN (${usuarios})`);
  await consulta(`DELETE FROM tutor WHERE id_usuario IN (${usuarios})`);
  await consulta(`DELETE FROM horario_psicologo WHERE id_psicologo IN (${usuarios})`);
  await consulta(`DELETE FROM bloqueo_horario WHERE id_psicologo IN (${usuarios})`);
  await consulta(`DELETE FROM psicologo WHERE id_usuario IN (${usuarios})`);
  await consulta(`DELETE FROM usuario WHERE correo LIKE '${PREFIJO}%'`);
  await pool.end();
});

describe('Registro de psicólogo', () => {
  test('se registra sin validar, con sesión iniciada y rol psicólogo', async () => {
    const agente = request.agent(app);
    const res = await agente.post('/api/psicologos/registro').send({
      nombre: 'Eva', apellidos: 'Prueba', correo: correoNuevo(), contrasena: CONTRASENA,
      cedula_profesional: cedulaNueva(),
    });
    expect(res.status).toBe(201);
    expect(res.body.usuario.rol).toBe('psicologo');
    expect(res.body.usuario).not.toHaveProperty('contrasena_hash');

    const perfil = await agente.get('/api/psicologos/yo');
    expect(perfil.status).toBe(200);
    expect(perfil.body.validado).toBe(false);
    expect(perfil.body.duracion_cita_min).toBe(60); // valor por defecto
  });

  test('no permite cédula ni correo repetidos', async () => {
    const cedula = cedulaNueva();
    const correo = correoNuevo();
    const base = { nombre: 'Eva', apellidos: 'Prueba', contrasena: CONTRASENA };
    await request(app).post('/api/psicologos/registro').send({ ...base, correo, cedula_profesional: cedula });

    const mismaCedula = await request(app)
      .post('/api/psicologos/registro')
      .send({ ...base, correo: correoNuevo(), cedula_profesional: cedula.toLowerCase() });
    expect(mismaCedula.status).toBe(409);
    expect(mismaCedula.body.error).toMatch(/cédula/);

    const mismoCorreo = await request(app)
      .post('/api/psicologos/registro')
      .send({ ...base, correo, cedula_profesional: cedulaNueva() });
    expect(mismoCorreo.status).toBe(409);
    expect(mismoCorreo.body.error).toMatch(/correo/);
  });

  test.each([
    ['cédula con espacios', { cedula_profesional: '123 456' }],
    ['cédula muy corta', { cedula_profesional: '123' }],
    ['duración fuera de rango', { duracion_cita_min: 10 }],
  ])('rechaza el registro: %s', async (_, cambios) => {
    const res = await request(app).post('/api/psicologos/registro').send({
      nombre: 'Eva', apellidos: 'Prueba', correo: correoNuevo(), contrasena: CONTRASENA,
      cedula_profesional: cedulaNueva(), ...cambios,
    });
    expect(res.status).toBe(400);
  });
});

describe('Visibilidad para los padres', () => {
  test('un psicólogo no validado no aparece ni tiene disponibilidad; al validarlo sí', async () => {
    const padre = await padreConSesion();
    const { id } = await psicologoConSesion({ validado: false });

    let lista = await padre.get('/api/psicologos');
    expect(lista.body.map((p) => p.id_psicologo)).not.toContain(id);
    const disponibilidad = await padre.get(`/api/psicologos/${id}/disponibilidad?fecha=${LUNES}`);
    expect(disponibilidad.status).toBe(404);

    await consulta('UPDATE psicologo SET validado = TRUE WHERE id_usuario = $1', [id]);
    lista = await padre.get('/api/psicologos');
    const encontrado = lista.body.find((p) => p.id_psicologo === id);
    expect(encontrado).toBeDefined();
    // Nunca se exponen datos de contacto ni la contraseña
    expect(encontrado).not.toHaveProperty('correo');
    expect(encontrado).not.toHaveProperty('telefono');
    expect(encontrado).not.toHaveProperty('contrasena_hash');
  });

  test('un psicólogo suspendido (activo = false) tampoco aparece', async () => {
    const padre = await padreConSesion();
    const { id } = await psicologoConSesion();
    await consulta('UPDATE usuario SET activo = FALSE WHERE id_usuario = $1', [id]);
    const lista = await padre.get('/api/psicologos');
    expect(lista.body.map((p) => p.id_psicologo)).not.toContain(id);
  });
});

describe('Horario y bloqueos del psicólogo', () => {
  test('agrega, lista, desactiva y borra bloques; rechaza traslapes', async () => {
    const { agente } = await psicologoConSesion({ validado: false, conHorario: false });

    const nuevo = await agente.post('/api/psicologos/yo/horario').send({ dia_semana: 2, hora_inicio: '09:00', hora_fin: '13:00' });
    expect(nuevo.status).toBe(201);
    expect(nuevo.body.hora_inicio).toBe('09:00');

    const traslape = await agente.post('/api/psicologos/yo/horario').send({ dia_semana: 2, hora_inicio: '12:00', hora_fin: '14:00' });
    expect(traslape.status).toBe(409);

    const contiguo = await agente.post('/api/psicologos/yo/horario').send({ dia_semana: 2, hora_inicio: '13:00', hora_fin: '15:00' });
    expect(contiguo.status).toBe(201);

    const alReves = await agente.post('/api/psicologos/yo/horario').send({ dia_semana: 3, hora_inicio: '10:00', hora_fin: '09:00' });
    expect(alReves.status).toBe(400);

    const desactivar = await agente.patch(`/api/psicologos/yo/horario/${nuevo.body.id_horario}`).send({ activo: false });
    expect(desactivar.status).toBe(200);

    const lista = await agente.get('/api/psicologos/yo/horario');
    expect(lista.body).toHaveLength(2);
    expect(lista.body.find((b) => b.id_horario === nuevo.body.id_horario).activo).toBe(false);

    const borrar = await agente.delete(`/api/psicologos/yo/horario/${nuevo.body.id_horario}`);
    expect(borrar.status).toBe(200);
  });

  test('crea bloqueos de día completo y parciales; exige las dos horas o ninguna', async () => {
    const { agente } = await psicologoConSesion({ validado: false, conHorario: false });

    const completo = await agente.post('/api/psicologos/yo/bloqueos').send({ fecha: LUNES, motivo: 'Congreso' });
    expect(completo.status).toBe(201);
    expect(completo.body.hora_inicio).toBeNull();

    const parcial = await agente.post('/api/psicologos/yo/bloqueos').send({ fecha: LUNES, hora_inicio: '10:00', hora_fin: '11:00' });
    expect(parcial.status).toBe(201);

    const unaHora = await agente.post('/api/psicologos/yo/bloqueos').send({ fecha: LUNES, hora_inicio: '10:00' });
    expect(unaHora.status).toBe(400);

    const pasado = await agente.post('/api/psicologos/yo/bloqueos').send({ fecha: '2020-01-01' });
    expect(pasado.status).toBe(400);

    const lista = await agente.get('/api/psicologos/yo/bloqueos');
    expect(lista.body).toHaveLength(2);

    const borrar = await agente.delete(`/api/psicologos/yo/bloqueos/${completo.body.id_bloqueo}`);
    expect(borrar.status).toBe(200);
  });

  test('un psicólogo no puede borrar el horario de otro', async () => {
    const a = await psicologoConSesion({ validado: false, conHorario: false });
    const b = await psicologoConSesion({ validado: false, conHorario: false });
    const bloque = await a.agente.post('/api/psicologos/yo/horario').send({ dia_semana: 4, hora_inicio: '09:00', hora_fin: '10:00' });
    const res = await b.agente.delete(`/api/psicologos/yo/horario/${bloque.body.id_horario}`);
    expect(res.status).toBe(404);
  });

  test('un padre no puede usar las rutas del psicólogo', async () => {
    const padre = await padreConSesion();
    const res = await padre.get('/api/psicologos/yo/horario');
    expect(res.status).toBe(403);
  });
});

describe('Disponibilidad', () => {
  test('divide el horario y descuenta los bloqueos', async () => {
    const padre = await padreConSesion();
    const psicologo = await psicologoConSesion();

    let res = await padre.get(`/api/psicologos/${psicologo.id}/disponibilidad?fecha=${LUNES}`);
    expect(res.status).toBe(200);
    expect(res.body.duracion_cita_min).toBe(60);
    expect(res.body.espacios.map((e) => e.hora_inicio)).toEqual(['09:00', '10:00', '11:00']);

    await psicologo.agente.post('/api/psicologos/yo/bloqueos').send({ fecha: LUNES, hora_inicio: '10:00', hora_fin: '10:30' });
    res = await padre.get(`/api/psicologos/${psicologo.id}/disponibilidad?fecha=${LUNES}`);
    expect(res.body.espacios.map((e) => e.hora_inicio)).toEqual(['09:00', '11:00']);
  });

  test.each([
    ['fecha pasada', '2020-01-06'],
    ['más de 60 días adelante', '2999-01-04'],
    ['fecha inválida', 'mañana'],
  ])('rechaza %s', async (_, fecha) => {
    const padre = await padreConSesion();
    const psicologo = await psicologoConSesion();
    const res = await padre.get(`/api/psicologos/${psicologo.id}/disponibilidad?fecha=${fecha}`);
    expect(res.status).toBe(400);
  });
});

describe('Solicitud de citas', () => {
  test('pide una cita, ocupa el espacio y aparece en la lista del padre', async () => {
    const padre = await padreConSesion();
    const psicologo = await psicologoConSesion();
    const idAplicacion = await hijoConCuestionario(padre);

    const res = await pedirCita(padre, idAplicacion, psicologo.id, '10:00');
    expect(res.status).toBe(201);
    expect(res.body).toEqual(expect.objectContaining({ hora_inicio: '10:00', hora_fin: '11:00', estado: 'solicitada' }));

    const disponibilidad = await padre.get(`/api/psicologos/${psicologo.id}/disponibilidad?fecha=${LUNES}`);
    expect(disponibilidad.body.espacios.map((e) => e.hora_inicio)).toEqual(['09:00', '11:00']);

    const lista = await padre.get('/api/citas');
    expect(lista.body).toHaveLength(1);
    expect(lista.body[0].nombre_nino).toBe('Leo');
    expect(lista.body[0]).not.toHaveProperty('correo_tutor');
  });

  test('un cuestionario solo puede tener una cita activa', async () => {
    const padre = await padreConSesion();
    const psicologo = await psicologoConSesion();
    const idAplicacion = await hijoConCuestionario(padre);

    await pedirCita(padre, idAplicacion, psicologo.id, '09:00');
    const otra = await pedirCita(padre, idAplicacion, psicologo.id, '11:00');
    expect(otra.status).toBe(409);
    expect(otra.body.error).toBe('Este cuestionario ya tiene una cita activa');
  });

  test('no se puede pedir un horario fuera de los espacios disponibles', async () => {
    const padre = await padreConSesion();
    const psicologo = await psicologoConSesion();
    const idAplicacion = await hijoConCuestionario(padre);
    const res = await pedirCita(padre, idAplicacion, psicologo.id, '15:00');
    expect(res.status).toBe(409);
  });

  test('no se puede pedir cita con el cuestionario de otro padre ni con un psicólogo no validado', async () => {
    const padreA = await padreConSesion();
    const padreB = await padreConSesion();
    const psicologo = await psicologoConSesion();
    const noValidado = await psicologoConSesion({ validado: false });
    const idAplicacion = await hijoConCuestionario(padreA);

    const ajeno = await pedirCita(padreB, idAplicacion, psicologo.id);
    expect(ajeno.status).toBe(404);

    const sinValidar = await pedirCita(padreA, idAplicacion, noValidado.id);
    expect(sinValidar.status).toBe(404);
  });

  test('DOBLE RESERVA: dos padres piden el mismo espacio al mismo tiempo y solo uno lo obtiene', async () => {
    const padreA = await padreConSesion();
    const padreB = await padreConSesion();
    const psicologo = await psicologoConSesion();
    const aplicacionA = await hijoConCuestionario(padreA);
    const aplicacionB = await hijoConCuestionario(padreB);

    // Las dos peticiones salen a la vez
    const [resA, resB] = await Promise.all([
      pedirCita(padreA, aplicacionA, psicologo.id, '09:00'),
      pedirCita(padreB, aplicacionB, psicologo.id, '09:00'),
    ]);

    const estados = [resA.status, resB.status].sort();
    expect(estados).toEqual([201, 409]);
    const rechazada = resA.status === 409 ? resA : resB;
    expect(rechazada.body.error).toMatch(/reservado por otra persona|ya no está disponible/);

    const { rows } = await consulta(
      `SELECT COUNT(*)::int AS total FROM cita WHERE id_psicologo = $1 AND fecha = $2 AND hora_inicio = '09:00'`,
      [psicologo.id, LUNES]
    );
    expect(rows[0].total).toBe(1);
  });
});

describe('Permisos sobre citas y resultados', () => {
  test('cada padre y cada psicólogo ven solo sus citas', async () => {
    const padreA = await padreConSesion();
    const padreB = await padreConSesion();
    const psicologoA = await psicologoConSesion();
    const psicologoB = await psicologoConSesion();
    const aplicacion = await hijoConCuestionario(padreA);
    const cita = await pedirCita(padreA, aplicacion, psicologoA.id);

    expect((await padreB.get('/api/citas')).body).toHaveLength(0);
    expect((await psicologoB.agente.get('/api/citas')).body).toHaveLength(0);

    const delPsicologo = await psicologoA.agente.get('/api/citas');
    expect(delPsicologo.body).toHaveLength(1);
    expect(delPsicologo.body[0]).toEqual(expect.objectContaining({ nombre_nino: 'Leo', edad_meses: 20, nivel: 'medio', puntaje_total: 4 }));

    // Ni el otro padre ni el otro psicólogo pueden tocarla
    expect((await padreB.patch(`/api/citas/${cita.body.id_cita}/cancelar`)).status).toBe(404);
    expect((await psicologoB.agente.patch(`/api/citas/${cita.body.id_cita}/confirmar`)).status).toBe(404);
    // El padre no puede confirmar
    expect((await padreA.patch(`/api/citas/${cita.body.id_cita}/confirmar`)).status).toBe(403);
  });

  test('el psicólogo ve el resultado y las respuestas solo de niños con cita con él', async () => {
    const padre = await padreConSesion();
    const psicologoA = await psicologoConSesion();
    const psicologoB = await psicologoConSesion();
    const aplicacion = await hijoConCuestionario(padre);

    // Antes de la cita nadie más que el padre lo ve
    expect((await psicologoA.agente.get(`/api/aplicaciones/${aplicacion}/resultado`)).status).toBe(403);

    const cita = await pedirCita(padre, aplicacion, psicologoA.id);
    const conCita = await psicologoA.agente.get(`/api/aplicaciones/${aplicacion}/resultado`);
    expect(conCita.status).toBe(200);
    expect(conCita.body.respuestas).toHaveLength(preguntas.length);
    expect(conCita.body.respuestas.filter((r) => r.es_riesgo)).toHaveLength(4);

    expect((await psicologoB.agente.get(`/api/aplicaciones/${aplicacion}/resultado`)).status).toBe(403);

    // Si la cita se cancela, el psicólogo pierde el acceso
    await padre.patch(`/api/citas/${cita.body.id_cita}/cancelar`);
    expect((await psicologoA.agente.get(`/api/aplicaciones/${aplicacion}/resultado`)).status).toBe(403);
  });
});

describe('Estados de la cita', () => {
  test('solicitada → confirmada → completada, con seguimiento; después ya no cambia', async () => {
    const padre = await padreConSesion();
    const psicologo = await psicologoConSesion();
    const aplicacion = await hijoConCuestionario(padre);
    const { body: cita } = await pedirCita(padre, aplicacion, psicologo.id);
    const ruta = (accion) => `/api/citas/${cita.id_cita}/${accion}`;
    const seguimiento = { puntaje_seguimiento: 1, resultado_seguimiento: 'negativo', observaciones: 'Sin señales tras la entrevista' };

    // Completar exige que esté confirmada
    expect((await psicologo.agente.patch(ruta('completar')).send(seguimiento)).status).toBe(409);

    expect((await psicologo.agente.patch(ruta('confirmar'))).status).toBe(200);
    expect((await psicologo.agente.patch(ruta('confirmar'))).status).toBe(409);

    const invalido = await psicologo.agente.patch(ruta('completar')).send({ ...seguimiento, resultado_seguimiento: 'tal vez' });
    expect(invalido.status).toBe(400);

    expect((await psicologo.agente.patch(ruta('completar')).send(seguimiento)).status).toBe(200);

    const { rows } = await consulta(
      'SELECT estado, puntaje_seguimiento, resultado_seguimiento, observaciones FROM cita WHERE id_cita = $1',
      [cita.id_cita]
    );
    expect(rows[0]).toEqual({ estado: 'completada', ...seguimiento });

    // Una cita completada ya no se puede cancelar
    const cancelar = await padre.patch(ruta('cancelar'));
    expect(cancelar.status).toBe(409);
    expect(cancelar.body.error).toBe('Esta cita ya está completada y no puede cambiar de estado');
  });

  test('una cita cancelada no cambia y libera el espacio para otra solicitud', async () => {
    const padre = await padreConSesion();
    const psicologo = await psicologoConSesion();
    const aplicacion = await hijoConCuestionario(padre);
    const { body: cita } = await pedirCita(padre, aplicacion, psicologo.id, '09:00');

    expect((await padre.patch(`/api/citas/${cita.id_cita}/cancelar`)).status).toBe(200);
    expect((await padre.patch(`/api/citas/${cita.id_cita}/cancelar`)).status).toBe(409);
    expect((await psicologo.agente.patch(`/api/citas/${cita.id_cita}/confirmar`)).status).toBe(409);

    // El mismo cuestionario puede volver a pedir cita, incluso en el mismo horario
    const otra = await pedirCita(padre, aplicacion, psicologo.id, '09:00');
    expect(otra.status).toBe(201);
  });
});
