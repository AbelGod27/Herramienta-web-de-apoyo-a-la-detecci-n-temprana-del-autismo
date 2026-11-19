// Punto de entrada: levanta el servidor HTTP en localhost.
const config = require('./config/env');
const app = require('./app');
const { pool } = require('./config/db');

const servidor = app.listen(config.puerto, () => {
  console.log(`Servidor escuchando en http://localhost:${config.puerto}`);
});

// Cierre ordenado (Ctrl+C): deja de aceptar peticiones y cierra el pool
function cerrar() {
  console.log('Cerrando servidor...');
  servidor.close(() => {
    pool.end().then(() => process.exit(0));
  });
}

process.on('SIGINT', cerrar);
process.on('SIGTERM', cerrar);
