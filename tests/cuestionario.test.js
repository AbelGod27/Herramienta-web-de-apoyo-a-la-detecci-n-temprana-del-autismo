// Pruebas de integración del cuestionario anónimo.
// Usan la base de datos de PRUEBAS (PGDATABASE_TEST) y borran lo que crean.
const request = require('supertest');
const app = require('../src/app');
const { pool, consulta } = require('../src/config/db');
const { haceMeses } = require('./utilidades');

let preguntas = []; // incluye riesgo_si_responde, leído directo de la BD
const creadas = []; // aplicaciones a borrar al final

/** Crea una aplicación y la registra para borrarla después. */
async function crearAplicacion(cuerpo = { fecha_nacimiento: haceMeses(20) }) {
  const res = await request(app).post('/api/aplicaciones').send(cuerpo);
  if (res.status === 201) creadas.push(res.body.id_aplicacion);
  return res;
}

/** Respuestas donde exactamente las primeras `n` preguntas indican riesgo. */
function respuestasConRiesgo(n) {
  return preguntas.map((p, i) => ({
    id_pregunta: p.id_pregunta,
    valor: i < n ? p.riesgo_si_responde : !p.riesgo_si_responde,
  }));
}

beforeAll(async () => {
  const { rows } = await consulta('SELECT id_pregunta, numero, riesgo_si_responde FROM pregunta ORDER BY numero');
  preguntas = rows;
});

afterAll(async () => {
  if (creadas.length > 0) {
    await consulta('DELETE FROM aplicacion WHERE id_aplicacion = ANY($1::uuid[])', [creadas]);
  }
  await pool.end();
});

describe('GET /api/preguntas', () => {
  test('devuelve las preguntas en orden y sin la respuesta de riesgo', async () => {
    const res = await request(app).get('/api/preguntas');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(preguntas.length);
    expect(res.body[0].numero).toBe(1);
    expect(res.body[0]).not.toHaveProperty('riesgo_si_responde');
  });
});

describe('POST /api/aplicaciones', () => {
  test('calcula la edad con la fecha de nacimiento y guarda solo la edad', async () => {
    const res = await crearAplicacion({ fecha_nacimiento: haceMeses(18), semanas_gestacion: 34 });
    expect(res.status).toBe(201);
    expect(res.body.id_aplicacion).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.edad_meses).toBe(18);

    const { rows } = await consulta(
      'SELECT edad_meses, semanas_gestacion FROM aplicacion WHERE id_aplicacion = $1',
      [res.body.id_aplicacion]
    );
    expect(rows[0]).toEqual({ edad_meses: 18, semanas_gestacion: 34 });
  });

  test.each([16, 30])('acepta los límites del rango: %i meses', async (meses) => {
    const res = await crearAplicacion({ fecha_nacimiento: haceMeses(meses) });
    expect(res.status).toBe(201);
    expect(res.body.edad_meses).toBe(meses);
  });

  test.each([15, 31])('rechaza a un niño de %i meses', async (meses) => {
    const res = await crearAplicacion({ fecha_nacimiento: haceMeses(meses) });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Este cuestionario es para niños de 16 a 30 meses');
  });

  test.each([
    ['texto', 'abc'],
    ['fecha inexistente', '2025-02-30'],
    ['fecha futura', '2999-01-01'],
    ['sin fecha', undefined],
  ])('rechaza una fecha inválida: %s', async (_, fecha) => {
    const res = await crearAplicacion({ fecha_nacimiento: fecha });
    expect(res.status).toBe(400);
  });

  test('rechaza semanas de gestación fuera de rango', async () => {
    const res = await crearAplicacion({ fecha_nacimiento: haceMeses(20), semanas_gestacion: 40 });
    expect(res.status).toBe(400);
  });
});

