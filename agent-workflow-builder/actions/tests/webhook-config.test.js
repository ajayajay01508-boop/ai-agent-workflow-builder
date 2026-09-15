const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { app } = require('../server');

test('protected routes reject missing and empty configured secrets', async () => {
  const original = process.env.ACTIONS_WEBHOOK_SECRET;
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    for (const configured of [undefined, '']) {
      if (configured === undefined) delete process.env.ACTIONS_WEBHOOK_SECRET;
      else process.env.ACTIONS_WEBHOOK_SECRET = configured;
      for (const route of ['/actions/triggerWorkflowRun', '/actions/approveStep', '/scheduled/run-due', '/events/database-event']) {
        const response = await fetch('http://127.0.0.1:' + server.address().port + route, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
        });
        assert.equal(response.status, 401, route);
        assert.deepEqual(await response.json(), { message: 'unauthorized' });
      }
    }
  } finally {
    if (original === undefined) delete process.env.ACTIONS_WEBHOOK_SECRET;
    else process.env.ACTIONS_WEBHOOK_SECRET = original;
    await new Promise(resolve => server.close(resolve));
  }
});
