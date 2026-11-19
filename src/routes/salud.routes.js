// Rutas del módulo de salud del sistema.
const { Router } = require('express');
const { verificarSalud } = require('../controllers/salud.controller');

const router = Router();

// GET /api/salud
router.get('/', verificarSalud);

module.exports = router;
