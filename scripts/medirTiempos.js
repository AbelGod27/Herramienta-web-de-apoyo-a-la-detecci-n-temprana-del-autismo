// Mide tiempos de respuesta para el artículo:
//  a) cálculo puro del resultado (función calcularResultado)
//  b) endpoint completo POST /api/aplicaciones/:id/finalizar
//  c) consulta de disponibilidad GET /api/psicologos/:id/disponibilidad
//
// Uso:  node scripts/medirTiempos.js
// Variables opcionales (número de mediciones):
//   N_PURO=10000  N_FINALIZAR=100  N_DISPONIBILIDAD=100  CALENTAMIENTO=5
// Ejemplo rápido:  N_FINALIZAR=10 N_DISPONIBILIDAD=10 node scripts/medirTiempos.js
//
// Usa la base de datos de PRUEBAS (PGDATABASE_TEST) y borra todo lo que crea.

// Debe ir ANTES de cargar la app: así config/env.js elige PGDATABASE_TEST
process.env.NODE_ENV = 'test';

const os = require('os');
const { performance } = require('perf_hooks');
const app = require('../src/app');
const { pool, consulta } = require('../src/config/db');
const { calcularResultado } = require('../src/services/puntaje.service');

const N_PURO = Number(process.env.N_PURO) || 10000;
const N_FINALIZAR = Number(process.env.N_FINALIZAR) || 100;
const N_DISPONIBILIDAD = Number(process.env.N_DISPONIBILIDAD) || 100;
const CALENTAMIENTO = Number(process.env.CALENTAMIENTO) || 5;

// Lo que se crea, para borrarlo al final aunque algo falle
const creado = {
  aplicaciones: [],
  correoPadre: null,
  idPsicologo: null,
};

// ---------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------

/** Fecha 'AAAA-MM-DD' en hora local. */
function aTexto(fecha) {
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  const dia = String(fecha.getDate()).padStart(2, '0');
  return `${fecha.getFullYear()}-${mes}-${dia}`;
}

/** Fecha de nacimiento de un niño que hoy tiene `meses` meses (día ≤ 28). */
function haceMeses(meses) {
  const hoy = new Date();
  const total = hoy.getFullYear() * 12 + hoy.getMonth() - meses;
  return aTexto(new Date(Math.floor(total / 12), total % 12, Math.min(hoy.getDate(), 28)));
}

/** El próximo lunes (si hoy es lunes, el de la semana siguiente). */
function proximoLunes() {
  const fecha = new Date();
  const diasHastaLunes = ((8 - fecha.getDay()) % 7) || 7; // getDay: 0 = domingo, 1 = lunes
  fecha.setDate(fecha.getDate() + diasHastaLunes);
  return aTexto(fecha);
}

/** Promedio, mediana, percentil 95, mínimo y máximo de una lista de tiempos (ms). */
function estadisticas(tiempos) {
  const orden = [...tiempos].sort((a, b) => a - b);
  const percentil = (p) => orden[Math.min(orden.length - 1, Math.ceil((p / 100) * orden.length) - 1)];
  return {
    n: orden.length,
    promedio: orden.reduce((s, t) => s + t, 0) / orden.length,
    mediana: percentil(50),
    p95: percentil(95),
    min: orden[0],
    max: orden[orden.length - 1],
  };
}

/** Respuestas aleatorias sí/no para todas las preguntas. */
function respuestasAleatorias(preguntas) {
  return preguntas.map((p) => ({ id_pregunta: p.id_pregunta, valor: Math.random() < 0.5 }));
}

