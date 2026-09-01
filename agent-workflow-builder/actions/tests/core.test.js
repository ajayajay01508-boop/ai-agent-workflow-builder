const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

process.env.ACTIONS_WEBHOOK_SECRET = 'test-webhook-secret';
const { app, timingSafeEqual } = require('../server');
const { interpolate, getPath, compare } = require('../lib/engine');
const { callHttp } = require('../lib/http');

async function withServer(handler, fn) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('health endpoint returns a request correlation id', async () => {
  await withServer(app, async (base) => {
    const response = await fetch(`${base}/health`, { headers: { 'x-request-id': 'test-123' } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-request-id'), 'test-123');
    assert.deepEqual(await response.json(), { status: 'ok' });
  });
});

test('action endpoints reject an invalid shared secret', async () => {
  await withServer(app, async (base) => {
    const response = await fetch(`${base}/actions/triggerWorkflowRun`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-webhook-secret': 'wrong' }, body: '{}',
    });
    assert.equal(response.status, 401);
  });
});

test('action endpoint validates workflow id before execution', async () => {
  await withServer(app, async (base) => {
    const response = await fetch(`${base}/actions/triggerWorkflowRun`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-webhook-secret': 'test-webhook-secret' },
      body: JSON.stringify({ input: {}, session_variables: { 'x-hasura-user-id': 'user-1' } }),
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).message, /workflow_id/);
  });
});

test('database event validates the event envelope', async () => {
  await withServer(app, async (base) => {
    const response = await fetch(`${base}/events/database-event`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-webhook-secret': 'test-webhook-secret' },
      body: JSON.stringify({ event: {}, table: {} }),
    });
    assert.equal(response.status, 400);
  });
});

test('constant-time secret comparison handles equal and unequal input', () => {
  assert.equal(timingSafeEqual('abc', 'abc'), true);
  assert.equal(timingSafeEqual('abc', 'abd'), false);
  assert.equal(timingSafeEqual('short', 'longer'), false);
});

test('workflow expression helpers resolve and compare values', () => {
  const context = { trigger: { customer: { score: 91 } }, previousOutput: { text: 'urgent review' } };
  assert.equal(getPath(context, 'trigger.customer.score'), 91);
  assert.equal(interpolate('score={{trigger.customer.score}}', context), 'score=91');
  assert.equal(compare('urgent review', 'contains', 'urgent'), true);
  assert.equal(compare(91, 'gt', 80), true);
  assert.equal(compare(4, 'lt', 2), false);
});

test('HTTP executor returns JSON and rejects unsafe protocols', async () => {
  await withServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  }, async (base) => {
    const result = await callHttp({ url: base });
    assert.equal(result.status, 200);
    assert.deepEqual(result.data, { ok: true });
  });
  await assert.rejects(() => callHttp({ url: 'file:///etc/passwd' }), /only supports/);
});
