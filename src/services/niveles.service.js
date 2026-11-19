// Reglas de los rangos de los niveles de riesgo.
// Funciones PURAS (sin base de datos) para poder probarlas por separado.

const PUNTAJE_MINIMO = 0;
const PUNTAJE_MAXIMO = 20;

/** ¿Dos rangos [puntaje_min, puntaje_max] comparten al menos un puntaje? */
function seTraslapan(a, b) {
  return a.puntaje_min <= b.puntaje_max && b.puntaje_min <= a.puntaje_max;
}

/**
 * Comprueba que los niveles cubran TODOS los puntajes de 0 a 20, sin huecos ni traslapes.
 * Ejemplo válido: 0–2, 3–7, 8–20.  Inválidos: 0–1, 3–7, 8–20 (falta el 2); 0–3, 3–7, 8–20 (el 3 se repite).
 */
function rangosCubrenTodo(niveles, minimo = PUNTAJE_MINIMO, maximo = PUNTAJE_MAXIMO) {
  const ordenados = [...niveles].sort((a, b) => a.puntaje_min - b.puntaje_min);

  let siguiente = minimo; // el siguiente puntaje que debe empezar un nivel
  for (const nivel of ordenados) {
    if (nivel.puntaje_min !== siguiente) return false; // hueco o traslape
    siguiente = nivel.puntaje_max + 1;
  }
  return siguiente === maximo + 1; // el último nivel debe terminar en 20
}

/**
 * Decide en qué orden aplicar los cambios de rango para que, paso a paso,
 * ningún nivel se traslape con otro (la base de datos lo revisa en cada UPDATE).
 * Ejemplo: mover la frontera bajo/medio de 2 a 3 exige reducir primero "medio" (3–7 → 4–7)
 * y después ampliar "bajo" (0–2 → 0–3).
 * Si no existe un orden posible (el resultado final se traslapa), devuelve los cambios
 * restantes tal cual y la base de datos rechazará el traslape.
 *
 * @param {Array<{id_nivel, puntaje_min, puntaje_max}>} actuales rangos guardados hoy
 * @param {Array<{id_nivel, puntaje_min, puntaje_max}>} nuevos   rangos que se quieren guardar
 */
function ordenarCambios(actuales, nuevos) {
  const rangos = new Map(actuales.map((n) => [n.id_nivel, n]));
  const pendientes = [...nuevos];
  const orden = [];

  while (pendientes.length > 0) {
    // Buscar un cambio que no choque con el rango actual de ningún OTRO nivel
    const indice = pendientes.findIndex((cambio) =>
      [...rangos.entries()].every(([id, rango]) => id === cambio.id_nivel || !seTraslapan(cambio, rango))
    );
    if (indice === -1) {
      orden.push(...pendientes);
      break;
    }
    const [cambio] = pendientes.splice(indice, 1);
    orden.push(cambio);
    rangos.set(cambio.id_nivel, cambio);
  }
  return orden;
}

module.exports = { rangosCubrenTodo, ordenarCambios };
