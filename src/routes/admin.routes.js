// Rutas del panel de administración.
// Todas exigen sesión de administrador (principal o secundario): los dos tienen los mismos permisos.
const { Router } = require('express');
const controlador = require('../controllers/admin.controller');
const v = require('../validators/admin.validator');
const { validar } = require('../middlewares/validar');
const { capturarErrores } = require('../middlewares/capturarErrores');
const { requerirSesion, requerirRol } = require('../middlewares/autenticacion');

const router = Router();

// Cualquier administrador (principal o secundario) para todas las rutas de este archivo
router.use(requerirSesion, requerirRol('admin_principal', 'admin_secundario'));

router.get('/estadisticas', capturarErrores(controlador.verEstadisticas));

router.get('/psicologos', v.validarFiltroPsicologos, validar, capturarErrores(controlador.listarPsicologos));
router.patch('/psicologos/:id/validacion', v.validarCambioValidacion, validar, capturarErrores(controlador.cambiarValidacion));

router.get('/usuarios', v.validarListaUsuarios, validar, capturarErrores(controlador.listarUsuarios));
router.patch('/usuarios/:id/activo', v.validarCambioActivo, validar, capturarErrores(controlador.cambiarEstadoCuenta));

router.get('/administradores', capturarErrores(controlador.listarAdministradores));
router.post('/administradores', v.validarCrearAdmin, validar, capturarErrores(controlador.crearAdministrador));

router.get('/preguntas', capturarErrores(controlador.listarPreguntas));
router.put('/preguntas/:numero', v.validarPregunta, validar, capturarErrores(controlador.editarPregunta));

router.get('/niveles', capturarErrores(controlador.listarNiveles));
router.put('/niveles', v.validarNiveles, validar, capturarErrores(controlador.editarNiveles));

module.exports = router;
