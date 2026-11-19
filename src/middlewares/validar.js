// Revisa el resultado de las reglas de express-validator.
// Si alguna falló, responde 400 con el primer mensaje (para mostrarlo al usuario)
// y la lista completa de errores por campo.
const { validationResult } = require('express-validator');

function validar(req, res, next) {
  const errores = validationResult(req);
  if (errores.isEmpty()) return next();

  const lista = errores.array();
  return res.status(400).json({
    error: lista[0].msg,
    detalles: lista.map((e) => ({ campo: e.path, mensaje: e.msg })),
  });
}

module.exports = { validar };
