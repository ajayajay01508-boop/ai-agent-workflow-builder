// functions/scheduled-trigger.js
//
// Deploy this as an nhost Serverless Function with a cron schedule (nhost
// supports cron functions natively via `nhost/functions` + a `cron.yaml`,
// or you can point any external scheduler — e.g. cron-job.org, GitHub
// Actions on a schedule, or Vercel Cron — at the same URL). It simply pings
// the action handler's /scheduled/run-due endpoint, which does the real
// work of finding due `scheduled` workflow_triggers and starting runs.
//
// Example nhost cron.yaml entry:
//   - webhook: '{{ACTIONS_BASE_URL}}/scheduled/run-due'
//     schedule: '*/15 * * * *'
//     headers:
//       - name: x-webhook-secret
//         value_from_env: ACTIONS_WEBHOOK_SECRET

module.exports = async (req, res) => {
  const resp = await fetch(`${process.env.ACTIONS_BASE_URL}/scheduled/run-due`, {
    method: 'POST',
    headers: { 'x-webhook-secret': process.env.ACTIONS_WEBHOOK_SECRET },
  });
  const data = await resp.json();
  res.status(200).json(data);
};
