// Conexión a PostgreSQL mediante un pool de conexiones (node-postgres).
// Un pool reutiliza conexiones abiertas en lugar de abrir una nueva en cada consulta.
const { Pool, types } = require('pg');
const config = require('./env');

// El tipo DATE de PostgreSQL (OID 1082) se devuelve como texto 'AAAA-MM-DD'.
// Si se convirtiera a Date de JavaScript, la zona horaria podría recorrerlo un día.
const OID_DATE = 1082;
types.setTypeParser(OID_DATE, (valor) => valor);

const pool = new Pool({
  ...config.bd,
  max: 10, // máximo de conexiones simultáneas
  idleTimeoutMillis: 30000, // cierra conexiones inactivas tras 30 s
  connectionTimeoutMillis: 5000, // error si no conecta en 5 s
  // La sesión de PostgreSQL también usa la zona de la Ciudad de México,
  // así NOW() y CURRENT_DATE coinciden con la hora local
  options: `-c timezone=${config.zonaHoraria}`,
});

// Errores de conexiones inactivas del pool (por ejemplo, si se reinicia PostgreSQL)
pool.on('error', (err) => {
  console.error('Error inesperado en el pool de PostgreSQL:', err.message);
});

/**
 * Ejecuta una consulta parametrizada.
 * Ejemplo: consulta('SELECT * FROM rol WHERE nombre = $1', ['padre'])
 * Los valores van en el arreglo, NUNCA concatenados en el texto SQL.
 */
function consulta(texto, parametros = []) {
  return pool.query(texto, parametros);
}

/**
 * Ejecuta varias consultas dentro de una transacción.
 * Recibe una función que usa el cliente; si algo falla se hace ROLLBACK.
 */
async function transaccion(funcion) {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const resultado = await funcion(cliente);
    await cliente.query('COMMIT');
    return resultado;
  } catch (err) {
    await cliente.query('ROLLBACK');
    throw err;
  } finally {
    cliente.release();
  }
}

module.exports = { pool, consulta, transaccion };
