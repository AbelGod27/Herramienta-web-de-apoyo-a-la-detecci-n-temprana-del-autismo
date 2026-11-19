// Pruebas de la Fase 5: administración.
// Usan la base de datos de PRUEBAS (PGDATABASE_TEST) y borran solo lo que crean.
// Otros archivos de pruebas pueden correr a la vez: por eso las estadísticas se comparan
// de forma relativa y no se cambia qué respuesta indica riesgo ni los rangos de los niveles.
const request = require('supertest');
const bcrypt = require('bcrypt');
const app = require('../src/app');
const { pool, consulta } = require('../src/config/db');
const { rangosCubrenTodo, ordenarCambios } = require('../src/services/niveles.service');
const { sinFrasesDiagnosticas } = require('../src/validators/admin.validator');

const PREFIJO = `prueba.f5.${Date.now()}`;
const CONTRASENA = 'Segura123';
let contador = 0;
let hash;

// Copias para restaurar los catálogos al final
let preguntasOriginales = [];
let nivelesOriginales = [];

// Usuarios de prueba (se llenan en beforeAll)
const u = {};

/** Inserta un usuario con el rol indicado y devuelve su id y correo. */
async function crearUsuario(rol, nombre = 'Prueba') {
  contador += 1;
  const correo = `${PREFIJO}.${contador}@ejemplo.com`;
  const { rows } = await consulta(
    `INSERT INTO usuario (id_rol, correo, contrasena_hash, nombre, apellidos)
     SELECT id_rol, $1, $2, $3, 'Admin Test' FROM rol WHERE nombre = $4
     RETURNING id_usuario`,
    [correo, hash, nombre, rol]
  );
  return { id: rows[0].id_usuario, correo };
}

/** Psicólogo de prueba sin validar. */
async function crearPsicologo() {
  const usuario = await crearUsuario('psicologo', 'Psico');
  await consulta(
    'INSERT INTO psicologo (id_usuario, cedula_profesional, especialidad) VALUES ($1, $2, $3)',
    [usuario.id, `CED${Date.now()}${contador}`.slice(0, 20), 'Psicología infantil']
  );
  return usuario;
}

/** Agente de Supertest con la sesión iniciada. */
async function conSesion(correo) {
  const agente = request.agent(app);
  const res = await agente.post('/api/auth/login').send({ correo, contrasena: CONTRASENA });
  expect(res.status).toBe(200);
  return agente;
}

beforeAll(async () => {
  hash = await bcrypt.hash(CONTRASENA, 10);

  // Se crea un admin principal temporal propio aunque ya exista otro en la BD de pruebas
  // (la BD no impide dos; solo el script crear-admin lo evita). Se borra al final.
  u.principal = await crearUsuario('admin_principal', 'Principal');
  u.secundario = await crearUsuario('admin_secundario', 'Secundario');
  u.padre = await crearUsuario('padre', 'Padre');
  u.psicologo = await crearPsicologo();

  u.agentePrincipal = await conSesion(u.principal.correo);
  u.agenteSecundario = await conSesion(u.secundario.correo);
  u.agentePadre = await conSesion(u.padre.correo);
  u.agentePsicologo = await conSesion(u.psicologo.correo);

  preguntasOriginales = (await consulta('SELECT numero, texto, ejemplo FROM pregunta ORDER BY numero')).rows;
  nivelesOriginales = (await consulta(
    'SELECT id_nivel, nombre, puntaje_min, puntaje_max, recomendacion FROM nivel_riesgo ORDER BY puntaje_min'
  )).rows;
});

