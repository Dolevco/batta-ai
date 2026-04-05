import { useState, useEffect } from 'react';
import { Button, Input, message, Divider, Spin } from 'antd';
import { MailOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import MicrosoftIcon from '../components/icons/Microsoft';
import { useAuth } from '../hooks/useAuth';
import { cacheAuthProvider } from '../services/authConfig';
import { T } from '../theme';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [emailMode, setEmailMode] = useState(false);
  const { login, isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();


  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated) {
      navigate('/overview', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  if (isLoading) {
    return (
      <div style={styles.container}>
        <Spin size="large" />
      </div>
    );
  }

  const handleMicrosoftLogin = async () => {
    try {
      setLoading(true);
      cacheAuthProvider('msal');
      await login();
    } catch (e) {
      message.error('Failed to sign in with Microsoft');
      setLoading(false);
    }
  };

  const handleSSOLogin = async () => {
    try {
      setLoading(true);
      cacheAuthProvider('oidc');
      await login();
    } catch (e) {
      message.error('Failed to sign in with SSO');
      setLoading(false);
    }
  };

  const handleEmailContinue = async () => {
    if (!email) {
      message.error('Please enter your email address');
      return;
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      message.error('Please enter a valid email address');
      return;
    }

    setLoading(true);
    try {
      // Post email to backend to resolve tenant/SSO provider
      const response = await fetch('/api/auth/resolve-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || 'Authentication failed');
      }

      const data = await response.json();
      
      // Backend returns provider type and initiates auth
      if (data.provider === 'msal') {
        cacheAuthProvider('msal');
        await login();
      } else if (data.provider === 'oidc') {
        cacheAuthProvider('oidc');
        await login();
      } else if (data.redirectUrl) {
        // Direct redirect URL provided by backend
        window.location.href = data.redirectUrl;
      } else if (data.accessToken) {
        // Direct token (e.g., magic link flow)
        localStorage.setItem('access_token', data.accessToken);
        navigate('/overview', { replace: true });
      } else {
        throw new Error('Invalid response from server');
      }
    } catch (error: any) {
      message.error(error.message || 'Unable to sign in. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && email) {
      handleEmailContinue();
    }
  };

  if (emailMode) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <div style={styles.header}>
            <div style={styles.logoContainer}>
              <img src="/images/batta.svg" alt="Batta.AI" style={{ height: 80, marginBottom: 16 }} />
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1 }}>
                <span style={{ fontSize: 24, fontWeight: 700, color: '#141414' }}>
                  Batta <span style={{ color: T.orange, fontWeight: 700 }}>Security</span>
                </span>
                <span style={{ fontSize: 14, color: '#595959' }}>AI Agents</span>
              </div>
            </div>
            <h1 style={styles.title}>Sign in to your account</h1>
            <p style={styles.subtitle}>Enter your work email to continue</p>
          </div>

          <div style={styles.form}>
            <Input
              className="login-dark-input"
              size="large"
              placeholder="name@company.com"
              prefix={<MailOutlined style={{ color: '#595959' }} />}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyPress={handleKeyPress}
              autoFocus
              style={styles.input}
            />

            <Button
              type="primary"
              size="large"
              block
              loading={loading}
              onClick={handleEmailContinue}
              style={styles.primaryButton}
            >
              Continue
            </Button>

            <Button
              type="text"
              size="large"
              block
              onClick={() => setEmailMode(false)}
              style={styles.backButton}
            >
              Back to sign in options
            </Button>
          </div>
        </div>

        <div style={styles.footer}>
          <p style={styles.footerText}>
            Need help? Contact your IT administrator
          </p>
        </div>
      </div>
    );
  }

  // Check if user has previously used a specific auth method
  const cachedProvider = localStorage.getItem('auth_provider') as 'msal' | 'oidc' | null;

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.header}>
          <div style={styles.logoContainer}>
            <img src="/images/batta.svg" alt="Batta.AI" style={{ height: 80, marginBottom: 16, filter: 'brightness(0) saturate(100%) invert(55%) sepia(90%) saturate(500%) hue-rotate(345deg) brightness(1.05)' }} />
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1 }}>
              <span style={{ fontSize: 24, fontWeight: 700, color: '#141414' }}>
                Batta.<span style={{ color: T.orange, fontWeight: 700 }}>AI</span>
              </span>
              <span style={{ fontSize: 14, color: '#595959' }}></span>
            </div>
          </div>
          <p style={styles.subtitle}>Sign in to access your security workspace</p>
        </div>

        <div style={styles.form}>
          {(!cachedProvider || cachedProvider === 'msal') && (
            <Button
              size="large"
              block
              icon={<MicrosoftIcon />}
              onClick={handleMicrosoftLogin}
              loading={loading}
              style={styles.microsoftButton}
            >
              Sign in with Microsoft
            </Button>
          )}

          {(!cachedProvider || cachedProvider === 'oidc') && (
            <Button
              size="large"
              block
              onClick={handleSSOLogin}
              loading={loading}
              style={styles.ssoButton}
            >
              Sign in with SSO
            </Button>
          )}

          {!cachedProvider && (
            <>
              <Divider style={styles.divider}>or</Divider>

              <Input
                className="login-dark-input"
                size="large"
                placeholder="name@company.com"
                prefix={<MailOutlined style={{ color: '#595959' }} />}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyPress={handleKeyPress}
                style={styles.input}
              />

              <Button
                type="primary"
                size="large"
                block
                loading={loading}
                onClick={handleEmailContinue}
                style={styles.primaryButton}
              >
                Continue
              </Button>
            </>
          )}
        </div>
      </div>

      <div style={styles.footer}>
        <p style={styles.footerText}>
          Batta.AI · Terms · Privacy
        </p>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f5f5f5',
    padding: '24px',
  },
  card: {
    width: '100%',
    maxWidth: '420px',
    backgroundColor: T.white,
    borderRadius: '12px',
    padding: '48px 40px',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.12)',
  },
  header: {
    textAlign: 'center',
    marginBottom: '40px',
  },
  logoContainer: {
    marginBottom: '24px',
  },
  logo: {
    fontSize: '48px',
    color: '#1890ff',
  },
  title: {
    fontSize: '24px',
    fontWeight: 600,
    color: '#141414',
    margin: '0 0 8px 0',
  },
  subtitle: {
    fontSize: '14px',
    color: '#595959',
    margin: 0,
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  microsoftButton: {
    height: '44px',
    fontSize: '15px',
    fontWeight: 500,
    border: '1px solid #d9d9d9',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    color: '#141414',
    backgroundColor: T.white,
  },
  ssoButton: {
    height: '44px',
    fontSize: '15px',
    fontWeight: 500,
    border: '1px solid #d9d9d9',
    color: '#141414',
    backgroundColor: T.white,
  },
  divider: {
    margin: '20px 0 16px 0',
    fontSize: '13px',
    color: '#8c8c8c',
  },
  input: {
    height: '44px',
    fontSize: '15px',
    backgroundColor: T.white,
    border: '1px solid #d9d9d9',
    color: '#141414',
    padding: '8px 12px',
    borderRadius: '6px',
    boxSizing: 'border-box' as const,
  },
  primaryButton: {
    height: '44px',
    fontSize: '15px',
    fontWeight: 500,
    marginTop: '4px',
  },
  backButton: {
    height: '44px',
    fontSize: '14px',
    color: '#a6a6a6',
    marginTop: '8px',
  },
  footer: {
    marginTop: '32px',
    textAlign: 'center',
  },
  footerText: {
    fontSize: '13px',
    color: '#8c8c8c',
    margin: 0,
  },
};
