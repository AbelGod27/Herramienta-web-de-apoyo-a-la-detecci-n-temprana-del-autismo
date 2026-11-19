// Middlewares para rutas inexistentes y errores no controlados.

/**
 * Error con código HTTP. Los controladores pueden lanzarlo así:
 *   throw new ErrorHttp(404, 'Cita no encontrada');
 */
class ErrorHttp extends Error {
  constructor(estado, mensaje) {
    super(mensaje);
    this.estado = estado;
  }
}

/** Responde 404 cuando ninguna ruta /api coincide. */
function rutaNoEncontrada(req, res) {
  res.status(404).json({ error: 'Recurso no encontrado' });
}

/**
 * Manejador central de errores. Express lo reconoce por tener 4 parámetros.
 * Al cliente solo se le envía un mensaje genérico en los errores 500
 * para no revelar detalles internos (consultas SQL, rutas de archivos, etc.).
 */
// eslint-disable-next-line no-unused-vars
function manejadorErrores(err, req, res, next) {
  // JSON mal formado en el cuerpo de la petición
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'El cuerpo de la petición no es JSON válido' });
  }

  const estado = err.estado || 500;

  if (estado >= 500) {
    console.error(err);
    return res.status(estado).json({ error: 'Ocurrió un error interno. Intenta de nuevo más tarde.' });
  }

  return res.status(estado).json({ error: err.message });
}

module.exports = { ErrorHttp, rutaNoEncontrada, manejadorErrores };
