// Rutas de autenticación.
const { Router } = require('express');
const controlador = require('../controllers/auth.controller');
const { validarRegistroPadre, validarLogin } = require('../validators/auth.validator');
const { validar } = require('../middlewares/validar');
const { capturarErrores } = require('../middlewares/capturarErrores');
const { requerirSesion } = require('../middlewares/autenticacion');
const { limitarLogin, limitarRegistro } = require('../middlewares/limitador');

const router = Router();

router.post('/registro', limitarRegistro, validarRegistroPadre, validar, capturarErrores(controlador.registrarPadre));
router.post('/login', limitarLogin, validarLogin, validar, capturarErrores(controlador.iniciarSesionUsuario));
router.post('/logout', controlador.cerrarSesionUsuario);
router.get('/yo', requerirSesion, controlador.obtenerUsuarioActual);

module.exports = router;
