const request = require('supertest');

// Use an in-memory SQLite database for tests
process.env.DB_FILE = ':memory:';

const { app } = require('./index');

describe('Survey backend', () => {
  test('GET /api/health returns ok', async () => {
    const response = await request(app).get('/api/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  test('GET /login returns the admin login page', async () => {
    const response = await request(app).get('/login');
    expect(response.status).toBe(200);
    expect(response.text).toContain('Admin Login');
  });

  test('POST /api/survey stores survey answers successfully', async () => {
    const response = await request(app)
      .post('/api/survey')
      .send({ answers: { name: 'Jane Doe', email: 'jane@example.com', favorite: 'impact' } })
      .set('Accept', 'application/json');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('success', true);
    expect(response.body).toHaveProperty('sqliteId');
    expect(typeof response.body.sqliteId).toBe('number');
  });
});
