// Panel de administración: estadísticas anónimas, validación de psicólogos,
// gestión de cuentas y catálogos. Los permisos por rol se revisan en admin.routes.js
// y aquí se aplican las reglas finas (por ejemplo, nadie suspende al admin principal).
const bcrypt = require('bcrypt');
const config = require('../config/env');
const { consulta, transaccion } = require('../config/db');
const { ErrorHttp } = require('../middlewares/manejadorErrores');
const { obtenerEstadisticas } = require('../services/estadisticas.service');
const { rangosCubrenTodo, ordenarCambios } = require('../services/niveles.service');

// Códigos de error de PostgreSQL
const PG_DUPLICADO = '23505'; // violación de UNIQUE
const PG_TRASLAPE = '23P01'; // violación de EXCLUDE (rangos de niveles que se cruzan)

const USUARIOS_POR_PAGINA = 20;

// ---------- Estadísticas ----------

/** GET /api/admin/estadisticas — solo agregados anónimos */
async function verEstadisticas(req, res) {
  res.json(await obtenerEstadisticas());
}

// ---------- Psicólogos ----------

/** GET /api/admin/psicologos?estado=pendientes|validados|todos */
async function listarPsicologos(req, res) {
  const estado = req.query.estado || 'pendientes';
  const { rows } = await consulta(
    `SELECT u.id_usuario, u.nombre, u.apellidos, u.correo, u.telefono, u.activo, u.fecha_registro,
            p.cedula_profesional, p.especialidad, p.validado, p.fecha_validacion
     FROM psicologo p
     JOIN usuario u ON u.id_usuario = p.id_usuario
     WHERE $1::text = 'todos'
        OR ($1::text = 'pendientes' AND NOT p.validado)
        OR ($1::text = 'validados' AND p.validado)
     ORDER BY p.validado, u.fecha_registro`,
    [estado]
  );
  res.json(rows);
}

/**
 * PATCH /api/admin/psicologos/:id/validacion   { validado: true | false }
 * Validar: se guarda quién validó y cuándo. Revocar: se borran esos datos
 * y el psicólogo deja de aparecer para los padres.
 */
async function cambiarValidacion(req, res) {
  const { id } = req.params;
  const { validado } = req.body;

  const { rows } = await consulta(
    `UPDATE psicologo
     SET validado = $2::boolean,
         id_admin_valida  = CASE WHEN $2::boolean THEN $3::int ELSE NULL END,
         fecha_validacion = CASE WHEN $2::boolean THEN NOW() ELSE NULL END
     WHERE id_usuario = $1
     RETURNING id_usuario, validado, id_admin_valida, fecha_validacion`,
    [id, validado, req.usuario.id_usuario]
  );
  if (rows.length === 0) throw new ErrorHttp(404, 'No se encontró al psicólogo');

  res.json({ ...rows[0], mensaje: validado ? 'Psicólogo validado' : 'Validación revocada' });
}

// ---------- Cuentas ----------

/** GET /api/admin/usuarios?rol=&buscar=&pagina= — nunca devuelve contrasena_hash */
async function listarUsuarios(req, res) {
  const { rol, buscar } = req.query;
  const pagina = req.query.pagina || 1;

  // Se arman las condiciones según los filtros. Los VALORES siempre van como
  // parámetros ($1, $2...); solo cambia cuántos parámetros hay.
  const condiciones = [];
  const parametros = [];
  if (rol) {
    parametros.push(rol);
    condiciones.push(`r.nombre = $${parametros.length}`);
  }
  if (buscar) {
    // Se escapan % y _ para que se busquen como caracteres normales
    parametros.push(`%${buscar.replace(/[\\%_]/g, '\\$&')}%`);
    const n = parametros.length;
    condiciones.push(`(u.correo ILIKE $${n} OR u.nombre ILIKE $${n} OR u.apellidos ILIKE $${n})`);
  }
  const where = condiciones.length > 0 ? `WHERE ${condiciones.join(' AND ')}` : '';

  const total = (await consulta(
    `SELECT COUNT(*)::int AS total FROM usuario u JOIN rol r ON r.id_rol = u.id_rol ${where}`,
    parametros
  )).rows[0].total;

  const { rows } = await consulta(
    `SELECT u.id_usuario, u.nombre, u.apellidos, u.correo, r.nombre AS rol, u.activo, u.fecha_registro
     FROM usuario u
     JOIN rol r ON r.id_rol = u.id_rol
     ${where}
     ORDER BY u.fecha_registro DESC, u.id_usuario DESC
     LIMIT $${parametros.length + 1} OFFSET $${parametros.length + 2}`,
    [...parametros, USUARIOS_POR_PAGINA, (pagina - 1) * USUARIOS_POR_PAGINA]
  );

  res.json({
    usuarios: rows,
    pagina,
    total,
    total_paginas: Math.max(1, Math.ceil(total / USUARIOS_POR_PAGINA)),
  });
}

