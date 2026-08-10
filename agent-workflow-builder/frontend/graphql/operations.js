import { gql } from '@apollo/client';

// 1. Org's workflows with steps, triggers, and most recent run status
export const GET_ORG_WORKFLOWS = gql`
  query GetOrgWorkflows($orgId: uuid!) {
    workflows(where: { org_id: { _eq: $orgId } }, order_by: { created_at: desc }) {
      id
      name
      description
      is_active
      created_at
      steps(order_by: { step_order: asc }) {
        id
        step_order
        name
        type
        config
      }
      triggers {
        id
        type
        config
        is_enabled
      }
      latest_run {
        workflow_run_id
        status
        started_at
        finished_at
      }
    }
    organizations_by_pk(id: $orgId) {
      id
      name
      quota_limit
      quota_used
    }
  }
`;

// 2. Create/edit a workflow, its steps, and its triggers
export const CREATE_WORKFLOW = gql`
  mutation CreateWorkflow(
    $orgId: uuid!
    $name: String!
    $description: String
    $steps: [workflow_steps_insert_input!]!
    $triggers: [workflow_triggers_insert_input!]!
  ) {
    insert_workflows_one(
      object: {
        org_id: $orgId
        name: $name
        description: $description
        steps: { data: $steps }
        triggers: { data: $triggers }
      }
    ) {
      id
      name
      steps {
        id
        name
        type
      }
      triggers {
        id
        type
      }
    }
  }
`;

export const UPDATE_WORKFLOW = gql`
  mutation UpdateWorkflow($id: uuid!, $name: String, $description: String, $is_active: Boolean) {
    update_workflows_by_pk(
      pk_columns: { id: $id }
      _set: { name: $name, description: $description, is_active: $is_active }
    ) {
      id
    }
  }
`;

export const UPSERT_STEP = gql`
  mutation UpsertStep($object: workflow_steps_insert_input!) {
    insert_workflow_steps_one(
      object: $object
      on_conflict: { constraint: workflow_steps_pkey, update_columns: [name, type, config, step_order] }
    ) {
      id
    }
  }
`;

export const DELETE_STEP = gql`
  mutation DeleteStep($id: uuid!) {
    delete_workflow_steps_by_pk(id: $id) {
      id
    }
  }
`;

export const CREATE_TRIGGER = gql`
  mutation CreateTrigger($workflow_id: uuid!, $type: String!, $config: jsonb) {
    insert_workflow_triggers_one(object: { workflow_id: $workflow_id, type: $type, config: $config }) {
      id
      type
      config
    }
  }
`;

// Manual run — Hasura Action
export const TRIGGER_WORKFLOW_RUN = gql`
  mutation TriggerWorkflowRun($workflow_id: uuid!) {
    triggerWorkflowRun(workflow_id: $workflow_id) {
      run_id
      status
    }
  }
`;

// 3. Approve a paused approval_gate step — Hasura Action
export const APPROVE_STEP = gql`
  mutation ApproveStep($step_run_id: uuid!) {
    approveStep(step_run_id: $step_run_id) {
      step_run_id
      status
    }
  }
`;

// 4. Live step-by-step progress for a run, filtered to workflow_run_id
export const STEP_RUNS_SUBSCRIPTION = gql`
  subscription StepRunsForRun($workflow_run_id: uuid!) {
    step_runs(where: { workflow_run_id: { _eq: $workflow_run_id } }, order_by: { step_order: asc }) {
      id
      step_order
      type
      status
      input
      output
      error
      attempt_count
      approved_by
      approved_at
      started_at
      finished_at
    }
    workflow_runs_by_pk(id: $workflow_run_id) {
      id
      status
      error
      started_at
      finished_at
    }
  }
`;

export const GET_MY_ORGS = gql`
  query GetMyOrgs {
    org_members {
      role
      org {
        id
        name
        quota_limit
        quota_used
      }
    }
  }
`;
