// Psicólogos: registro, perfil, horario semanal, bloqueos y disponibilidad.
const bcrypt = require('bcrypt');
const config = require('../config/env');
const { pool, consulta, transaccion } = require('../config/db');
const { ErrorHttp } = require('../middlewares/manejadorErrores');
const { iniciarSesion } = require('../middlewares/autenticacion');
const { fechaHoy } = require('../services/edad.service');
const { calcularEspacios, diaSemanaDeFecha, aMinutos, seCruzan } = require('../services/disponibilidad.service');

// Código de PostgreSQL para violación de UNIQUE
const PG_DUPLICADO = '23505';

// Las horas TIME se devuelven como 'HH:MM' para que el cliente no tenga que recortarlas
const HORAS = "to_char(hora_inicio, 'HH24:MI') AS hora_inicio, to_char(hora_fin, 'HH24:MI') AS hora_fin";

// ---------------------------------------------------------------------
// Registro (público)
// ---------------------------------------------------------------------

/**
 * POST /api/psicologos/registro
 * Crea la cuenta con activo = true y validado = false: puede entrar y configurar su horario,
 * pero no aparece para los padres hasta que un administrador valide su cédula.
 */
async function registrarPsicologo(req, res) {
  const {
    nombre, apellidos, correo, contrasena, telefono,
    cedula_profesional: cedula, especialidad, descripcion, duracion_cita_min: duracion,
  } = req.body;
  const contrasenaHash = await bcrypt.hash(contrasena, config.bcryptRondas);

  let usuario;
  try {
    usuario = await transaccion(async (cliente) => {
      // El rol se busca por nombre, nunca por un id fijo
      const { rows } = await cliente.query(
        `INSERT INTO usuario (id_rol, correo, contrasena_hash, nombre, apellidos, telefono)
         SELECT id_rol, $1, $2, $3, $4, $5 FROM rol WHERE nombre = 'psicologo'
         RETURNING id_usuario, correo, nombre, apellidos`,
        [correo, contrasenaHash, nombre, apellidos, telefono || null]
      );
      if (rows.length === 0) throw new Error('No existe el rol "psicologo" en la tabla rol');

      await cliente.query(
        `INSERT INTO psicologo (id_usuario, cedula_profesional, especialidad, descripcion, duracion_cita_min)
         VALUES ($1, $2, $3, $4, $5)`,
        [rows[0].id_usuario, cedula, especialidad || null, descripcion || null, duracion || 60]
      );

      return { ...rows[0], rol: 'psicologo' };
    });
  } catch (err) {
    if (err.code === PG_DUPLICADO) {
      // err.constraint dice qué restricción UNIQUE falló
      if (err.constraint && err.constraint.includes('cedula')) {
        throw new ErrorHttp(409, 'Ya existe una cuenta con esa cédula profesional.');
      }
      throw new ErrorHttp(409, 'Ya existe una cuenta con ese correo. Inicia sesión.');
    }
    throw err;
  }

  iniciarSesion(res, usuario);
  res.status(201).json({ usuario });
}

// ---------------------------------------------------------------------
// Para padres: lista y disponibilidad
// ---------------------------------------------------------------------

/**
 * GET /api/psicologos
 * Solo psicólogos validados y con cuenta activa. Nunca se envía correo, teléfono ni contraseña.
 */
async function listarPsicologos(req, res) {
  const { rows } = await consulta(
    `SELECT p.id_usuario AS id_psicologo, u.nombre, u.apellidos,
            p.especialidad, p.descripcion, p.duracion_cita_min
     FROM psicologo p
     JOIN usuario u ON u.id_usuario = p.id_usuario
     WHERE p.validado = TRUE AND u.activo = TRUE
     ORDER BY u.apellidos, u.nombre`
  );
  res.json(rows);
}

/** Momento actual: fecha 'AAAA-MM-DD' y minutos desde la medianoche (zona de la Ciudad de México). */
function momentoActual() {
  const ahora = new Date();
  return { fecha: fechaHoy(), minutos: ahora.getHours() * 60 + ahora.getMinutes() };
}

/**
 * Lee de la BD lo necesario y calcula los espacios libres de un psicólogo en una fecha.
 * Recibe `ejecutor` (el pool o el cliente de una transacción) para poder usarse
 * también al reservar una cita, dentro de la misma transacción.
 */