/**
 * PATCH /api/admin/usuarios/:id/activo   { activo: true | false }
 * Suspender o reactivar una cuenta (borrado SOLO lógico: nunca se borra el usuario).
 * Reglas:
 *  - Nadie cambia el estado de su propia cuenta.
 *  - Nadie suspende al administrador principal (así siempre queda alguien con acceso).
 */
async function cambiarEstadoCuenta(req, res) {
  const { id } = req.params;
  const { activo } = req.body;

  if (id === req.usuario.id_usuario) {
    throw new ErrorHttp(403, 'No puedes cambiar el estado de tu propia cuenta');
  }

  const { rows } = await consulta(
    'SELECT r.nombre AS rol FROM usuario u JOIN rol r ON r.id_rol = u.id_rol WHERE u.id_usuario = $1',
    [id]
  );
  if (rows.length === 0) throw new ErrorHttp(404, 'No se encontró la cuenta');

  const rolCuenta = rows[0].rol;
  if (rolCuenta === 'admin_principal') {
    throw new ErrorHttp(403, 'La cuenta del administrador principal no se puede suspender');
  }

  await consulta('UPDATE usuario SET activo = $2 WHERE id_usuario = $1', [id, activo]);
  res.json({ id_usuario: id, activo, mensaje: activo ? 'Cuenta reactivada' : 'Cuenta suspendida' });
}

// ---------- Administradores secundarios ----------

/** GET /api/admin/administradores */
async function listarAdministradores(req, res) {
  const { rows } = await consulta(
    `SELECT u.id_usuario, u.nombre, u.apellidos, u.correo, u.activo, u.fecha_registro
     FROM usuario u
     JOIN rol r ON r.id_rol = u.id_rol
     WHERE r.nombre = 'admin_secundario'
     ORDER BY u.fecha_registro DESC`
  );
  res.json(rows);
}

/** POST /api/admin/administradores — crea un administrador secundario */
async function crearAdministrador(req, res) {
  const { nombre, apellidos, correo, contrasena, telefono } = req.body;
  const contrasenaHash = await bcrypt.hash(contrasena, config.bcryptRondas);

  let rows;
  try {
    // El rol se busca por nombre, nunca por un id fijo
    ({ rows } = await consulta(
      `INSERT INTO usuario (id_rol, correo, contrasena_hash, nombre, apellidos, telefono)
       SELECT id_rol, $1, $2, $3, $4, $5 FROM rol WHERE nombre = 'admin_secundario'
       RETURNING id_usuario, nombre, apellidos, correo, activo, fecha_registro`,
      [correo, contrasenaHash, nombre, apellidos, telefono || null]
    ));
  } catch (err) {
    if (err.code === PG_DUPLICADO) throw new ErrorHttp(409, 'Ya existe una cuenta con ese correo');
    throw err;
  }
  if (rows.length === 0) throw new Error('No existe el rol "admin_secundario" en la tabla rol');

  res.status(201).json(rows[0]);
}

// ---------- Catálogo de preguntas ----------

/** GET /api/admin/preguntas */
async function listarPreguntas(req, res) {
  const { rows } = await consulta(
    'SELECT id_pregunta, numero, texto, ejemplo, riesgo_si_responde FROM pregunta ORDER BY numero'
  );
  res.json(rows);
}

