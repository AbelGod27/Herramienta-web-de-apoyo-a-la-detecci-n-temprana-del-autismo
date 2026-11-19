// Configuración de la aplicación Express (sin levantar el servidor).
// Se separa de server.js para poder probarla con Supertest.
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');

const config = require('./config/env');
const rutasCuestionario = require('./routes/cuestionario.routes');
const rutasAuth = require('./routes/auth.routes');
const rutasNinos = require('./routes/ninos.routes');
const rutasPsicologos = require('./routes/psicologos.routes');
const rutasCitas = require('./routes/citas.routes');
const rutasAdmin = require('./routes/admin.routes');
const { rutaNoEncontrada, manejadorErrores } = require('./middlewares/manejadorErrores');

const app = express();

// Encabezados HTTP de seguridad. La política de contenido por defecto de helmet
// solo permite recursos del propio servidor (no hay CDNs ni scripts en línea).
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        // Sin HTTPS (localhost) no se debe forzar a pedir los recursos por https://,
        // o el CSS y el JS no cargarían al entrar por IP (por ejemplo, desde un celular)
        upgradeInsecureRequests: config.cookieSegura ? [] : null,
      },
    },
  })
);

// Lee cuerpos JSON (límite pequeño: la API no recibe archivos)
app.use(express.json({ limit: '100kb' }));

// Lee las cookies (ahí viaja el token de sesión)
app.use(cookieParser());

// --- Rutas de la API ---
app.use('/api/auth', rutasAuth);
app.use('/api/ninos', rutasNinos);
app.use('/api/psicologos', rutasPsicologos);
app.use('/api/citas', rutasCitas);
app.use('/api/admin', rutasAdmin);
app.use('/api', rutasCuestionario);

// Cualquier otra ruta /api que no exista
app.use('/api', rutaNoEncontrada);

// --- Archivos del cliente (HTML, CSS, JS) ---
app.use(express.static(path.join(__dirname, '..', 'public')));

// Manejador central de errores (siempre al final)
app.use(manejadorErrores);

module.exports = app;