afterAll(async () => {
  // Restaurar textos de preguntas y recomendaciones de niveles
  for (const p of preguntasOriginales) {
    await consulta('UPDATE pregunta SET texto = $2, ejemplo = $3 WHERE numero = $1', [p.numero, p.texto, p.ejemplo]);
  }
  for (const n of nivelesOriginales) {
    await consulta('UPDATE nivel_riesgo SET nombre = $2, recomendacion = $3 WHERE id_nivel = $1', [
      n.id_nivel, n.nombre, n.recomendacion,
    ]);
  }

  // Borrar solo lo creado por este archivo (en orden por las llaves foráneas)
  const mios = `SELECT id_usuario FROM usuario WHERE correo LIKE '${PREFIJO}%'`;
  await consulta(`UPDATE psicologo SET id_admin_valida = NULL WHERE id_admin_valida IN (${mios})`);
  await consulta(`DELETE FROM psicologo WHERE id_usuario IN (${mios})`);
  await consulta(`DELETE FROM usuario WHERE correo LIKE '${PREFIJO}%'`);
  await pool.end();
});

describe('Reglas puras de los niveles', () => {
  test('rangosCubrenTodo detecta huecos y traslapes', () => {
    const r = (a, b) => ({ puntaje_min: a, puntaje_max: b });
    expect(rangosCubrenTodo([r(0, 2), r(3, 7), r(8, 20)])).toBe(true);
    expect(rangosCubrenTodo([r(8, 20), r(0, 2), r(3, 7)])).toBe(true); // el orden no importa
    expect(rangosCubrenTodo([r(0, 1), r(3, 7), r(8, 20)])).toBe(false); // falta el 2
    expect(rangosCubrenTodo([r(0, 3), r(3, 7), r(8, 20)])).toBe(false); // el 3 se repite
    expect(rangosCubrenTodo([r(0, 2), r(3, 7), r(8, 19)])).toBe(false); // falta el 20
  });

  test('ordenarCambios reduce antes de ampliar para no traslapar en el camino', () => {
    const actuales = [
      { id_nivel: 1, puntaje_min: 0, puntaje_max: 2 },
      { id_nivel: 2, puntaje_min: 3, puntaje_max: 7 },
      { id_nivel: 3, puntaje_min: 8, puntaje_max: 20 },
    ];
    const nuevos = [
      { id_nivel: 1, puntaje_min: 0, puntaje_max: 3 }, // bajo crece
      { id_nivel: 2, puntaje_min: 4, puntaje_max: 7 }, // medio se reduce
      { id_nivel: 3, puntaje_min: 8, puntaje_max: 20 },
    ];
    const orden = ordenarCambios(actuales, nuevos).map((n) => n.id_nivel);
    expect(orden.indexOf(2)).toBeLessThan(orden.indexOf(1));
  });

  test('las recomendaciones no pueden afirmar un diagnóstico', () => {
    expect(() => sinFrasesDiagnosticas('Su hijo tiene autismo')).toThrow();
    expect(() => sinFrasesDiagnosticas('NO TIENE AUTISMO')).toThrow();
    expect(() => sinFrasesDiagnosticas('Confirma el diagnóstico de autismo')).toThrow();
    expect(sinFrasesDiagnosticas('Riesgo medio. Este resultado no es un diagnóstico.')).toBe(true);
  });
});

describe('Permisos', () => {
  test('sin sesión responde 401', async () => {
    const res = await request(app).get('/api/admin/estadisticas');
    expect(res.status).toBe(401);
  });

  test.each(['agentePadre', 'agentePsicologo'])('%s recibe 403', async (agente) => {
    const res = await u[agente].get('/api/admin/estadisticas');
    expect(res.status).toBe(403);
  });

  test.each([
    ['get', '/api/admin/administradores'],
    ['post', '/api/admin/administradores'],
    ['get', '/api/admin/preguntas'],
    ['put', '/api/admin/preguntas/1'],
    ['get', '/api/admin/niveles'],
    ['put', '/api/admin/niveles'],
  ])('el secundario no puede %s %s (403)', async (metodo, ruta) => {
    const res = await u.agenteSecundario[metodo](ruta).send({});
    expect(res.status).toBe(403);
  });
});

