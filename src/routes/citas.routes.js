// Rutas de citas. Todas requieren sesión; cada acción indica qué rol la puede usar.
const { Router } = require('express');
const controlador = require('../controllers/citas.controller');
const { validarSolicitudCita, validarIdCita, validarSeguimiento } = require('../validators/citas.validator');
const { validar } = require('../middlewares/validar');
const { capturarErrores } = require('../middlewares/capturarErrores');
const { requerirSesion, requerirRol } = require('../middlewares/autenticacion');

const router = Router();

router.use(requerirSesion);

// El padre pide una cita para un cuestionario de su hijo
router.post('/', requerirRol('padre'), validarSolicitudCita, validar, capturarErrores(controlador.solicitarCita));

// Cada quien ve solo sus citas
router.get('/', requerirRol('padre', 'psicologo'), capturarErrores(controlador.listarCitas));

// Cancelar: el padre o el psicólogo de la cita
router.patch('/:id/cancelar', requerirRol('padre', 'psicologo'), validarIdCita, validar, capturarErrores(controlador.cancelarCita));

// Confirmar y registrar el seguimiento: solo el psicólogo
router.patch('/:id/confirmar', requerirRol('psicologo'), validarIdCita, validar, capturarErrores(controlador.confirmarCita));
router.patch('/:id/completar', requerirRol('psicologo'), validarSeguimiento, validar, capturarErrores(controlador.completarCita));

module.exports = router;
