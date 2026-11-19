// Cálculos de edad. Funciones puras que trabajan con fechas en texto 'AAAA-MM-DD'
// (así llegan los DATE desde PostgreSQL) para evitar problemas de zona horaria.

/**
 * Meses cumplidos entre dos fechas.
 * Ejemplo: de '2024-03-15' a '2025-11-14' son 19 meses (el día 15 aún no se cumple el mes 20).
 * @param {string} fechaNacimiento 'AAAA-MM-DD'
 * @param {string} fechaReferencia 'AAAA-MM-DD'
 */
function calcularEdadMeses(fechaNacimiento, fechaReferencia) {
  const [anio1, mes1, dia1] = fechaNacimiento.split('-').map(Number);
  const [anio2, mes2, dia2] = fechaReferencia.split('-').map(Number);

  let meses = (anio2 - anio1) * 12 + (mes2 - mes1);
  if (dia2 < dia1) meses -= 1; // todavía no cumple el mes en curso
  return meses;
}

/**
 * Indica si la edad calculada coincide con la declarada en el cuestionario,
 * con una tolerancia de ±1 mes (el padre pudo redondear).
 */
function edadCoincide(edadCalculada, edadDeclarada, tolerancia = 1) {
  return Math.abs(edadCalculada - edadDeclarada) <= tolerancia;
}

/** Fecha de hoy en texto 'AAAA-MM-DD' según la zona horaria del proceso (Ciudad de México). */
function fechaHoy() {
  const hoy = new Date();
  const mes = String(hoy.getMonth() + 1).padStart(2, '0');
  const dia = String(hoy.getDate()).padStart(2, '0');
  return `${hoy.getFullYear()}-${mes}-${dia}`;
}

module.exports = { calcularEdadMeses, edadCoincide, fechaHoy };
