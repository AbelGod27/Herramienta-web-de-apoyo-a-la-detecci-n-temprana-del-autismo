// Niños del padre con sesión iniciada. Todas las consultas filtran por id_tutor:
// un padre nunca puede ver ni modificar a los hijos de otro.
const { consulta } = require('../config/db');
const { ErrorHttp } = require('../middlewares/manejadorErrores');
const { calcularEdadMeses, fechaHoy } = require('../services/edad.service');

/**
 * GET /api/ninos — lista de mis hijos con su edad actual, número de cuestionarios,
 * la edad que tenía en el último (para sugerir repetirlo a los 24 meses)
 * y el id del último cuestionario (sobre él se pide la cita de seguimiento).
 */
async function listarNinos(req, res) {
  const { rows } = await consulta(
    `SELECT n.id_nino, n.nombre, n.fecha_nacimiento, n.semanas_gestacion, n.sexo,
            COUNT(a.id_aplicacion)::int AS total_cuestionarios,
            (SELECT u.edad_meses FROM aplicacion u
             WHERE u.id_nino = n.id_nino AND u.estado = 'completada'
             ORDER BY u.fecha_fin DESC LIMIT 1) AS edad_ultimo_cuestionario,
            (SELECT u.id_aplicacion FROM aplicacion u
             WHERE u.id_nino = n.id_nino AND u.estado = 'completada'
             ORDER BY u.fecha_fin DESC LIMIT 1) AS id_ultimo_cuestionario
     FROM nino n
     LEFT JOIN aplicacion a ON a.id_nino = n.id_nino
     WHERE n.id_tutor = $1
     GROUP BY n.id_nino
     ORDER BY n.nombre`,
    [req.usuario.id_usuario]
  );

  const hoy = fechaHoy();
  res.json(rows.map((n) => ({ ...n, edad_meses: calcularEdadMeses(n.fecha_nacimiento, hoy) })));
}

/** POST /api/ninos — registrar un hijo */
async function registrarNino(req, res) {
  const { nombre, fecha_nacimiento: fechaNacimiento, semanas_gestacion: semanas, sexo } = req.body;

  const { rows } = await consulta(
    `INSERT INTO nino (id_tutor, nombre, fecha_nacimiento, semanas_gestacion, sexo)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id_nino, nombre, fecha_nacimiento, semanas_gestacion, sexo`,
    [req.usuario.id_usuario, nombre, fechaNacimiento, semanas ?? null, sexo || null]
  );

  res.status(201).json({ ...rows[0], edad_meses: calcularEdadMeses(rows[0].fecha_nacimiento, fechaHoy()) });
}

/** GET /api/ninos/:id/aplicaciones — historial de cuestionarios de un hijo */
async function historialNino(req, res) {
  const { id } = req.params;

  // Comprobar que el niño es de este padre (si no, 404: no revelamos que existe)
  const nino = await consulta('SELECT 1 FROM nino WHERE id_nino = $1 AND id_tutor = $2', [
    id,
    req.usuario.id_usuario,
  ]);
  if (nino.rowCount === 0) throw new ErrorHttp(404, 'No se encontró al niño');

  const { rows } = await consulta(
    `SELECT a.id_aplicacion, a.edad_meses, a.puntaje_total, a.fecha_fin,
            nr.nombre AS nivel
     FROM aplicacion a
     JOIN nivel_riesgo nr ON nr.id_nivel = a.id_nivel
     WHERE a.id_nino = $1 AND a.estado = 'completada'
     ORDER BY a.fecha_fin DESC`,
    [id]
  );
  res.json(rows);
}

module.exports = { listarNinos, registrarNino, historialNino };
