// Íconos SVG propios para los niveles de riesgo (no dependen de internet).
// Cada nivel tiene una FORMA distinta, así se distinguen aunque no se perciba el color.

const ICONOS_NIVEL = {
  // Círculo con palomita
  bajo: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><circle cx="24" cy="24" r="20"/><path d="M15 25l6 6 12-13"/></svg>',
  // Triángulo con signo de admiración
  medio: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M24 5L44 41H4Z"/><path d="M24 19v10"/><circle cx="24" cy="35" r="1.5" fill="currentColor"/></svg>',
  // Octágono con signo de admiración
  alto: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h16l12 12v16L32 44H16L4 32V16Z"/><path d="M24 13v14"/><circle cx="24" cy="34" r="1.5" fill="currentColor"/></svg>',
  // Círculo con "i" (por si el catálogo tiene otro nombre de nivel)
  otro: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"><circle cx="24" cy="24" r="20"/><path d="M24 22v12"/><circle cx="24" cy="15" r="1.5" fill="currentColor"/></svg>',
};

/** Clave del ícono y del color para un nombre de nivel ('bajo', 'medio', 'alto' u 'otro'). */
function claveNivel(nombreNivel) {
  return ICONOS_NIVEL[nombreNivel] && nombreNivel !== 'otro' ? nombreNivel : 'otro';
}

/** Etiqueta pequeña con ícono + texto, por ejemplo para el historial. */
function crearEtiquetaNivel(nombreNivel) {
  const clave = claveNivel(nombreNivel);
  const etiqueta = document.createElement('span');
  etiqueta.className = `etiqueta-nivel nivel-${clave}`;

  const icono = document.createElement('span');
  icono.className = 'icono-nivel';
  icono.setAttribute('aria-hidden', 'true');
  icono.innerHTML = ICONOS_NIVEL[clave]; // SVG fijo de este archivo, no datos del usuario

  const texto = document.createElement('span');
  texto.textContent = `Riesgo ${nombreNivel}`;

  etiqueta.append(icono, texto);
  return etiqueta;
}
