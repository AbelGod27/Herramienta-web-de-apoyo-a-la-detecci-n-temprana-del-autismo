// Página de registro de padre o tutor.

const formulario = document.getElementById('form-registro');
const textoError = document.getElementById('error-registro');
const botonRegistrar = document.getElementById('boton-registrar');

// Si ya hay sesión, no tiene sentido registrarse otra vez
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
    parentesco: formulario.parentesco.value,
    correo: formulario.correo.value.trim(),
    telefono: formulario.telefono.value.trim(),
    contrasena: formulario.contrasena.value,
    acepto_aviso: formulario.acepto_aviso.checked,
  };

  // Validaciones rápidas en el navegador (el servidor las repite todas)
  if (!datos.nombre) return mostrarError('Escribe tu nombre', 'nombre');
  if (!datos.apellidos) return mostrarError('Escribe tus apellidos', 'apellidos');
  if (!datos.parentesco) return mostrarError('Elige tu parentesco con el niño o niña', 'parentesco');
  if (!datos.correo) return mostrarError('Escribe tu correo electrónico', 'correo');
  if (datos.contrasena.length < 8 || !/[A-Za-z]/.test(datos.contrasena) || !/\d/.test(datos.contrasena)) {
    return mostrarError('La contraseña debe tener mínimo 8 caracteres, con al menos una letra y un número', 'contrasena');
  }
  if (datos.contrasena !== document.getElementById('confirmar').value) {
    return mostrarError('Las contraseñas no coinciden', 'confirmar');
  }
  if (!datos.acepto_aviso) {
    return mostrarError('Debes aceptar el aviso de privacidad para registrarte', 'acepto-aviso');
  }

  botonRegistrar.disabled = true;
  try {
    await llamarApi('POST', '/api/auth/registro', datos);
    // El registro deja la sesión iniciada; en el panel se vincula el cuestionario pendiente
    window.location.href = '/padre.html';
  } catch (err) {
    mostrarError(err.message);
    botonRegistrar.disabled = false;
  }
});
