# Guía del proyecto

Herramienta web de apoyo a la detección temprana del autismo (M-CHAT-R, 16 a 30 meses).

Esta guía explica **qué hace cada parte, por qué está hecha así y cómo demostrarla**. Está ordenada de lo general a lo particular: si solo tienes 10 minutos, lee las secciones 1, 3 y 11.

---

## 1. Qué es (y qué no es)

Una plataforma donde los padres de niños de 16 a 30 meses contestan el cuestionario **M-CHAT-R** (20 preguntas de sí/no) y obtienen un **nivel de riesgo** (bajo, medio o alto) con una recomendación. Si quieren, crean una cuenta, guardan el resultado en el perfil de su hijo y piden una cita con un psicólogo validado, quien aplica la entrevista de seguimiento y registra el resultado.

**No diagnostica.** Ningún texto dice que el niño "tiene" o "no tiene" autismo. El M-CHAT-R es un instrumento de **cribado**: su objetivo es detectar a la mayor cantidad posible de niños en riesgo (alta sensibilidad), aceptando falsos positivos. Por eso el resultado siempre lleva a un profesional, nunca a una conclusión.

---

## 2. Cómo arrancarlo desde cero

Requisitos: Node.js 18 o más y PostgreSQL (tú tienes Node 24 y PostgreSQL 18).

```bash
npm install                    # 1. instala las dependencias
cp .env.example .env           # 2. crea tu archivo de configuración y llénalo
npm run bd:crear               # 3. crea las bases mchat y mchat_test con sus tablas y catálogos
npm run cargar-preguntas       # 4. carga el texto oficial de las 20 preguntas (bd/preguntas.json)
npm run cargar-preguntas -- --test   #    lo mismo en la base de pruebas
npm run crear-admin            # 5. crea el administrador principal (datos ADMIN_* del .env)
npm run dev                    # 6. abre http://localhost:3000
```

Otros comandos:

| Comando | Para qué sirve |
|---|---|
| `npm test` | Corre las 174 pruebas automáticas |
| `npm run test:exhaustivo` | Solo la prueba de las 1,048,576 combinaciones (imprime tablas para el artículo) |
| `npm run tiempos` | Mide los tiempos de respuesta (imprime tabla para el artículo) |

Todo corre en tu computadora (localhost): no hay servicios externos, CDNs, correos ni HTTPS. La cookie de sesión tiene `secure` controlado por `COOKIE_SECURE` en `.env` para poder activarlo en el futuro.

---

## 3. Arquitectura en una imagen

```
 NAVEGADOR (public/)                         SERVIDOR (src/)                              BASE DE DATOS
 ┌───────────────────┐   fetch + JSON   ┌──────────────────────────────────────────┐   SQL      ┌────────────┐
 │ HTML + CSS + JS   │ ───────────────► │ routes      ¿qué URL es?                 │ ─────────► │ PostgreSQL │
 │ sin frameworks    │                  │ middlewares ¿tiene sesión? ¿su rol puede?│ parametri- │ 12 tablas  │
 │                   │ ◄─────────────── │ validators  ¿los datos son correctos?    │ zado ($1)  │            │
 │ api.js: llamarApi │   cookie httpOnly│ controllers lógica de cada ruta          │ ◄───────── │            │
 └───────────────────┘   con la sesión  │ services    cálculos puros (puntaje,     │            └────────────┘
                                        │             edad, disponibilidad...)     │
                                        └──────────────────────────────────────────┘
```

**Idea clave para explicar:** cada capa tiene una sola responsabilidad. Las rutas no calculan nada, los controladores no validan formatos y los **servicios son funciones puras** (no tocan la base de datos), por eso se pueden probar solos, como en la prueba exhaustiva.

### Recorrido de una petición: "ver mi resultado"

Cuando el padre contesta la última pregunta, el navegador hace `POST /api/aplicaciones/:id/finalizar`:

