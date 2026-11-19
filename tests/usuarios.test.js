// Pruebas de integración de la Fase 3: registro, sesión, roles, hijos y vinculación.
// Usan la base de datos de PRUEBAS (PGDATABASE_TEST) y borran lo que crean.
const request = require('supertest');
const app = require('../src/app');
const { pool, consulta } = require('../src/config/db');
const { haceMeses } = require('./utilidades');

// Prefijo único para encontrar y borrar los usuarios de esta corrida
const PREFIJO = `prueba.f3.${Date.now()}`;
const CONTRASENA = 'Segura123';
let contador = 0;
const aplicacionesCreadas = []; // para borrar solo lo que crea esta prueba
let preguntas = [];

/** Datos válidos de registro con un correo nuevo. */
function datosPadre(cambios = {}) {
  contador += 1;
  return {
    nombre: 'Ana',
    apellidos: 'Prueba López',
    correo: `${PREFIJO}.${contador}@ejemplo.com`,
    contrasena: CONTRASENA,
    telefono: '5512345678',
    parentesco: 'madre',
    acepto_aviso: true,
    ...cambios,
  };
}

/** Registra un padre y devuelve un "agente" de Supertest que conserva la cookie de sesión. */
async function padreConSesion() {
  const agente = request.agent(app);
  const datos = datosPadre();
  const res = await agente.post('/api/auth/registro').send(datos);
  expect(res.status).toBe(201);
  return { agente, datos, usuario: res.body.usuario };
}

/** Crea y termina una aplicación anónima para un niño de `edadMeses` meses. */
async function aplicacionTerminada(edadMeses) {
  const crear = await request(app).post('/api/aplicaciones').send({ fecha_nacimiento: haceMeses(edadMeses) });
  const id = crear.body.id_aplicacion;
  aplicacionesCreadas.push(id);
  const respuestas = preguntas.map((p) => ({ id_pregunta: p.id_pregunta, valor: !p.riesgo_si_responde }));
  await request(app).put(`/api/aplicaciones/${id}/respuestas`).send({ respuestas });
  await request(app).post(`/api/aplicaciones/${id}/finalizar`);
  return id;
}

beforeAll(async () => {
  const { rows } = await consulta('SELECT id_pregunta, riesgo_si_responde FROM pregunta ORDER BY numero');
  preguntas = rows;
});

afterAll(async () => {
  // Borrar en orden por las llaves foráneas
  const usuarios = `SELECT id_usuario FROM usuario WHERE correo LIKE '${PREFIJO}%'`;
  await consulta(`DELETE FROM aplicacion WHERE id_nino IN (SELECT id_nino FROM nino WHERE id_tutor IN (${usuarios}))`);
  // Solo las aplicaciones anónimas que creó este archivo (no las de otras pruebas que corran a la vez)
  await consulta('DELETE FROM aplicacion WHERE id_aplicacion = ANY($1::uuid[])', [aplicacionesCreadas]);
  await consulta(`DELETE FROM nino WHERE id_tutor IN (${usuarios})`);
  await consulta(`DELETE FROM tutor WHERE id_usuario IN (${usuarios})`);
  await consulta(`DELETE FROM usuario WHERE correo LIKE '${PREFIJO}%'`);
  await pool.end();
});

