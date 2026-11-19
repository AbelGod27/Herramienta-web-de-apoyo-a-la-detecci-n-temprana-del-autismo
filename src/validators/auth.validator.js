// Reglas de validación de registro e inicio de sesión.
const { body } = require('express-validator');

const PARENTESCOS = ['madre', 'padre', 'abuelo', 'tutor_legal', 'otro'];

// Reglas comunes a cualquier registro de usuario (también se usarán con psicólogos)
const reglasUsuario = [
  body('nombre')
    .trim()
    .notEmpty().withMessage('Escribe tu nombre')
    .isLength({ max: 80 }).withMessage('El nombre es demasiado largo'),
  body('apellidos')
    .trim()
    .notEmpty().withMessage('Escribe tus apellidos')
    .isLength({ max: 120 }).withMessage('Los apellidos son demasiado largos'),
  body('correo')
    .trim()
    .toLowerCase()
    .isEmail().withMessage('Escribe un correo electrónico válido')
    .isLength({ max: 120 }).withMessage('El correo es demasiado largo'),
  body('contrasena')
    .isString().withMessage('Escribe una contraseña')
    .isLength({ min: 8, max: 72 }).withMessage('La contraseña debe tener entre 8 y 72 caracteres')
    .matches(/[A-Za-zÁÉÍÓÚÑáéíóúñ]/).withMessage('La contraseña debe incluir al menos una letra')
    .matches(/\d/).withMessage('La contraseña debe incluir al menos un número'),
  body('telefono')
    .optional({ values: 'falsy' })
    .trim()
    .matches(/^[0-9 +()-]{8,20}$/).withMessage('Escribe un teléfono válido (de 8 a 20 dígitos)'),
];

const validarRegistroPadre = [
  ...reglasUsuario,
  body('parentesco')
    .isIn(PARENTESCOS).withMessage('Elige tu parentesco con el niño o niña'),
  // Consentimiento expreso: debe ser exactamente true
  body('acepto_aviso')
    .custom((valor) => valor === true)
    .withMessage('Debes aceptar el aviso de privacidad para registrarte'),
];

const validarLogin = [
  body('correo').trim().toLowerCase().notEmpty().withMessage('Escribe tu correo y tu contraseña'),
  body('contrasena').isString().notEmpty().withMessage('Escribe tu correo y tu contraseña'),
];

module.exports = { reglasUsuario, validarRegistroPadre, validarLogin };
