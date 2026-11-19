// Controladores del cuestionario anónimo: preguntas, aplicación, respuestas y resultado.
const { consulta, transaccion } = require('../config/db');
const { ErrorHttp } = require('../middlewares/manejadorErrores');
const { calcularResultado } = require('../services/puntaje.service');
const { calcularEdadMeses, edadCoincide, fechaHoy } = require('../services/edad.service');

// Código de error de PostgreSQL cuando una llave foránea no existe
const PG_LLAVE_FORANEA = '23503';

/**
 * GET /api/preguntas
 * Devuelve las preguntas en orden. No se envía riesgo_si_responde:
 * el cálculo se hace en el servidor y el padre no necesita saber qué respuesta suma puntos.
 */
async function obtenerPreguntas(req, res) {
  const { rows } = await consulta(
    'SELECT id_pregunta, numero, texto, ejemplo FROM pregunta ORDER BY numero'
  );
  res.json(rows);
}

/**
 * POST /api/aplicaciones   { fecha_nacimiento, semanas_gestacion? }
 * Crea una aplicación anónima (sin niño) y devuelve su identificador UUID.
 * La fecha de nacimiento solo se usa para calcular la edad en meses: no se guarda.
 */
async function crearAplicacion(req, res) {
  const { fecha_nacimiento: fechaNacimiento, semanas_gestacion: semanasGestacion } = req.body;
  const edadMeses = calcularEdadMeses(fechaNacimiento, fechaHoy());

  const { rows } = await consulta(
    'INSERT INTO aplicacion (edad_meses, semanas_gestacion) VALUES ($1, $2) RETURNING id_aplicacion',
    [edadMeses, semanasGestacion ?? null]
  );

  res.status(201).json({ id_aplicacion: rows[0].id_aplicacion, edad_meses: edadMeses });
}

/**
 * Bloquea la fila de la aplicación dentro de una transacción (FOR UPDATE)
 * y comprueba que exista y siga en curso. Así dos peticiones simultáneas
 * no pueden modificarla al mismo tiempo.
 */
async function bloquearAplicacionEnCurso(cliente, idAplicacion) {
  const { rows } = await cliente.query(
    'SELECT estado FROM aplicacion WHERE id_aplicacion = $1 FOR UPDATE',
    [idAplicacion]
  );
  if (rows.length === 0) {
    throw new ErrorHttp(404, 'No se encontró el cuestionario');
  }
  if (rows[0].estado !== 'en_curso') {
    throw new ErrorHttp(409, 'Este cuestionario ya fue terminado y no se puede modificar');
  }
}

/**
 * PUT /api/aplicaciones/:id/respuestas
 * Guarda una o varias respuestas. Si una pregunta ya tenía respuesta, se actualiza
 * (el padre puede regresar y cambiarla mientras no termine).
 */
async function guardarRespuestas(req, res) {
  const { id } = req.params;
  const { respuestas } = req.body;

  const idsPreguntas = respuestas.map((r) => r.id_pregunta);
  if (new Set(idsPreguntas).size !== idsPreguntas.length) {
    throw new ErrorHttp(400, 'Hay preguntas repetidas en las respuestas');
  }
  const valores = respuestas.map((r) => r.valor);

  try {
    await transaccion(async (cliente) => {
      await bloquearAplicacionEnCurso(cliente, id);

      // unnest convierte los dos arreglos en filas (id_pregunta, valor) para insertar todo de una vez
      await cliente.query(
        `INSERT INTO respuesta (id_aplicacion, id_pregunta, valor)
         SELECT $1, t.id_pregunta, t.valor
         FROM unnest($2::int[], $3::boolean[]) AS t(id_pregunta, valor)
         ON CONFLICT (id_aplicacion, id_pregunta) DO UPDATE SET valor = EXCLUDED.valor`,
        [id, idsPreguntas, valores]
      );
    });
  } catch (err) {
    if (err.code === PG_LLAVE_FORANEA) {
      throw new ErrorHttp(400, 'Alguna de las preguntas no existe');
    }
    throw err;
  }

  res.json({ guardadas: respuestas.length });
}

