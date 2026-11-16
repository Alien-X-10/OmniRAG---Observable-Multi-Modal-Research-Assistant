// File: src/components/Login.jsx
import React, { useState } from 'react';

export default function Login({ onLoginSuccess }) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleTabSwitch = (toLogin) => {
    setIsLogin(toLogin);
    setEmail('');
    setPassword('');
    setUsername('');
    setError('');
  };

  // const handleSubmit = async (e) => {
  //   e.preventDefault();
  //   setError('');

  //   if (!email || !password) {
  //     setError('Please fill in all required fields.');
  //     return;
  //   }

  //   if (!isLogin && password !== confirmPassword) {
  //     setError('Security keys (passwords) do not match.');
  //     return;
  //   }

  //   if (!isLogin && !username.trim()) {
  //     setError('Please choose a display username.');
  //     return;
  //   }

  //   setLoading(true);
  //   const endpoint = isLogin ? '/api/auth/login' : '/api/auth/register';

  //   try {
  //     const response = await fetch(endpoint, {
  //       method: 'POST',
  //       headers: { 'Content-Type': 'application/json' },
  //       // body: JSON.stringify({ email, password }),
  //       body: JSON.stringify(isLogin ? { email, password } : { username: username.trim(), email, password }),
  //     });

  //     const data = await response.json();

  //     if (!response.ok) {
  //       throw new Error(data.error || 'Authentication failed.');
  //     }

  //     // Pass real user email and JWT token from MongoDB up to App.jsx
  //     if (onLoginSuccess) {
  //       onLoginSuccess(data);
  //     }
  //   } catch (err) {
  //     setError(err.message);
  //   } finally {
  //     setLoading(false);
  //   }
  // };