async function espaciosDisponibles(ejecutor, idPsicologo, fecha, duracionMin) {
  const diaSemana = diaSemanaDeFecha(fecha);

  const horarios = await ejecutor.query(
    `SELECT dia_semana, ${HORAS}, activo
     FROM horario_psicologo
     WHERE id_psicologo = $1 AND dia_semana = $2 AND activo = TRUE`,
    [idPsicologo, diaSemana]
  );
  const bloqueos = await ejecutor.query(
    `SELECT fecha, ${HORAS} FROM bloqueo_horario WHERE id_psicologo = $1 AND fecha = $2`,
    [idPsicologo, fecha]
  );
  const citas = await ejecutor.query(
    `SELECT fecha, ${HORAS}, estado FROM cita
     WHERE id_psicologo = $1 AND fecha = $2 AND estado <> 'cancelada'`,
    [idPsicologo, fecha]
  );

  // El cálculo se hace con la función pura del servicio
  return calcularEspacios({
    fecha,
    diaSemana,
    horarios: horarios.rows,
    bloqueos: bloqueos.rows,
    citas: citas.rows,
    duracionMin,
    ahora: momentoActual(),
  });
}

/** Busca un psicólogo que los padres puedan ver (validado y activo). Devuelve null si no existe. */
async function buscarPsicologoVisible(ejecutor, idPsicologo) {
  const { rows } = await ejecutor.query(
    `SELECT p.id_usuario, p.duracion_cita_min
     FROM psicologo p
     JOIN usuario u ON u.id_usuario = p.id_usuario
     WHERE p.id_usuario = $1 AND p.validado = TRUE AND u.activo = TRUE`,
    [idPsicologo]
  );
  return rows[0] || null;
}

/** GET /api/psicologos/:id/disponibilidad?fecha=AAAA-MM-DD */
async function obtenerDisponibilidad(req, res) {
  const { id } = req.params;
  const { fecha } = req.query;

  const psicologo = await buscarPsicologoVisible(pool, id);
  if (!psicologo) throw new ErrorHttp(404, 'No se encontró al psicólogo');

  const espacios = await espaciosDisponibles(pool, id, fecha, psicologo.duracion_cita_min);
  res.json({ fecha, duracion_cita_min: psicologo.duracion_cita_min, espacios });
}

// ---------------------------------------------------------------------
// Para el psicólogo con sesión: perfil
// ---------------------------------------------------------------------

/** GET /api/psicologos/yo */
async function obtenerPerfil(req, res) {
  const { rows } = await consulta(
    `SELECT u.id_usuario, u.nombre, u.apellidos, u.correo, u.telefono,
            p.cedula_profesional, p.especialidad, p.descripcion, p.duracion_cita_min,
            p.validado, p.fecha_validacion
     FROM usuario u
     JOIN psicologo p ON p.id_usuario = u.id_usuario
     WHERE u.id_usuario = $1`,
    [req.usuario.id_usuario]
  );
  if (rows.length === 0) throw new ErrorHttp(404, 'No se encontró el perfil del psicólogo');
  res.json(rows[0]);
}

/** PUT /api/psicologos/yo — especialidad, descripción y duración de la cita */
async function actualizarPerfil(req, res) {
  const { especialidad, descripcion, duracion_cita_min: duracion } = req.body;
  await consulta(
    `UPDATE psicologo SET especialidad = $2, descripcion = $3, duracion_cita_min = $4
     WHERE id_usuario = $1`,
    [req.usuario.id_usuario, especialidad || null, descripcion || null, duracion]
  );
  res.json({ mensaje: 'Perfil actualizado' });
}

// ---------------------------------------------------------------------
// Horario semanal
// ---------------------------------------------------------------------

/** GET /api/psicologos/yo/horario */
async function listarHorario(req, res) {
  const { rows } = await consulta(
    `SELECT id_horario, dia_semana, ${HORAS}, activo
     FROM horario_psicologo
     WHERE id_psicologo = $1
     ORDER BY dia_semana, hora_inicio`,
    [req.usuario.id_usuario]
  );
  res.json(rows);
}