/**
 * POST /api/aplicaciones/:id/finalizar
 * Calcula el puntaje y el nivel de riesgo, y marca la aplicación como completada.
 */
async function finalizarAplicacion(req, res) {
  const { id } = req.params;

  await transaccion(async (cliente) => {
    await bloquearAplicacionEnCurso(cliente, id);

    // 1. Leer los datos que necesita el algoritmo
    const preguntas = (await cliente.query(
      'SELECT id_pregunta, numero, riesgo_si_responde FROM pregunta ORDER BY numero'
    )).rows;
    const respuestas = (await cliente.query(
      'SELECT id_pregunta, valor FROM respuesta WHERE id_aplicacion = $1',
      [id]
    )).rows;
    const niveles = (await cliente.query(
      'SELECT id_nivel, nombre, puntaje_min, puntaje_max FROM nivel_riesgo'
    )).rows;

    // 2. Calcular con la función pura del servicio
    let resultado;
    try {
      resultado = calcularResultado(respuestas, preguntas, niveles);
    } catch (err) {
      if (err.codigo === 'RESPUESTAS_INCOMPLETAS') throw new ErrorHttp(400, err.message);
      throw err; // un nivel no configurado es un error del catálogo (500)
    }

    // 3. Guardar es_riesgo en cada respuesta
    await cliente.query(
      `UPDATE respuesta r
       SET es_riesgo = t.es_riesgo
       FROM unnest($2::int[], $3::boolean[]) AS t(id_pregunta, es_riesgo)
       WHERE r.id_aplicacion = $1 AND r.id_pregunta = t.id_pregunta`,
      [id, resultado.detalle.map((d) => d.id_pregunta), resultado.detalle.map((d) => d.es_riesgo)]
    );

    // 4. Guardar el resultado en la aplicación
    await cliente.query(
      `UPDATE aplicacion
       SET puntaje_total = $2, id_nivel = $3, fecha_fin = NOW(), estado = 'completada'
       WHERE id_aplicacion = $1`,
      [id, resultado.puntaje, resultado.nivel.id_nivel]
    );
  });

  res.json(await buscarResultado(id));
}

/**
 * GET /api/aplicaciones/:id/resultado
 * Devuelve el resultado de una aplicación terminada.
 * - Anónima: cualquiera que tenga su identificador (UUID) puede verla.
 * - Vinculada a un niño: solo su padre o tutor con sesión iniciada.
 */
async function obtenerResultado(req, res) {
  res.json(await buscarResultado(req.params.id, req.usuario));
}

