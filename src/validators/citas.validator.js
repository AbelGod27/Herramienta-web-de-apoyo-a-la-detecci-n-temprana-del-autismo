// Reglas de validación de las citas.
const { body, param } = require('express-validator');
const { fechaHoy } = require('../services/edad.service');
const { diasEntre } = require('../services/disponibilidad.service');

// Hora en formato de 24 horas 'HH:MM'
const FORMATO_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

// Las citas se pueden pedir hasta 60 días adelante
const DIAS_MAXIMOS = 60;

// Resultado de la entrevista de seguimiento:
// - 'negativo': tras la entrevista el riesgo es bajo; se sugiere seguimiento habitual.
// - 'positivo': tras la entrevista persiste el riesgo; se recomienda una evaluación del desarrollo.
const RESULTADOS_SEGUIMIENTO = ['negativo', 'positivo'];

/** Comprueba que una fecha 'AAAA-MM-DD' sea hoy o posterior y no más de 60 días adelante. */
function comprobarFechaCita(fecha) {
  const dias = diasEntre(fechaHoy(), fecha);
  if (dias < 0) throw new Error('La fecha no puede estar en el pasado');
  if (dias > DIAS_MAXIMOS) throw new Error(`Solo se pueden pedir citas hasta ${DIAS_MAXIMOS} días adelante`);
  return true;
}

/** Reglas para un campo de fecha de cita (sirve para body o query). */
function reglaFechaCita(campo) {
  return campo
    .matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('Escribe una fecha válida')
    .bail()
    .isISO8601({ strict: true }).withMessage('Escribe una fecha válida')
    .bail()
    .custom(comprobarFechaCita);
}

const validarSolicitudCita = [
  body('id_aplicacion').isUUID().withMessage('Elige un cuestionario válido'),
  body('id_psicologo').isInt({ min: 1 }).withMessage('Elige un psicólogo').toInt(),
  reglaFechaCita(body('fecha')),
  body('hora_inicio').matches(FORMATO_HORA).withMessage('Elige un horario'),
  body('modalidad').isIn(['presencial', 'en_linea']).withMessage('Elige si la cita será presencial o en línea'),
  body('motivo_padre')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 500 }).withMessage('El motivo es demasiado largo (máximo 500 caracteres)'),
];

const validarIdCita = [
  param('id').isInt({ min: 1 }).withMessage('Identificador de cita no válido').toInt(),
];

const validarSeguimiento = [
  ...validarIdCita,
  body('puntaje_seguimiento')
    .isInt({ min: 0, max: 20 }).withMessage('El puntaje de seguimiento debe estar entre 0 y 20')
    .toInt(),
  body('resultado_seguimiento')
    .isIn(RESULTADOS_SEGUIMIENTO).withMessage('Elige el resultado de la entrevista: negativo o positivo'),
  body('observaciones')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 2000 }).withMessage('Las observaciones son demasiado largas (máximo 2000 caracteres)'),
];

module.exports = {
  FORMATO_HORA,
  reglaFechaCita,
  validarSolicitudCita,
  validarIdCita,
  validarSeguimiento,
};
