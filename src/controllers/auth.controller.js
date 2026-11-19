// Registro de padres, inicio y cierre de sesión.
const bcrypt = require('bcrypt');
const config = require('../config/env');
const { consulta, transaccion } = require('../config/db');
const { ErrorHttp } = require('../middlewares/manejadorErrores');
const { iniciarSesion, cerrarSesion } = require('../middlewares/autenticacion');

// Código de PostgreSQL para violación de UNIQUE (correo repetido)
const PG_DUPLICADO = '23505';

// Hash de relleno: si el correo no existe se compara contra este,
// para que la respuesta tarde lo mismo y no revele qué correos están registrados.
const HASH_DE_RELLENO = bcrypt.hashSync('contrasena-de-relleno', 10);

const MENSAJE_LOGIN_INCORRECTO = 'Correo o contraseña incorrectos';

/**
 * POST /api/auth/registro
 * Registra a un padre o tutor. Exige el consentimiento expreso (acepto_aviso = true).
 */
async function registrarPadre(req, res) {
  const { nombre, apellidos, correo, contrasena, telefono, parentesco } = req.body;
  const contrasenaHash = await bcrypt.hash(contrasena, config.bcryptRondas);

  let usuario;
  try {
    usuario = await transaccion(async (cliente) => {
      // El rol se busca por nombre, nunca por un id fijo
      const { rows } = await cliente.query(
        `INSERT INTO usuario (id_rol, correo, contrasena_hash, nombre, apellidos, telefono)
         SELECT id_rol, $1, $2, $3, $4, $5 FROM rol WHERE nombre = 'padre'
         RETURNING id_usuario, correo, nombre, apellidos`,
        [correo, contrasenaHash, nombre, apellidos, telefono || null]
      );
      if (rows.length === 0) throw new Error('No existe el rol "padre" en la tabla rol');

      await cliente.query(
        `INSERT INTO tutor (id_usuario, parentesco, acepto_aviso, version_aviso, fecha_aceptacion)
         VALUES ($1, $2, TRUE, $3, NOW())`,
        [rows[0].id_usuario, parentesco, config.versionAviso]
      );

      return { ...rows[0], rol: 'padre' };
    });
  } catch (err) {
    if (err.code === PG_DUPLICADO) {
      throw new ErrorHttp(409, 'Ya existe una cuenta con ese correo. Inicia sesión.');
    }
    throw err;
  }

  // Al registrarse queda con la sesión iniciada
  iniciarSesion(res, usuario);
  res.status(201).json({ usuario });
}

/**
 * POST /api/auth/login
 * Mensaje genérico si el correo o la contraseña no coinciden.
 */
async function iniciarSesionUsuario(req, res) {
  const { correo, contrasena } = req.body;

  const { rows } = await consulta(
    `SELECT u.id_usuario, u.correo, u.nombre, u.apellidos, u.activo, u.contrasena_hash, r.nombre AS rol
     FROM usuario u
     JOIN rol r ON r.id_rol = u.id_rol
     WHERE u.correo = $1`,
    [correo]
  );
  const usuario = rows[0];

  const contrasenaCorrecta = await bcrypt.compare(
    contrasena,
    usuario ? usuario.contrasena_hash : HASH_DE_RELLENO
  );

  if (!usuario || !contrasenaCorrecta) {
    throw new ErrorHttp(401, MENSAJE_LOGIN_INCORRECTO);
  }
  if (!usuario.activo) {
    throw new ErrorHttp(403, 'Tu cuenta está suspendida. Contacta al administrador.');
  }

  // Nunca se devuelve el hash de la contraseña
  delete usuario.contrasena_hash;
  delete usuario.activo;

  iniciarSesion(res, usuario);
  res.json({ usuario });
}

/** POST /api/auth/logout */
function cerrarSesionUsuario(req, res) {
  cerrarSesion(res);
  res.json({ mensaje: 'Sesión cerrada' });
}

/** GET /api/auth/yo — datos del usuario con sesión iniciada */
function obtenerUsuarioActual(req, res) {
  res.json({ usuario: req.usuario });
}

module.exports = {
  registrarPadre,
  iniciarSesionUsuario,
  cerrarSesionUsuario,
  obtenerUsuarioActual,
};
