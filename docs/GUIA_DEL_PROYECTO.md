# Guía del proyecto

Herramienta web de apoyo a la detección temprana del autismo (M-CHAT-R, 16 a 30 meses).

Esta guía explica **qué hace cada parte del sistema, por qué está hecha así y cómo se usa**. Está ordenada de lo general a lo particular.

---

## 1. Qué es (y qué no es)

Es una plataforma donde los padres de niños de 16 a 30 meses contestan el cuestionario **M-CHAT-R** (20 preguntas de sí/no) y obtienen un **nivel de riesgo** (bajo, medio o alto) con una recomendación. Si lo desean, crean una cuenta, guardan el resultado en el perfil de su hijo y piden una cita con un psicólogo validado, quien aplica la entrevista de seguimiento y registra el resultado.

**No diagnostica.** Ningún texto dice que el niño "tiene" o "no tiene" autismo. El M-CHAT-R es un instrumento de **cribado**: su objetivo es detectar a la mayor cantidad posible de niños en riesgo (alta sensibilidad), aceptando falsos positivos. Por eso el resultado siempre lleva a un profesional, nunca a una conclusión.

---

## 2. Instalación

Requisitos: Node.js 18 o superior y PostgreSQL.

```bash
npm install                    # 1. instala las dependencias
cp .env.example .env           # 2. crea el archivo de configuración (se llena con los datos de PostgreSQL)
npm run bd:crear               # 3. crea la base mchat con sus tablas, catálogos y las 20 preguntas
npm run crear-admin            # 4. crea el administrador principal (datos ADMIN_* del .env)
npm run dev                    # 5. inicia el sistema en http://localhost:3000
```

El paso 3 carga el texto oficial de las preguntas desde `bd/preguntas.json`. Si ese archivo no existe, el cuestionario muestra preguntas de relleno hasta que se agregue y se ejecute `npm run cargar-preguntas`.

Todo funciona en un solo equipo (localhost): no hay servicios externos, CDNs, correos ni HTTPS. La opción `secure` de la cookie de sesión se controla con `COOKIE_SECURE` en `.env`, para poder activarla si en el futuro se usa HTTPS.

---

## 3. Arquitectura

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

Cada capa tiene una sola responsabilidad. Las rutas no calculan nada, los controladores no validan formatos y los **servicios son funciones puras** (no tocan la base de datos), por eso son fáciles de leer y de reutilizar.

### Recorrido de una petición: "ver el resultado"

Cuando el padre contesta la última pregunta, el navegador envía `POST /api/aplicaciones/:id/finalizar`:

1. **Ruta** ([cuestionario.routes.js](../src/routes/cuestionario.routes.js)): reconoce la URL y encadena validador → controlador.
2. **Validador** ([cuestionario.validator.js](../src/validators/cuestionario.validator.js)): revisa que `:id` sea un UUID. Si no lo es, responde 400 y no continúa.
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
| `src/routes/` | Un archivo por módulo: auth, ninos, cuestionario, psicologos, citas, admin |
| `src/middlewares/` | Sesión y roles (`autenticacion.js`), límite de intentos (`limitador.js`), validación (`validar.js`), errores |
| `src/validators/` | Reglas de `express-validator` de cada módulo |
| `src/controllers/` | La lógica de cada ruta (consultas SQL parametrizadas) |
| `src/services/` | Funciones puras: `puntaje`, `edad`, `disponibilidad`, `niveles`, `estadisticas` |
| `public/` | Páginas: inicio, cuestionario, resultado, registro, inicio de sesión, panel del padre, del psicólogo y del administrador |
| `bd/` | `esquema.sql` (tablas), `datos_iniciales.sql` (roles, niveles), `preguntas.json` (texto oficial, **no se sube a Git**) |
| `scripts/` | `crearBd`, `crearAdmin`, `cargarPreguntas` |

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

Decisiones de diseño:

- **La aplicación nace anónima** (`id_nino = NULL`). Solo se llena `id_nino` cuando el padre la vincula a su hijo, sin perder las respuestas.
- **La fecha de nacimiento del cuestionario anónimo no se guarda**: el servidor calcula la edad en meses y guarda solo ese dato (privacidad).
- **Reglas en la propia base de datos**, no solo en el código: edad entre 16 y 30, puntaje entre 0 y 20, un tutor no existe sin `acepto_aviso = TRUE`, los rangos de niveles no pueden traslaparse (`EXCLUDE`), una aplicación completada siempre tiene puntaje y nivel.
- **Índice único parcial en `cita`**: un psicólogo no puede tener dos citas *no canceladas* en la misma fecha y hora. Equivale a `UNIQUE (id_psicologo, fecha, hora_inicio)`, pero ignora las canceladas para que un espacio cancelado se pueda volver a reservar.
- **Otro índice parcial**: cada aplicación puede tener como máximo una cita activa.
- **Borrado solo lógico**: suspender una cuenta es `activo = false`; nunca se borran usuarios.

