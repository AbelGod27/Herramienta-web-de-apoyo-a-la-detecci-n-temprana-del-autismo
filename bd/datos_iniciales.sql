-- =====================================================================
-- Datos iniciales de los catálogos.
-- Se puede ejecutar varias veces: ON CONFLICT DO NOTHING evita duplicados.
-- =====================================================================
-- Roles (el código siempre los busca por nombre, no por id)
INSERT INTO rol (nombre)
VALUES ('admin_principal'),
  ('admin_secundario'),
  ('psicologo'),
  ('padre') ON CONFLICT (nombre) DO NOTHING;
-- Niveles de riesgo. Los textos NO diagnostican: solo recomiendan.
INSERT INTO nivel_riesgo (nombre, puntaje_min, puntaje_max, recomendacion)
VALUES (
    'bajo',
    0,
    2,
    'El resultado indica un riesgo bajo. Continúa con las revisiones habituales de desarrollo con su pediatra. ' || 'Si el niño o la niña tiene menos de 24 meses, se sugiere volver a contestar el cuestionario al cumplir 24 meses. ' || 'Si en algún momento te preocupa su desarrollo, consulta a un profesional de la salud. Este resultado no es un diagnóstico.'
  ),
  (
    'medio',
    3,
    7,
    'El resultado indica un riesgo medio. Se recomienda solicitar una entrevista de seguimiento con un psicólogo ' || 'para revisar con más detalle las respuestas. Este resultado no es un diagnóstico.'
  ),
  (
    'alto',
    8,
    20,
    'El resultado indica un riesgo alto. Se recomienda acudir pronto con un profesional de la salud para una evaluación ' || 'del desarrollo y solicitar una entrevista de seguimiento. Este resultado no es un diagnóstico.'
  ) ON CONFLICT (nombre) DO NOTHING;
-- Preguntas de PRUEBA. El texto real del M-CHAT-R tiene derechos de autor:
-- el administrador principal debe reemplazarlo con su autorización.
-- riesgo_si_responde: TRUE en las preguntas 2, 5 y 12 ("sí" indica riesgo); FALSE en las demás.
INSERT INTO pregunta (numero, texto, ejemplo, riesgo_si_responde)
SELECT n,
  'Pregunta de prueba ' || n,
  'Ejemplo de prueba ' || n,
  n IN (2, 5, 12)
FROM generate_series(1, 20) AS n ON CONFLICT (numero) DO NOTHING;