const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!email.trim() || !password) {
      setError('Email and security key are required.');
      return;
    }

    if (!isLogin && !username.trim()) {
      setError('Please choose a display username.');
      return;
    }

    if (!isLogin && password.length < 6) {
      setError('Security key must be at least 6 characters.');
      return;
    }

    setLoading(true);
    try {
      const endpoint = isLogin ? '/api/auth/login' : '/api/auth/register';
      const payload = isLogin
        ? { email: email.trim(), password }
        : { username: username.trim(), email: email.trim(), password };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Authentication failed');
      }

      if (onLoginSuccess) {
        onLoginSuccess({
          email: data.email || email.trim(),
          username: data.username || username.trim() || email.split('@')[0],
          token: data.token,
        });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = () => {
    if (onLoginSuccess) {
      onLoginSuccess({ email: 'google-user@omnirag.internal', token: 'mock-google-jwt-token' });
    }
  };

  return (
    <div style={styles.container}>
      {/* Ambient Corner Telemetry */}
      <div style={{ ...styles.telemetry, top: '20px', left: '20px' }}>
        [ SYS_SECURE v2.4 ]<br />STATUS TICKS: ✓ ✓
      </div>
      <div style={{ ...styles.telemetry, top: '20px', right: '20px', textAlign: 'right' }}>
        PORT_CONNECT // 27017<br />ENCRYPTED
      </div>
      <div style={{ ...styles.telemetry, bottom: '20px', left: '20px' }}>
        [ OMNIRAG ACCESS GATEWAY ]<br />SYS.STATUS: ONLINE
      </div>
      <div style={{ ...styles.telemetry, bottom: '20px', right: '20px', textAlign: 'right' }}>
        NODE_CONNECT: ▓▓▓▓<br />STATUS: ●●
      </div>

      {/* Main Inner Console Box */}
      <div style={styles.consoleBox}>
        <div style={styles.brandHeader}>
          <h1 style={styles.title}>OmniRAG</h1>
          <p style={styles.subtitle}>Observable Multi-Modal Research Assistant</p>
        </div>

        {/* Tab Switcher */}
        <div style={styles.tabContainer}>
          <button
            type="button"
            style={{ ...styles.tab, ...(isLogin ? styles.activeTab : {}) }}
            onClick={() => { setIsLogin(true); setError(''); }}
          >
            Sign In
          </button>
          <button
            type="button"
            style={{ ...styles.tab, ...(!isLogin ? styles.activeTab : {}) }}
            onClick={() => { setIsLogin(false); setError(''); }}
          >
            Register
          </button>
        </div>

        {error && <div style={styles.errorBox}>{error}</div>}

        <form onSubmit={handleSubmit} autoComplete="off" style={styles.form}>
          <div style={styles.inputGroup}>
            <label style={styles.label}>EMAIL // USER_ID</label>
            <input
              type="email"
              name={isLogin ? 'login_email' : 'register_email'}
              autoComplete="new-password"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={styles.input}
            />
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>SECURITY_KEY</label>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <input
                type={showPassword ? 'text' : 'password'}
                name={isLogin ? 'login_password' : 'register_password'}
                autoComplete="new-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{ ...styles.input, width: '100%', paddingRight: '42px' }}
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                style={{
                  position: 'absolute',
                  right: '12px',
                  background: 'transparent',
                  border: 'none',
                  color: showPassword ? '#00ff66' : '#64748b',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  padding: 0,
                }}
              >
                {showPassword ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {!isLogin && (
            <div style={styles.inputGroup}>
              <label style={styles.label}>USERNAME // DISPLAY_HANDLE</label>
              <input
                type="text"
                name="register_username"
                autoComplete="off"
                placeholder="e.g., abc_dev"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                style={styles.input}
              />
            </div>
          )}

          <button type="submit" style={styles.submitBtn} disabled={loading}>
            {loading
              ? 'Authenticating...'
              : isLogin
                ? 'Access Console'
                : 'Initialize Account'}
          </button>

          <div style={styles.divider}>OR</div>

          <button type="button" onClick={handleGoogleLogin} style={styles.googleBtn}>
            <svg width="16" height="16" viewBox="0 0 48 48" style={{ marginRight: '8px' }}>
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
            </svg>
            Sign in with Google
          </button>
        </form>

        <div style={styles.footer}>
          {isLogin ? (
            <span>New to OmniRAG? <a href="#register" onClick={(e) => { e.preventDefault(); setIsLogin(false); }} style={styles.link}>Create an account</a></span>
          ) : (
            <span>Already have access? <a href="#login" onClick={(e) => { e.preventDefault(); setIsLogin(true); }} style={styles.link}>Sign in</a></span>
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  container: {
    backgroundColor: '#050505',
    color: '#e0e0e0',
    fontFamily: "'JetBrains Mono', monospace, sans-serif",
    height: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
    backgroundImage: 'linear-gradient(#111818 1px, transparent 1px), linear-gradient(90deg, #111818 1px, transparent 1px)',
    backgroundSize: '40px 40px',
  },
  telemetry: {
    position: 'absolute',
    fontSize: '10px',
    color: '#4a6b5d',
    letterSpacing: '1px',
    lineHeight: '1.4',
  },
  consoleBox: {
    width: '420px',
    backgroundColor: '#0a0d0b',
    border: '1px solid #00ff66',
    padding: '35px',
    boxShadow: '0 0 25px rgba(0, 255, 102, 0.15)',
    clipPath: 'polygon(15px 0, 100% 0, 100% calc(100% - 15px), calc(100% - 15px) 100%, 0 100%, 0 15px)',
    zIndex: 10,
  },
  brandHeader: {
    textAlign: 'center',
    marginBottom: '25px',
  },
  title: {
    fontSize: '22px',
    color: '#ffffff',
    letterSpacing: '1px',
    margin: '0 0 5px 0',
  },
  subtitle: {
    fontSize: '10px',
    color: '#4a6b5d',
    textTransform: 'uppercase',
    margin: 0,
  },
  tabContainer: {
    display: 'flex',
    borderBottom: '1px solid #1f2d25',
    marginBottom: '20px',
  },
  tab: {
    flex: 1,
    background: 'none',
    border: 'none',
    padding: '10px',
    fontSize: '12px',
    color: '#4a6b5d',
    cursor: 'pointer',
    textTransform: 'uppercase',
    fontWeight: 'bold',
  },
  activeTab: {
    color: '#00ff66',
    borderBottom: '2px solid #00ff66',
    textShadow: '0 0 8px rgba(0, 255, 102, 0.4)',
  },
  errorBox: {
    backgroundColor: 'rgba(255, 0, 0, 0.1)',
    border: '1px solid #ff4444',
    color: '#ff8888',
    padding: '8px',
    fontSize: '11px',
    marginBottom: '15px',
    textAlign: 'center',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '15px',
  },
  inputGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '5px',
  },
  label: {
    fontSize: '10px',
    color: '#4a6b5d',
    textTransform: 'uppercase',
  },
  input: {
    backgroundColor: '#000000',
    border: '1px solid #1f2d25',
    padding: '12px',
    color: '#ffffff',
    fontSize: '13px',
    outline: 'none',
  },
  submitBtn: {
    backgroundColor: '#00ff66',
    color: '#000000',
    border: 'none',
    padding: '12px',
    fontWeight: 'bold',
    textTransform: 'uppercase',
    cursor: 'pointer',
    letterSpacing: '1px',
    marginTop: '5px',
  },
  divider: {
    textAlign: 'center',
    fontSize: '10px',
    color: '#4a6b5d',
    margin: '5px 0',
  },
  googleBtn: {
    backgroundColor: 'transparent',
    color: '#ffffff',
    border: '1px solid #1f2d25',
    padding: '11px',
    fontSize: '13px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    textAlign: 'center',
    marginTop: '20px',
    fontSize: '11px',
    color: '#4a6b5d',
  },
  link: {
    color: '#00ff66',
    textDecoration: 'none',
  },
}