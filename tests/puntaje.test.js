// Pruebas unitarias del algoritmo de puntuación (función pura, sin base de datos).
const {
  esRespuestaDeRiesgo,
  calcularPuntaje,
  obtenerNivel,
  calcularResultado,
} = require('../src/services/puntaje.service');

// Catálogo de prueba: 20 preguntas; en la 2, 5 y 12 "sí" indica riesgo, en las demás "no".
const preguntas = Array.from({ length: 20 }, (_, i) => ({
  id_pregunta: 100 + i, // ids distintos al número para comprobar que se usa id_pregunta
  numero: i + 1,
  riesgo_si_responde: [2, 5, 12].includes(i + 1),
}));

const niveles = [
  { id_nivel: 1, nombre: 'bajo', puntaje_min: 0, puntaje_max: 2 },
  { id_nivel: 2, nombre: 'medio', puntaje_min: 3, puntaje_max: 7 },
  { id_nivel: 3, nombre: 'alto', puntaje_min: 8, puntaje_max: 20 },
];

/** Respuestas sin ningún riesgo (cada valor es lo contrario de riesgo_si_responde). */
function respuestasSinRiesgo() {
  return preguntas.map((p) => ({ id_pregunta: p.id_pregunta, valor: !p.riesgo_si_responde }));
}

/** Respuestas donde exactamente las primeras `n` preguntas indican riesgo. */
function respuestasConRiesgo(n) {
  return preguntas.map((p, i) => ({
    id_pregunta: p.id_pregunta,
    valor: i < n ? p.riesgo_si_responde : !p.riesgo_si_responde,
  }));
}

describe('esRespuestaDeRiesgo', () => {
  test('"sí" indica riesgo cuando riesgo_si_responde es true', () => {
    expect(esRespuestaDeRiesgo(true, true)).toBe(true);
    expect(esRespuestaDeRiesgo(false, true)).toBe(false);
  });

  test('"no" indica riesgo cuando riesgo_si_responde es false', () => {
    expect(esRespuestaDeRiesgo(false, false)).toBe(true);
    expect(esRespuestaDeRiesgo(true, false)).toBe(false);
  });
});

describe('calcularPuntaje', () => {
  test('todas las respuestas sin riesgo dan 0', () => {
    expect(calcularPuntaje(respuestasSinRiesgo(), preguntas).puntaje).toBe(0);
  });

  test('todas las respuestas con riesgo dan 20', () => {
    expect(calcularPuntaje(respuestasConRiesgo(20), preguntas).puntaje).toBe(20);
  });

  test('responder "no" a todo da 17 (las preguntas 2, 5 y 12 no suman)', () => {
    const todoNo = preguntas.map((p) => ({ id_pregunta: p.id_pregunta, valor: false }));
    expect(calcularPuntaje(todoNo, preguntas).puntaje).toBe(17);
  });

  test('responder "sí" a todo da 3 (solo suman las preguntas 2, 5 y 12)', () => {
    const todoSi = preguntas.map((p) => ({ id_pregunta: p.id_pregunta, valor: true }));
    const { puntaje, detalle } = calcularPuntaje(todoSi, preguntas);
    expect(puntaje).toBe(3);
    const conRiesgo = detalle.filter((d) => d.es_riesgo).map((d) => d.id_pregunta);
    expect(conRiesgo).toEqual([101, 104, 111]); // ids de las preguntas 2, 5 y 12
  });

  test('el detalle trae es_riesgo para cada pregunta', () => {
    const { detalle } = calcularPuntaje(respuestasConRiesgo(4), preguntas);
    expect(detalle).toHaveLength(20);
    expect(detalle.filter((d) => d.es_riesgo)).toHaveLength(4);
  });

  test('falla si falta alguna respuesta e indica cuáles', () => {
    const incompletas = respuestasSinRiesgo().filter((r) => r.id_pregunta !== 102 && r.id_pregunta !== 106);
    expect(() => calcularPuntaje(incompletas, preguntas)).toThrow('Faltan respuestas de las preguntas: 3, 7');
  });

  test('no modifica los arreglos recibidos', () => {
    const respuestas = respuestasConRiesgo(5);
    const copia = JSON.parse(JSON.stringify(respuestas));
    calcularPuntaje(respuestas, preguntas);
    expect(respuestas).toEqual(copia);
  });
});

describe('obtenerNivel', () => {
  test.each([
    [0, 'bajo'],
    [2, 'bajo'],
    [3, 'medio'],
    [7, 'medio'],
    [8, 'alto'],
    [20, 'alto'],
  ])('puntaje %i -> nivel %s', (puntaje, nombre) => {
    expect(obtenerNivel(puntaje, niveles).nombre).toBe(nombre);
  });

  test('falla si ningún nivel cubre el puntaje', () => {
    const incompletos = niveles.slice(0, 2); // sin nivel "alto"
    expect(() => obtenerNivel(10, incompletos)).toThrow('No hay un nivel de riesgo configurado para el puntaje 10');
  });
});

describe('calcularResultado', () => {
  test.each([
    [0, 'bajo'],
    [2, 'bajo'],
    [3, 'medio'],
    [7, 'medio'],
    [8, 'alto'],
    [20, 'alto'],
  ])('con %i respuestas de riesgo el nivel es %s', (n, nombre) => {
    const resultado = calcularResultado(respuestasConRiesgo(n), preguntas, niveles);
    expect(resultado.puntaje).toBe(n);
    expect(resultado.nivel.nombre).toBe(nombre);
  });
});
