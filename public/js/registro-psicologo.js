// Página de registro de psicólogo.

const formulario = document.getElementById('form-registro-psicologo');
const textoError = document.getElementById('error-registro');
const botonRegistrar = document.getElementById('boton-registrar');

// Si ya hay sesión, ir directo al panel correspondiente
obtenerSesion().then((usuario) => {
  if (usuario) window.location.replace(rutaPanel(usuario.rol));
});

function mostrarError(mensaje, idCampo) {
  textoError.textContent = mensaje;
  if (idCampo) {
    const campo = document.getElementById(idCampo);
    campo.setAttribute('aria-invalid', 'true');
    campo.focus();
  }
}

formulario.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  textoError.textContent = '';
  formulario.querySelectorAll('[aria-invalid]').forEach((c) => c.removeAttribute('aria-invalid'));

  const datos = {
    nombre: formulario.nombre.value.trim(),
    apellidos: formulario.apellidos.value.trim(),
    correo: formulario.correo.value.trim(),
    telefono: formulario.telefono.value.trim(),
    contrasena: formulario.contrasena.value,
    cedula_profesional: formulario.cedula_profesional.value.trim().toUpperCase(),
    especialidad: formulario.especialidad.value.trim(),
    descripcion: formulario.descripcion.value.trim(),
    duracion_cita_min: Number(formulario.duracion_cita_min.value),
  };

  // Validaciones rápidas en el navegador (el servidor las repite todas)
  if (!datos.nombre) return mostrarError('Escribe tu nombre', 'nombre');
  if (!datos.apellidos) return mostrarError('Escribe tus apellidos', 'apellidos');
  if (!datos.correo) return mostrarError('Escribe tu correo electrónico', 'correo');
  if (datos.contrasena.length < 8 || !/[A-Za-z]/.test(datos.contrasena) || !/\d/.test(datos.contrasena)) {
    return mostrarError('La contraseña debe tener mínimo 8 caracteres, con al menos una letra y un número', 'contrasena');
  }
  if (datos.contrasena !== document.getElementById('confirmar').value) {
    return mostrarError('Las contraseñas no coinciden', 'confirmar');
  }
  if (!/^[A-Z0-9]{5,20}$/.test(datos.cedula_profesional)) {
    return mostrarError('La cédula profesional debe tener de 5 a 20 letras o números, sin espacios', 'cedula');
  }

  botonRegistrar.disabled = true;
  try {
    await llamarApi('POST', '/api/psicologos/registro', datos);
    // El registro deja la sesión iniciada
    window.location.href = '/psicologo.html';
  } catch (err) {
    mostrarError(err.message);
    botonRegistrar.disabled = false;
  }
});