describe('Estadísticas anónimas', () => {
  test('responden con la estructura esperada y sin datos personales', async () => {
    const res = await u.agenteSecundario.get('/api/admin/estadisticas');
    expect(res.status).toBe(200);

    const e = res.body;
    expect(e).toEqual(expect.objectContaining({
      resumen: expect.any(Object),
      por_nivel: expect.any(Array),
      por_edad: expect.any(Array),
      por_mes: expect.any(Array),
      citas_por_estado: expect.any(Array),
      seguimiento: expect.any(Object),
      usuarios: expect.any(Object),
    }));
    expect(e.por_edad.map((f) => f.rango)).toEqual(['16–20', '21–25', '26–30']);
    expect(e.por_mes).toHaveLength(12);
    expect(e.citas_por_estado.map((c) => c.estado)).toEqual(['solicitada', 'confirmada', 'cancelada', 'completada']);
    // La suma por nivel coincide con el total de completados
    expect(e.por_nivel.reduce((s, n) => s + n.total, 0)).toBe(e.resumen.completados);
    // Hay al menos un psicólogo pendiente (el de esta prueba)
    expect(e.usuarios.psicologos_pendientes).toBeGreaterThanOrEqual(1);

    // Ningún campo personal ni dato de nuestros usuarios de prueba
    const texto = JSON.stringify(e);
    for (const campo of ['correo', 'apellidos', 'id_nino', 'id_usuario', 'fecha_nacimiento', 'contrasena_hash', 'resultado_seguimiento']) {
      expect(texto).not.toContain(`"${campo}"`);
    }
    expect(texto).not.toContain(PREFIJO);
  });

  test('el principal también puede verlas', async () => {
    const res = await u.agentePrincipal.get('/api/admin/estadisticas');
    expect(res.status).toBe(200);
  });
});

describe('Validación de psicólogos', () => {
  test('aparece en pendientes y el secundario lo valida y revoca', async () => {
    const pendientes = await u.agenteSecundario.get('/api/admin/psicologos?estado=pendientes');
    expect(pendientes.status).toBe(200);
    expect(pendientes.body.map((p) => p.id_usuario)).toContain(u.psicologo.id);
    expect(pendientes.body[0]).not.toHaveProperty('contrasena_hash');

    const validar = await u.agenteSecundario
      .patch(`/api/admin/psicologos/${u.psicologo.id}/validacion`)
      .send({ validado: true });
    expect(validar.status).toBe(200);

    let { rows } = await consulta(
      'SELECT validado, id_admin_valida, fecha_validacion FROM psicologo WHERE id_usuario = $1',
      [u.psicologo.id]
    );
    expect(rows[0].validado).toBe(true);
    expect(rows[0].id_admin_valida).toBe(u.secundario.id);
    expect(rows[0].fecha_validacion).toBeInstanceOf(Date);

    const revocar = await u.agenteSecundario
      .patch(`/api/admin/psicologos/${u.psicologo.id}/validacion`)
      .send({ validado: false });
    expect(revocar.status).toBe(200);

    ({ rows } = await consulta(
      'SELECT validado, id_admin_valida, fecha_validacion FROM psicologo WHERE id_usuario = $1',
      [u.psicologo.id]
    ));
    expect(rows[0]).toEqual({ validado: false, id_admin_valida: null, fecha_validacion: null });
  });

  test('un psicólogo inexistente responde 404', async () => {
    const res = await u.agenteSecundario.patch('/api/admin/psicologos/99999999/validacion').send({ validado: true });
    expect(res.status).toBe(404);
  });

  test('un valor que no es booleano responde 400', async () => {
    const res = await u.agenteSecundario.patch(`/api/admin/psicologos/${u.psicologo.id}/validacion`).send({ validado: 'si' });
    expect(res.status).toBe(400);
  });
});

