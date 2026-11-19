// Reglas de validación del panel de administración.
const { body, param, query } = require('express-validator');
const { reglasUsuario } = require('./auth.validator');

const ROLES = ['admin_principal', 'admin_secundario', 'psicologo', 'padre'];

// La plataforma NO diagnostica. Las recomendaciones nunca deben afirmar que el niño
// "tiene" o "no tiene" autismo. Esta regla simple rechaza las frases más directas;
// se comparan sin acentos y en minúsculas para que "Diagnóstico" y "diagnostico" cuenten igual.
const FRASES_PROHIBIDAS = ['diagnostico de autismo', 'tiene autismo', 'no tiene autismo'];

function normalizar(texto) {
  return String(texto).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function sinFrasesDiagnosticas(texto) {
  const limpio = normalizar(texto);
  if (FRASES_PROHIBIDAS.some((frase) => limpio.includes(frase))) {
    throw new Error(
      'La recomendación no puede afirmar un diagnóstico (por ejemplo "tiene autismo"): solo debe indicar un nivel de riesgo y qué hacer'
    );
  }
  return true;
}

// Crear un administrador secundario: mismas reglas que cualquier registro de usuario
const validarCrearAdmin = [...reglasUsuario];

const validarIdUsuario = [param('id').isInt({ min: 1 }).withMessage('Identificador no válido').toInt()];

const validarCambioActivo = [
  ...validarIdUsuario,
  body('activo').isBoolean({ strict: true }).withMessage('Indica si la cuenta queda activa (true) o suspendida (false)').toBoolean(true),
];

const validarCambioValidacion = [
  ...validarIdUsuario,
  body('validado').isBoolean({ strict: true }).withMessage('Indica si el psicólogo queda validado (true) o no (false)').toBoolean(true),
];

const validarFiltroPsicologos = [
  query('estado')
    .optional({ values: 'falsy' })
    .isIn(['pendientes', 'validados', 'todos']).withMessage('Filtro no válido'),
];

const validarListaUsuarios = [
  query('rol').optional({ values: 'falsy' }).isIn(ROLES).withMessage('Rol no válido'),
  query('buscar').optional({ values: 'falsy' }).trim().isLength({ max: 100 }).withMessage('La búsqueda es demasiado larga'),
  query('pagina').optional({ values: 'falsy' }).isInt({ min: 1, max: 10000 }).withMessage('Página no válida').toInt(),
];

const validarPregunta = [
  param('numero').isInt({ min: 1, max: 20 }).withMessage('El número de pregunta debe estar entre 1 y 20').toInt(),
  body('texto')
    .isString().withMessage('Escribe el texto de la pregunta')
    .trim()
    .notEmpty().withMessage('Escribe el texto de la pregunta')
    .isLength({ max: 1000 }).withMessage('El texto es demasiado largo'),
  body('ejemplo')
    .optional({ values: 'null' })
    .isString().withMessage('El ejemplo debe ser texto')
    .trim()
    .isLength({ max: 1000 }).withMessage('El ejemplo es demasiado largo'),
  body('riesgo_si_responde')
    .isBoolean({ strict: true }).withMessage('Indica qué respuesta indica riesgo').toBoolean(true),
];

// Se envían TODOS los niveles juntos, porque mover la frontera entre dos niveles
// cambia los dos rangos a la vez.
const validarNiveles = [
  body('niveles').isArray({ min: 1, max: 10 }).withMessage('Envía la lista de niveles de riesgo'),
  body('niveles.*.id_nivel').isInt({ min: 1 }).withMessage('Nivel no válido').toInt(),
  body('niveles.*.nombre')
    .isString().withMessage('Escribe el nombre del nivel')
    .trim()
    .notEmpty().withMessage('Escribe el nombre del nivel')
    .isLength({ max: 20 }).withMessage('El nombre del nivel es demasiado largo'),
  body('niveles.*.puntaje_min').isInt({ min: 0, max: 20 }).withMessage('Los puntajes deben estar entre 0 y 20').toInt(),
  body('niveles.*.puntaje_max').isInt({ min: 0, max: 20 }).withMessage('Los puntajes deben estar entre 0 y 20').toInt(),
  body('niveles.*')
    .custom((nivel) => Number(nivel.puntaje_min) <= Number(nivel.puntaje_max))
    .withMessage('En cada nivel, el puntaje mínimo no puede ser mayor que el máximo'),
  body('niveles.*.recomendacion')
    .isString().withMessage('Escribe la recomendación')
    .trim()
    .notEmpty().withMessage('Escribe la recomendación')
    .isLength({ max: 2000 }).withMessage('La recomendación es demasiado larga')
    .custom(sinFrasesDiagnosticas),
];

module.exports = {
  validarCrearAdmin,
  validarCambioActivo,
  validarCambioValidacion,
  validarFiltroPsicologos,
  validarListaUsuarios,
  validarPregunta,
  validarNiveles,
};
