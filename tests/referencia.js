// Implementación de REFERENCIA del algoritmo de puntuación, usada solo en las pruebas.
//
// ¿Por qué es independiente del servicio (src/services/puntaje.service.js)?
//  - No importa ni reutiliza nada del servicio.
//  - Representa las 20 respuestas como un solo número entero (máscara de bits)
//    en lugar de arreglos de objetos y un Map.
//  - Calcula el puntaje con operaciones de bits (XOR y conteo de bits en 1)
//    en lugar de comparar respuesta por respuesta.
//  - Obtiene el nivel con comparaciones if/else fijas contra los umbrales,
//    en lugar de buscar el rango dentro de un arreglo de niveles.
// Si las dos formas, escritas de manera distinta, dan siempre lo mismo,
// es muy poco probable que ambas tengan el mismo error.

const TOTAL_PREGUNTAS = 20;

// Máscara con los 20 bits en 1: 0b1111_1111_1111_1111_1111
const TODAS = (1 << TOTAL_PREGUNTAS) - 1;

// Preguntas donde "sí" indica riesgo (2, 5 y 12). El bit i corresponde a la pregunta i + 1.
const PREGUNTAS_SI_ES_RIESGO = [2, 5, 12];
const MASCARA_SI_ES_RIESGO = PREGUNTAS_SI_ES_RIESGO.reduce((mascara, numero) => mascara | (1 << (numero - 1)), 0);

// Preguntas donde "sí" NO indica riesgo (en ellas, el riesgo es responder "no")
const MASCARA_SI_NO_ES_RIESGO = TODAS & ~MASCARA_SI_ES_RIESGO;

/** Cuenta cuántos bits valen 1 (algoritmo de Kernighan: cada vuelta apaga el bit 1 más bajo). */
function contarBits(numero) {
  let cuenta = 0;
  while (numero !== 0) {
    numero &= numero - 1;
    cuenta += 1;
  }
  return cuenta;
}

/**
 * Puntaje de una combinación de respuestas.
 * @param {number} respuestasSi máscara de bits: bit i en 1 = respondió "sí" a la pregunta i + 1
 *
 * Una respuesta es de riesgo cuando coincide con la respuesta de riesgo de la pregunta.
 * El XOR con la máscara de "sí NO es riesgo" deja en 1 exactamente esos bits:
 *  - pregunta donde "sí" es riesgo (bit de la máscara = 0): queda 1 si respondió "sí".
 *  - pregunta donde "no" es riesgo (bit de la máscara = 1): queda 1 si respondió "no".
 */
function puntajeReferencia(respuestasSi) {
  return contarBits((respuestasSi ^ MASCARA_SI_NO_ES_RIESGO) & TODAS);
}

/** Nivel de riesgo con umbrales fijos: 0–2 bajo, 3–7 medio, 8–20 alto. */
function nivelReferencia(puntaje) {
  if (puntaje <= 2) return 'bajo';
  if (puntaje <= 7) return 'medio';
  return 'alto';
}

module.exports = { TOTAL_PREGUNTAS, PREGUNTAS_SI_ES_RIESGO, contarBits, puntajeReferencia, nivelReferencia };