1. **Ruta** ([cuestionario.routes.js](../src/routes/cuestionario.routes.js)): reconoce la URL y encadena validador → controlador.
2. **Validador** ([cuestionario.validator.js](../src/validators/cuestionario.validator.js)): revisa que `:id` sea un UUID. Si no, responde 400 y no sigue.
3. **Controlador** `finalizarAplicacion` ([cuestionario.controller.js](../src/controllers/cuestionario.controller.js)), dentro de una **transacción**:
   - bloquea la fila de la aplicación (`FOR UPDATE`) para que dos peticiones no la terminen a la vez,
   - lee preguntas, respuestas y niveles,
   - llama al **servicio** `calcularResultado` ([puntaje.service.js](../src/services/puntaje.service.js)),
   - guarda `es_riesgo` en cada respuesta y `puntaje_total`, `id_nivel`, `fecha_fin`, `estado='completada'`.
4. Si algo falla en cualquier paso, la transacción hace **ROLLBACK** y el **manejador de errores** ([manejadorErrores.js](../src/middlewares/manejadorErrores.js)) responde un mensaje claro (o uno genérico si es un error interno, para no revelar detalles).

---

## 4. Carpetas

| Carpeta | Qué contiene |
|---|---|
| `src/config/` | Lectura del `.env` (`env.js`) y el pool de conexiones a PostgreSQL (`db.js`, con `consulta()` y `transaccion()`) |
| `src/routes/` | Una archivo por módulo: salud, auth, ninos, cuestionario, psicologos, citas, admin |
| `src/middlewares/` | Sesión y roles (`autenticacion.js`), límite de intentos (`limitador.js`), validación (`validar.js`), errores |
| `src/validators/` | Reglas de `express-validator` de cada módulo |
| `src/controllers/` | La lógica de cada ruta (consultas SQL parametrizadas) |
| `src/services/` | Funciones puras: `puntaje`, `edad`, `disponibilidad`, `niveles`, `estadisticas` |
| `public/` | Páginas: inicio, cuestionario, resultado, registro, login, panel del padre, del psicólogo y del administrador |
| `bd/` | `esquema.sql` (tablas), `datos_iniciales.sql` (roles, niveles), `preguntas.json` (texto oficial, **no se sube a Git**) |
| `scripts/` | `crearBd`, `crearAdmin`, `cargarPreguntas`, `medirTiempos` |
| `tests/` | 9 archivos de pruebas (unitarias, de integración y exhaustiva) |

---

## 5. Base de datos

```
rol ─< usuario ─┬─ tutor ─< nino ─< aplicacion >─ nivel_riesgo
                │                      │   │
                │                      │   └─< respuesta >─ pregunta
                │                      │
                └─ psicologo ─┬─< horario_psicologo
                              ├─< bloqueo_horario
                              └─< cita >─ aplicacion
```
(`─<` = "uno a muchos")

Decisiones que vale la pena mencionar:

- **La aplicación nace anónima** (`id_nino = NULL`). Solo se llena `id_nino` cuando el padre la vincula a su hijo, sin perder las respuestas.
- **La fecha de nacimiento del cuestionario anónimo no se guarda**: el servidor calcula la edad en meses y guarda solo eso (privacidad).
- **Reglas en la propia base de datos**, no solo en el código: edad entre 16 y 30, puntaje entre 0 y 20, un tutor no existe sin `acepto_aviso = TRUE`, los rangos de niveles no pueden traslaparse (`EXCLUDE`), una aplicación completada siempre tiene puntaje y nivel.
- **Índice único parcial en `cita`**: un psicólogo no puede tener dos citas *no canceladas* en la misma fecha y hora. Es el `UNIQUE (id_psicologo, fecha, hora_inicio)` del diseño, pero ignorando las canceladas para que un espacio cancelado se pueda volver a reservar.
- **Otro índice parcial**: cada aplicación puede tener como máximo una cita activa.
- **Borrado solo lógico**: suspender una cuenta es `activo = false`; nunca se borran usuarios.

---

## 6. Roles y qué puede hacer cada uno

| Rol | Puede |
|---|---|
| **Padre o tutor** | Contestar sin cuenta; registrarse (con consentimiento expreso); registrar hijos; ver el historial; vincular el cuestionario anónimo; pedir, ver y cancelar citas |
| **Psicólogo** | Registrarse (queda `validado = false`); configurar horario semanal y bloqueos; ver **solo sus** citas; confirmar, cancelar y registrar el seguimiento; ver el resultado y las respuestas **solo** de niños con cita con él |
| **Admin secundario** | Validar la cédula de psicólogos; suspender o reactivar cuentas de padres y psicólogos; ver estadísticas anónimas |
| **Admin principal** (uno) | Todo lo anterior + crear y suspender admins secundarios + editar preguntas y niveles de riesgo |

