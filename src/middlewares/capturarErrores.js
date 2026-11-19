// Express 4 no atrapa los errores de funciones async.
// Este envoltorio pasa cualquier error al manejador central con next(err).
// Uso: router.get('/ruta', capturarErrores(miControlador));
function capturarErrores(controlador) {
  return (req, res, next) => Promise.resolve(controlador(req, res, next)).catch(next);
}

module.exports = { capturarErrores };
