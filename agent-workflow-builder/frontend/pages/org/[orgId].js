import { useRouter } from 'next/router';
import { useQuery, useMutation } from '@apollo/client';
import { useState } from 'react';
import { GET_ORG_WORKFLOWS, GET_MY_ORGS, CREATE_WORKFLOW } from '../../graphql/operations';

export default function OrgDashboard() {
  const router = useRouter();
  const { orgId } = router.query;
  const { data, loading, error, refetch } = useQuery(GET_ORG_WORKFLOWS, {
    variables: { orgId },
    skip: !orgId,
  });
  const { data: myOrgs } = useQuery(GET_MY_ORGS);
  const [createWorkflow] = useMutation(CREATE_WORKFLOW);
  const [creating, setCreating] = useState(false);

  const myRole = myOrgs?.org_members.find((m) => m.org.id === orgId)?.role;
  const canEdit = myRole === 'owner' || myRole === 'editor';

  if (!orgId || loading) return <p style={{ padding: 40 }}>Loading…</p>;
  if (error) return <p style={{ padding: 40 }}>Error: {error.message}</p>;

  const org = data.organizations_by_pk;

  async function handleCreate() {
    setCreating(true);
    try {
      const res = await createWorkflow({
        variables: {
          orgId,
          name: 'New Workflow',
          description: '',
          steps: [],
          triggers: [{ type: 'manual', config: {} }],
        },
      });
      const newId = res.data.insert_workflows_one.id;
      router.push(`/org/${orgId}/workflow/${newId}`);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="shell">
      <div className="row space-between">
        <h1>{org.name}</h1>
        <span className="pill">Role: {myRole}</span>
      </div>

      <div className="quota-bar">
        <div className="quota-fill" style={{ width: `${Math.min(100, (org.quota_used / org.quota_limit) * 100)}%` }} />
        <span className="quota-label">
          {org.quota_used} / {org.quota_limit} calls used this period
        </span>
      </div>

      <div className="row space-between" style={{ marginTop: 24 }}>
        <h2>Workflows</h2>
        {canEdit && (
          <button onClick={handleCreate} disabled={creating}>
            + New workflow
          </button>
        )}
      </div>

      <div className="workflow-list">
        {data.workflows.map((wf) => (
          <a key={wf.id} className="workflow-card" href={`/org/${orgId}/workflow/${wf.id}`}>
            <strong>{wf.name}</strong>
            <span className="muted">{wf.steps.length} steps · {wf.triggers.map((t) => t.type).join(', ')}</span>
            <StatusBadge status={wf.latest_run?.status} />
          </a>
        ))}
        {data.workflows.length === 0 && <p className="muted">No workflows yet.</p>}
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  if (!status) return <span className="badge grey">no runs yet</span>;
  const colorClass = { completed: 'green', failed: 'red', paused: 'orange', running: 'blue', pending: 'grey' }[status] || 'grey';
  return <span className={`badge ${colorClass}`}>{status}</span>;
}