---

## 6. Roles y qué puede hacer cada uno

| Rol | Puede |
|---|---|
| **Padre o tutor** | Contestar sin cuenta; registrarse (con consentimiento expreso); registrar hijos; ver el historial; vincular el cuestionario anónimo; pedir, ver y cancelar citas |
| **Psicólogo** | Registrarse (queda `validado = false`); configurar horario semanal y bloqueos; ver **solo sus** citas; confirmar, cancelar y registrar el seguimiento; ver el resultado y las respuestas **solo** de niños con cita con él |
| **Administrador** (principal o secundario) | Mismo panel y mismos permisos: validar la cédula de psicólogos; suspender o reactivar cuentas; crear administradores secundarios; editar preguntas y niveles de riesgo; ver estadísticas anónimas. La única diferencia: el principal (uno, creado con `crear-admin`) no puede ser suspendido |

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

## 7. Los algoritmos

### 7.1 Puntaje del M-CHAT-R ([puntaje.service.js](../src/services/puntaje.service.js))

```
para cada pregunta:
    si respuesta == pregunta.riesgo_si_responde  → suma 1 punto
puntaje (0–20) → se busca el nivel cuyo rango lo contiene: 0–2 bajo, 3–7 medio, 8–20 alto
```

En las preguntas 2, 5 y 12 "sí" indica riesgo; en las demás, "no". **Ese dato se lee de la base de datos** (`riesgo_si_responde`), no está escrito en el código: si el catálogo cambia, el algoritmo no se modifica.

### 7.2 Edad en meses ([edad.service.js](../src/services/edad.service.js))

Meses cumplidos = diferencia de años × 12 + diferencia de meses, y se resta 1 si todavía no llega el día del mes. Ejemplo: del 15/03/2024 al 14/11/2025 son 19 meses (el día 15 cumple 20). Se usa para validar el rango 16–30 y para la **vinculación**: la edad calculada con la fecha de nacimiento del hijo debe coincidir ±1 mes con la del cuestionario.

### 7.3 Disponibilidad de citas ([disponibilidad.service.js](../src/services/disponibilidad.service.js))

```
espacios libres = bloques del horario activos ese día, partidos según la duración de la cita
                − los que se cruzan con un bloqueo de esa fecha
                − los que se cruzan con citas no canceladas
                − los que ya pasaron (si es hoy)
```

Las horas se convierten a **minutos desde la medianoche** para compararlas fácilmente (09:30 → 570). Dos intervalos se cruzan si `inicio1 < fin2 y inicio2 < fin1`.

Ejemplo: horario del lunes 09:00–12:00, citas de 60 min → 09:00, 10:00, 11:00. Si hay una cita a las 10:00 y un bloqueo de 11:30 a 12:00, solo queda libre el espacio de las **09:00**.

### 7.4 Doble reserva

Si dos padres piden el mismo espacio al mismo tiempo, los dos podrían verlo libre. Para que solo uno lo obtenga:

1. Al reservar, el servidor **vuelve a calcular** la disponibilidad dentro de una transacción.
2. Si aun así las dos peticiones llegan en el mismo instante, el **índice único** de la base de datos rechaza el segundo `INSERT` (error `23505`) y el servidor responde: *"Ese horario acaba de ser reservado por otra persona. Elige otro."*

---

## 8. Seguridad y privacidad

| Medida | Dónde |
|---|---|
| Contraseñas con bcrypt (12 rondas; mínimo 10) y nunca devueltas por la API | `auth.controller.js`, `env.js` |
| Sesión en JWT dentro de cookie `httpOnly` + `SameSite=Strict` (protege de robo por XSS y de CSRF) | `autenticacion.js` |
| Se consulta la BD en cada petición: una cuenta suspendida pierde la sesión al instante | `autenticacion.js` |
| Mensaje genérico al iniciar sesión ("Correo o contraseña incorrectos"), con el mismo tiempo de respuesta exista o no el correo | `auth.controller.js` |
| Límite de intentos: 10 inicios de sesión / 15 min y 5 registros / hora por IP | `limitador.js` |
| Consultas SQL siempre parametrizadas (`$1, $2`): sin inyección SQL | todos los controladores |
| Validación de todas las entradas con `express-validator` | `src/validators/` |
| Encabezados de seguridad con `helmet` (solo recursos del propio servidor) | `app.js` |
| En el navegador, los datos del servidor se muestran con `textContent`, nunca con `innerHTML` | `public/js/` |
| Consentimiento expreso obligatorio (`acepto_aviso`, `version_aviso`, `fecha_aceptacion`) | registro de padre |
| Estadísticas solo con totales: los administradores no ven niños ni respuestas | `estadisticas.service.js` |
| Credenciales solo en `.env` (está en `.gitignore`) | raíz |

