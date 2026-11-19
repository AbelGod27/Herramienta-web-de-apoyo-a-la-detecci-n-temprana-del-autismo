// Página de inicio de sesión: al entrar, lleva a cada usuario al panel de su rol.

const formulario = document.getElementById('form-login');
const textoError = document.getElementById('error-login');
const botonEntrar = document.getElementById('boton-entrar');

obtenerSesion().then((usuario) => {
  if (usuario) window.location.replace(rutaPanel(usuario.rol));
});

formulario.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  textoError.textContent = '';

  const correo = formulario.correo.value.trim();
  const contrasena = formulario.contrasena.value;
  if (!correo || !contrasena) {
    textoError.textContent = 'Escribe tu correo y tu contraseña';
    return;
  }

  botonEntrar.disabled = true;
  try {
    const { usuario } = await llamarApi('POST', '/api/auth/login', { correo, contrasena });
    window.location.href = rutaPanel(usuario.rol);
  } catch (err) {
    textoError.textContent = err.message;
    formulario.contrasena.value = '';
    botonEntrar.disabled = false;
  }
});