describe('Registro de padre', () => {
  test('registra, guarda el consentimiento y deja la sesión iniciada', async () => {
    const datos = datosPadre();
    const res = await request(app).post('/api/auth/registro').send(datos);

    expect(res.status).toBe(201);
    expect(res.body.usuario.rol).toBe('padre');
    expect(res.body.usuario).not.toHaveProperty('contrasena_hash');

    const cookie = res.headers['set-cookie'][0];
    expect(cookie).toMatch(/^sesion=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);

    const { rows } = await consulta(
      `SELECT t.acepto_aviso, t.version_aviso, t.fecha_aceptacion, u.contrasena_hash
       FROM tutor t JOIN usuario u ON u.id_usuario = t.id_usuario WHERE u.correo = $1`,
      [datos.correo]
    );
    expect(rows[0].acepto_aviso).toBe(true);
    expect(rows[0].version_aviso).toBe(process.env.VERSION_AVISO || '1.0');
    expect(rows[0].fecha_aceptacion).toBeInstanceOf(Date);
    // bcrypt con al menos 10 rondas: el hash empieza con $2b$10$ o más
    expect(rows[0].contrasena_hash).toMatch(/^\$2[aby]\$1\d\$/);
  });

  test.each([
    ['sin casilla de consentimiento', { acepto_aviso: false }],
    ['consentimiento como texto', { acepto_aviso: 'true' }],
    ['correo inválido', { correo: 'no-es-correo' }],
    ['contraseña corta', { contrasena: 'abc1' }],
    ['contraseña sin números', { contrasena: 'soloLetras' }],
    ['parentesco inválido', { parentesco: 'vecino' }],
  ])('rechaza el registro: %s', async (_, cambios) => {
    const res = await request(app).post('/api/auth/registro').send(datosPadre(cambios));
    expect(res.status).toBe(400);
  });

  test('sin consentimiento el mensaje lo explica', async () => {
    const res = await request(app).post('/api/auth/registro').send(datosPadre({ acepto_aviso: false }));
    expect(res.body.error).toBe('Debes aceptar el aviso de privacidad para registrarte');
  });

  test('no permite dos cuentas con el mismo correo (sin importar mayúsculas)', async () => {
    const datos = datosPadre();
    await request(app).post('/api/auth/registro').send(datos);
    const res = await request(app)
      .post('/api/auth/registro')
      .send({ ...datos, correo: datos.correo.toUpperCase() });
    expect(res.status).toBe(409);
  });
});

describe('Inicio y cierre de sesión', () => {
  let datos;

  beforeAll(async () => {
    datos = datosPadre();
    await request(app).post('/api/auth/registro').send(datos);
  });

  test('inicia sesión con datos correctos', async () => {
    const agente = request.agent(app);
    const res = await agente.post('/api/auth/login').send({ correo: datos.correo, contrasena: CONTRASENA });
    expect(res.status).toBe(200);
    expect(res.body.usuario).not.toHaveProperty('contrasena_hash');

    const yo = await agente.get('/api/auth/yo');
    expect(yo.status).toBe(200);
    expect(yo.body.usuario.correo).toBe(datos.correo);
  });

  test('mismo mensaje genérico con contraseña incorrecta o correo inexistente', async () => {
    const malaContrasena = await request(app)
      .post('/api/auth/login')
      .send({ correo: datos.correo, contrasena: 'Incorrecta1' });
    const sinCuenta = await request(app)
      .post('/api/auth/login')
      .send({ correo: `${PREFIJO}.nadie@ejemplo.com`, contrasena: 'Incorrecta1' });

    expect(malaContrasena.status).toBe(401);
    expect(sinCuenta.status).toBe(401);
    expect(malaContrasena.body.error).toBe('Correo o contraseña incorrectos');
    expect(sinCuenta.body.error).toBe('Correo o contraseña incorrectos');
  });

  test('sin sesión /api/auth/yo responde 401', async () => {
    const res = await request(app).get('/api/auth/yo');
    expect(res.status).toBe(401);
  });

  test('un token alterado no sirve', async () => {
    const res = await request(app).get('/api/auth/yo').set('Cookie', 'sesion=token.falso.123');
    expect(res.status).toBe(401);
  });

  test('cerrar sesión borra la cookie', async () => {
    const agente = request.agent(app);
    await agente.post('/api/auth/login').send({ correo: datos.correo, contrasena: CONTRASENA });
    await agente.post('/api/auth/logout');
    const res = await agente.get('/api/auth/yo');
    expect(res.status).toBe(401);
  });

  test('un usuario suspendido no puede iniciar sesión y pierde la sesión abierta', async () => {
    const { agente, datos: suspendido } = await padreConSesion();
    await consulta('UPDATE usuario SET activo = FALSE WHERE correo = $1', [suspendido.correo]);

    const yo = await agente.get('/api/auth/yo');
    expect(yo.status).toBe(401);

    const login = await request(app)
      .post('/api/auth/login')
      .send({ correo: suspendido.correo, contrasena: CONTRASENA });
    expect(login.status).toBe(403);
  });
});