**Todo se valida en el servidor.** Las consultas filtran por el usuario de la sesión (`WHERE n.id_tutor = $1`, `AND id_psicologo = $2`), así que aunque alguien modifique el JavaScript del navegador, no puede ver datos ajenos: recibe 403 o 404.

### Rutas de la API

| Módulo | Rutas principales |
|---|---|
| Cuestionario (sin sesión) | `GET /api/preguntas` · `POST /api/aplicaciones` · `PUT /api/aplicaciones/:id/respuestas` · `POST /api/aplicaciones/:id/finalizar` · `GET /api/aplicaciones/:id/resultado` |
| Sesión | `POST /api/auth/registro` · `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/auth/yo` |
| Hijos (padre) | `GET/POST /api/ninos` · `GET /api/ninos/:id/aplicaciones` · `POST /api/aplicaciones/:id/vincular` |
| Psicólogos | `POST /api/psicologos/registro` · `GET /api/psicologos` · `GET /api/psicologos/:id/disponibilidad?fecha=` · `/api/psicologos/yo` (perfil, horario, bloqueos) |
| Citas | `POST/GET /api/citas` · `PATCH /api/citas/:id/cancelar` · `/confirmar` · `/completar` |
| Administración | `/api/admin/estadisticas` · `/psicologos` · `/usuarios` · `/administradores` · `/preguntas` · `/niveles` |

---

## 7. Los algoritmos, explicados

### 7.1 Puntaje del M-CHAT-R ([puntaje.service.js](../src/services/puntaje.service.js))

```
para cada pregunta:
    si respuesta == pregunta.riesgo_si_responde  → suma 1 punto
puntaje (0–20) → se busca el nivel cuyo rango lo contiene: 0–2 bajo, 3–7 medio, 8–20 alto
```

En las preguntas 2, 5 y 12 "sí" indica riesgo; en las demás, "no". **Ese dato se lee de la base de datos** (`riesgo_si_responde`), no está escrito en el código: si el catálogo cambia, el algoritmo no se toca.

### 7.2 Edad en meses ([edad.service.js](../src/services/edad.service.js))

Meses cumplidos = diferencia de años × 12 + diferencia de meses, y se resta 1 si todavía no llega el día del mes. Ejemplo: del 15/03/2024 al 14/11/2025 son 19 meses (el 15 cumple 20). Se usa para validar el rango 16–30 y para la **vinculación**: la edad calculada con la fecha de nacimiento del hijo debe coincidir ±1 mes con la del cuestionario.

### 7.3 Disponibilidad de citas ([disponibilidad.service.js](../src/services/disponibilidad.service.js))

```
espacios libres = bloques del horario activos ese día, partidos según la duración de la cita
                − los que se cruzan con un bloqueo de esa fecha
                − los que se cruzan con citas no canceladas
                − los que ya pasaron (si es hoy)
```

Las horas se convierten a **minutos desde la medianoche** para comparar fácil (09:30 → 570). Dos intervalos se cruzan si `inicio1 < fin2 y inicio2 < fin1`.

Ejemplo: horario lunes 09:00–12:00, citas de 60 min → 09:00, 10:00, 11:00. Si hay una cita a las 10:00 y un bloqueo de 11:30 a 12:00, quedan libres solo las **09:00**.

### 7.4 Doble reserva

Si dos padres piden el mismo espacio al mismo tiempo, los dos podrían ver el espacio libre. Para que solo uno lo obtenga:

1. Al reservar, el servidor **vuelve a calcular** la disponibilidad dentro de una transacción.
2. Aun así, si los dos llegan en el mismo milisegundo, el **índice único** de la base de datos rechaza el segundo `INSERT` (error `23505`), y el servidor responde: *"Ese horario acaba de ser reservado por otra persona. Elige otro."*

La prueba automática lanza las dos reservas en paralelo (`Promise.all`) y comprueba que exactamente una obtiene 201 y la otra 409.

---

## 8. Seguridad y privacidad (dónde está cada cosa)

