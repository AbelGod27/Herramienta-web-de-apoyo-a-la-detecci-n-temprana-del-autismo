// Estadísticas ANÓNIMAS para los administradores.
// Todas las consultas devuelven solo conteos y promedios (COUNT, AVG):
// nunca nombres, correos, fechas de nacimiento ni identificadores de niños.
const { consulta } = require('../config/db');

const RANGOS_EDAD = ['16–20', '21–25', '26–30'];
const ESTADOS_CITA = ['solicitada', 'confirmada', 'cancelada', 'completada'];

/** Porcentaje con un decimal (0 si el total es 0). */
function porcentaje(parte, total) {
  return total === 0 ? 0 : Math.round((parte / total) * 1000) / 10;
}

async function obtenerEstadisticas() {
  // 1. Resumen de cuestionarios
  const resumen = (await consulta(
    `SELECT COUNT(*) FILTER (WHERE estado = 'completada')::int AS completados,
            COUNT(*) FILTER (WHERE estado = 'en_curso')::int AS en_curso,
            COUNT(*) FILTER (WHERE estado = 'completada' AND id_nino IS NOT NULL)::int AS vinculados,
            ROUND(AVG(puntaje_total) FILTER (WHERE estado = 'completada'), 1) AS puntaje_promedio
     FROM aplicacion`
  )).rows[0];
  const completados = resumen.completados;

  // 2. Distribución por nivel de riesgo (incluye los niveles sin cuestionarios)
  const porNivel = (await consulta(
    `SELECT n.nombre AS nivel, n.puntaje_min, n.puntaje_max, COUNT(a.id_aplicacion)::int AS total
     FROM nivel_riesgo n
     LEFT JOIN aplicacion a ON a.id_nivel = n.id_nivel AND a.estado = 'completada'
     GROUP BY n.id_nivel
     ORDER BY n.puntaje_min`
  )).rows;

  // 3. Por rango de edad
  const filasEdad = (await consulta(
    `SELECT CASE WHEN edad_meses <= 20 THEN '16–20'
                 WHEN edad_meses <= 25 THEN '21–25'
                 ELSE '26–30' END AS rango,
            COUNT(*)::int AS total
     FROM aplicacion
     WHERE estado = 'completada'
     GROUP BY 1`
  )).rows;
  const porEdad = RANGOS_EDAD.map((rango) => {
    const fila = filasEdad.find((f) => f.rango === rango);
    const total = fila ? fila.total : 0;
    return { rango, total, porcentaje: porcentaje(total, completados) };
  });

  // 4. Por mes, últimos 12 meses (generate_series incluye los meses sin cuestionarios)
  const porMes = (await consulta(
    `SELECT to_char(m.mes, 'YYYY-MM') AS mes, COUNT(a.id_aplicacion)::int AS total
     FROM generate_series(date_trunc('month', NOW()) - INTERVAL '11 months',
                          date_trunc('month', NOW()),
                          INTERVAL '1 month') AS m(mes)
     LEFT JOIN aplicacion a
       ON a.estado = 'completada' AND date_trunc('month', a.fecha_fin) = m.mes
     GROUP BY m.mes
     ORDER BY m.mes`
  )).rows;

  // 5. Citas por estado
  const filasCitas = (await consulta(
    'SELECT estado, COUNT(*)::int AS total FROM cita GROUP BY estado'
  )).rows;
  const citasPorEstado = ESTADOS_CITA.map((estado) => {
    const fila = filasCitas.find((f) => f.estado === estado);
    return { estado, total: fila ? fila.total : 0 };
  });

  // 6. Resultado de la entrevista de seguimiento (solo citas completadas).
  //    Se agrupa por el PUNTAJE de seguimiento, no por el texto libre "resultado_seguimiento",
  //    porque un texto libre podría contener datos personales.
  //    En el M-CHAT-R/F, un puntaje de seguimiento de 2 o más se considera positivo.
  const seguimiento = (await consulta(
    `SELECT COUNT(*)::int AS completadas,
            COUNT(*) FILTER (WHERE puntaje_seguimiento >= 2)::int AS positivas,
            COUNT(*) FILTER (WHERE puntaje_seguimiento < 2)::int AS negativas,
            COUNT(*) FILTER (WHERE puntaje_seguimiento IS NULL)::int AS sin_puntaje,
            ROUND(AVG(puntaje_seguimiento), 1) AS puntaje_promedio
     FROM cita
     WHERE estado = 'completada'`
  )).rows[0];

  // 7. Cuentas
  const usuarios = (await consulta(
    `SELECT COUNT(*) FILTER (WHERE r.nombre = 'padre')::int AS padres,
            COUNT(*) FILTER (WHERE r.nombre = 'psicologo' AND p.validado)::int AS psicologos_validados,
            COUNT(*) FILTER (WHERE r.nombre = 'psicologo' AND NOT p.validado)::int AS psicologos_pendientes,
            COUNT(*) FILTER (WHERE NOT u.activo)::int AS cuentas_suspendidas
     FROM usuario u
     JOIN rol r ON r.id_rol = u.id_rol
     LEFT JOIN psicologo p ON p.id_usuario = u.id_usuario`
  )).rows[0];

  return {
    resumen: {
      completados,
      en_curso: resumen.en_curso,
      vinculados: resumen.vinculados,
      porcentaje_vinculados: porcentaje(resumen.vinculados, completados),
      // AVG llega como texto desde PostgreSQL (tipo numeric): se convierte a número
      puntaje_promedio: resumen.puntaje_promedio === null ? null : Number(resumen.puntaje_promedio),
    },
    por_nivel: porNivel.map((n) => ({ ...n, porcentaje: porcentaje(n.total, completados) })),
    por_edad: porEdad,
    por_mes: porMes,
    citas_por_estado: citasPorEstado,
    seguimiento: {
      ...seguimiento,
      puntaje_promedio: seguimiento.puntaje_promedio === null ? null : Number(seguimiento.puntaje_promedio),
    },
    usuarios,
  };
}

module.exports = { obtenerEstadisticas };
