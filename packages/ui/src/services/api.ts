// Minimal API helper file — only provides API_BASE and fetchWithAuth (token getter injected by hooks/providers)

export const API_BASE: string = (() => {
  if (typeof window === 'undefined') return 'https://localhost:3001/api';

  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') {
    const protocol = window.location.protocol; // e.g. "http:" or "https:"
    const currentPort = parseInt(window.location.port || '3000', 10);
    const port = Number.isFinite(currentPort) ? currentPort + 1 : 3001;
    return `${protocol}//${host}:${port}/api`;
  }
  if (host.includes('windows.net')) {
    return 'https://batta-api.livelysea-aa2f3ed4.westeurope.azurecontainerapps.io/api';
  }

  if (host.includes('batta.ai')) {
    return 'https://batta.ai/api';
  }

  return 'https://localhost:3001/api';
})();

export async function fetchWithAuth(getToken: () => Promise<string | null>, input: string, init: RequestInit = {}) {
  const token = await getToken();
  const headers = Object.assign({}, init.headers || {}, token ? { Authorization: `Bearer ${token}` } : {}, { 'Content-Type': 'application/json' });
  const resp = await fetch(input, Object.assign({}, init, { headers }));
  if (resp.status === 401) {
    // Redirect to login
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }
  return resp;
}
