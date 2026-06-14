import { PublicClientApplication, AccountInfo, AuthenticationResult, InteractionRequiredAuthError } from '@azure/msal-browser';
import { getAuthConfig } from '../authConfig';

export interface AuthProvider {
  login: () => Promise<void>;
  logout: () => void;
  handleRedirect: () => Promise<AuthenticationResult | null>;
  acquireToken: (scopes?: string[]) => Promise<string | null>;
  getAccessToken: () => Promise<string | null>;
  getAccount: () => AccountInfo | null;
}

export function createMsalProvider(): AuthProvider | null {
  const config = getAuthConfig();
  
  if (!config.msal) {
    console.warn('MSAL configuration not found');
    return null;
  }

  const msalConfig = {
    auth: {
      clientId: config.msal.clientId,
      authority: config.msal.authority,
      redirectUri: config.msal.redirectUri,
    },
    cache: {
      cacheLocation: 'localStorage',
      storeAuthStateInCookie: false,
    },
  };

  const scopes = [`api://${config.msal.clientId}/User.ReadWrite`];

  const pca = new PublicClientApplication(msalConfig);
  let initPromise: Promise<void> | null = null;

  const ensureInitialized = async () => {
    if (!initPromise) {
      initPromise = pca.initialize();
    }
    await initPromise;
  };

  return {
    async login() {
      await ensureInitialized();
      await pca.loginRedirect({
        scopes
      });
    },

    logout() {
      pca.logoutRedirect();
    },

    async handleRedirect() {
      await ensureInitialized();
      return await pca.handleRedirectPromise();
    },

    async acquireToken(tokenScopes?: string[]) {
      await ensureInitialized();
      const accounts = pca.getAllAccounts();
      if (accounts.length === 0) return null;

      const request = {
        account: accounts[0],
        scopes: tokenScopes || scopes
      };

      try {
        const response = await pca.acquireTokenSilent(request);
        return response.accessToken;
      } catch (error) {
        if (error instanceof InteractionRequiredAuthError) {
          // Require user interaction
          await pca.acquireTokenRedirect(request);
          return null;
        }
        throw error;
      }
    },

    async getAccessToken() {
      await ensureInitialized();
      const accounts = pca.getAllAccounts();
      if (accounts.length === 0) return null;

      const request = {
        account: accounts[0],
        scopes: config.msal?.scopes || scopes,
      };

      try {
        const response = await pca.acquireTokenSilent(request);
        return response.accessToken;
      } catch {
        return null;
      }
    },

    getAccount() {
      const accounts = pca.getAllAccounts();
      return accounts.length > 0 ? accounts[0] : null;
    },
  };
}
