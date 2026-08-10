import { useEffect, useState } from 'react';
import {
  useAuthenticationStatus,
  useSignInEmailPassword,
  useSignUpEmailPassword,
  useUserData,
} from '@nhost/react';
import { useQuery } from '@apollo/client';
import { useRouter } from 'next/router';
import { GET_MY_ORGS } from '../graphql/operations';

export default function Home() {
  const [mounted, setMounted] = useState(false);
  const { isAuthenticated, isLoading } = useAuthenticationStatus();

  useEffect(() => {
    setMounted(true);
  }, []);

  // Prevent Nhost authentication state from causing
  // a server/client hydration mismatch.
  if (!mounted || isLoading) {
    return (
      <div className="auth-shell">
        <h1>AI Agent Workflow Builder</h1>
        <p>Loading…</p>
      </div>
    );
  }

  if (isAuthenticated) {
    return <OrgPicker />;
  }

  return <AuthForm />;
}

function AuthForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState('signin');

  const {
    signInEmailPassword,
    isLoading: signingIn,
    error: signInError,
  } = useSignInEmailPassword();

  const {
    signUpEmailPassword,
    isLoading: signingUp,
    error: signUpError,
  } = useSignUpEmailPassword();

  const isSigningIn = signingIn || signingUp;

  async function submit(e) {
    e.preventDefault();

    if (!email || !password) {
      return;
    }

    if (mode === 'signin') {
      await signInEmailPassword(email, password);
    } else {
      await signUpEmailPassword(email, password);
    }
  }

  function toggleMode() {
    setMode((currentMode) =>
      currentMode === 'signin' ? 'signup' : 'signin'
    );
  }

  const error = signInError || signUpError;

  return (
    <div className="auth-shell">
      <h1>AI Agent Workflow Builder</h1>

      <form onSubmit={submit} className="auth-form">
        <input
          type="email"
          name="email"
          placeholder="you@org.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />

        <input
          type="password"
          name="password"
          placeholder="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={
            mode === 'signin' ? 'current-password' : 'new-password'
          }
          required
          minLength={6}
        />

        <button
          type="submit"
          disabled={isSigningIn}
        >
          {isSigningIn
            ? 'Please wait…'
            : mode === 'signin'
              ? 'Sign in'
              : 'Sign up'}
        </button>

        {error && (
          <p className="error">
            {error.message}
          </p>
        )}
      </form>

      <button
        type="button"
        className="link"
        onClick={toggleMode}
      >
        {mode === 'signin'
          ? 'Need an account? Sign up'
          : 'Have an account? Sign in'}
      </button>
    </div>
  );
}

function OrgPicker() {
  const user = useUserData();
  const router = useRouter();

  const { data, loading, error } = useQuery(GET_MY_ORGS);

  if (loading) {
    return (
      <p style={{ padding: 40 }}>
        Loading your organizations…
      </p>
    );
  }

  if (error) {
    return (
      <p style={{ padding: 40 }}>
        Error: {error.message}
      </p>
    );
  }

  const memberships = data?.org_members || [];

  return (
    <div className="shell">
      <h1>
        Welcome, {user?.email || 'User'}
      </h1>

      <p className="muted">
        Pick an organization to work in.
      </p>

      <div className="org-grid">
        {memberships.map((membership) => (
          <button
            key={membership.org.id}
            type="button"
            className="org-card"
            onClick={() =>
              router.push(`/org/${membership.org.id}`)
            }
          >
            <strong>
              {membership.org.name}
            </strong>

            <span className="badge">
              {membership.role}
            </span>

            <span className="muted">
              {membership.org.quota_used} /{' '}
              {membership.org.quota_limit} calls used
            </span>
          </button>
        ))}

        {memberships.length === 0 && (
          <p>
            You aren't a member of any organization yet.
            Ask an owner to add you.
          </p>
        )}
      </div>
    </div>
  );
}
