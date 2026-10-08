// Regression coverage for removing membership-tier pricing (see
// docs/DATA-MODEL.md / the become-a-member.html pricing removal): a `tier`
// in the request body must be ignored, not merely unused by the front-end
// — the saved subscriber record should never carry one.
process.env.DB_FILE = ':memory:';

const request = require('supertest');
const { store } = require('../db/store.js');
const { app } = require('../index');

describe('POST /api/subscribe', () => {
  test('a tier in the request body is ignored — the saved record has no tier field', async () => {
    const res = await request(app)
      .post('/api/subscribe')
      .send({
        email: 'waitlist@example.com',
        name: 'Jane Doe',
        phone: '555-0100',
        address: '123 Main St, Springfield, IL 00000',
        tier: 'Vetted Investor',
        source: 'membership-waitlist',
      });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true });

    const saved = store.subscribers.find((s) => s.email === 'waitlist@example.com');
    expect(saved).toEqual({
      id: expect.any(Number),
      created_at: expect.any(String),
      email: 'waitlist@example.com',
      source: 'membership-waitlist',
      name: 'Jane Doe',
      phone: '555-0100',
      address: '123 Main St, Springfield, IL 00000',
      surveyResponseId: null,
      freeMonthEarned: false,
    });
  });
});