/** Petición JSON al servidor de pruebas. */
async function pedir(base, metodo, ruta, cuerpo, cookie) {
  const respuesta = await fetch(base + ruta, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  const datos = await respuesta.json().catch(() => ({}));
  return { estado: respuesta.status, datos, respuesta };
}

// ---------------------------------------------------------------------
// a) Cálculo puro del resultado
// ---------------------------------------------------------------------
async function medirCalculoPuro() {
  const preguntas = (await consulta('SELECT id_pregunta, numero, riesgo_si_responde FROM pregunta ORDER BY numero')).rows;
  const niveles = (await consulta('SELECT id_nivel, nombre, puntaje_min, puntaje_max FROM nivel_riesgo')).rows;

  for (let i = 0; i < CALENTAMIENTO * 100; i += 1) {
    calcularResultado(respuestasAleatorias(preguntas), preguntas, niveles);
  }

  const tiempos = [];
  for (let i = 0; i < N_PURO; i += 1) {
    const respuestas = respuestasAleatorias(preguntas); // se prepara fuera del cronómetro
    const inicio = performance.now();
    calcularResultado(respuestas, preguntas, niveles);
    tiempos.push(performance.now() - inicio);
  }
  return estadisticas(tiempos);
}

// ---------------------------------------------------------------------
// b) Endpoint completo de cálculo del resultado
// ---------------------------------------------------------------------
async function medirFinalizar(base) {
  const { datos: preguntas } = await pedir(base, 'GET', '/api/preguntas');
  const tiempos = [];

  for (let i = 0; i < CALENTAMIENTO + N_FINALIZAR; i += 1) {
    // Preparación (no se cronometra): crear la aplicación y guardar las 20 respuestas
    const crear = await pedir(base, 'POST', '/api/aplicaciones', { fecha_nacimiento: haceMeses(20) });
    if (crear.estado !== 201) throw new Error(`No se pudo crear la aplicación (${crear.estado})`);
    const id = crear.datos.id_aplicacion;
    creado.aplicaciones.push(id);
    await pedir(base, 'PUT', `/api/aplicaciones/${id}/respuestas`, { respuestas: respuestasAleatorias(preguntas) });

    // Solo se mide el cálculo y guardado del resultado
    const inicio = performance.now();
    const final = await pedir(base, 'POST', `/api/aplicaciones/${id}/finalizar`);
    const duracion = performance.now() - inicio;
    if (final.estado !== 200) throw new Error(`Falló finalizar (${final.estado}): ${final.datos.error}`);

    if (i >= CALENTAMIENTO) tiempos.push(duracion); // las primeras son de calentamiento
  }
  return estadisticas(tiempos);
}

// ---------------------------------------------------------------------
// c) Consulta de disponibilidad de un psicólogo
// ---------------------------------------------------------------------
async function prepararDisponibilidad(base, fecha) {
  const marca = Date.now();

  // Psicólogo validado con citas de 30 minutos (el rol se busca por nombre)
  const psicologo = await consulta(
    `INSERT INTO usuario (id_rol, correo, contrasena_hash, nombre, apellidos)
     SELECT id_rol, $1, 'sin-acceso', 'Psicóloga', 'De Tiempos' FROM rol WHERE nombre = 'psicologo'
     RETURNING id_usuario`,
    [`tiempos.psi.${marca}@ejemplo.com`]
  );
  creado.idPsicologo = psicologo.rows[0].id_usuario;
  await consulta(
    `INSERT INTO psicologo (id_usuario, cedula_profesional, duracion_cita_min, validado, fecha_validacion)
     VALUES ($1, $2, 30, TRUE, NOW())`,
    [creado.idPsicologo, `T${marca}`.slice(0, 20)]
  );

  // Horario de lunes (1) a viernes (5), de 09:00 a 14:00
  await consulta(
    `INSERT INTO horario_psicologo (id_psicologo, dia_semana, hora_inicio, hora_fin)
     SELECT $1, d, '09:00', '14:00' FROM generate_series(1, 5) AS d`,
    [creado.idPsicologo]
  );

  // Un bloqueo de 12:00 a 13:00 ese lunes
  await consulta(
    `INSERT INTO bloqueo_horario (id_psicologo, fecha, hora_inicio, hora_fin, motivo)
     VALUES ($1, $2, '12:00', '13:00', 'Medición de tiempos')`,
    [creado.idPsicologo, fecha]
  );

  // Dos citas ese lunes (cada cita necesita su propia aplicación)
  for (const [hora, fin] of [['09:00', '09:30'], ['10:30', '11:00']]) {
    const aplicacion = await consulta(
      `INSERT INTO aplicacion (edad_meses, estado, puntaje_total, id_nivel, fecha_fin)
       SELECT 20, 'completada', 3, id_nivel, NOW() FROM nivel_riesgo WHERE nombre = 'medio'
       RETURNING id_aplicacion`
    );
    creado.aplicaciones.push(aplicacion.rows[0].id_aplicacion);
    await consulta(
      `INSERT INTO cita (id_aplicacion, id_psicologo, fecha, hora_inicio, hora_fin, modalidad, estado)
       VALUES ($1, $2, $3, $4, $5, 'presencial', 'confirmada')`,
      [aplicacion.rows[0].id_aplicacion, creado.idPsicologo, fecha, hora, fin]
    );
  }

  // Padre registrado por la API para obtener la cookie de sesión
  creado.correoPadre = `tiempos.padre.${marca}@ejemplo.com`;
  const registro = await pedir(base, 'POST', '/api/auth/registro', {
    nombre: 'Padre',
    apellidos: 'De Tiempos',
    correo: creado.correoPadre,
    contrasena: 'Tiempos123',
    parentesco: 'padre',
    acepto_aviso: true,
  });
  if (registro.estado !== 201) throw new Error(`No se pudo registrar al padre (${registro.estado})`);
  return registro.respuesta.headers.get('set-cookie').split(';')[0];
}

async function medirDisponibilidad(base) {
  const fecha = proximoLunes();
  const cookie = await prepararDisponibilidad(base, fecha);
  const ruta = `/api/psicologos/${creado.idPsicologo}/disponibilidad?fecha=${fecha}`;

  // Comprobar que el endpoint ya existe (lo implementa otro hilo de trabajo)
  const prueba = await pedir(base, 'GET', ruta, undefined, cookie);
  if (prueba.estado !== 200) {
    console.warn(
      `\nAVISO: se omitió la medición de disponibilidad. GET ${ruta} respondió ${prueba.estado}` +
      (prueba.estado === 404 ? ' (el endpoint todavía no está implementado).' : '.')
    );
    return null;
  }
  console.log(`Disponibilidad del ${fecha}: ${prueba.datos.espacios.length} espacios libres`);

  const tiempos = [];
  for (let i = 0; i < CALENTAMIENTO + N_DISPONIBILIDAD; i += 1) {
    const inicio = performance.now();
    const res = await pedir(base, 'GET', ruta, undefined, cookie);
    const duracion = performance.now() - inicio;
    if (res.estado !== 200) throw new Error(`Falló la disponibilidad (${res.estado})`);
    if (i >= CALENTAMIENTO) tiempos.push(duracion);
  }
  return estadisticas(tiempos);
}

// ---------------------------------------------------------------------
// Limpieza
// ---------------------------------------------------------------------
async function limpiar() {
  if (creado.idPsicologo) {
    await consulta('DELETE FROM cita WHERE id_psicologo = $1', [creado.idPsicologo]);
    await consulta('DELETE FROM bloqueo_horario WHERE id_psicologo = $1', [creado.idPsicologo]);
    await consulta('DELETE FROM horario_psicologo WHERE id_psicologo = $1', [creado.idPsicologo]);
    await consulta('DELETE FROM psicologo WHERE id_usuario = $1', [creado.idPsicologo]);
    await consulta('DELETE FROM usuario WHERE id_usuario = $1', [creado.idPsicologo]);
  }
  if (creado.aplicaciones.length > 0) {
    // Las respuestas se borran solas (ON DELETE CASCADE)
    await consulta('DELETE FROM aplicacion WHERE id_aplicacion = ANY($1::uuid[])', [creado.aplicaciones]);
  }
  if (creado.correoPadre) {
    await consulta('DELETE FROM tutor WHERE id_usuario IN (SELECT id_usuario FROM usuario WHERE correo = $1)', [creado.correoPadre]);
    await consulta('DELETE FROM usuario WHERE correo = $1', [creado.correoPadre]);
  }
}

// ---------------------------------------------------------------------
// Programa principal
// ---------------------------------------------------------------------
function fila(nombre, e) {
  const f = (x) => x.toFixed(3);
  return `| ${nombre} | ${e.n.toLocaleString('es-MX')} | ${f(e.promedio)} | ${f(e.mediana)} | ${f(e.p95)} | ${f(e.min)} | ${f(e.max)} |`;
}

async function main() {
  const servidor = app.listen(0); // puerto libre elegido por el sistema
  await new Promise((resolver) => servidor.once('listening', resolver));
  const base = `http://127.0.0.1:${servidor.address().port}`;

  const filas = [];
  try {
    console.log('Midiendo cálculo puro…');
    filas.push(fila('Cálculo del resultado (función pura)', await medirCalculoPuro()));

    console.log('Midiendo POST /api/aplicaciones/:id/finalizar…');
    filas.push(fila('Cálculo del resultado (POST /finalizar)', await medirFinalizar(base)));

    console.log('Midiendo GET /api/psicologos/:id/disponibilidad…');
    const disponibilidad = await medirDisponibilidad(base);
    if (disponibilidad) filas.push(fila('Consulta de disponibilidad (GET)', disponibilidad));
  } finally {
    await limpiar();
    await new Promise((resolver) => servidor.close(resolver));
    await pool.end();
  }

  const memoriaGb = (os.totalmem() / 1024 ** 3).toFixed(1);
  console.log([
    '',
    '### Tiempos de respuesta (ms)',
    '',
    '| Operación | N | Promedio | Mediana | p95 | Mín | Máx |',
    '|---|---|---|---|---|---|---|',
    ...filas,
    '',
    `Medido el ${new Date().toLocaleString('es-MX')} · Node ${process.version} · ` +
      `${os.cpus()[0].model.trim()} · ${memoriaGb} GB de RAM · servidor y PostgreSQL en el mismo equipo (localhost)`,
    '',
  ].join('\n'));
}

main().catch((err) => {
  console.error('Error al medir tiempos:', err.message);
  process.exitCode = 1;
});