/** Lee el resultado de una aplicación y aplica las reglas de acceso. */
async function buscarResultado(idAplicacion, usuario = null) {
  const { rows } = await consulta(
    `SELECT a.id_aplicacion, a.id_nino, a.edad_meses, a.semanas_gestacion, a.estado,
            a.puntaje_total, a.fecha_fin,
            n.nombre AS nivel, n.recomendacion,
            ni.nombre AS nombre_nino, ni.id_tutor,
            (SELECT COUNT(*)::int FROM pregunta) AS total_preguntas,
            -- ¿El usuario (si es psicólogo) tiene una cita no cancelada para esta aplicación?
            EXISTS (SELECT 1 FROM cita c
                    WHERE c.id_aplicacion = a.id_aplicacion
                      AND c.id_psicologo = $2
                      AND c.estado <> 'cancelada') AS tiene_cita_con_psicologo
     FROM aplicacion a
     LEFT JOIN nivel_riesgo n ON n.id_nivel = a.id_nivel
     LEFT JOIN nino ni ON ni.id_nino = a.id_nino
     WHERE a.id_aplicacion = $1`,
    [idAplicacion, usuario && usuario.rol === 'psicologo' ? usuario.id_usuario : null]
  );

  if (rows.length === 0) {
    throw new ErrorHttp(404, 'No se encontró el cuestionario');
  }
  const aplicacion = rows[0];

  if (aplicacion.estado !== 'completada') {
    throw new ErrorHttp(409, 'El cuestionario todavía no está terminado');
  }

  // Una vez vinculada a un niño, el resultado deja de ser anónimo:
  // solo lo ven su padre o tutor y el psicólogo que tiene una cita (no cancelada) para él
  if (aplicacion.id_nino !== null) {
    const esSuTutor = usuario && usuario.rol === 'padre' && usuario.id_usuario === aplicacion.id_tutor;
    const esSuPsicologo = aplicacion.tiene_cita_con_psicologo;
    if (!esSuTutor && !esSuPsicologo) {
      throw new ErrorHttp(403, 'Este resultado está vinculado a una cuenta. Inicia sesión para consultarlo.');
    }
  }

  // Respuesta a cada pregunta, en orden, para que el padre vea qué contestó
  const respuestas = await consulta(
    `SELECT p.numero, p.texto, r.valor, r.es_riesgo
     FROM respuesta r
     JOIN pregunta p ON p.id_pregunta = r.id_pregunta
     WHERE r.id_aplicacion = $1
     ORDER BY p.numero`,
    [idAplicacion]
  );
  aplicacion.respuestas = respuestas.rows;

  delete aplicacion.id_tutor;
  delete aplicacion.tiene_cita_con_psicologo;
  return aplicacion;
}

/**
 * POST /api/aplicaciones/:id/vincular   { id_nino }
 * Vincula una aplicación anónima terminada a un hijo del padre con sesión iniciada.
 * Reglas: la aplicación debe estar completada y sin niño, el niño debe ser de este padre
 * y la edad calculada con la fecha de nacimiento debe coincidir (±1 mes) con la del cuestionario.
 */
async function vincularAplicacion(req, res) {
  const { id } = req.params;
  const { id_nino: idNino } = req.body;

  await transaccion(async (cliente) => {
    // fecha_fin::date llega como texto 'AAAA-MM-DD' (fecha en que se contestó)
    const { rows } = await cliente.query(
      `SELECT estado, id_nino, edad_meses, fecha_fin::date AS fecha_aplicacion
       FROM aplicacion WHERE id_aplicacion = $1 FOR UPDATE`,
      [id]
    );
    const aplicacion = rows[0];
    if (!aplicacion) throw new ErrorHttp(404, 'No se encontró el cuestionario');
    if (aplicacion.estado !== 'completada') {
      throw new ErrorHttp(409, 'Termina el cuestionario antes de vincularlo');
    }
    if (aplicacion.id_nino !== null) {
      throw new ErrorHttp(409, 'Este cuestionario ya está vinculado a un niño');
    }

    // Solo se puede vincular a un hijo propio
    const ninos = await cliente.query(
      'SELECT fecha_nacimiento FROM nino WHERE id_nino = $1 AND id_tutor = $2',
      [idNino, req.usuario.id_usuario]
    );
    if (ninos.rowCount === 0) throw new ErrorHttp(404, 'No se encontró al niño');

    const edadCalculada = calcularEdadMeses(ninos.rows[0].fecha_nacimiento, aplicacion.fecha_aplicacion);
    if (!edadCoincide(edadCalculada, aplicacion.edad_meses)) {
      throw new ErrorHttp(400, 'La edad del niño no coincide con la del cuestionario');
    }

    await cliente.query('UPDATE aplicacion SET id_nino = $2 WHERE id_aplicacion = $1', [id, idNino]);
  });

  res.json({ mensaje: 'Cuestionario vinculado correctamente', id_aplicacion: id, id_nino: idNino });
}

module.exports = {
  obtenerPreguntas,
  crearAplicacion,
  guardarRespuestas,
  finalizarAplicacion,
  obtenerResultado,
  vincularAplicacion,
};
