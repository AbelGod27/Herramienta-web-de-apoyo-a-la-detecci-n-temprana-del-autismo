// Funciones de sesión del lado del cliente.
// La cookie de sesión es httpOnly: el navegador la envía sola, pero JavaScript no la puede leer.
// Para saber quién está conectado se pregunta al servidor (/api/auth/yo).

/** Devuelve el usuario con sesión iniciada, o null si no hay sesión. */
async function obtenerSesion() {
  try {
    const datos = await llamarApi('GET', '/api/auth/yo');
    return datos.usuario;
  } catch (err) {
    return null;
  }
}

/** Página principal de cada rol. */
function rutaPanel(rol) {
  const paneles = {
    padre: '/padre.html',
    psicologo: '/psicologo.html',
    admin_principal: '/admin.html',
    admin_secundario: '/admin.html',
  };
  return paneles[rol] || '/';
}

async function cerrarSesion() {
  try {
    await llamarApi('POST', '/api/auth/logout');
  } finally {
    window.location.href = '/';
  }
}
