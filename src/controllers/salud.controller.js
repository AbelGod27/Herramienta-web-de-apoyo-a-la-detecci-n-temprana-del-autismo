// Controlador de la ruta /api/salud: comprueba que el servidor y la base de datos respondan.
const { consulta } = require('../config/db');

async function verificarSalud(req, res) {
  try {
    const { rows } = await consulta('SELECT NOW() AS hora_servidor_bd');
    res.json({
      estado: 'ok',
      baseDatos: 'conectada',
      horaBaseDatos: rows[0].hora_servidor_bd,
    });
  } catch (err) {
    // No se envía el detalle del error al cliente, solo se registra en consola
    console.error('Fallo la verificación de la base de datos:', err.message);
    res.status(503).json({ estado: 'error', baseDatos: 'sin conexión' });
  }
}

module.exports = { verificarSalud };
