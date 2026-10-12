import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { auth } from '../firebase/config';
import { sendPasswordResetEmail } from 'firebase/auth';
import { signInWithGoogle } from '../firebase/socialAuth';
import { Icon } from '../components/brand';

interface AuthScreenProps {
  onAuthSuccess: () => void;
  onBack: () => void;
}

const AuthScreen: React.FC<AuthScreenProps> = ({ onAuthSuccess, onBack }) => {
  const [currentForm, setCurrentForm] = useState<'login' | 'signup'>('login');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const { login, register } = useAuth();

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    if (password !== confirmPassword) { setError('Passwords do not match'); return; }
    if (!username) { setError('Username is required'); return; }
    setLoading(true);
    const result = await register(email, password, name, username, phone);
    setLoading(false);
    if (result.success) onAuthSuccess();
    else setError(result.error || 'Registration failed');
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    setLoading(true);
    const result = await login(email, password);
    setLoading(false);
    if (result.success) onAuthSuccess();
    else setError(result.error || 'Login failed');
  };

  const handleForgotPassword = async () => {
    setError('');
    setNotice('');
    if (!email.trim()) {
      setError('Enter your email address first.');
      return;
    }

    setLoading(true);
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setNotice('Password reset instructions were sent to your email.');
    } catch (e: any) {
      setError(e?.message || 'Could not send password reset email.');
    } finally {
      setLoading(false);
    }
  };

  const handleSocialSignIn = async (
    provider: () => Promise<{ success: boolean; error?: string }>,
  ) => {
    setError('');
    setNotice('');
    setLoading(true);
    try {
      const result = await provider();
      if (!result.success) setError(result.error || 'Social sign-in failed.');
    } catch (e: any) {
      setError(e?.message || 'Social sign-in failed.');
    } finally {
      setLoading(false);
    }
  };

  const isSignup = currentForm === 'signup';

  return (
    <div
      className="screen auth-screen active"
      style={{
        background: 'var(--bg-page)',
        padding: '60px 28px 32px',
        flexDirection: 'column',
      }}
    >
      <button
        onClick={() => (isSignup ? setCurrentForm('login') : onBack())}
        style={{
          width: 40,
          height: 40,
          borderRadius: 12,
          background: 'var(--bg-soft)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text)',
        }}
        aria-label="Back"
      >
        <Icon.ArrowLeft />
      </button>

      <div style={{ marginTop: 32 }}>
        <h1 className="h1" style={{ fontSize: 32 }}>
          {isSignup ? 'Create account' : 'Welcome back'}
        </h1>
        <p style={{ fontSize: 15, color: 'var(--text-muted)', margin: '8px 0 0' }}>
          {isSignup ? 'Sign up for your Mark Identity account' : 'Sign in to your Mark Identity account'}
        </p>
      </div>

      {error && (
        <div
          style={{
            marginTop: 16,
            padding: '10px 14px',
            background: 'rgba(229,72,72,0.08)',
            color: 'var(--danger)',
            borderRadius: 12,
            fontSize: 13,
            border: '1px solid rgba(229,72,72,0.2)',
          }}
        >
          {error}
        </div>
      )}

      {notice && (
        <div
          style={{
            marginTop: 16,
            padding: '10px 14px',
            background: 'var(--primary-soft)',
            color: 'var(--primary-ink)',
            borderRadius: 12,
            fontSize: 13,
            border: '1px solid var(--border)',
          }}
        >
          {notice}
        </div>
      )}

      <form
        onSubmit={isSignup ? handleSignup : handleLogin}
        style={{ marginTop: 28, display: 'flex', flexDirection: 'column', gap: 16, flex: '0 0 auto' }}
      >
        <div className="field">
          <label>Email</label>
          <input
            type="email"
            placeholder="alex@email.com"
            required
            value={email}
            onChange={e => setEmail(e.target.value)}
          />
        </div>

        {isSignup && (
          <>
            <div className="field">
              <label>Full Name</label>
              <input
                type="text"
                placeholder="John Doe"
                required
                value={name}
                onChange={e => setName(e.target.value)}
              />
            </div>
            <div className="field">
              <label>Username</label>
              <input
                type="text"
                placeholder="@username"
                required
                value={username}
                onChange={e => setUsername(e.target.value)}
              />
            </div>
            <div className="field">
              <label>Phone (optional)</label>
              <input
                type="tel"
                placeholder="+380995683023"
                value={phone}
                onChange={e => setPhone(e.target.value)}
              />
            </div>
          </>
        )}

        <div className="field">
          <label>Password</label>
          <input
            type="password"
            placeholder="••••••••••"
            required
            value={password}
            onChange={e => setPassword(e.target.value)}
          />
        </div>

        {isSignup && (
          <div className="field">
            <label>Confirm Password</label>
            <input
              type="password"
              placeholder="••••••••••"
              required
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
            />
          </div>
        )}

        {!isSignup && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: 13,
            }}
          >
            <span style={{ color: 'var(--text-muted)' }}>&nbsp;</span>
            <button
              type="button"
              onClick={handleForgotPassword}
              disabled={loading}
              style={{ color: 'var(--primary)', fontWeight: 600, padding: 0 }}
            >
              Forgot?
            </button>
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="btn btn-primary btn-block"
          style={{ marginTop: 4, padding: '16px', fontSize: 16 }}
        >
          {loading ? 'Loading…' : isSignup ? 'Sign up' : 'Sign in'}
        </button>
      </form>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          margin: '24px 0',
          color: 'var(--text-faint)',
          fontSize: 12,
        }}
      >
        <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
        <span>OR CONTINUE WITH</span>
        <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
      </div>

      <div style={{ display: 'flex' }}>
        <button
          onClick={() => handleSocialSignIn(signInWithGoogle)}
          disabled={loading}
          style={{
            width: '100%',
            padding: 14,
            borderRadius: 14,
            background: 'var(--bg-soft)',
            fontWeight: 700,
            fontSize: 18,
            color: 'var(--text)',
          }}
          aria-label="Continue with Google"
        >
          Continue with Google
        </button>
      </div>

      <div
        style={{
          marginTop: 'auto',
          textAlign: 'center',
          fontSize: 14,
          color: 'var(--text-muted)',
          paddingTop: 28,
        }}
      >
        {isSignup ? (
          <>
            Already have an account?{' '}
            <button
              type="button"
              onClick={() => { setCurrentForm('login'); setError(''); setNotice(''); }}
              style={{ color: 'var(--primary)', fontWeight: 600, padding: 0 }}
            >
              Sign in
            </button>
          </>
        ) : (
          <>
            Don't have an account?{' '}
            <button
              type="button"
              onClick={() => { setCurrentForm('signup'); setError(''); setNotice(''); }}
              style={{ color: 'var(--primary)', fontWeight: 600, padding: 0 }}
            >
              Sign up
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default AuthScreen;
