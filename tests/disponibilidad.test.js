// Pruebas unitarias del cálculo de disponibilidad (función pura, sin base de datos).
const {
  aMinutos,
  aHora,
  diaSemanaDeFecha,
  diasEntre,
  calcularEspacios,
} = require('../src/services/disponibilidad.service');

const FECHA = '2026-12-07'; // lunes
const LUNES = 1;

/** Datos base: lunes de 09:00 a 12:00, citas de 60 minutos, consultado un día antes. */
function datos(cambios = {}) {
  return {
    fecha: FECHA,
    diaSemana: LUNES,
    horarios: [{ dia_semana: LUNES, hora_inicio: '09:00', hora_fin: '12:00', activo: true }],
    bloqueos: [],
    citas: [],
    duracionMin: 60,
    ahora: { fecha: '2026-12-06', minutos: 0 },
    ...cambios,
  };
}

/** Solo las horas de inicio, para comparar fácilmente. */
const inicios = (espacios) => espacios.map((e) => e.hora_inicio);

describe('Funciones auxiliares', () => {
  test('convierten entre horas y minutos', () => {
    expect(aMinutos('09:30')).toBe(570);
    expect(aMinutos('09:30:00')).toBe(570); // PostgreSQL puede devolver segundos
    expect(aHora(570)).toBe('09:30');
    expect(aHora(0)).toBe('00:00');
  });

  test.each([
    ['2026-12-07', 1], // lunes
    ['2026-12-12', 6], // sábado
    ['2026-12-13', 7], // domingo
  ])('%s es el día %i de la semana', (fecha, dia) => {
    expect(diaSemanaDeFecha(fecha)).toBe(dia);
  });

  test('cuenta los días entre dos fechas', () => {
    expect(diasEntre('2026-12-01', '2026-12-31')).toBe(30);
    expect(diasEntre('2026-12-31', '2026-12-01')).toBe(-30);
    expect(diasEntre('2026-02-28', '2026-03-01')).toBe(1);
  });
});

describe('calcularEspacios', () => {
  test('sin horario ese día no hay espacios', () => {
    expect(calcularEspacios(datos({ horarios: [] }))).toEqual([]);
  });

  test('un horario de otro día no cuenta', () => {
    const horarios = [{ dia_semana: 2, hora_inicio: '09:00', hora_fin: '12:00', activo: true }];
    expect(calcularEspacios(datos({ horarios }))).toEqual([]);
  });

  test('un bloque desactivado no cuenta', () => {
    const horarios = [{ dia_semana: LUNES, hora_inicio: '09:00', hora_fin: '12:00', activo: false }];
    expect(calcularEspacios(datos({ horarios }))).toEqual([]);
  });

  test('divide el bloque exactamente según la duración', () => {
    expect(calcularEspacios(datos())).toEqual([
      { hora_inicio: '09:00', hora_fin: '10:00' },
      { hora_inicio: '10:00', hora_fin: '11:00' },
      { hora_inicio: '11:00', hora_fin: '12:00' },
    ]);
  });

  test('con citas de 45 minutos solo caben espacios completos', () => {
    // 09:00–12:00 son 180 min = 4 espacios de 45 min
    expect(inicios(calcularEspacios(datos({ duracionMin: 45 })))).toEqual(['09:00', '09:45', '10:30', '11:15']);
  });

  test('los minutos que no alcanzan un espacio completo se descartan', () => {
    const horarios = [{ dia_semana: LUNES, hora_inicio: '09:00', hora_fin: '10:30', activo: true }];
    expect(inicios(calcularEspacios(datos({ horarios })))).toEqual(['09:00']);
  });

  test('un bloqueo de día completo elimina todos los espacios', () => {
    const bloqueos = [{ fecha: FECHA, hora_inicio: null, hora_fin: null }];
    expect(calcularEspacios(datos({ bloqueos }))).toEqual([]);
  });

  test('un bloqueo parcial elimina solo los espacios que se cruzan con él', () => {
    // 10:30–11:00 se cruza con el espacio 10:00–11:00
    const bloqueos = [{ fecha: FECHA, hora_inicio: '10:30', hora_fin: '11:00' }];
    expect(inicios(calcularEspacios(datos({ bloqueos })))).toEqual(['09:00', '11:00']);
  });

  test('un bloqueo de otra fecha no afecta', () => {
    const bloqueos = [{ fecha: '2026-12-08', hora_inicio: null, hora_fin: null }];
    expect(calcularEspacios(datos({ bloqueos }))).toHaveLength(3);
  });

  test('las citas activas ocupan su espacio', () => {
    const citas = [
      { fecha: FECHA, hora_inicio: '10:00', hora_fin: '11:00', estado: 'solicitada' },
      { fecha: FECHA, hora_inicio: '11:00', hora_fin: '12:00', estado: 'confirmada' },
    ];
    expect(inicios(calcularEspacios(datos({ citas })))).toEqual(['09:00']);
  });

  test('las citas canceladas no ocupan el espacio', () => {
    const citas = [{ fecha: FECHA, hora_inicio: '10:00', hora_fin: '11:00', estado: 'cancelada' }];
    expect(calcularEspacios(datos({ citas }))).toHaveLength(3);
  });

  test('una cita con otra duración bloquea todos los espacios que toca', () => {
    // Una cita antigua de 09:30 a 10:30 se cruza con 09:00–10:00 y con 10:00–11:00
    const citas = [{ fecha: FECHA, hora_inicio: '09:30', hora_fin: '10:30', estado: 'completada' }];
    expect(inicios(calcularEspacios(datos({ citas })))).toEqual(['11:00']);
  });

  test('si la fecha es hoy, se quitan los espacios que ya empezaron', () => {
    const ahora = { fecha: FECHA, minutos: aMinutos('10:15') };
    expect(inicios(calcularEspacios(datos({ ahora })))).toEqual(['11:00']);
  });

  test('varios bloques en el mismo día se ordenan por hora', () => {
    const horarios = [
      { dia_semana: LUNES, hora_inicio: '16:00', hora_fin: '18:00', activo: true },
      { dia_semana: LUNES, hora_inicio: '09:00', hora_fin: '10:00', activo: true },
    ];
    expect(inicios(calcularEspacios(datos({ horarios })))).toEqual(['09:00', '16:00', '17:00']);
  });
});
