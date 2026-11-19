// Prueba de la ruta /api/salud.
// Se simula (mock) el módulo de base de datos para que la prueba no dependa de PostgreSQL.

// Variables mínimas para que config/env.js no falle durante la prueba
process.env.NODE_ENV = 'test';
process.env.PGHOST = process.env.PGHOST || 'localhost';
process.env.PGUSER = process.env.PGUSER || 'prueba';
process.env.PGPASSWORD = process.env.PGPASSWORD || 'prueba';
process.env.PGDATABASE_TEST = process.env.PGDATABASE_TEST || 'mchat_test';
process.env.JWT_SECRETO = process.env.JWT_SECRETO || 'secreto_de_prueba';

jest.mock('../src/config/db', () => ({
  consulta: jest.fn(),
  transaccion: jest.fn(),
  pool: { end: jest.fn() },
}));

const request = require('supertest');
const app = require('../src/app');
const { consulta } = require('../src/config/db');

describe('GET /api/salud', () => {
  test('responde 200 cuando la base de datos contesta', async () => {
    consulta.mockResolvedValueOnce({ rows: [{ hora_servidor_bd: '2026-11-05T10:00:00' }] });

    const res = await request(app).get('/api/salud');

    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('ok');
    expect(res.body.baseDatos).toBe('conectada');
  });

  test('responde 503 sin revelar detalles cuando la base de datos falla', async () => {
    consulta.mockRejectedValueOnce(new Error('password authentication failed'));

    const res = await request(app).get('/api/salud');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ estado: 'error', baseDatos: 'sin conexión' });
  });
});

describe('Rutas inexistentes y errores', () => {
  test('una ruta /api inexistente responde 404', async () => {
    const res = await request(app).get('/api/no-existe');
    expect(res.status).toBe(404);
  });

  test('un JSON mal formado responde 400', async () => {
    const res = await request(app)
      .post('/api/salud')
      .set('Content-Type', 'application/json')
      .send('{malformado');
    expect(res.status).toBe(400);
  });
});
