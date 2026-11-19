// Carga el texto de las 20 preguntas desde un archivo JSON a la tabla "pregunta".
//
// El texto oficial del M-CHAT-R tiene derechos de autor y su uso en una aplicación
// requiere permiso de sus autores. Por eso NO viene en el proyecto: el administrador
// copia bd/preguntas.ejemplo.json como bd/preguntas.json, pega el texto autorizado
// y ejecuta este script. bd/preguntas.json está en .gitignore (no se sube a Git).
//
// Uso:
//   npm run cargar-preguntas                 -> base de datos principal (PGDATABASE)
//   npm run cargar-preguntas -- --test       -> base de datos de pruebas (PGDATABASE_TEST)
//   npm run cargar-preguntas -- --archivo otra/ruta.json
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

// Texto con el que empieza el relleno de bd/preguntas.ejemplo.json
const TEXTO_DE_EJEMPLO = 'Escribe aquí';

/** Lee los argumentos de la línea de comandos. */
function leerArgumentos() {
  const args = process.argv.slice(2);
  const indiceArchivo = args.indexOf('--archivo');
  return {
    usarPruebas: args.includes('--test'),
    archivo: indiceArchivo !== -1 && args[indiceArchivo + 1]
      ? path.resolve(args[indiceArchivo + 1])
      : path.join(__dirname, '..', 'bd', 'preguntas.json'),
  };
}

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

async function main() {
  const { usarPruebas, archivo } = leerArgumentos();

  if (!fs.existsSync(archivo)) {
    throw new Error(
      `No existe ${archivo}.\nCopia bd/preguntas.ejemplo.json como bd/preguntas.json y pega el texto oficial autorizado.`
    );
  }

  let preguntas;
  try {
    preguntas = JSON.parse(fs.readFileSync(archivo, 'utf8'));
  } catch (err) {
    throw new Error(`El archivo no es JSON válido: ${err.message}`);
  }

  const errores = validarPreguntas(preguntas);
  if (errores.length > 0) {
    throw new Error(`El archivo tiene ${errores.length} problema(s):\n  - ${errores.join('\n  - ')}`);
  }

  const baseDatos = usarPruebas ? process.env.PGDATABASE_TEST : process.env.PGDATABASE;
  const cliente = new Client({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT) || 5432,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: baseDatos,
  });
  await cliente.connect();

  try {
    // Todo en una transacción: o se actualizan las 20 preguntas, o ninguna
    await cliente.query('BEGIN');
    for (const p of preguntas) {
      const { rowCount } = await cliente.query(
        'UPDATE pregunta SET texto = $2, ejemplo = $3, riesgo_si_responde = $4 WHERE numero = $1',
        [p.numero, p.texto.trim(), p.ejemplo ? p.ejemplo.trim() : null, p.riesgo_si_responde]
      );
      if (rowCount === 0) {
        throw new Error(`La pregunta ${p.numero} no existe en la base de datos. Ejecuta primero npm run bd:crear`);
      }
    }
    await cliente.query('COMMIT');
    console.log(`Se cargaron las 20 preguntas en la base de datos "${baseDatos}".`);
  } catch (err) {
    await cliente.query('ROLLBACK');
    throw err;
  } finally {
    await cliente.end();
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
