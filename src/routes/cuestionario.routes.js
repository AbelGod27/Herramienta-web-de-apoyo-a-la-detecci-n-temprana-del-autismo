// Rutas del cuestionario. Contestarlo no requiere sesión; vincularlo sí.
const { Router } = require('express');
const controlador = require('../controllers/cuestionario.controller');
const {
  validarCrearAplicacion,
  validarIdAplicacion,
  validarRespuestas,
} = require('../validators/cuestionario.validator');
const { validarVincular } = require('../validators/ninos.validator');
const { validar } = require('../middlewares/validar');
const { capturarErrores } = require('../middlewares/capturarErrores');
const { requerirSesion, requerirRol, sesionOpcional } = require('../middlewares/autenticacion');

const router = Router();

// Lista de preguntas en orden
router.get('/preguntas', capturarErrores(controlador.obtenerPreguntas));

// Crear una aplicación anónima indicando la edad del niño
router.post('/aplicaciones', validarCrearAplicacion, validar, capturarErrores(controlador.crearAplicacion));

// Guardar (o cambiar) respuestas mientras la aplicación está en curso
router.put(
  '/aplicaciones/:id/respuestas',
  validarRespuestas,
  validar,
  capturarErrores(controlador.guardarRespuestas)
);

// Calcular el resultado y cerrar la aplicación
router.post(
  '/aplicaciones/:id/finalizar',
  validarIdAplicacion,
  validar,
  capturarErrores(controlador.finalizarAplicacion)
);

// Consultar el resultado (la sesión es opcional: se necesita si ya está vinculada)
router.get(
  '/aplicaciones/:id/resultado',
  sesionOpcional,
  validarIdAplicacion,
  validar,
  capturarErrores(controlador.obtenerResultado)
);

// Vincular una aplicación anónima a un hijo (solo padres con sesión)
router.post(
  '/aplicaciones/:id/vincular',
  requerirSesion,
  requerirRol('padre'),
  validarVincular,
  validar,
  capturarErrores(controlador.vincularAplicacion)
);

module.exports = router;
