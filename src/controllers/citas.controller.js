// Citas: solicitud (padre), consulta, cancelación, confirmación y seguimiento (psicólogo).
// La pertenencia se valida SIEMPRE en el servidor, dentro de la consulta SQL:
// un padre solo toca citas de sus hijos y un psicólogo solo las suyas.
const { consulta, transaccion } = require('../config/db');
const { ErrorHttp } = require('../middlewares/manejadorErrores');
const { espaciosDisponibles, buscarPsicologoVisible } = require('./psicologos.controller');

const PG_DUPLICADO = '23505';

// Una cita en estos estados ya no puede cambiar
const ESTADOS_FINALES = ['cancelada', 'completada'];

/**
 * Condición SQL para "esta cita pertenece al usuario".
 * `parametro` es el marcador donde va el id del usuario ($1, $2…); el valor siempre viaja
 * como parámetro de la consulta, nunca dentro del texto SQL.
 * - Padre: la cita es de un cuestionario vinculado a uno de sus hijos.
 * - Psicólogo: la cita es con él.
 */
function condicionPropietario(rol, parametro) {
  if (rol === 'padre') {
    return `c.id_aplicacion IN (
              SELECT ap.id_aplicacion FROM aplicacion ap
              JOIN nino ni ON ni.id_nino = ap.id_nino
              WHERE ni.id_tutor = ${parametro})`;
  }
  return `c.id_psicologo = ${parametro}`;
}

/**
 * POST /api/citas  (padre)
 * { id_aplicacion, id_psicologo, fecha, hora_inicio, modalidad, motivo_padre? }
 */
async function solicitarCita(req, res) {
  const {
    id_aplicacion: idAplicacion, id_psicologo: idPsicologo, fecha,
    hora_inicio: horaInicio, modalidad, motivo_padre: motivo,
  } = req.body;

  let cita;
  try {
    cita = await transaccion(async (cliente) => {
      // 1. El cuestionario debe estar terminado y ser de un hijo de este padre
      const aplicacion = await cliente.query(
        `SELECT a.estado FROM aplicacion a
         JOIN nino n ON n.id_nino = a.id_nino
         WHERE a.id_aplicacion = $1 AND n.id_tutor = $2`,
        [idAplicacion, req.usuario.id_usuario]
      );
      if (aplicacion.rowCount === 0) throw new ErrorHttp(404, 'No se encontró el cuestionario');
      if (aplicacion.rows[0].estado !== 'completada') {
        throw new ErrorHttp(409, 'El cuestionario debe estar terminado para pedir una cita');
      }

      // 2. El psicólogo debe estar validado y activo
      const psicologo = await buscarPsicologoVisible(cliente, idPsicologo);
      if (!psicologo) throw new ErrorHttp(404, 'No se encontró al psicólogo');

      // 3. El espacio debe seguir libre (se recalcula aquí, no se confía en el cliente)
      const espacios = await espaciosDisponibles(cliente, idPsicologo, fecha, psicologo.duracion_cita_min);
      const espacio = espacios.find((e) => e.hora_inicio === horaInicio);
      if (!espacio) {
        throw new ErrorHttp(409, 'Ese horario ya no está disponible. Elige otro.');
      }

      // 4. Guardar. Si otro padre reservó el mismo espacio al mismo tiempo,
      //    el índice único cita_espacio_unico rechaza esta inserción (código 23505).
      const { rows } = await cliente.query(
        `INSERT INTO cita (id_aplicacion, id_psicologo, fecha, hora_inicio, hora_fin, modalidad, motivo_padre)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id_cita, fecha, to_char(hora_inicio, 'HH24:MI') AS hora_inicio,
                   to_char(hora_fin, 'HH24:MI') AS hora_fin, modalidad, estado`,
        [idAplicacion, idPsicologo, fecha, espacio.hora_inicio, espacio.hora_fin, modalidad, motivo || null]
      );
      return rows[0];
    });
  } catch (err) {
    if (err.code === PG_DUPLICADO && err.constraint === 'cita_espacio_unico') {
      throw new ErrorHttp(409, 'Ese horario acaba de ser reservado por otra persona. Elige otro.');
    }
    if (err.code === PG_DUPLICADO && err.constraint === 'cita_una_activa_por_aplicacion') {
      throw new ErrorHttp(409, 'Este cuestionario ya tiene una cita activa');
    }
    throw err;
  }

  res.status(201).json(cita);
}

/**
 * GET /api/citas
 * El padre ve las citas de sus hijos (con el nombre del psicólogo).
 * El psicólogo ve las suyas (con datos del niño, su resultado y el contacto del tutor).
 */