| Medida | Dónde |
|---|---|
| Contraseñas con bcrypt (12 rondas; mínimo 10) y nunca devueltas por la API | `auth.controller.js`, `env.js` |
| Sesión en JWT dentro de cookie `httpOnly` + `SameSite=Strict` (protege de robo por XSS y de CSRF) | `autenticacion.js` |
| Se consulta la BD en cada petición: una cuenta suspendida pierde la sesión al instante | `autenticacion.js` |
| Mensaje genérico en el login ("Correo o contraseña incorrectos"), con el mismo tiempo de respuesta exista o no el correo | `auth.controller.js` |
| Límite de intentos: 10 logins / 15 min y 5 registros / hora por IP | `limitador.js` |
| Consultas SQL siempre parametrizadas (`$1, $2`): sin inyección SQL | todos los controladores |
| Validación de todas las entradas con `express-validator` | `src/validators/` |
| Encabezados de seguridad con `helmet` (solo recursos del propio servidor) | `app.js` |
| En el navegador, los datos del servidor se muestran con `textContent`, nunca `innerHTML` | `public/js/` |
| Consentimiento expreso obligatorio (`acepto_aviso`, `version_aviso`, `fecha_aceptacion`) | registro de padre |
| Estadísticas solo con totales: los administradores no ven niños ni respuestas | `estadisticas.service.js` |
| Credenciales solo en `.env` (está en `.gitignore`) | raíz |

---

## 9. Diseño de la interfaz

- Primero celular, paleta tranquila (azul petróleo, verde salvia, durazno, crema), sin rompecabezas ni neón.
- **El nivel de riesgo siempre con ícono + texto**: círculo con palomita (bajo), triángulo (medio), octágono (alto). Cada forma es distinta para que se distingan aunque no se perciba el color.
- Contraste verificado (WCAG 2.1 AA): todos los pares de colores usados superan 4.5:1.
- Botones grandes (mínimo 44–52 px de alto), etiquetas en todos los campos, mensajes de error con `role="alert"`.
- Imprimir o guardar como PDF con el propio navegador (`@media print`), sin librerías.

---

## 10. Pruebas y resultados para el artículo

**174 pruebas automáticas, todas pasan** (`npm test`):

| Archivo | Qué prueba |
|---|---|
| `puntaje.test.js`, `edad.test.js`, `disponibilidad.test.js` | Funciones puras, caso por caso |
| `exhaustivo.test.js` | Las 2^20 combinaciones contra una implementación de referencia independiente |
| `cuestionario.test.js` | Flujo anónimo completo contra la base de pruebas |
| `usuarios.test.js` | Registro, consentimiento, login, roles, hijos y vinculación |
| `citas.test.js` | Psicólogos, horarios, bloqueos, citas, permisos y **doble reserva** |
| `admin.test.js` | Permisos de administración, validación de psicólogos, catálogos y estadísticas |
| `salud.test.js` | Ruta de salud y manejo de errores |

### Prueba exhaustiva del algoritmo

La implementación de referencia ([tests/referencia.js](../tests/referencia.js)) está escrita **de otra forma**: trata las 20 respuestas como bits de un número y calcula el puntaje con XOR y conteo de bits, sin reutilizar nada del servicio.

| Métrica | Valor |
|---|---|
| Combinaciones evaluadas | 1,048,576 |
| Coincidencias con la referencia | 1,048,576 |
| Discrepancias | 0 |
| Porcentaje de aciertos | 100.00 % |

| Nivel | Puntaje | Combinaciones | % del total | Esperado por combinatoria |
|---|---|---|---|---|
| bajo | 0–2 | 211 | 0.02 % | 211 |
| medio | 3–7 | 137,769 | 13.14 % | 137,769 |
| alto | 8–20 | 910,596 | 86.84 % | 910,596 |

(La distribución se verifica además con coeficientes binomiales: por ejemplo, bajo = C(20,0) + C(20,1) + C(20,2) = 1 + 20 + 190 = 211.)

### Tiempos de respuesta (ms)

| Operación | N | Promedio | Mediana | p95 | Mín | Máx |
|---|---|---|---|---|---|---|
| Cálculo del resultado (función pura) | 10,000 | 0.002 | 0.002 | 0.003 | 0.001 | 0.641 |
| Cálculo del resultado (POST /finalizar) | 100 | 3.403 | 3.348 | 4.344 | 2.491 | 4.607 |
| Consulta de disponibilidad (GET) | 100 | 2.497 | 2.419 | 3.190 | 1.640 | 5.005 |

