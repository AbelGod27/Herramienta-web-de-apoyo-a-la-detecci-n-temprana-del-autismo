// Funciones de apoyo compartidas por las pruebas.

/**
 * Fecha 'AAAA-MM-DD' de hace `meses` meses, con día ≤ 28 para evitar meses cortos.
 * Un niño nacido en esa fecha tiene hoy exactamente `meses` meses cumplidos.
 */
function haceMeses(meses) {
  const hoy = new Date();
  const total = hoy.getFullYear() * 12 + hoy.getMonth() - meses;
  const anio = Math.floor(total / 12);
  const mes = (total % 12) + 1;
  const dia = Math.min(hoy.getDate(), 28);
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

module.exports = { haceMeses };
