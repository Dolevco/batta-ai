export interface AuthConfig {
  provider: 'msal' | 'oidc';
  msal?: {
    clientId: string;
    authority: string;
    redirectUri: string;
    scopes?: string[];
  };
  oidc?: {
    authority: string;
    clientId: string;
    redirectUri: string;
    scope?: string;
  };
}

// Detect auth config from environment or localStorage
export function getAuthConfig(): AuthConfig {
  // Check if we have cached auth method from previous login
  const cachedProvider = localStorage.getItem('auth_provider') as 'msal' | 'oidc' | null;
  
  // MSAL config from environment
  const msalClientId = import.meta.env.VITE_MSAL_CLIENT_ID || '';
  const msalAuthority = import.meta.env.VITE_MSAL_AUTHORITY || 'https://login.microsoftonline.com/common';
  const msalRedirectUri = window.location.origin;
  
  // OIDC config from environment
  const oidcAuthority = import.meta.env.VITE_OIDC_AUTHORITY;
  const oidcClientId = import.meta.env.VITE_OIDC_CLIENT_ID;
  const oidcRedirectUri = import.meta.env.VITE_OIDC_REDIRECT_URI || window.location.origin;
  
  // Determine which provider to use
  let provider: 'msal' | 'oidc';
  
  if (cachedProvider) {
    provider = cachedProvider;
  } else if (msalClientId && msalAuthority) {
    provider = 'msal';
  } else if (oidcClientId && oidcAuthority) {
    provider = 'oidc';
  } else {
    // Default to msal if nothing is configured
    provider = 'msal';
  }
  
  return {
    provider,
    msal: msalClientId && msalAuthority ? {
      clientId: msalClientId,
      authority: msalAuthority,
      redirectUri: msalRedirectUri,
      scopes: [`api://${msalClientId}/User.ReadWrite`],
    } : undefined,
    oidc: oidcClientId && oidcAuthority ? {
      authority: oidcAuthority,
      clientId: oidcClientId,
      redirectUri: oidcRedirectUri,
      scope: 'openid profile email',
    } : undefined,
  };
}

export function cacheAuthProvider(provider: 'msal' | 'oidc') {
  try {
    localStorage.setItem('auth_provider', provider);
  } catch {}
}