describe('Gestión de cuentas', () => {
  test('lista y busca cuentas sin devolver contraseñas', async () => {
    const res = await u.agenteSecundario.get(`/api/admin/usuarios?buscar=${encodeURIComponent(PREFIJO)}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(4);
    expect(res.body.usuarios.every((c) => c.correo.startsWith(PREFIJO))).toBe(true);
    expect(res.body.usuarios[0]).not.toHaveProperty('contrasena_hash');

    const soloPadres = await u.agenteSecundario.get(`/api/admin/usuarios?rol=padre&buscar=${encodeURIComponent(PREFIJO)}`);
    expect(soloPadres.body.usuarios.every((c) => c.rol === 'padre')).toBe(true);
  });

  test('el secundario suspende a un padre, que ya no puede entrar, y lo reactiva', async () => {
    const padre = await crearUsuario('padre', 'Suspendible');

    const suspender = await u.agenteSecundario.patch(`/api/admin/usuarios/${padre.id}/activo`).send({ activo: false });
    expect(suspender.status).toBe(200);
    const login = await request(app).post('/api/auth/login').send({ correo: padre.correo, contrasena: CONTRASENA });
    expect(login.status).toBe(403);

    const reactivar = await u.agenteSecundario.patch(`/api/admin/usuarios/${padre.id}/activo`).send({ activo: true });
    expect(reactivar.status).toBe(200);
    const loginOtraVez = await request(app).post('/api/auth/login').send({ correo: padre.correo, contrasena: CONTRASENA });
    expect(loginOtraVez.status).toBe(200);
  });

  test('nadie puede suspender al administrador principal', async () => {
    const res = await u.agenteSecundario.patch(`/api/admin/usuarios/${u.principal.id}/activo`).send({ activo: false });
    expect(res.status).toBe(403);
  });

  test('nadie puede suspender su propia cuenta', async () => {
    const principal = await u.agentePrincipal.patch(`/api/admin/usuarios/${u.principal.id}/activo`).send({ activo: false });
    const secundario = await u.agenteSecundario.patch(`/api/admin/usuarios/${u.secundario.id}/activo`).send({ activo: false });
    expect(principal.status).toBe(403);
    expect(secundario.status).toBe(403);
  });

  test('un secundario no puede suspender a otro administrador', async () => {
    const otro = await crearUsuario('admin_secundario', 'OtroSecundario');
    const res = await u.agenteSecundario.patch(`/api/admin/usuarios/${otro.id}/activo`).send({ activo: false });
    expect(res.status).toBe(403);
  });
});

describe('Administradores secundarios (solo principal)', () => {
  test('el principal crea un secundario que puede iniciar sesión; luego lo suspende', async () => {
    contador += 1;
    const correo = `${PREFIJO}.nuevo${contador}@ejemplo.com`;
    const crear = await u.agentePrincipal.post('/api/admin/administradores').send({
      nombre: 'Nuevo', apellidos: 'Secundario', correo, contrasena: CONTRASENA,
    });
    expect(crear.status).toBe(201);
    expect(crear.body).not.toHaveProperty('contrasena_hash');

    const { rows } = await consulta(
      'SELECT r.nombre AS rol FROM usuario u JOIN rol r ON r.id_rol = u.id_rol WHERE u.correo = $1',
      [correo]
    );
    expect(rows[0].rol).toBe('admin_secundario');

    const lista = await u.agentePrincipal.get('/api/admin/administradores');
    expect(lista.body.map((a) => a.correo)).toContain(correo);

    const agenteNuevo = await conSesion(correo);
    expect((await agenteNuevo.get('/api/admin/estadisticas')).status).toBe(200);

    const suspender = await u.agentePrincipal
      .patch(`/api/admin/usuarios/${crear.body.id_usuario}/activo`)
      .send({ activo: false });
    expect(suspender.status).toBe(200);
    const login = await request(app).post('/api/auth/login').send({ correo, contrasena: CONTRASENA });
    expect(login.status).toBe(403);
  });

  test('no se repiten correos y se exige una contraseña válida', async () => {
    const repetido = await u.agentePrincipal.post('/api/admin/administradores').send({
      nombre: 'Rep', apellidos: 'Etido', correo: u.secundario.correo, contrasena: CONTRASENA,
    });
    expect(repetido.status).toBe(409);

    const debil = await u.agentePrincipal.post('/api/admin/administradores').send({
      nombre: 'Débil', apellidos: 'Clave', correo: `${PREFIJO}.debil@ejemplo.com`, contrasena: 'abc',
    });
    expect(debil.status).toBe(400);
  });
});

describe('Catálogo de preguntas (solo principal)', () => {
  test('edita el texto y el ejemplo de una pregunta', async () => {
    const original = (await consulta('SELECT riesgo_si_responde FROM pregunta WHERE numero = 1')).rows[0];
    const res = await u.agentePrincipal.put('/api/admin/preguntas/1').send({
      texto: 'Texto editado de prueba',
      ejemplo: null,
      // Se conserva el valor actual para no alterar las pruebas que corren a la vez
      riesgo_si_responde: original.riesgo_si_responde,
    });
    expect(res.status).toBe(200);

    const { rows } = await consulta('SELECT texto, ejemplo FROM pregunta WHERE numero = 1');
    expect(rows[0]).toEqual({ texto: 'Texto editado de prueba', ejemplo: null });
  });

  test.each([
    ['número fuera de rango', '/api/admin/preguntas/21', { texto: 'x', riesgo_si_responde: false }],
    ['texto vacío', '/api/admin/preguntas/1', { texto: '   ', riesgo_si_responde: false }],
    ['riesgo no booleano', '/api/admin/preguntas/1', { texto: 'x', riesgo_si_responde: 'no' }],
  ])('rechaza %s (400)', async (_, ruta, cuerpo) => {
    const res = await u.agentePrincipal.put(ruta).send(cuerpo);
    expect(res.status).toBe(400);
  });
});

describe('Catálogo de niveles (solo principal)', () => {
  /** Copia de los niveles originales con cambios aplicados por id. */
  function nivelesCon(cambios) {
    return nivelesOriginales.map((n, i) => ({ ...n, ...(cambios[i] || {}) }));
  }

  async function nivelesEnBd() {
    return (await consulta(
      'SELECT id_nivel, nombre, puntaje_min, puntaje_max, recomendacion FROM nivel_riesgo ORDER BY puntaje_min'
    )).rows;
  }

  test('guarda una recomendación nueva sin cambiar los rangos', async () => {
    const res = await u.agentePrincipal.put('/api/admin/niveles').send({
      niveles: nivelesCon({ 0: { recomendacion: 'Recomendación de prueba. Este resultado no es un diagnóstico.' } }),
    });
    expect(res.status).toBe(200);
    const bd = await nivelesEnBd();
    expect(bd[0].recomendacion).toBe('Recomendación de prueba. Este resultado no es un diagnóstico.');
  });

  test('un rango con hueco se rechaza y no cambia nada', async () => {
    const antes = await nivelesEnBd();
    // El primer nivel termina 1 punto antes: queda un puntaje sin nivel
    const res = await u.agentePrincipal.put('/api/admin/niveles').send({
      niveles: nivelesCon({ 0: { puntaje_max: nivelesOriginales[0].puntaje_max - 1 } }),
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sin huecos/);
    expect(await nivelesEnBd()).toEqual(antes);
  });

  test('un rango que se traslapa se rechaza', async () => {
    const antes = await nivelesEnBd();
    // El primer nivel invade el inicio del segundo
    const res = await u.agentePrincipal.put('/api/admin/niveles').send({
      niveles: nivelesCon({ 0: { puntaje_max: nivelesOriginales[1].puntaje_min } }),
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/traslaparse/);
    expect(await nivelesEnBd()).toEqual(antes);
  });

  test('una recomendación con frase diagnóstica se rechaza', async () => {
    const res = await u.agentePrincipal.put('/api/admin/niveles').send({
      niveles: nivelesCon({ 2: { recomendacion: 'Su hijo tiene autismo.' } }),
    });
    expect(res.status).toBe(400);
  });

  test('hay que enviar todos los niveles', async () => {
    const res = await u.agentePrincipal.put('/api/admin/niveles').send({ niveles: nivelesOriginales.slice(0, 2) });
    expect(res.status).toBe(400);
  });

  test('mínimo mayor que máximo se rechaza', async () => {
    const res = await u.agentePrincipal.put('/api/admin/niveles').send({
      niveles: nivelesCon({ 0: { puntaje_min: 5, puntaje_max: 1 } }),
    });
    expect(res.status).toBe(400);
  });
});