describe('Flujo completo: responder, finalizar y consultar', () => {
  test.each([
    [0, 'bajo'],
    [3, 'medio'],
    [8, 'alto'],
  ])('con %i respuestas de riesgo el resultado es "%s"', async (n, nivel) => {
    const { body } = await crearAplicacion();
    const id = body.id_aplicacion;

    const guardar = await request(app)
      .put(`/api/aplicaciones/${id}/respuestas`)
      .send({ respuestas: respuestasConRiesgo(n) });
    expect(guardar.status).toBe(200);

    const final = await request(app).post(`/api/aplicaciones/${id}/finalizar`);
    expect(final.status).toBe(200);
    expect(final.body.puntaje_total).toBe(n);
    expect(final.body.nivel).toBe(nivel);
    expect(final.body.recomendacion).toBeTruthy();

    // Se guardó es_riesgo en cada respuesta
    const { rows } = await consulta(
      'SELECT COUNT(*)::int AS total FROM respuesta WHERE id_aplicacion = $1 AND es_riesgo',
      [id]
    );
    expect(rows[0].total).toBe(n);

    const consultaResultado = await request(app).get(`/api/aplicaciones/${id}/resultado`);
    expect(consultaResultado.status).toBe(200);
    expect(consultaResultado.body.nivel).toBe(nivel);

    // Incluye la respuesta de cada pregunta, en orden, con su marca de riesgo
    const { respuestas } = consultaResultado.body;
    expect(respuestas).toHaveLength(preguntas.length);
    expect(respuestas.map((r) => r.numero)).toEqual(preguntas.map((p) => p.numero));
    expect(respuestas[0]).toEqual(
      expect.objectContaining({ texto: expect.any(String), valor: expect.any(Boolean) })
    );
    expect(respuestas.filter((r) => r.es_riesgo)).toHaveLength(n);
  });

  test('permite cambiar una respuesta antes de terminar', async () => {
    const { body } = await crearAplicacion();
    const id = body.id_aplicacion;
    const primera = preguntas[0];

    await request(app).put(`/api/aplicaciones/${id}/respuestas`).send({ respuestas: respuestasConRiesgo(0) });
    // Cambiar la primera respuesta a la de riesgo
    await request(app)
      .put(`/api/aplicaciones/${id}/respuestas`)
      .send({ respuestas: [{ id_pregunta: primera.id_pregunta, valor: primera.riesgo_si_responde }] });

    const final = await request(app).post(`/api/aplicaciones/${id}/finalizar`);
    expect(final.body.puntaje_total).toBe(1);
  });

  test('no permite finalizar con respuestas incompletas', async () => {
    const { body } = await crearAplicacion();
    const id = body.id_aplicacion;
    await request(app)
      .put(`/api/aplicaciones/${id}/respuestas`)
      .send({ respuestas: respuestasConRiesgo(0).slice(0, 5) });

    const res = await request(app).post(`/api/aplicaciones/${id}/finalizar`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/^Faltan respuestas de las preguntas: 6, 7/);
  });

  test('no permite modificar ni volver a finalizar una aplicación terminada', async () => {
    const { body } = await crearAplicacion();
    const id = body.id_aplicacion;
    await request(app).put(`/api/aplicaciones/${id}/respuestas`).send({ respuestas: respuestasConRiesgo(2) });
    await request(app).post(`/api/aplicaciones/${id}/finalizar`);

    const cambiar = await request(app)
      .put(`/api/aplicaciones/${id}/respuestas`)
      .send({ respuestas: respuestasConRiesgo(5) });
    expect(cambiar.status).toBe(409);

    const otraVez = await request(app).post(`/api/aplicaciones/${id}/finalizar`);
    expect(otraVez.status).toBe(409);
  });

  test('el resultado de una aplicación en curso responde 409', async () => {
    const { body } = await crearAplicacion();
    const res = await request(app).get(`/api/aplicaciones/${body.id_aplicacion}/resultado`);
    expect(res.status).toBe(409);
  });
});

describe('Validaciones de respuestas', () => {
  test('rechaza valores que no son sí/no', async () => {
    const { body } = await crearAplicacion();
    const res = await request(app)
      .put(`/api/aplicaciones/${body.id_aplicacion}/respuestas`)
      .send({ respuestas: [{ id_pregunta: preguntas[0].id_pregunta, valor: 1 }] });
    expect(res.status).toBe(400);
  });

  test('rechaza preguntas repetidas', async () => {
    const { body } = await crearAplicacion();
    const r = { id_pregunta: preguntas[0].id_pregunta, valor: true };
    const res = await request(app)
      .put(`/api/aplicaciones/${body.id_aplicacion}/respuestas`)
      .send({ respuestas: [r, r] });
    expect(res.status).toBe(400);
  });

  test('rechaza preguntas que no existen', async () => {
    const { body } = await crearAplicacion();
    const res = await request(app)
      .put(`/api/aplicaciones/${body.id_aplicacion}/respuestas`)
      .send({ respuestas: [{ id_pregunta: 999999, valor: true }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Alguna de las preguntas no existe');
  });

  test('un id que no es UUID responde 400 y uno inexistente 404', async () => {
    const malo = await request(app).get('/api/aplicaciones/123/resultado');
    expect(malo.status).toBe(400);

    const inexistente = await request(app).get('/api/aplicaciones/00000000-0000-4000-8000-000000000000/resultado');
    expect(inexistente.status).toBe(404);
  });
});
