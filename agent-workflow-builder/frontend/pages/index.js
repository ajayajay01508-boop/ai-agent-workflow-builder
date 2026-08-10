import { useState } from 'react';
import { useAuthenticationStatus, useSignInEmailPassword, useSignUpEmailPassword, useUserData } from '@nhost/react';
import { useQuery } from '@apollo/client';
import { useRouter } from 'next/router';
import { GET_MY_ORGS } from '../graphql/operations';

export default function Home() {
  const { isAuthenticated, isLoading } = useAuthenticationStatus();

  if (isLoading) return <p style={{ padding: 40 }}>Loading…</p>;
  return isAuthenticated ? <OrgPicker /> : <AuthForm />;
}

function AuthForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState('signin');
  const { signInEmailPassword, isLoading: signingIn, error: signInError } = useSignInEmailPassword();
  const { signUpEmailPassword, isLoading: signingUp, error: signUpError } = useSignUpEmailPassword();

  async function submit(e) {
    e.preventDefault();
    if (mode === 'signin') await signInEmailPassword(email, password);
    else await signUpEmailPassword(email, password);
  }

  return (
    <div className="auth-shell">
      <h1>AI Agent Workflow Builder</h1>
      <form onSubmit={submit} className="auth-form">
        <input type="email" placeholder="you@org.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input type="password" placeholder="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <button type="submit" disabled={signingIn || signingUp}>
          {mode === 'signin' ? 'Sign in' : 'Sign up'}
        </button>
        {(signInError || signUpError) && <p className="error">{(signInError || signUpError).message}</p>}
      </form>
      <button className="link" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
        {mode === 'signin' ? 'Need an account? Sign up' : 'Have an account? Sign in'}
      </button>
    </div>
  );
}

function OrgPicker() {
  const user = useUserData();
  const router = useRouter();
  const { data, loading, error } = useQuery(GET_MY_ORGS);

  if (loading) return <p style={{ padding: 40 }}>Loading your organizations…</p>;
  if (error) return <p style={{ padding: 40 }}>Error: {error.message}</p>;

  const memberships = data?.org_members || [];

  return (
    <div className="shell">
      <h1>Welcome, {user?.email}</h1>
      <p className="muted">Pick an organization to work in.</p>
      <div className="org-grid">
        {memberships.map((m) => (
          <button key={m.org.id} className="org-card" onClick={() => router.push(`/org/${m.org.id}`)}>
            <strong>{m.org.name}</strong>
            <span className="badge">{m.role}</span>
            <span className="muted">
              {m.org.quota_used} / {m.org.quota_limit} calls used
            </span>
          </button>
        ))}
        {memberships.length === 0 && <p>You aren't a member of any organization yet. Ask an owner to add you.</p>}
      </div>
    </div>
  );
}
