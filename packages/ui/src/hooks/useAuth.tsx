import { useState, useEffect, createContext, useContext, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAuthConfig, cacheAuthProvider } from '../services/authConfig';
import { createMsalProvider } from '../services/authProviders/msalProvider';
import { createOidcProvider } from '../services/authProviders/oidcProvider';
import type { AuthProvider } from '../services/authProviders/msalProvider';

interface UserInfo {
  name?: string;
  email?: string;
  userId?: string;
  tenantId?: string;
}

interface AuthContextValue {
  isAuthenticated: boolean;
  isLoading: boolean;
  userInfo: UserInfo | null;
  accessToken: string | null;
  authError: string | null;
  login: () => Promise<void>;
  logout: () => void;
  acquireToken: (scopes?: string[]) => Promise<string | null>;
  setExternalToken: (token: string, account?: any) => void; // used when backend returns token directly
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [provider, setProvider] = useState<AuthProvider | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let mounted = true;

    const initialize = async () => {
      try {
        const config = getAuthConfig();
        let authProvider: AuthProvider | null = null;

        // Create the appropriate provider
        if (config.provider === 'msal' && config.msal) {
          authProvider = createMsalProvider();
        } else if (config.provider === 'oidc' && config.oidc) {
          authProvider = createOidcProvider();
        }

        if (!authProvider) {
          if (mounted) {
            setIsLoading(false);
            setIsAuthenticated(false);
          }
          return;
        }

        if (mounted) {
          setProvider(authProvider);
        }

        // Handle redirect from OAuth flow
        const redirectResult = await authProvider.handleRedirect();

        // When returning from redirect we may get an access token and account info.
        if (redirectResult?.accessToken) {
          if (mounted) {
            setAccessToken(redirectResult.accessToken);
            setIsAuthenticated(true);
            cacheAuthProvider(config.provider);

            const account = redirectResult.account || authProvider.getAccount?.();
            if (account) {
              const claims = (account as any).idTokenClaims || {};
              setUserInfo({
                name: claims.name || claims.preferred_username || (account as any).name,
                email: (account as any).username,
                userId: claims.oid || claims.sub,
                tenantId: claims.tid,
              });
            }
          }

          // Remove any query params and navigate into the app
          try { window.history.replaceState({}, document.title, window.location.pathname); } catch {}
          try { navigate('/', { replace: true }); } catch {}
        }

        // Try to get an existing token from the provider (silent)
        const token = await authProvider.getAccessToken();

        if (token) {
          if (mounted) {
            setAccessToken(token);
            setIsAuthenticated(true);

            // Get user info
            const account = authProvider.getAccount();
            if (account) {
              const claims = (account as any).idTokenClaims || {};
              setUserInfo({
                name: claims.name || claims.preferred_username || (account as any).name,
                email: (account as any).username,
                userId: claims.oid || claims.sub,
                tenantId: claims.tid,
              });
            }
          }
        }
      } catch (error: any) {
        console.error('Auth initialization error:', error);
        if (mounted) {
          setAuthError(error.message || 'Authentication failed');
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    initialize();

    return () => {
      mounted = false;
    };
  }, []);

  const login = async () => {
    if (!provider) {
      // Fallback to server-side auth
      window.location.href = '/auth/login';
      return;
    }

    try {
      await provider.login();
    } catch (error: any) {
      setAuthError(error.message || 'Login failed');
      throw error;
    }
  };

  const logout = () => {
    if (provider) {
      provider.logout();
    } else {
      // Clear in-memory state only
      setAccessToken(null);
      setIsAuthenticated(false);
      localStorage.removeItem('auth_provider');
      window.location.href = '/login';
    }
  };

  const acquireToken = async (scopes?: string[]): Promise<string | null> => {
    if (!provider) return null;

    try {
      const t = await (provider.getAccessToken ? provider.getAccessToken() : provider.acquireToken?.(scopes));
      if (t) {
        setAccessToken(t as string);
        setIsAuthenticated(true);
      }
      return t as string | null;
    } catch (e: any) {
      setAuthError(String(e));
      return null;
    }
  };

  // Used when backend returns a token directly (magic link). Token kept in memory only.
  const setExternalToken = (token: string, account?: any) => {
    setAccessToken(token);
    setIsAuthenticated(true);
    if (account) {
      const claims = account.idTokenClaims || {};
      setUserInfo({
        name: account.name || undefined,
        email: account.username || undefined,
        userId: claims.oid || claims.sub,
        tenantId: claims.tid,
      });
    }
  };

  const value: AuthContextValue = {
    isAuthenticated,
    isLoading,
    userInfo,
    accessToken,
    authError,
    login,
    logout,
    acquireToken,
    setExternalToken,
  };

  // Note: token provider registration removed. Hooks call useAuth().acquireToken directly.

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
