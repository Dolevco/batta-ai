import { getAuthConfig } from '../authConfig';
import type { AuthProvider } from './msalProvider';

interface OidcTokens {
  accessToken: string;
  idToken?: string;
  refreshToken?: string;
  expiresAt: number;
}

interface UserInfo {
  sub: string;
  name?: string;
  email?: string;
  preferred_username?: string;
}

const STORAGE_KEY = 'oidc_tokens';
const USER_INFO_KEY = 'oidc_user_info';

export function createOidcProvider(): AuthProvider | null {
  const config = getAuthConfig();
  
  if (!config.oidc) {
    console.warn('OIDC configuration not found');
    return null;
  }

  const getStoredTokens = (): OidcTokens | null => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return null;
      return JSON.parse(stored);
    } catch {
      return null;
    }
  };

  const storeTokens = (tokens: OidcTokens) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
    } catch {}
  };

  const clearTokens = () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(USER_INFO_KEY);
    } catch {}
  };

  const getUserInfo = (): UserInfo | null => {
    try {
      const stored = localStorage.getItem(USER_INFO_KEY);
      if (!stored) return null;
      return JSON.parse(stored);
    } catch {
      return null;
    }
  };

  const storeUserInfo = (info: UserInfo) => {
    try {
      localStorage.setItem(USER_INFO_KEY, JSON.stringify(info));
    } catch {}
  };

  const isTokenExpired = (tokens: OidcTokens): boolean => {
    return Date.now() >= tokens.expiresAt;
  };

  const buildAuthUrl = (): string => {
    const params = new URLSearchParams({
      client_id: config.oidc!.clientId,
      redirect_uri: config.oidc!.redirectUri,
      response_type: 'code',
      scope: config.oidc!.scope || 'openid profile email',
      state: Math.random().toString(36).substring(7),
    });
    return `${config.oidc!.authority}/authorize?${params}`;
  };

  const exchangeCodeForToken = async (code: string): Promise<OidcTokens | null> => {
    try {
      const response = await fetch(`${config.oidc!.authority}/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: config.oidc!.clientId,
          code,
          redirect_uri: config.oidc!.redirectUri,
          grant_type: 'authorization_code',
        }),
      });

      if (!response.ok) return null;

      const data = await response.json();
      const tokens: OidcTokens = {
        accessToken: data.access_token,
        idToken: data.id_token,
        refreshToken: data.refresh_token,
        expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
      };

      storeTokens(tokens);

      // Fetch user info
      if (tokens.accessToken) {
        await fetchUserInfo(tokens.accessToken);
      }

      return tokens;
    } catch {
      return null;
    }
  };

  const fetchUserInfo = async (accessToken: string): Promise<void> => {
    try {
      const response = await fetch(`${config.oidc!.authority}/userinfo`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (response.ok) {
        const info = await response.json();
        storeUserInfo(info);
      }
    } catch {}
  };

  return {
    async login() {
      window.location.href = buildAuthUrl();
    },

    logout() {
      clearTokens();
      const logoutUrl = `${config.oidc!.authority}/logout?post_logout_redirect_uri=${encodeURIComponent(window.location.origin)}`;
      window.location.href = logoutUrl;
    },

    async handleRedirect() {
      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');

      if (!code) return null;

      const tokens = await exchangeCodeForToken(code);
      if (!tokens) return null;

      // Clear the URL
      window.history.replaceState({}, document.title, window.location.pathname);

      const userInfo = getUserInfo();
      return {
        accessToken: tokens.accessToken,
        account: userInfo ? {
          homeAccountId: userInfo.sub,
          localAccountId: userInfo.sub,
          username: userInfo.email || userInfo.preferred_username || '',
          name: userInfo.name || '',
          environment: '',
        } as any : null,
      } as any;
    },

    async acquireToken() {
      const tokens = getStoredTokens();
      if (!tokens) return null;

      if (!isTokenExpired(tokens)) {
        return tokens.accessToken;
      }

      // Token expired, try refresh if available
      if (tokens.refreshToken) {
        try {
          const response = await fetch(`${config.oidc!.authority}/token`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
              client_id: config.oidc!.clientId,
              refresh_token: tokens.refreshToken,
              grant_type: 'refresh_token',
            }),
          });

          if (response.ok) {
            const data = await response.json();
            const newTokens: OidcTokens = {
              accessToken: data.access_token,
              idToken: data.id_token,
              refreshToken: data.refresh_token || tokens.refreshToken,
              expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
            };
            storeTokens(newTokens);
            return newTokens.accessToken;
          }
        } catch {}
      }

      return null;
    },

    async getAccessToken() {
      const tokens = getStoredTokens();
      if (!tokens) return null;

      if (!isTokenExpired(tokens)) {
        return tokens.accessToken;
      }

      // Try to refresh
      return await this.acquireToken();
    },

    getAccount() {
      const userInfo = getUserInfo();
      if (!userInfo) return null;

      return {
        homeAccountId: userInfo.sub,
        localAccountId: userInfo.sub,
        username: userInfo.email || userInfo.preferred_username || '',
        name: userInfo.name || '',
        environment: '',
      } as any;
    },
  };
}
