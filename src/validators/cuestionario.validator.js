// Reglas de validación de las rutas del cuestionario.
const { body, param } = require('express-validator');
const { calcularEdadMeses, fechaHoy } = require('../services/edad.service');

const EDAD_MINIMA = 16;
const EDAD_MAXIMA = 30;

const validarCrearAplicacion = [
  // Se pide la fecha de nacimiento (más fácil para el padre que contar meses).
  // El servidor calcula la edad en meses y SOLO guarda la edad, no la fecha.
  body('fecha_nacimiento')
    .matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('Escribe una fecha de nacimiento válida')
    .bail()
    .isISO8601({ strict: true }).withMessage('Escribe una fecha de nacimiento válida')
    .bail()
    .custom((fecha) => {
      const hoy = fechaHoy();
      if (fecha > hoy) throw new Error('La fecha de nacimiento no puede ser futura');
      const edad = calcularEdadMeses(fecha, hoy);
      if (edad < EDAD_MINIMA || edad > EDAD_MAXIMA) {
        throw new Error('Este cuestionario es para niños de 16 a 30 meses');
      }
      return true;
    }),
  // Solo se envía si el niño fue prematuro (menos de 37 semanas)
  body('semanas_gestacion')
    .optional({ values: 'null' })
    .isInt({ min: 22, max: 36 })
    .withMessage('Las semanas de gestación de un niño prematuro deben estar entre 22 y 36')
    .toInt(),
];

const validarIdAplicacion = [
  param('id').isUUID().withMessage('El identificador del cuestionario no es válido'),
];

const validarRespuestas = [
  ...validarIdAplicacion,
  body('respuestas')
    .isArray({ min: 1, max: 20 })
    .withMessage('Envía entre 1 y 20 respuestas'),
  body('respuestas.*.id_pregunta')
    .isInt({ min: 1 })
    .withMessage('Cada respuesta debe indicar una pregunta válida')
    .toInt(),
  body('respuestas.*.valor')
    .isBoolean({ strict: true })
    .withMessage('Cada respuesta debe ser sí (true) o no (false)')
    .toBoolean(true),
];

module.exports = { validarCrearAplicacion, validarIdAplicacion, validarRespuestas };