async function listarCitas(req, res) {
  const { rol, id_usuario: idUsuario } = req.usuario;

  const { rows } = await consulta(
    `SELECT c.id_cita, c.id_aplicacion, c.fecha,
            to_char(c.hora_inicio, 'HH24:MI') AS hora_inicio,
            to_char(c.hora_fin, 'HH24:MI') AS hora_fin,
            c.modalidad, c.estado, c.motivo_padre,
            c.puntaje_seguimiento, c.resultado_seguimiento, c.observaciones, c.fecha_solicitud,
            n.id_nino, n.nombre AS nombre_nino, a.edad_meses, a.puntaje_total, nr.nombre AS nivel,
            up.nombre AS nombre_psicologo, up.apellidos AS apellidos_psicologo,
            ut.nombre AS nombre_tutor, ut.apellidos AS apellidos_tutor,
            ut.correo AS correo_tutor, ut.telefono AS telefono_tutor
     FROM cita c
     JOIN aplicacion a ON a.id_aplicacion = c.id_aplicacion
     JOIN nino n ON n.id_nino = a.id_nino
     JOIN usuario ut ON ut.id_usuario = n.id_tutor
     JOIN usuario up ON up.id_usuario = c.id_psicologo
     LEFT JOIN nivel_riesgo nr ON nr.id_nivel = a.id_nivel
     WHERE ${condicionPropietario(rol, '$1')}
     ORDER BY c.fecha DESC, c.hora_inicio DESC`,
    [idUsuario]
  );

  // El padre no necesita ver sus propios datos de contacto en cada cita
  if (rol === 'padre') {
    for (const cita of rows) {
      delete cita.correo_tutor;
      delete cita.telefono_tutor;
    }
  }
  res.json(rows);
}

/**
 * Cambia el estado de una cita que pertenece al usuario.
 * @param {object} usuario   req.usuario
 * @param {number} idCita
 * @param {object} cambio    { desde: estados permitidos, hacia: nuevo estado, mensaje: error si no aplica,
 *                             columnas: valores extra a guardar (por ejemplo, el seguimiento) }
 */
async function cambiarEstadoCita(usuario, idCita, cambio) {
  return transaccion(async (cliente) => {
    // FOR UPDATE bloquea la cita mientras se decide, para evitar cambios simultáneos
    const { rows } = await cliente.query(
      `SELECT c.estado FROM cita c WHERE c.id_cita = $1 AND ${condicionPropietario(usuario.rol, '$2')} FOR UPDATE`,
      [idCita, usuario.id_usuario]
    );
    if (rows.length === 0) throw new ErrorHttp(404, 'No se encontró la cita');

    const estadoActual = rows[0].estado;
    if (ESTADOS_FINALES.includes(estadoActual)) {
      throw new ErrorHttp(409, `Esta cita ya está ${estadoActual} y no puede cambiar de estado`);
    }
    if (!cambio.desde.includes(estadoActual)) {
      throw new ErrorHttp(409, cambio.mensaje);
    }

    const columnas = cambio.columnas || {};
    const nombres = Object.keys(columnas); // nombres fijos definidos en este archivo, no del usuario
    const asignaciones = nombres.map((nombre, i) => `, ${nombre} = $${i + 3}`).join('');
    await cliente.query(
      `UPDATE cita SET estado = $2${asignaciones} WHERE id_cita = $1`,
      [idCita, cambio.hacia, ...nombres.map((n) => columnas[n])]
    );
    return cambio.hacia;
  });
}

/** PATCH /api/citas/:id/cancelar  (padre o psicólogo) */
async function cancelarCita(req, res) {
  await cambiarEstadoCita(req.usuario, req.params.id, {
    desde: ['solicitada', 'confirmada'],
    hacia: 'cancelada',
    mensaje: 'Esta cita no se puede cancelar',
  });
  res.json({ mensaje: 'Cita cancelada', estado: 'cancelada' });
}

/** PATCH /api/citas/:id/confirmar  (psicólogo) */
async function confirmarCita(req, res) {
  await cambiarEstadoCita(req.usuario, req.params.id, {
    desde: ['solicitada'],
    hacia: 'confirmada',
    mensaje: 'Solo se pueden confirmar citas solicitadas',
  });
  res.json({ mensaje: 'Cita confirmada', estado: 'confirmada' });
}

/** PATCH /api/citas/:id/completar  (psicólogo) — registra la entrevista de seguimiento */
async function completarCita(req, res) {
  const { puntaje_seguimiento: puntaje, resultado_seguimiento: resultado, observaciones } = req.body;
  await cambiarEstadoCita(req.usuario, req.params.id, {
    desde: ['confirmada'],
    hacia: 'completada',
    mensaje: 'Primero confirma la cita; solo se registra el seguimiento de citas confirmadas',
    columnas: {
      puntaje_seguimiento: puntaje,
      resultado_seguimiento: resultado,
      observaciones: observaciones || null,
    },
  });
  res.json({ mensaje: 'Seguimiento registrado', estado: 'completada' });
}

module.exports = { solicitarCita, listarCitas, cancelarCita, confirmarCita, completarCita };
