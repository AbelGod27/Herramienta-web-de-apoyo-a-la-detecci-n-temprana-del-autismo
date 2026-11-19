// Rutas de los hijos del padre. Todas exigen sesión con rol "padre".
const { Router } = require('express');
const controlador = require('../controllers/ninos.controller');
const { validarNino, validarIdNino } = require('../validators/ninos.validator');
const { validar } = require('../middlewares/validar');
const { capturarErrores } = require('../middlewares/capturarErrores');
const { requerirSesion, requerirRol } = require('../middlewares/autenticacion');

const router = Router();

// Se aplica a todas las rutas de este archivo
router.use(requerirSesion, requerirRol('padre'));

router.get('/', capturarErrores(controlador.listarNinos));
router.post('/', validarNino, validar, capturarErrores(controlador.registrarNino));
router.get('/:id/aplicaciones', validarIdNino, validar, capturarErrores(controlador.historialNino));

module.exports = router;