/** POST /api/psicologos/yo/horario — agrega un bloque; no puede cruzarse con otro del mismo día */
async function agregarHorario(req, res) {
  const { dia_semana: dia, hora_inicio: inicio, hora_fin: fin } = req.body;
  const idPsicologo = req.usuario.id_usuario;

  const bloque = await transaccion(async (cliente) => {
    const existentes = await cliente.query(
      `SELECT ${HORAS} FROM horario_psicologo WHERE id_psicologo = $1 AND dia_semana = $2`,
      [idPsicologo, dia]
    );
    const seTraslapa = existentes.rows.some((b) =>
      seCruzan(aMinutos(inicio), aMinutos(fin), aMinutos(b.hora_inicio), aMinutos(b.hora_fin))
    );
    if (seTraslapa) {
      throw new ErrorHttp(409, 'Ese horario se cruza con otro bloque del mismo día');
    }

    const { rows } = await cliente.query(
      `INSERT INTO horario_psicologo (id_psicologo, dia_semana, hora_inicio, hora_fin)
       VALUES ($1, $2, $3, $4)
       RETURNING id_horario, dia_semana, ${HORAS}, activo`,
      [idPsicologo, dia, inicio, fin]
    );
    return rows[0];
  });

  res.status(201).json(bloque);
}

/** PATCH /api/psicologos/yo/horario/:id — activar o desactivar un bloque */
async function cambiarEstadoHorario(req, res) {
  const { rowCount } = await consulta(
    'UPDATE horario_psicologo SET activo = $3 WHERE id_horario = $1 AND id_psicologo = $2',
    [req.params.id, req.usuario.id_usuario, req.body.activo]
  );
  if (rowCount === 0) throw new ErrorHttp(404, 'No se encontró el bloque de horario');
  res.json({ mensaje: req.body.activo ? 'Bloque activado' : 'Bloque desactivado' });
}

/** DELETE /api/psicologos/yo/horario/:id */
async function borrarHorario(req, res) {
  const { rowCount } = await consulta(
    'DELETE FROM horario_psicologo WHERE id_horario = $1 AND id_psicologo = $2',
    [req.params.id, req.usuario.id_usuario]
  );
  if (rowCount === 0) throw new ErrorHttp(404, 'No se encontró el bloque de horario');
  res.json({ mensaje: 'Bloque eliminado' });
}

// ---------------------------------------------------------------------
// Bloqueos (vacaciones, días inhábiles, etc.)
// ---------------------------------------------------------------------

/** GET /api/psicologos/yo/bloqueos — solo de hoy en adelante */
async function listarBloqueos(req, res) {
  const { rows } = await consulta(
    `SELECT id_bloqueo, fecha, ${HORAS}, motivo
     FROM bloqueo_horario
     WHERE id_psicologo = $1 AND fecha >= $2
     ORDER BY fecha, hora_inicio NULLS FIRST`,
    [req.usuario.id_usuario, fechaHoy()]
  );
  res.json(rows);
}

/** POST /api/psicologos/yo/bloqueos — sin horas = día completo */
async function crearBloqueo(req, res) {
  const { fecha, hora_inicio: inicio, hora_fin: fin, motivo } = req.body;
  const { rows } = await consulta(
    `INSERT INTO bloqueo_horario (id_psicologo, fecha, hora_inicio, hora_fin, motivo)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id_bloqueo, fecha, ${HORAS}, motivo`,
    [req.usuario.id_usuario, fecha, inicio || null, fin || null, motivo || null]
  );
  res.status(201).json(rows[0]);
}

/** DELETE /api/psicologos/yo/bloqueos/:id */
async function borrarBloqueo(req, res) {
  const { rowCount } = await consulta(
    'DELETE FROM bloqueo_horario WHERE id_bloqueo = $1 AND id_psicologo = $2',
    [req.params.id, req.usuario.id_usuario]
  );
  if (rowCount === 0) throw new ErrorHttp(404, 'No se encontró el bloqueo');
  res.json({ mensaje: 'Bloqueo eliminado' });
}

module.exports = {
  registrarPsicologo,
  listarPsicologos,
  obtenerDisponibilidad,
  obtenerPerfil,
  actualizarPerfil,
  listarHorario,
  agregarHorario,
  cambiarEstadoHorario,
  borrarHorario,
  listarBloqueos,
  crearBloqueo,
  borrarBloqueo,
  // Se usan también al reservar una cita
  espaciosDisponibles,
  buscarPsicologoVisible,
};
