// Reglas de validación del módulo de psicólogos.
const { body, param, query } = require('express-validator');
const { reglasUsuario } = require('./auth.validator');
const { FORMATO_HORA, reglaFechaCita } = require('./citas.validator');
const { fechaHoy } = require('../services/edad.service');

// Campos del perfil profesional (se usan al registrarse y al editar el perfil)
const reglasPerfil = [
  body('especialidad')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 100 }).withMessage('La especialidad es demasiado larga (máximo 100 caracteres)'),
  body('descripcion')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 1000 }).withMessage('La descripción es demasiado larga (máximo 1000 caracteres)'),
];

const reglaDuracion = (campo) =>
  campo.isInt({ min: 15, max: 180 }).withMessage('La duración de la cita debe estar entre 15 y 180 minutos').toInt();

const validarRegistroPsicologo = [
  ...reglasUsuario,
  // Se guarda en mayúsculas y sin espacios para que la restricción UNIQUE detecte duplicados
  body('cedula_profesional')
    .trim()
    .toUpperCase()
    .matches(/^[A-Z0-9]{5,20}$/).withMessage('La cédula profesional debe tener de 5 a 20 letras o números, sin espacios'),
  ...reglasPerfil,
  reglaDuracion(body('duracion_cita_min').optional({ values: 'falsy' })),
];

const validarPerfil = [...reglasPerfil, reglaDuracion(body('duracion_cita_min'))];

const validarId = [param('id').isInt({ min: 1 }).withMessage('Identificador no válido').toInt()];

const validarHorario = [
  body('dia_semana').isInt({ min: 1, max: 7 }).withMessage('Elige un día de la semana').toInt(),
  body('hora_inicio').matches(FORMATO_HORA).withMessage('Escribe la hora de inicio (HH:MM)'),
  body('hora_fin')
    .matches(FORMATO_HORA).withMessage('Escribe la hora de fin (HH:MM)')
    .bail()
    // Las horas 'HH:MM' se pueden comparar como texto: '09:00' < '13:30'
    .custom((fin, { req }) => fin > req.body.hora_inicio)
    .withMessage('La hora de fin debe ser posterior a la de inicio'),
];

const validarActivo = [
  ...validarId,
  body('activo').isBoolean({ strict: true }).withMessage('Indica si el bloque está activo').toBoolean(true),
];

const validarBloqueo = [
  body('fecha')
    .matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('Escribe una fecha válida')
    .bail()
    .isISO8601({ strict: true }).withMessage('Escribe una fecha válida')
    .bail()
    .custom((fecha) => fecha >= fechaHoy()).withMessage('La fecha del bloqueo no puede estar en el pasado'),
  body('hora_inicio')
    .optional({ values: 'falsy' })
    .matches(FORMATO_HORA).withMessage('Escribe la hora de inicio (HH:MM)'),
  body('hora_fin')
    .optional({ values: 'falsy' })
    .matches(FORMATO_HORA).withMessage('Escribe la hora de fin (HH:MM)'),
  // Las dos horas van juntas: ambas vacías = día completo
  body().custom((datos) => {
    const inicio = datos.hora_inicio || null;
    const fin = datos.hora_fin || null;
    if ((inicio === null) !== (fin === null)) {
      throw new Error('Escribe las dos horas, o deja ambas vacías para bloquear el día completo');
    }
    if (inicio !== null && fin <= inicio) {
      throw new Error('La hora de fin debe ser posterior a la de inicio');
    }
    return true;
  }),
  body('motivo')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 200 }).withMessage('El motivo es demasiado largo (máximo 200 caracteres)'),
];

const validarDisponibilidad = [...validarId, reglaFechaCita(query('fecha'))];

module.exports = {
  validarRegistroPsicologo,
  validarPerfil,
  validarId,
  validarHorario,
  validarActivo,
  validarBloqueo,
  validarDisponibilidad,
};
