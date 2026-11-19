// Algoritmo de puntuación del cuestionario.
// Son funciones PURAS: no consultan la base de datos ni modifican sus parámetros.
// Reciben los datos ya leídos y devuelven el resultado, por eso se pueden probar por separado.

/**
 * Una respuesta indica riesgo cuando coincide con la respuesta de riesgo de la pregunta.
 * @param {boolean} valor            respuesta del padre (true = sí, false = no)
 * @param {boolean} riesgoSiResponde respuesta que indica riesgo según el catálogo
 */
function esRespuestaDeRiesgo(valor, riesgoSiResponde) {
  return valor === riesgoSiResponde;
}

/**
 * Calcula el puntaje total: 1 punto por cada respuesta que indica riesgo.
 * @param {Array<{id_pregunta:number, valor:boolean}>} respuestas
 * @param {Array<{id_pregunta:number, numero:number, riesgo_si_responde:boolean}>} preguntas
 * @returns {{puntaje:number, detalle:Array<{id_pregunta:number, es_riesgo:boolean}>}}
 */
function calcularPuntaje(respuestas, preguntas) {
  // Mapa id_pregunta -> valor para buscar cada respuesta rápidamente
  const valorPorPregunta = new Map(respuestas.map((r) => [r.id_pregunta, r.valor]));

  // Todas las preguntas del catálogo deben estar contestadas
  const faltantes = preguntas
    .filter((p) => !valorPorPregunta.has(p.id_pregunta))
    .map((p) => p.numero);

  if (faltantes.length > 0) {
    const error = new Error(`Faltan respuestas de las preguntas: ${faltantes.join(', ')}`);
    error.codigo = 'RESPUESTAS_INCOMPLETAS';
    throw error;
  }

  const detalle = preguntas.map((p) => ({
    id_pregunta: p.id_pregunta,
    es_riesgo: esRespuestaDeRiesgo(valorPorPregunta.get(p.id_pregunta), p.riesgo_si_responde),
  }));

  const puntaje = detalle.filter((d) => d.es_riesgo).length;

  return { puntaje, detalle };
}

/**
 * Busca el nivel de riesgo cuyo rango [puntaje_min, puntaje_max] contiene el puntaje.
 * @param {number} puntaje
 * @param {Array<{id_nivel:number, nombre:string, puntaje_min:number, puntaje_max:number}>} niveles
 */
function obtenerNivel(puntaje, niveles) {
  const nivel = niveles.find((n) => puntaje >= n.puntaje_min && puntaje <= n.puntaje_max);

  if (!nivel) {
    const error = new Error(`No hay un nivel de riesgo configurado para el puntaje ${puntaje}`);
    error.codigo = 'NIVEL_NO_CONFIGURADO';
    throw error;
  }

  return nivel;
}

/**
 * Calcula el resultado completo de una aplicación: puntaje, nivel y detalle por pregunta.
 */
function calcularResultado(respuestas, preguntas, niveles) {
  const { puntaje, detalle } = calcularPuntaje(respuestas, preguntas);
  const nivel = obtenerNivel(puntaje, niveles);
  return { puntaje, nivel, detalle };
}

module.exports = { esRespuestaDeRiesgo, calcularPuntaje, obtenerNivel, calcularResultado };
