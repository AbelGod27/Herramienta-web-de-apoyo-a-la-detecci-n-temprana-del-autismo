// Carga y centraliza las variables de entorno del archivo .env.
// El resto del proyecto importa este objeto en lugar de leer process.env directamente.
require('dotenv').config();

// Todo el sistema trabaja con la hora de la Ciudad de México.
// Se fija antes de crear cualquier objeto Date.
process.env.TZ = process.env.TZ || 'America/Mexico_City';

// Variables sin las cuales el servidor no puede arrancar
const obligatorias = ['PGHOST', 'PGUSER', 'PGPASSWORD', 'PGDATABASE', 'JWT_SECRETO'];

const faltantes = obligatorias.filter((nombre) => !process.env[nombre]);
if (faltantes.length > 0) {
  throw new Error(`Faltan variables de entorno en .env: ${faltantes.join(', ')}`);
}

const config = {
  puerto: Number(process.env.PORT) || 3000,
  zonaHoraria: process.env.TZ,

  bd: {
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT) || 5432,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE,
  },

  jwt: {
    secreto: process.env.JWT_SECRETO,
  },

  // Duración de la sesión (token y cookie)
  sesionHoras: Number(process.env.SESION_HORAS) || 8,

  // Rondas de bcrypt: nunca menos de 10
  bcryptRondas: Math.max(10, Number(process.env.BCRYPT_RONDAS) || 12),

  // En localhost no hay HTTPS; se podrá activar en el futuro desde .env
  cookieSegura: process.env.COOKIE_SECURE === 'true',

  versionAviso: process.env.VERSION_AVISO || '1.0',
};

module.exports = config;
