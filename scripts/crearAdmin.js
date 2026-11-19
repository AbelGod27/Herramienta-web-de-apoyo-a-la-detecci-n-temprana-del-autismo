// Crea el administrador principal con los datos ADMIN_* del archivo .env.
// Uso: npm run crear-admin
// No hace nada si ya existe un administrador principal (solo puede haber uno).
require('dotenv').config();
const bcrypt = require('bcrypt');
const { Client } = require('pg');

const RONDAS = Math.max(10, Number(process.env.BCRYPT_RONDAS) || 12);

async function main() {
  const correo = (process.env.ADMIN_CORREO || '').trim().toLowerCase();
  const contrasena = process.env.ADMIN_CONTRASENA || '';
  const nombre = (process.env.ADMIN_NOMBRE || '').trim();
  const apellidos = (process.env.ADMIN_APELLIDOS || '').trim();

  // Validaciones básicas (mismas reglas de contraseña que el registro)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) throw new Error('ADMIN_CORREO no es un correo válido');
  if (contrasena === 'cambia_esta_contrasena') throw new Error('Cambia ADMIN_CONTRASENA en el archivo .env');
  if (contrasena.length < 8 || contrasena.length > 72 || !/[A-Za-z]/.test(contrasena) || !/\d/.test(contrasena)) {
    throw new Error('ADMIN_CONTRASENA debe tener de 8 a 72 caracteres, con al menos una letra y un número');
  }
  if (!nombre || !apellidos) throw new Error('Define ADMIN_NOMBRE y ADMIN_APELLIDOS en el archivo .env');

  const cliente = new Client({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT) || 5432,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE,
  });
  await cliente.connect();

  try {
    const existente = await cliente.query(
      `SELECT u.correo FROM usuario u JOIN rol r ON r.id_rol = u.id_rol
       WHERE r.nombre = 'admin_principal'`
    );
    if (existente.rowCount > 0) {
      console.log(`Ya existe un administrador principal (${existente.rows[0].correo}). No se creó otro.`);
      return;
    }

    const hash = await bcrypt.hash(contrasena, RONDAS);
    const { rowCount } = await cliente.query(
      `INSERT INTO usuario (id_rol, correo, contrasena_hash, nombre, apellidos)
       SELECT id_rol, $1, $2, $3, $4 FROM rol WHERE nombre = 'admin_principal'`,
      [correo, hash, nombre, apellidos]
    );
    if (rowCount === 0) throw new Error('No existe el rol "admin_principal". Ejecuta primero npm run bd:crear');

    console.log(`Administrador principal creado: ${correo}`);
    console.log('Por seguridad, puedes borrar ADMIN_CONTRASENA del archivo .env.');
  } catch (err) {
    if (err.code === '23505') throw new Error(`Ya existe un usuario con el correo ${correo}`);
    throw err;
  } finally {
    await cliente.end();
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