Medido el 19/11/2026 · Node v24.16.0 · Intel Core 5 210H · 15.6 GB de RAM · servidor y PostgreSQL en el mismo equipo. Vuelve a correr `npm run tiempos` antes de entregar el artículo para tener los números de tu versión final.

---

## 11. Guion de demostración (unos 7 minutos)

1. **Cuestionario anónimo**: abre `http://localhost:3000`, escribe una fecha de nacimiento (se ve la edad calculada), contesta las 20 preguntas. Muestra la barra de progreso y el botón "Anterior".
2. **Resultado**: nivel con ícono + texto, recomendación, lista de respuestas con las señales de alerta marcadas. Pulsa "Imprimir o guardar como PDF".
3. **Registro**: "Quiero una entrevista de seguimiento" → intenta registrarte **sin** marcar el consentimiento (no deja) → regístrate.
4. **Vinculación**: en el panel, registra al hijo y guarda el cuestionario en su perfil. Prueba con una fecha que no coincida para mostrar la validación.
5. **Psicólogo** (en otra ventana privada): regístrate como psicólogo → aparece el aviso "aún no validado" → configura un horario.
6. **Administrador**: entra como admin → valida al psicólogo → muestra las estadísticas anónimas.
7. **Cita**: vuelve al padre → "Pedir cita" → elige psicólogo, fecha y espacio libre → solicita. En la ventana del psicólogo: confirma, abre el resultado del niño y registra el seguimiento.
8. **Cierre**: corre `npm run test:exhaustivo` en la terminal y muestra el 100 %.

Consejo: prepara las cuentas (admin, un psicólogo ya validado con horario) antes de la presentación, por si falla algo en vivo.

---

## 12. Preguntas probables en el congreso

- **¿Por qué no diagnostica?** Porque el M-CHAT-R es un cribado de alta sensibilidad: hay falsos positivos por diseño. Su función es decidir quién necesita una evaluación profesional.
- **¿Cómo sabes que el algoritmo es correcto?** Lo comparamos contra una implementación independiente en las 1,048,576 combinaciones posibles: 0 discrepancias.
- **¿Qué pasa si dos padres reservan el mismo horario?** La base de datos lo impide con un índice único; el segundo recibe un mensaje claro. Está probado con peticiones simultáneas.
- **¿Cómo proteges los datos de los niños?** Cada consulta filtra por el usuario de la sesión, los admins solo ven totales, el cuestionario anónimo no guarda la fecha de nacimiento y las contraseñas van cifradas con bcrypt.
- **¿Por qué sin frameworks en el frontend?** Para que el sistema sea ligero, funcione sin internet y sea fácil de auditar y explicar.
- **¿Por qué la entrevista de seguimiento no está en línea?** La aplica el psicólogo en persona siguiendo los diagramas del M-CHAT-R/F; la plataforma registra su puntaje (2 o más = positivo).

---

## 13. Sobre el instrumento M-CHAT-R

- Se usa la versión oficial en **español para el hemisferio occidental** (*Spanish – Western Hemisphere*, mchatscreen.com), la más cercana al español de México: no existe una versión específica para México.
- © 2009 Diana Robins, Deborah Fein y Marianne Barton. Las pautas exigen: mostrar el aviso de derechos de autor (aparece en el cuestionario, el resultado y la hoja impresa), no modificar ítems, instrucciones ni orden, y usar las 20 preguntas completas. Su uso electrónico requiere permiso de las autoras.
- El texto vive en `bd/preguntas.json`, que **no se sube a Git**. Para cambiarlo: edita ese archivo y corre `npm run cargar-preguntas` (y `-- --test`). El administrador principal también puede editar preguntas desde su panel.
- Menciona en tu artículo la autorización que recibiste y la versión usada.

---

## 14. Limitaciones conocidas (dilo antes de que te lo pregunten)

- Suspender a un psicólogo no cancela automáticamente sus citas pendientes.
- Que solo exista un administrador principal lo garantiza el script `crear-admin`, no la base de datos.
- No hay recuperación de contraseña ni correos (decisión: proyecto local).
- Las pantallas se revisaron con pruebas automáticas de la API y revisión de código; conviene recorrerlas a mano en el navegador antes de la presentación.
