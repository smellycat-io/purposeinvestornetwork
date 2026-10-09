jest.mock('@sentry/aws-serverless', () => ({ captureException: jest.fn() }));

const { captureException } = require('@sentry/aws-serverless');
const { asyncRoute } = require('./asyncRoute.js');

function makeRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  return res;
}

beforeEach(() => {
  captureException.mockReset();
});

describe('asyncRoute', () => {
  test('lets a successful handler respond normally, untouched', async () => {
    const res = makeRes();
    const handler = asyncRoute(async (req, r) => {
      r.status(200).json({ ok: true });
    }, 'Unable to do the thing.');

    await handler({}, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(captureException).not.toHaveBeenCalled();
  });

  test('on a thrown error, reports to Sentry and returns the generic message with no detail by default', async () => {
    const res = makeRes();
    const thrown = new Error('ValidationException: index does not exist');
    const handler = asyncRoute(async () => {
      throw thrown;
    }, 'Unable to do the thing.');

    await handler({}, res);

    expect(captureException).toHaveBeenCalledWith(thrown);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Unable to do the thing.' });
  });

  test('verbose: true folds the raw error message into the response as detail', async () => {
    const res = makeRes();
    const thrown = new Error('ValidationException: index does not exist');
    const handler = asyncRoute(async () => {
      throw thrown;
    }, 'Unable to do the thing.', { verbose: true });

    await handler({}, res);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({
      error: 'Unable to do the thing.',
      detail: 'ValidationException: index does not exist',
    });
  });
});
