// Rutas del módulo de psicólogos.
const { Router } = require('express');
const controlador = require('../controllers/psicologos.controller');
const v = require('../validators/psicologos.validator');
const { validar } = require('../middlewares/validar');
const { capturarErrores } = require('../middlewares/capturarErrores');
const { requerirSesion, requerirRol } = require('../middlewares/autenticacion');
const { limitarRegistro } = require('../middlewares/limitador');

const router = Router();

// ---------- Público ----------
router.post('/registro', limitarRegistro, v.validarRegistroPsicologo, validar, capturarErrores(controlador.registrarPsicologo));

// ---------- Psicólogo con sesión: /api/psicologos/yo/... ----------
// (se declaran antes de "/:id" para que "yo" no se confunda con un id)
const yo = Router();
yo.use(requerirSesion, requerirRol('psicologo'));

yo.get('/', capturarErrores(controlador.obtenerPerfil));
yo.put('/', v.validarPerfil, validar, capturarErrores(controlador.actualizarPerfil));

yo.get('/horario', capturarErrores(controlador.listarHorario));
yo.post('/horario', v.validarHorario, validar, capturarErrores(controlador.agregarHorario));
yo.patch('/horario/:id', v.validarActivo, validar, capturarErrores(controlador.cambiarEstadoHorario));
yo.delete('/horario/:id', v.validarId, validar, capturarErrores(controlador.borrarHorario));

yo.get('/bloqueos', capturarErrores(controlador.listarBloqueos));
yo.post('/bloqueos', v.validarBloqueo, validar, capturarErrores(controlador.crearBloqueo));
yo.delete('/bloqueos/:id', v.validarId, validar, capturarErrores(controlador.borrarBloqueo));

router.use('/yo', yo);

// ---------- Padre con sesión ----------
router.get('/', requerirSesion, requerirRol('padre'), capturarErrores(controlador.listarPsicologos));
router.get(
  '/:id/disponibilidad',
  requerirSesion,
  requerirRol('padre'),
  v.validarDisponibilidad,
  validar,
  capturarErrores(controlador.obtenerDisponibilidad)
);

module.exports = router;
