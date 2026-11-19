// Pruebas unitarias del cálculo de edad en meses.
const { calcularEdadMeses, edadCoincide } = require('../src/services/edad.service');

describe('calcularEdadMeses', () => {
  test.each([
    ['2024-03-15', '2025-11-15', 20], // mismo día: mes cumplido
    ['2024-03-15', '2025-11-14', 19], // un día antes: aún no cumple
    ['2024-03-15', '2025-11-30', 20],
    ['2024-01-31', '2024-02-29', 0], // febrero no tiene 31: aún no cumple el mes
    ['2024-01-31', '2024-03-31', 2],
    ['2023-12-01', '2024-01-01', 1], // cambio de año
    ['2024-06-10', '2024-06-10', 0],
  ])('de %s a %s -> %i meses', (nacimiento, referencia, esperado) => {
    expect(calcularEdadMeses(nacimiento, referencia)).toBe(esperado);
  });
});

describe('edadCoincide (tolerancia ±1 mes)', () => {
  test.each([
    [20, 20, true],
    [19, 20, true],
    [21, 20, true],
    [18, 20, false],
    [22, 20, false],
  ])('calculada %i vs declarada %i -> %s', (calculada, declarada, esperado) => {
    expect(edadCoincide(calculada, declarada)).toBe(esperado);
  });
});
