// actions/lib/hasura.js
// Thin GraphQL client that always uses the admin secret. This service is the
// trusted backend for workflow_runs / step_runs / quota writes — no user
// input is ever trusted for *what* gets written, only used to decide
// *whether* the write is allowed (checked in engine.js / permissions.js).

const HASURA_URL = process.env.HASURA_GRAPHQL_URL; // e.g. https://<subdomain>.nhost.run/v1/graphql
const ADMIN_SECRET = process.env.HASURA_ADMIN_SECRET;

async function hasuraRequest(query, variables = {}) {
  if (!HASURA_URL || !ADMIN_SECRET) {
    const err = new Error('Hasura service configuration is incomplete');
    err.status = 503;
    throw err;
  }
  const resp = await fetch(HASURA_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hasura-admin-secret': ADMIN_SECRET,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!resp.ok) {
    const err = new Error(`Hasura request failed with status ${resp.status}`);
    err.status = 502;
    throw err;
  }
  const json = await resp.json();
  if (json.errors) {
    const err = new Error(json.errors.map((e) => e.message).join('; '));
    err.status = 500;
    throw err;
  }
  return json.data;
}

module.exports = { hasuraRequest };