/**
 * PUT /api/admin/preguntas/:numero   { texto, ejemplo, riesgo_si_responde }
 * Solo se editan las 20 preguntas existentes (no se crean ni se borran).
 * Cambiar riesgo_si_responde afecta a los cuestionarios que se terminen DESPUÉS;
 * los ya calificados conservan su puntaje.
 */
async function editarPregunta(req, res) {
  const { numero } = req.params;
  const { texto, ejemplo, riesgo_si_responde: riesgoSiResponde } = req.body;

  const { rows } = await consulta(
    `UPDATE pregunta SET texto = $2, ejemplo = $3, riesgo_si_responde = $4
     WHERE numero = $1
     RETURNING id_pregunta, numero, texto, ejemplo, riesgo_si_responde`,
    [numero, texto, ejemplo || null, riesgoSiResponde]
  );
  if (rows.length === 0) throw new ErrorHttp(404, 'No existe esa pregunta');

  res.json(rows[0]);
}

// ---------- Catálogo de niveles de riesgo ----------

/** GET /api/admin/niveles */
async function listarNiveles(req, res) {
  const { rows } = await consulta(
    'SELECT id_nivel, nombre, puntaje_min, puntaje_max, recomendacion FROM nivel_riesgo ORDER BY puntaje_min'
  );
  res.json(rows);
}

/**
 * PUT /api/admin/niveles   { niveles: [{ id_nivel, nombre, puntaje_min, puntaje_max, recomendacion }] }
 * Se guardan todos los niveles juntos dentro de una transacción. Al final se comprueba
 * que cubran todos los puntajes de 0 a 20 sin huecos; si no, se deshace todo (ROLLBACK).
 */
async function editarNiveles(req, res) {
  const { niveles } = req.body;

  try {
    await transaccion(async (cliente) => {
      // FOR UPDATE: nadie más puede cambiar los niveles mientras se guardan
      const actuales = (await cliente.query(
        'SELECT id_nivel, puntaje_min, puntaje_max FROM nivel_riesgo FOR UPDATE'
      )).rows;

      // Deben venir todos los niveles existentes, cada uno una sola vez
      const idsActuales = actuales.map((n) => n.id_nivel).sort((a, b) => a - b);
      const idsNuevos = niveles.map((n) => n.id_nivel).sort((a, b) => a - b);
      const mismosIds = idsActuales.length === idsNuevos.length && idsActuales.every((id, i) => id === idsNuevos[i]);
      if (!mismosIds) throw new ErrorHttp(400, 'Envía todos los niveles de riesgo, cada uno una sola vez');

      // Aplicar los cambios en un orden que evite traslapes intermedios
      for (const nivel of ordenarCambios(actuales, niveles)) {
        await cliente.query(
          `UPDATE nivel_riesgo SET nombre = $2, puntaje_min = $3, puntaje_max = $4, recomendacion = $5
           WHERE id_nivel = $1`,
          [nivel.id_nivel, nivel.nombre, nivel.puntaje_min, nivel.puntaje_max, nivel.recomendacion]
        );
      }

      // Comprobación final: los rangos deben cubrir 0–20 sin huecos
      const despues = (await cliente.query('SELECT puntaje_min, puntaje_max FROM nivel_riesgo')).rows;
      if (!rangosCubrenTodo(despues)) {
        throw new ErrorHttp(400, 'Los niveles deben cubrir todos los puntajes del 0 al 20, sin huecos');
      }
    });
  } catch (err) {
    if (err.code === PG_TRASLAPE) throw new ErrorHttp(400, 'Los rangos de dos niveles no pueden traslaparse');
    if (err.code === PG_DUPLICADO) throw new ErrorHttp(400, 'Dos niveles no pueden tener el mismo nombre');
    throw err;
  }

  const { rows } = await consulta(
    'SELECT id_nivel, nombre, puntaje_min, puntaje_max, recomendacion FROM nivel_riesgo ORDER BY puntaje_min'
  );
  res.json(rows);
}

module.exports = {
  verEstadisticas,
  listarPsicologos,
  cambiarValidacion,
  listarUsuarios,
  cambiarEstadoCuenta,
  listarAdministradores,
  crearAdministrador,
  listarPreguntas,
  editarPregunta,
  listarNiveles,
  editarNiveles,
};
