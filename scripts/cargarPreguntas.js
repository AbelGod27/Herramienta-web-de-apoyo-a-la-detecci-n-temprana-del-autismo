// Carga el texto de las 20 preguntas desde un archivo JSON a la tabla "pregunta".
//
// El texto oficial del M-CHAT-R tiene derechos de autor y su uso en una aplicación
// requiere permiso de sus autores. Por eso NO viene en el proyecto: el administrador
// copia bd/preguntas.ejemplo.json como bd/preguntas.json y pega el texto autorizado.
// bd/preguntas.json está en .gitignore (no se sube a Git).
//
// "npm run bd:crear" ya carga las preguntas si encuentra bd/preguntas.json.
// Este comando sirve para volver a cargarlas si después cambia el texto:
//   npm run cargar-preguntas
//   npm run cargar-preguntas -- --archivo otra/ruta.json
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

// Archivo que se usa si no se indica otro
const ARCHIVO_PREGUNTAS = path.join(__dirname, '..', 'bd', 'preguntas.json');

// Texto con el que empieza el relleno de bd/preguntas.ejemplo.json
const TEXTO_DE_EJEMPLO = 'Escribe aquí';

/**
 * Revisa que el archivo tenga exactamente las preguntas 1 a 20, sin repetir,
 * con texto y con riesgo_si_responde booleano. Devuelve la lista de errores (vacía si todo está bien).
 */
function validarPreguntas(preguntas) {
  if (!Array.isArray(preguntas)) return ['El archivo debe contener una lista [ ... ] de preguntas'];

  const errores = [];
  const numeros = new Set();

  preguntas.forEach((p, i) => {
    const etiqueta = `Elemento ${i + 1}`;
    if (!Number.isInteger(p.numero) || p.numero < 1 || p.numero > 20) {
      errores.push(`${etiqueta}: "numero" debe ser un entero del 1 al 20`);
      return;
    }
    if (numeros.has(p.numero)) errores.push(`La pregunta ${p.numero} está repetida`);
    numeros.add(p.numero);

    if (typeof p.texto !== 'string' || p.texto.trim() === '') {
      errores.push(`Pregunta ${p.numero}: falta el texto`);
    } else if (p.texto.includes(TEXTO_DE_EJEMPLO)) {
      errores.push(`Pregunta ${p.numero}: todavía tiene el texto de ejemplo`);
    }
    if (p.ejemplo !== undefined && p.ejemplo !== null && typeof p.ejemplo !== 'string') {
      errores.push(`Pregunta ${p.numero}: "ejemplo" debe ser texto o null`);
    } else if (typeof p.ejemplo === 'string' && p.ejemplo.includes(TEXTO_DE_EJEMPLO)) {
      errores.push(`Pregunta ${p.numero}: el ejemplo todavía es el de la plantilla (escribe el oficial o pon null)`);
    }
    if (typeof p.riesgo_si_responde !== 'boolean') {
      errores.push(`Pregunta ${p.numero}: "riesgo_si_responde" debe ser true o false`);
    }
  });

  for (let n = 1; n <= 20; n += 1) {
    if (!numeros.has(n)) errores.push(`Falta la pregunta ${n}`);
  }
  return errores;
}

/** Lee el archivo JSON y lo valida. Lanza un error con la explicación si algo está mal. */
function leerPreguntas(archivo) {
  let preguntas;
  try {
    preguntas = JSON.parse(fs.readFileSync(archivo, 'utf8'));
  } catch (err) {
    throw new Error(`El archivo ${archivo} no es JSON válido: ${err.message}`);
  }

  const errores = validarPreguntas(preguntas);
  if (errores.length > 0) {
    throw new Error(`El archivo tiene ${errores.length} problema(s):\n  - ${errores.join('\n  - ')}`);
  }
  return preguntas;
}

/**
 * Guarda las preguntas en la base de datos con un cliente ya conectado.
 * Quien la llama se encarga de la transacción (BEGIN / COMMIT).
 */
async function guardarPreguntas(cliente, preguntas) {
  for (const p of preguntas) {
    const { rowCount } = await cliente.query(
      'UPDATE pregunta SET texto = $2, ejemplo = $3, riesgo_si_responde = $4 WHERE numero = $1',
      [p.numero, p.texto.trim(), p.ejemplo ? p.ejemplo.trim() : null, p.riesgo_si_responde]
    );
    if (rowCount === 0) {
      throw new Error(`La pregunta ${p.numero} no existe en la base de datos. Ejecuta primero npm run bd:crear`);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const indiceArchivo = args.indexOf('--archivo');
  const archivo = indiceArchivo !== -1 && args[indiceArchivo + 1]
    ? path.resolve(args[indiceArchivo + 1])
    : ARCHIVO_PREGUNTAS;

  if (!fs.existsSync(archivo)) {
    throw new Error(
      `No existe ${archivo}.\nCopia bd/preguntas.ejemplo.json como bd/preguntas.json y pega el texto oficial autorizado.`
    );
  }
  const preguntas = leerPreguntas(archivo);

  const cliente = new Client({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT) || 5432,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE,
  });
  await cliente.connect();

  try {
    // Todo en una transacción: o se actualizan las 20 preguntas, o ninguna
    await cliente.query('BEGIN');
    await guardarPreguntas(cliente, preguntas);
    await cliente.query('COMMIT');
    console.log(`Se cargaron las 20 preguntas en la base de datos "${process.env.PGDATABASE}".`);
  } catch (err) {
    await cliente.query('ROLLBACK');
    throw err;
  } finally {
    await cliente.end();
  }
}

// Solo se ejecuta si se llama directamente (npm run cargar-preguntas),
// no cuando crearBd.js importa sus funciones.
if (require.main === module) {
  main().catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { ARCHIVO_PREGUNTAS, leerPreguntas, guardarPreguntas };
