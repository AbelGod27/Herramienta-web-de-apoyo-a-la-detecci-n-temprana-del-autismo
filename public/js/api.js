// Funciones comunes del cliente para hablar con la API del servidor.
// Se carga antes del script de cada página.

/**
 * Hace una petición a la API y devuelve el JSON de la respuesta.
 * Si el servidor responde con error, lanza un Error con el mensaje que envió.
 * @param {string} metodo  'GET', 'POST', 'PUT', 'DELETE'
 * @param {string} url     por ejemplo '/api/preguntas'
 * @param {object} [cuerpo] datos a enviar como JSON
 */
async function llamarApi(metodo, url, cuerpo) {
  const opciones = {
    method: metodo,
    headers: {},
    credentials: 'same-origin', // envía la cookie de sesión
  };

  if (cuerpo !== undefined) {
    opciones.headers['Content-Type'] = 'application/json';
    opciones.body = JSON.stringify(cuerpo);
  }

  let respuesta;
  try {
    respuesta = await fetch(url, opciones);
  } catch (err) {
    throw new Error('No se pudo conectar con el servidor. Intenta de nuevo.');
  }

  // Algunas respuestas de error podrían no traer JSON
  const datos = await respuesta.json().catch(() => ({}));

  if (!respuesta.ok) {
    const error = new Error(datos.error || 'Ocurrió un error inesperado. Intenta de nuevo.');
    error.estado = respuesta.status;
    throw error;
  }

  return datos;
}

// Claves usadas en sessionStorage (se borran al cerrar la pestaña)
const CLAVE_APLICACION = 'id_aplicacion';
// Hijo para el que el padre empezó el cuestionario desde su panel { id_nino, fecha_nacimiento }
const CLAVE_NINO_CUESTIONARIO = 'nino_cuestionario';
const claveRespuestas = (idAplicacion) => `respuestas_${idAplicacion}`;
