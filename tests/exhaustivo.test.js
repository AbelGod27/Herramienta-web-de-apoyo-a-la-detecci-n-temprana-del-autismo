// Prueba EXHAUSTIVA del algoritmo de puntuación.
// Evalúa las 2^20 = 1,048,576 combinaciones posibles de respuestas sí/no y compara
// el servicio real (calcularResultado) contra una implementación de referencia independiente.
// Al final imprime tablas listas para copiar al artículo.
const { performance } = require('perf_hooks');
const { calcularResultado } = require('../src/services/puntaje.service');
const {
  TOTAL_PREGUNTAS,
  PREGUNTAS_SI_ES_RIESGO,
  puntajeReferencia,
  nivelReferencia,
} = require('./referencia');

// Catálogo igual al que se lee de la base de datos
const preguntas = Array.from({ length: TOTAL_PREGUNTAS }, (_, i) => ({
  id_pregunta: i + 1,
  numero: i + 1,
  riesgo_si_responde: PREGUNTAS_SI_ES_RIESGO.includes(i + 1),
}));

const niveles = [
  { id_nivel: 1, nombre: 'bajo', puntaje_min: 0, puntaje_max: 2 },
  { id_nivel: 2, nombre: 'medio', puntaje_min: 3, puntaje_max: 7 },
  { id_nivel: 3, nombre: 'alto', puntaje_min: 8, puntaje_max: 20 },
];

const TOTAL_COMBINACIONES = 2 ** TOTAL_PREGUNTAS; // 1,048,576

/** Coeficiente binomial C(n, k): de cuántas formas se eligen k preguntas de n. */
function binomial(n, k) {
  let resultado = 1;
  for (let i = 1; i <= k; i += 1) resultado = (resultado * (n - k + i)) / i;
  return Math.round(resultado);
}

/** Suma de C(20, k) para k entre min y max: combinaciones con ese rango de puntaje. */
function combinacionesEsperadas(min, max) {
  let suma = 0;
  for (let k = min; k <= max; k += 1) suma += binomial(TOTAL_PREGUNTAS, k);
  return suma;
}

const formato = (n) => n.toLocaleString('es-MX');

describe('Prueba exhaustiva: 2^20 combinaciones de respuestas', () => {
  test('el servicio coincide al 100% con la implementación de referencia', () => {
    // Se reutiliza un solo arreglo de respuestas y se cambian sus valores en cada combinación
    // (calcularResultado no modifica lo que recibe, así que es seguro).
    const respuestas = preguntas.map((p) => ({ id_pregunta: p.id_pregunta, valor: false }));

    let coincidencias = 0;
    let discrepancias = 0;
    const ejemplosDeFallo = [];
    const conteoPorNivel = { bajo: 0, medio: 0, alto: 0 };

    const inicio = performance.now();

    for (let combinacion = 0; combinacion < TOTAL_COMBINACIONES; combinacion += 1) {
      // Bit i de la combinación = respuesta a la pregunta i + 1 (1 = sí, 0 = no)
      for (let i = 0; i < TOTAL_PREGUNTAS; i += 1) {
        respuestas[i].valor = ((combinacion >> i) & 1) === 1;
      }

      const servicio = calcularResultado(respuestas, preguntas, niveles);
      const puntajeEsperado = puntajeReferencia(combinacion);
      const nivelEsperado = nivelReferencia(puntajeEsperado);

      if (servicio.puntaje === puntajeEsperado && servicio.nivel.nombre === nivelEsperado) {
        coincidencias += 1;
      } else {
        discrepancias += 1;
        if (ejemplosDeFallo.length < 5) {
          ejemplosDeFallo.push({ combinacion, servicio: servicio.puntaje, referencia: puntajeEsperado });
        }
      }
      conteoPorNivel[servicio.nivel.nombre] += 1;
    }

    const tiempoTotalMs = performance.now() - inicio;
    const porcentaje = (coincidencias / TOTAL_COMBINACIONES) * 100;

    // Distribución esperada según la combinatoria (verificación independiente adicional)
    const esperado = {
      bajo: combinacionesEsperadas(0, 2),
      medio: combinacionesEsperadas(3, 7),
      alto: combinacionesEsperadas(8, 20),
    };

    // ---- Resumen para el artículo ----
    const filasNivel = ['bajo', 'medio', 'alto'].map((nivel) => {
      const rango = { bajo: '0–2', medio: '3–7', alto: '8–20' }[nivel];
      const pct = ((conteoPorNivel[nivel] / TOTAL_COMBINACIONES) * 100).toFixed(2);
      const ok = conteoPorNivel[nivel] === esperado[nivel] ? 'Sí' : 'No';
      return `| ${nivel} | ${rango} | ${formato(conteoPorNivel[nivel])} | ${pct} % | ${formato(esperado[nivel])} | ${ok} |`;
    });

    console.log([
      '',
      '### Prueba exhaustiva del algoritmo de puntuación',
      '',
      '| Métrica | Valor |',
      '|---|---|',
      `| Combinaciones evaluadas | ${formato(TOTAL_COMBINACIONES)} |`,
      `| Coincidencias con la referencia | ${formato(coincidencias)} |`,
      `| Discrepancias | ${formato(discrepancias)} |`,
      `| Porcentaje de aciertos | ${porcentaje.toFixed(2)} % |`,
      `| Tiempo total | ${formato(Math.round(tiempoTotalMs))} ms |`,
      `| Tiempo promedio por combinación | ${((tiempoTotalMs * 1000) / TOTAL_COMBINACIONES).toFixed(2)} µs |`,
      '',
      '### Distribución de las combinaciones por nivel de riesgo',
      '',
      '| Nivel | Puntaje | Combinaciones | % del total | Esperado (combinatoria) | Coincide |',
      '|---|---|---|---|---|---|',
      ...filasNivel,
      '',
    ].join('\n'));

    if (ejemplosDeFallo.length > 0) console.log('Ejemplos de discrepancias:', ejemplosDeFallo);

    expect(discrepancias).toBe(0);
    expect(coincidencias).toBe(TOTAL_COMBINACIONES);
    expect(conteoPorNivel).toEqual(esperado);
    expect(esperado.bajo).toBe(211); // C(20,0) + C(20,1) + C(20,2) = 1 + 20 + 190
  });
});

describe('Casos límite: puntajes 0, 2, 3, 7, 8 y 20', () => {
  /** Respuestas donde exactamente las primeras `k` preguntas indican riesgo. */
  function respuestasConRiesgo(k) {
    return preguntas.map((p, i) => ({
      id_pregunta: p.id_pregunta,
      valor: i < k ? p.riesgo_si_responde : !p.riesgo_si_responde,
    }));
  }

  test.each([
    [0, 'bajo'],
    [2, 'bajo'],
    [3, 'medio'],
    [7, 'medio'],
    [8, 'alto'],
    [20, 'alto'],
  ])('puntaje %i -> nivel %s', (k, nivel) => {
    const respuestas = respuestasConRiesgo(k);
    const resultado = calcularResultado(respuestas, preguntas, niveles);
    expect(resultado.puntaje).toBe(k);
    expect(resultado.nivel.nombre).toBe(nivel);

    // La referencia da lo mismo para esa combinación
    const mascara = respuestas.reduce((m, r, i) => (r.valor ? m | (1 << i) : m), 0);
    expect(puntajeReferencia(mascara)).toBe(k);
    expect(nivelReferencia(k)).toBe(nivel);
  });
});
