// Reglas de validación para el registro de niños y la vinculación de aplicaciones.
const { body, param } = require('express-validator');
const { calcularEdadMeses, fechaHoy } = require('../services/edad.service');

// La plataforma es para niños pequeños; más de 6 años suele ser un error de captura
const EDAD_MAXIMA_MESES = 72;

const validarNino = [
  body('nombre')
    .trim()
    .notEmpty().withMessage('Escribe el nombre del niño o niña')
    .isLength({ max: 80 }).withMessage('El nombre es demasiado largo'),
  body('fecha_nacimiento')
    .matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('Escribe una fecha de nacimiento válida')
    .bail()
    .isISO8601({ strict: true }).withMessage('Escribe una fecha de nacimiento válida')
    .bail()
    .custom((fecha) => {
      const hoy = fechaHoy();
      if (fecha > hoy) throw new Error('La fecha de nacimiento no puede ser futura');
      if (calcularEdadMeses(fecha, hoy) > EDAD_MAXIMA_MESES) {
        throw new Error('Revisa la fecha de nacimiento: la plataforma es para niños pequeños');
      }
      return true;
    }),
  body('semanas_gestacion')
    .optional({ values: 'null' })
    .isInt({ min: 22, max: 36 }).withMessage('Las semanas de gestación de un niño prematuro deben estar entre 22 y 36')
    .toInt(),
  body('sexo')
    .optional({ values: 'falsy' })
    .isIn(['F', 'M']).withMessage('Elige una opción válida para el sexo'),
];

const validarIdNino = [
  param('id').isInt({ min: 1 }).withMessage('Identificador no válido').toInt(),
];

const validarVincular = [
  param('id').isUUID().withMessage('El identificador del cuestionario no es válido'),
  body('id_nino').isInt({ min: 1 }).withMessage('Elige a tu hijo o hija').toInt(),
];

module.exports = { validarNino, validarIdNino, validarVincular };
