// Autenticación (¿quién eres?) y autorización por rol (¿qué puedes hacer?).
// La sesión es un JWT guardado en una cookie httpOnly: JavaScript del navegador no puede leerla.
const jwt = require('jsonwebtoken');
const config = require('../config/env');
const { consulta } = require('../config/db');
const { ErrorHttp } = require('./manejadorErrores');
const { capturarErrores } = require('./capturarErrores');

const NOMBRE_COOKIE = 'sesion';

const opcionesCookie = {
  httpOnly: true, // no accesible desde JavaScript (protege contra robo por XSS)
  secure: config.cookieSegura, // false en localhost (sin HTTPS); true en producción
  sameSite: 'strict', // el navegador no la envía desde otros sitios (protege contra CSRF)
  path: '/',
};

/** Crea el token de sesión y lo guarda en la cookie. */
function iniciarSesion(res, usuario) {
  const token = jwt.sign({ id: usuario.id_usuario, rol: usuario.rol }, config.jwt.secreto, {
    expiresIn: `${config.sesionHoras}h`,
  });
  res.cookie(NOMBRE_COOKIE, token, { ...opcionesCookie, maxAge: config.sesionHoras * 60 * 60 * 1000 });
}

function cerrarSesion(res) {
  res.clearCookie(NOMBRE_COOKIE, opcionesCookie);
}

/**
 * Lee el usuario de la cookie. Devuelve null si no hay sesión válida.
 * Se consulta la BD en cada petición para que una suspensión (activo = false)
 * o un cambio de rol tengan efecto inmediato, aunque el token siga vigente.
 */
async function leerUsuarioDeCookie(req) {
  const token = req.cookies && req.cookies[NOMBRE_COOKIE];
  if (!token) return null;

  let datos;
  try {
    datos = jwt.verify(token, config.jwt.secreto);
  } catch (err) {
    return null; // token alterado o vencido
  }

  const { rows } = await consulta(
    `SELECT u.id_usuario, u.nombre, u.apellidos, u.correo, u.activo, r.nombre AS rol
     FROM usuario u
     JOIN rol r ON r.id_rol = u.id_rol
     WHERE u.id_usuario = $1`,
    [datos.id]
  );
  const usuario = rows[0];
  if (!usuario || !usuario.activo) return null;

  delete usuario.activo;
  return usuario;
}

/** Exige una sesión válida. Deja el usuario en req.usuario. */
const requerirSesion = capturarErrores(async (req, res, next) => {
  const usuario = await leerUsuarioDeCookie(req);
  if (!usuario) {
    cerrarSesion(res);
    throw new ErrorHttp(401, 'Inicia sesión para continuar');
  }
  req.usuario = usuario;
  next();
});

/** Lee la sesión si existe, pero no la exige (req.usuario puede quedar en null). */
const sesionOpcional = capturarErrores(async (req, res, next) => {
  req.usuario = await leerUsuarioDeCookie(req);
  next();
});

/**
 * Permite el paso solo a los roles indicados. Se usa después de requerirSesion.
 * Ejemplo: router.get('/ruta', requerirSesion, requerirRol('padre'), controlador)
 */
function requerirRol(...roles) {
  return (req, res, next) => {
    if (!req.usuario) return next(new ErrorHttp(401, 'Inicia sesión para continuar'));
    if (!roles.includes(req.usuario.rol)) {
      return next(new ErrorHttp(403, 'No tienes permiso para realizar esta acción'));
    }
    return next();
  };
}

module.exports = {
  NOMBRE_COOKIE,
  iniciarSesion,
  cerrarSesion,
  requerirSesion,
  sesionOpcional,
  requerirRol,
};
