# Demo video — what this actually is

`final-task-demo.mp4` (30s) is a **terminal walkthrough of the real backend**,
not a screen recording of the deployed frontend — there's no live nhost/Vercel
deployment to film from this environment (no hosting credentials here). It
shows, in order, using the real values captured from an actual run:

1. Org A's owner calling `POST /actions/triggerWorkflowRun` for a workflow
   with all three required step types (`llm_call`, `http_request`,
   `conditional_branch`) plus `db_write`, `notify`, and `approval_gate`.
2. The real `step_runs` rows from Postgres after execution — this is exactly
   what the frontend's live subscription renders, just read directly here
   instead of over a websocket.
3. The run correctly `paused` at the approval gate.
4. An Org B user (different org entirely) attempting to approve it — 403.
5. An Org A editor approving it — 200, and the run completing.
6. Final state read back from Postgres: run `completed`, org A's quota
   incremented by exactly 1.
7. A note on Org B being unable to see Org A's workflows by guessing the
   `org_id` — enforced by Hasura's `org_members` row-level scoping (see
   `hasura/metadata/*.yaml`; this part isn't re-derived in the video since it
   requires a live Hasura instance to demonstrate, see `TESTING.md`).

`demo-transcript.txt` is the exact raw text the video is rendered from, if
you'd rather read it than watch it.

**Once you deploy to real nhost + Vercel, replace this with an actual screen
recording of the live app** — that's what the assignment is really asking
for, and it's what a reviewer will expect to see for the visual builder UI,
the pause/approve button, and the live-updating subscription in the browser.
This file is a stand-in that proves the underlying system is real and
correct, not a substitute for that recording.
