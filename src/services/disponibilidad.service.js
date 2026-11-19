// Cálculo de los espacios disponibles para citas.
// Son funciones PURAS: reciben los datos ya leídos de la base de datos y devuelven
// la lista de espacios libres. No consultan la BD ni la hora del sistema,
// por eso se pueden probar por separado con cualquier caso.

/** Convierte 'HH:MM' o 'HH:MM:SS' en minutos desde la medianoche. '09:30' -> 570 */
function aMinutos(hora) {
  const [horas, minutos] = hora.split(':').map(Number);
  return horas * 60 + minutos;
}

/** Convierte minutos desde la medianoche en 'HH:MM'. 570 -> '09:30' */
function aHora(minutos) {
  const horas = String(Math.floor(minutos / 60)).padStart(2, '0');
  const resto = String(minutos % 60).padStart(2, '0');
  return `${horas}:${resto}`;
}

/** Dos intervalos [inicio1, fin1) y [inicio2, fin2) se cruzan si uno empieza antes de que termine el otro. */
function seCruzan(inicio1, fin1, inicio2, fin2) {
  return inicio1 < fin2 && inicio2 < fin1;
}

/**
 * Día de la semana de una fecha 'AAAA-MM-DD': 1 = lunes … 7 = domingo.
 * Se usa UTC para que la zona horaria no cambie el día.
 */
function diaSemanaDeFecha(fecha) {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  const diaJs = new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay(); // 0 = domingo
  return diaJs === 0 ? 7 : diaJs;
}

/** Días completos entre dos fechas 'AAAA-MM-DD' (positivo si `hasta` es posterior). */
function diasEntre(desde, hasta) {
  const aUtc = (fecha) => {
    const [anio, mes, dia] = fecha.split('-').map(Number);
    return Date.UTC(anio, mes - 1, dia);
  };
  return Math.round((aUtc(hasta) - aUtc(desde)) / (24 * 60 * 60 * 1000));
}

/**
 * Espacios disponibles de un psicólogo en una fecha.
 *
 * Disponibles = bloques del horario activos ese día de la semana, divididos según la duración de la cita
 *             − los que se cruzan con un bloqueo de esa fecha (día completo o un rango de horas)
 *             − los que se cruzan con citas que NO están canceladas
 *             − los que ya pasaron, si la fecha es hoy
 *
 * @param {object} datos
 * @param {string} datos.fecha        'AAAA-MM-DD'
 * @param {number} datos.diaSemana    1 = lunes … 7 = domingo
 * @param {Array<{dia_semana:number, hora_inicio:string, hora_fin:string, activo:boolean}>} datos.horarios
 * @param {Array<{fecha:string, hora_inicio:string|null, hora_fin:string|null}>} datos.bloqueos
 * @param {Array<{fecha:string, hora_inicio:string, hora_fin:string, estado:string}>} datos.citas
 * @param {number} datos.duracionMin  duración de cada cita en minutos
 * @param {{fecha:string, minutos:number}} datos.ahora  momento actual (fecha y minutos desde la medianoche)
 * @returns {Array<{hora_inicio:string, hora_fin:string}>}
 */
function calcularEspacios({ fecha, diaSemana, horarios, bloqueos, citas, duracionMin, ahora }) {
  const bloqueosDelDia = bloqueos.filter((b) => b.fecha === fecha);

  // Un bloqueo sin horas es de día completo: no hay ningún espacio
  if (bloqueosDelDia.some((b) => b.hora_inicio === null && b.hora_fin === null)) {
    return [];
  }

  // 1. Dividir cada bloque del horario en espacios de la duración de la cita
  const espacios = [];
  const bloquesDelDia = horarios
    .filter((h) => h.activo && h.dia_semana === diaSemana)
    .sort((a, b) => aMinutos(a.hora_inicio) - aMinutos(b.hora_inicio));

  for (const bloque of bloquesDelDia) {
    const fin = aMinutos(bloque.hora_fin);
    // Solo caben espacios completos: si sobran minutos al final del bloque, se descartan
    for (let inicio = aMinutos(bloque.hora_inicio); inicio + duracionMin <= fin; inicio += duracionMin) {
      espacios.push({ inicio, fin: inicio + duracionMin });
    }
  }

  // Citas que sí ocupan su horario (las canceladas liberan el espacio)
  const citasActivas = citas.filter((c) => c.fecha === fecha && c.estado !== 'cancelada');

  // 2. Quitar los espacios que no se pueden reservar
  const libres = espacios.filter((espacio) => {
    const bloqueado = bloqueosDelDia.some((b) =>
      seCruzan(espacio.inicio, espacio.fin, aMinutos(b.hora_inicio), aMinutos(b.hora_fin))
    );
    const ocupado = citasActivas.some((c) =>
      seCruzan(espacio.inicio, espacio.fin, aMinutos(c.hora_inicio), aMinutos(c.hora_fin))
    );
    const yaPaso = fecha === ahora.fecha && espacio.inicio <= ahora.minutos;
    return !bloqueado && !ocupado && !yaPaso;
  });

  // 3. Devolver las horas como texto 'HH:MM'
  return libres.map((e) => ({ hora_inicio: aHora(e.inicio), hora_fin: aHora(e.fin) }));
}

module.exports = { aMinutos, aHora, seCruzan, diaSemanaDeFecha, diasEntre, calcularEspacios };
