// Crea las bases de datos (principal y de pruebas) y les aplica el esquema y los datos iniciales.
// Uso: npm run bd:crear
// Es seguro ejecutarlo varias veces: no borra datos existentes.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const ZONA_HORARIA = process.env.TZ || 'America/Mexico_City';

// Conexión base (sin indicar la base de datos)
const conexion = {
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT) || 5432,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
};

const basesDeDatos = [process.env.PGDATABASE, process.env.PGDATABASE_TEST].filter(Boolean);

const esquema = fs.readFileSync(path.join(__dirname, '..', 'bd', 'esquema.sql'), 'utf8');
const datos = fs.readFileSync(path.join(__dirname, '..', 'bd', 'datos_iniciales.sql'), 'utf8');

// Los nombres de base de datos no se pueden pasar como parámetro ($1),
// así que se validan con una expresión regular antes de usarlos.
function validarNombre(nombre) {
  if (!/^[a-z_][a-z0-9_]*$/.test(nombre)) {
    throw new Error(`Nombre de base de datos no válido: "${nombre}" (usa minúsculas, números y _)`);
  }
}

async function crearSiNoExiste(nombre) {
  // Se conecta a la base "postgres", que siempre existe, para poder crear las demás
  const cliente = new Client({ ...conexion, database: 'postgres' });
  await cliente.connect();
  try {
    const { rowCount } = await cliente.query('SELECT 1 FROM pg_database WHERE datname = $1', [nombre]);
    if (rowCount === 0) {
      await cliente.query(`CREATE DATABASE ${nombre} ENCODING 'UTF8'`);
      console.log(`  Base de datos "${nombre}" creada.`);
    } else {
      console.log(`  Base de datos "${nombre}" ya existía.`);
    }
    // Zona horaria por defecto de la base de datos
    await cliente.query(`ALTER DATABASE ${nombre} SET timezone TO '${ZONA_HORARIA}'`);
  } finally {
    await cliente.end();
  }
}

async function aplicarEsquema(nombre) {
  const cliente = new Client({ ...conexion, database: nombre });
  await cliente.connect();
  try {
    // Todo en una transacción: si algo falla, no queda a medias
    await cliente.query('BEGIN');
    await cliente.query(esquema);
    await cliente.query(datos);
    await cliente.query('COMMIT');
    console.log(`  Esquema y datos iniciales aplicados en "${nombre}".`);
  } catch (err) {
    await cliente.query('ROLLBACK');
    throw err;
  } finally {
    await cliente.end();
  }
}

async function main() {
  if (!fs.existsSync(path.join(__dirname, '..', '.env'))) {
    throw new Error('No existe el archivo .env. Copia .env.example como .env y llena tus datos.');
  }
  if (!process.env.PGPASSWORD || process.env.PGPASSWORD === 'cambia_esta_contrasena') {
    throw new Error('Escribe en PGPASSWORD (archivo .env) la contraseña de tu usuario de PostgreSQL.');
  }
  if (basesDeDatos.length === 0) {
    throw new Error('Define PGDATABASE (y opcionalmente PGDATABASE_TEST) en el archivo .env');
  }
  for (const nombre of basesDeDatos) {
    validarNombre(nombre);
    console.log(`\n[${nombre}]`);
    await crearSiNoExiste(nombre);
    await aplicarEsquema(nombre);
  }
  console.log('\nListo.');
}

main().catch((err) => {
  console.error('\nError al crear la base de datos:', err.message);
  process.exit(1);
});