describe('Hijos y permisos por rol', () => {
  test('un padre registra y ve a sus hijos', async () => {
    const { agente } = await padreConSesion();
    const nuevo = await agente
      .post('/api/ninos')
      .send({ nombre: 'Leo', fecha_nacimiento: haceMeses(20), sexo: 'M' });
    expect(nuevo.status).toBe(201);
    expect(nuevo.body.edad_meses).toBe(20);

    const lista = await agente.get('/api/ninos');
    expect(lista.status).toBe(200);
    expect(lista.body).toHaveLength(1);
    expect(lista.body[0].nombre).toBe('Leo');
  });

  test('sin sesión no se puede acceder a /api/ninos', async () => {
    const res = await request(app).get('/api/ninos');
    expect(res.status).toBe(401);
  });

  test('un usuario con otro rol recibe 403', async () => {
    const { agente, datos } = await padreConSesion();
    // Cambiar el rol directamente en la BD para simular a un psicólogo
    await consulta(
      `UPDATE usuario SET id_rol = (SELECT id_rol FROM rol WHERE nombre = 'psicologo') WHERE correo = $1`,
      [datos.correo]
    );
    const res = await agente.get('/api/ninos');
    expect(res.status).toBe(403);
  });

  test('un padre no ve el historial del hijo de otro padre', async () => {
    const padreA = await padreConSesion();
    const padreB = await padreConSesion();
    const nino = await padreA.agente
      .post('/api/ninos')
      .send({ nombre: 'Mia', fecha_nacimiento: haceMeses(18) });

    const res = await padreB.agente.get(`/api/ninos/${nino.body.id_nino}/aplicaciones`);
    expect(res.status).toBe(404);
  });

  test.each([
    ['fecha futura', { fecha_nacimiento: '2999-01-01' }],
    ['fecha inválida', { fecha_nacimiento: '2024-02-31' }],
    ['sin nombre', { nombre: '' }],
    ['semanas fuera de rango', { semanas_gestacion: 40 }],
  ])('rechaza el registro de hijo: %s', async (_, cambios) => {
    const { agente } = await padreConSesion();
    const res = await agente
      .post('/api/ninos')
      .send({ nombre: 'Leo', fecha_nacimiento: haceMeses(20), ...cambios });
    expect(res.status).toBe(400);
  });
});

