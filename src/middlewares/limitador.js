// Límite de intentos por IP en login y registro (frena ataques de fuerza bruta).
const rateLimit = require('express-rate-limit');
const config = require('../config/env');

function crearLimitador(maximo, minutos, mensaje) {
  return rateLimit({
    windowMs: minutos * 60 * 1000,
    // En las pruebas automáticas se hacen muchas peticiones seguidas desde la misma IP
    limit: config.esPrueba ? 1000 : maximo,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: mensaje },
  });
}

// 10 intentos de inicio de sesión cada 15 minutos
const limitarLogin = crearLimitador(
  10,
  15,
  'Demasiados intentos de inicio de sesión. Espera 15 minutos e intenta de nuevo.'
);

// 5 registros por hora
const limitarRegistro = crearLimitador(
  5,
  60,
  'Demasiados registros desde este equipo. Espera una hora e intenta de nuevo.'
);

module.exports = { limitarLogin, limitarRegistro };