---

## 9. Diseño de la interfaz

- Pensada primero para celular, con una paleta tranquila (azul petróleo, verde salvia, durazno, crema), sin rompecabezas ni colores neón.
- **El nivel de riesgo siempre se muestra con ícono + texto**: círculo con palomita (bajo), triángulo (medio), octágono (alto). Cada forma es distinta para que se distingan aunque no se perciba el color.
- Contraste verificado (WCAG 2.1 AA): todos los pares de colores usados superan 4.5:1.
- Botones grandes (mínimo 44–52 px de alto), etiquetas en todos los campos y mensajes de error con `role="alert"`.
- El resultado se imprime o se guarda como PDF con el propio navegador (`@media print`), sin librerías.

---

## 10. Recorrido de uso

1. **Cuestionario anónimo**: en `http://localhost:3000` se escribe la fecha de nacimiento (el sistema muestra la edad calculada) y se contestan las 20 preguntas, con barra de progreso y botón "Anterior".
2. **Resultado**: nivel con ícono y texto, recomendación y lista de respuestas con las posibles señales de alerta marcadas. Se puede imprimir o guardar como PDF.
3. **Registro**: desde "Quiero una entrevista de seguimiento" el padre crea su cuenta; el registro no avanza sin aceptar el aviso de privacidad.
4. **Vinculación**: en su panel, el padre registra a su hijo y guarda el cuestionario en su perfil. Si la edad no coincide con la del cuestionario, el sistema lo rechaza.
5. **Psicólogo**: se registra y ve el aviso "aún no validado" hasta que un administrador revisa su cédula; mientras tanto puede configurar su horario.
6. **Administrador**: valida al psicólogo y consulta las estadísticas anónimas.
7. **Cita**: el padre elige psicólogo, fecha y un espacio libre y solicita la cita. El psicólogo la confirma, consulta el resultado del niño y registra el seguimiento.

---

## 11. Preguntas frecuentes

- **¿Por qué no diagnostica?** Porque el M-CHAT-R es un cribado de alta sensibilidad: hay falsos positivos por diseño. Su función es identificar quién necesita una evaluación profesional.
- **¿Qué pasa si dos padres reservan el mismo horario?** La base de datos lo impide con un índice único; el segundo recibe un mensaje claro.
- **¿Cómo se protegen los datos de los niños?** Cada consulta filtra por el usuario de la sesión, los administradores solo ven totales, el cuestionario anónimo no guarda la fecha de nacimiento y las contraseñas se guardan cifradas con bcrypt.
- **¿Por qué no se usan frameworks en el frontend?** Para que el sistema sea ligero, funcione sin internet y sea fácil de auditar.
- **¿Por qué la entrevista de seguimiento no está en línea?** La aplica el psicólogo en persona siguiendo los diagramas del M-CHAT-R/F; la plataforma registra su puntaje (2 o más = positivo).

---

## 12. Sobre el instrumento M-CHAT-R

- Se usa la versión oficial en **español para el hemisferio occidental** (*Spanish – Western Hemisphere*, mchatscreen.com), la más cercana al español de México: no existe una versión específica para México.
- © 2009 Diana Robins, Deborah Fein y Marianne Barton. Las pautas exigen mostrar el aviso de derechos de autor (aparece en el cuestionario, el resultado y la hoja impresa), no modificar ítems, instrucciones ni orden, y usar las 20 preguntas completas. Su uso electrónico requiere permiso de las autoras, con el que cuenta este proyecto.
- El texto está en `bd/preguntas.json`, que **no se sube a Git**. Para cambiarlo se edita ese archivo y se ejecuta `npm run cargar-preguntas`. Los administradores también pueden editar preguntas desde su panel.

---

## 13. Limitaciones conocidas

- Suspender a un psicólogo no cancela automáticamente sus citas pendientes.
- Que solo exista un administrador principal lo garantiza el script `crear-admin`, no la base de datos.
- No hay recuperación de contraseña ni envío de correos, porque el sistema funciona solo en local.
- No hay pruebas automáticas.