describe('Vinculación de la aplicación anónima', () => {
  test('vincula sin perder las respuestas y aparece en el historial', async () => {
    const idAplicacion = await aplicacionTerminada(20);
    const { agente } = await padreConSesion();
    const nino = await agente.post('/api/ninos').send({ nombre: 'Leo', fecha_nacimiento: haceMeses(20) });

    const res = await agente
      .post(`/api/aplicaciones/${idAplicacion}/vincular`)
      .send({ id_nino: nino.body.id_nino });
    expect(res.status).toBe(200);

    const { rows } = await consulta(
      'SELECT COUNT(*)::int AS total FROM respuesta WHERE id_aplicacion = $1',
      [idAplicacion]
    );
    expect(rows[0].total).toBe(preguntas.length);

    const historial = await agente.get(`/api/ninos/${nino.body.id_nino}/aplicaciones`);
    expect(historial.body.map((a) => a.id_aplicacion)).toContain(idAplicacion);

    // La lista de hijos indica cuántos cuestionarios tiene y la edad en el último
    const lista = await agente.get('/api/ninos');
    expect(lista.body[0].total_cuestionarios).toBe(1);
    expect(lista.body[0].edad_ultimo_cuestionario).toBe(20);
  });

  test('acepta una diferencia de ±1 mes y rechaza una mayor', async () => {
    const { agente } = await padreConSesion();
    const nino = await agente.post('/api/ninos').send({ nombre: 'Sol', fecha_nacimiento: haceMeses(20) });

    const unMes = await aplicacionTerminada(21);
    const ok = await agente.post(`/api/aplicaciones/${unMes}/vincular`).send({ id_nino: nino.body.id_nino });
    expect(ok.status).toBe(200);

    const dosMeses = await aplicacionTerminada(22);
    const mal = await agente.post(`/api/aplicaciones/${dosMeses}/vincular`).send({ id_nino: nino.body.id_nino });
    expect(mal.status).toBe(400);
    expect(mal.body.error).toBe('La edad del niño no coincide con la del cuestionario');
  });

  test('no se puede vincular dos veces', async () => {
    const idAplicacion = await aplicacionTerminada(20);
    const { agente } = await padreConSesion();
    const nino = await agente.post('/api/ninos').send({ nombre: 'Leo', fecha_nacimiento: haceMeses(20) });

    await agente.post(`/api/aplicaciones/${idAplicacion}/vincular`).send({ id_nino: nino.body.id_nino });
    const otraVez = await agente
      .post(`/api/aplicaciones/${idAplicacion}/vincular`)
      .send({ id_nino: nino.body.id_nino });
    expect(otraVez.status).toBe(409);
  });

  test('no se puede vincular una aplicación sin terminar', async () => {
    const crear = await request(app).post('/api/aplicaciones').send({ fecha_nacimiento: haceMeses(20) });
    aplicacionesCreadas.push(crear.body.id_aplicacion);
    const { agente } = await padreConSesion();
    const nino = await agente.post('/api/ninos').send({ nombre: 'Leo', fecha_nacimiento: haceMeses(20) });

    const res = await agente
      .post(`/api/aplicaciones/${crear.body.id_aplicacion}/vincular`)
      .send({ id_nino: nino.body.id_nino });
    expect(res.status).toBe(409);
  });

  test('no se puede vincular al hijo de otro padre', async () => {
    const idAplicacion = await aplicacionTerminada(20);
    const padreA = await padreConSesion();
    const padreB = await padreConSesion();
    const ninoDeA = await padreA.agente
      .post('/api/ninos')
      .send({ nombre: 'Leo', fecha_nacimiento: haceMeses(20) });

    const res = await padreB.agente
      .post(`/api/aplicaciones/${idAplicacion}/vincular`)
      .send({ id_nino: ninoDeA.body.id_nino });
    expect(res.status).toBe(404);
  });

  test('sin sesión no se puede vincular', async () => {
    const idAplicacion = await aplicacionTerminada(20);
    const res = await request(app).post(`/api/aplicaciones/${idAplicacion}/vincular`).send({ id_nino: 1 });
    expect(res.status).toBe(401);
  });

  test('el resultado vinculado solo lo ve su padre', async () => {
    const idAplicacion = await aplicacionTerminada(20);
    const padreA = await padreConSesion();
    const padreB = await padreConSesion();
    const nino = await padreA.agente.post('/api/ninos').send({ nombre: 'Leo', fecha_nacimiento: haceMeses(20) });
    await padreA.agente.post(`/api/aplicaciones/${idAplicacion}/vincular`).send({ id_nino: nino.body.id_nino });

    const anonimo = await request(app).get(`/api/aplicaciones/${idAplicacion}/resultado`);
    expect(anonimo.status).toBe(403);

    const otroPadre = await padreB.agente.get(`/api/aplicaciones/${idAplicacion}/resultado`);
    expect(otroPadre.status).toBe(403);

    const suPadre = await padreA.agente.get(`/api/aplicaciones/${idAplicacion}/resultado`);
    expect(suPadre.status).toBe(200);
    expect(suPadre.body.nombre_nino).toBe('Leo');
  });
});
