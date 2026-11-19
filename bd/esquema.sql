-- =====================================================================
-- Esquema de la base de datos: plataforma de apoyo al cribado M-CHAT-R
-- PostgreSQL 13 o superior (usa gen_random_uuid() integrado).
-- Es idempotente: se puede ejecutar varias veces sin error.
-- =====================================================================
-- ---------------------------------------------------------------------
-- Roles del sistema
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rol (
  id_rol SERIAL PRIMARY KEY,
  nombre VARCHAR(30) NOT NULL UNIQUE CHECK (
    nombre IN (
      'admin_principal',
      'admin_secundario',
      'psicologo',
      'padre'
    )
  )
);
-- ---------------------------------------------------------------------
-- Usuarios (datos comunes a todos los roles)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuario (
  id_usuario SERIAL PRIMARY KEY,
  id_rol INT NOT NULL REFERENCES rol (id_rol),
  correo VARCHAR(120) NOT NULL UNIQUE,
  contrasena_hash VARCHAR(100) NOT NULL,
  nombre VARCHAR(80) NOT NULL,
  apellidos VARCHAR(120) NOT NULL,
  telefono VARCHAR(20),
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  -- borrado lógico / suspensión
  fecha_registro TIMESTAMP NOT NULL DEFAULT NOW()
);
-- ---------------------------------------------------------------------
-- Psicólogos (extiende a usuario)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS psicologo (
  id_usuario INT PRIMARY KEY REFERENCES usuario (id_usuario),
  cedula_profesional VARCHAR(20) NOT NULL UNIQUE,
  especialidad VARCHAR(100),
  descripcion TEXT,
  duracion_cita_min SMALLINT NOT NULL DEFAULT 60 CHECK (
    duracion_cita_min BETWEEN 15 AND 180
  ),
  validado BOOLEAN NOT NULL DEFAULT FALSE,
  -- solo visible para padres si es TRUE
  id_admin_valida INT REFERENCES usuario (id_usuario),
  fecha_validacion TIMESTAMP
);
-- ---------------------------------------------------------------------
-- Tutores / padres (extiende a usuario)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tutor (
  id_usuario INT PRIMARY KEY REFERENCES usuario (id_usuario),
  parentesco VARCHAR(30) NOT NULL,
  -- Sin consentimiento expreso no se puede registrar un tutor
  acepto_aviso BOOLEAN NOT NULL CHECK (acepto_aviso = TRUE),
  version_aviso VARCHAR(10) NOT NULL,
  fecha_aceptacion TIMESTAMP NOT NULL DEFAULT NOW()
);
-- ---------------------------------------------------------------------
-- Niños registrados por un tutor
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nino (
  id_nino SERIAL PRIMARY KEY,
  id_tutor INT NOT NULL REFERENCES tutor (id_usuario),
  nombre VARCHAR(80) NOT NULL,
  fecha_nacimiento DATE NOT NULL,
  semanas_gestacion SMALLINT CHECK (
    semanas_gestacion BETWEEN 22 AND 42
  ),
  -- solo si fue prematuro
  sexo CHAR(1) CHECK (sexo IN ('F', 'M')) -- opcional
);
-- ---------------------------------------------------------------------
-- Catálogo de preguntas del cuestionario (20 preguntas de sí/no)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pregunta (
  id_pregunta SERIAL PRIMARY KEY,
  numero SMALLINT NOT NULL UNIQUE CHECK (
    numero BETWEEN 1 AND 20
  ),
  texto TEXT NOT NULL,
  ejemplo TEXT,
  -- Respuesta que indica riesgo: TRUE = "sí" indica riesgo; FALSE = "no" indica riesgo
  riesgo_si_responde BOOLEAN NOT NULL
);
-- ---------------------------------------------------------------------
-- Catálogo de niveles de riesgo (rangos de puntaje sin traslape)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nivel_riesgo (
  id_nivel SERIAL PRIMARY KEY,
  nombre VARCHAR(20) NOT NULL UNIQUE,
  puntaje_min SMALLINT NOT NULL,
  puntaje_max SMALLINT NOT NULL,
  recomendacion TEXT NOT NULL,
  CHECK (
    puntaje_min >= 0
    AND puntaje_max <= 20
    AND puntaje_min <= puntaje_max
  ),
  -- Impide que dos niveles tengan rangos que se crucen (por ejemplo 0–3 y 3–7)
  CONSTRAINT nivel_riesgo_sin_traslape EXCLUDE USING gist (
    int4range(puntaje_min, puntaje_max, '[]') WITH &&
  )
);
-- ---------------------------------------------------------------------
-- Aplicación del cuestionario (anónima hasta que se vincula a un niño)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS aplicacion (
  id_aplicacion UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_nino INT REFERENCES nino (id_nino),
  -- NULL mientras es anónima
  id_nivel INT REFERENCES nivel_riesgo (id_nivel),
  edad_meses SMALLINT NOT NULL CHECK (
    edad_meses BETWEEN 16 AND 30
  ),
  semanas_gestacion SMALLINT CHECK (
    semanas_gestacion BETWEEN 22 AND 42
  ),
  fecha_inicio TIMESTAMP NOT NULL DEFAULT NOW(),
  fecha_fin TIMESTAMP,
  puntaje_total SMALLINT CHECK (
    puntaje_total BETWEEN 0 AND 20
  ),
  estado VARCHAR(12) NOT NULL DEFAULT 'en_curso' CHECK (estado IN ('en_curso', 'completada')),
  -- Una aplicación completada siempre tiene puntaje, nivel y fecha de fin
  CHECK (
    estado = 'en_curso'
    OR (
      puntaje_total IS NOT NULL
      AND id_nivel IS NOT NULL
      AND fecha_fin IS NOT NULL
    )
  )
);
-- ---------------------------------------------------------------------
-- Respuestas de una aplicación (una por pregunta)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS respuesta (
  id_aplicacion UUID NOT NULL REFERENCES aplicacion (id_aplicacion) ON DELETE CASCADE,
  id_pregunta INT NOT NULL REFERENCES pregunta (id_pregunta),
  valor BOOLEAN NOT NULL,
  -- TRUE = sí, FALSE = no
  es_riesgo BOOLEAN,
  -- se llena al calcular el resultado
  PRIMARY KEY (id_aplicacion, id_pregunta)
);
-- ---------------------------------------------------------------------
-- Horario semanal de cada psicólogo
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS horario_psicologo (
  id_horario SERIAL PRIMARY KEY,
  id_psicologo INT NOT NULL REFERENCES psicologo (id_usuario),
  dia_semana SMALLINT NOT NULL CHECK (
    dia_semana BETWEEN 1 AND 7
  ),
  -- 1 = lunes … 7 = domingo
  hora_inicio TIME NOT NULL,
  hora_fin TIME NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  CHECK (hora_fin > hora_inicio)
);
-- ---------------------------------------------------------------------
-- Bloqueos de horario (vacaciones, días inhábiles, etc.)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bloqueo_horario (
  id_bloqueo SERIAL PRIMARY KEY,
  id_psicologo INT NOT NULL REFERENCES psicologo (id_usuario),
  fecha DATE NOT NULL,
  hora_inicio TIME,
  -- ambas NULL = día completo
  hora_fin TIME,
  motivo VARCHAR(200),
  CHECK (
    (
      hora_inicio IS NULL
      AND hora_fin IS NULL
    )
    OR (
      hora_inicio IS NOT NULL
      AND hora_fin IS NOT NULL
      AND hora_fin > hora_inicio
    )
  )
);
-- ---------------------------------------------------------------------
-- Citas
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cita (
  id_cita SERIAL PRIMARY KEY,
  id_aplicacion UUID NOT NULL REFERENCES aplicacion (id_aplicacion),
  id_psicologo INT NOT NULL REFERENCES psicologo (id_usuario),
  fecha DATE NOT NULL,
  hora_inicio TIME NOT NULL,
  hora_fin TIME NOT NULL,
  modalidad VARCHAR(10) NOT NULL CHECK (modalidad IN ('presencial', 'en_linea')),
  estado VARCHAR(12) NOT NULL DEFAULT 'solicitada' CHECK (
    estado IN (
      'solicitada',
      'confirmada',
      'cancelada',
      'completada'
    )
  ),
  motivo_padre TEXT,
  puntaje_seguimiento SMALLINT CHECK (
    puntaje_seguimiento BETWEEN 0 AND 20
  ),
  resultado_seguimiento TEXT,
  observaciones TEXT,
  fecha_solicitud TIMESTAMP NOT NULL DEFAULT NOW(),
  CHECK (hora_fin > hora_inicio)
);
-- Un psicólogo no puede tener dos citas vigentes en el mismo espacio.
-- Es UNIQUE (id_psicologo, fecha, hora_inicio) pero solo entre citas NO canceladas,
-- para que un espacio cancelado pueda volver a reservarse.
-- Si dos padres reservan a la vez, PostgreSQL rechaza la segunda con el código 23505.
CREATE UNIQUE INDEX IF NOT EXISTS cita_espacio_unico ON cita (id_psicologo, fecha, hora_inicio)
WHERE estado <> 'cancelada';
-- Cada aplicación puede tener como máximo una cita activa (solicitada o confirmada)
CREATE UNIQUE INDEX IF NOT EXISTS cita_una_activa_por_aplicacion ON cita (id_aplicacion)
WHERE estado IN ('solicitada', 'confirmada');
-- ---------------------------------------------------------------------
-- Índices para las consultas más frecuentes
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_usuario_rol ON usuario (id_rol);
CREATE INDEX IF NOT EXISTS idx_nino_tutor ON nino (id_tutor);
CREATE INDEX IF NOT EXISTS idx_aplicacion_nino ON aplicacion (id_nino);
CREATE INDEX IF NOT EXISTS idx_horario_psicologo ON horario_psicologo (id_psicologo, dia_semana);
CREATE INDEX IF NOT EXISTS idx_bloqueo_psicologo ON bloqueo_horario (id_psicologo, fecha);
CREATE INDEX IF NOT EXISTS idx_cita_psicologo ON cita (id_psicologo, fecha);