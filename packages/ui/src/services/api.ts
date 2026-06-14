const AUTH_DISABLED = import.meta.env.VITE_AUTH_DISABLED === 'true';

export const API_BASE: string = (import.meta.env.VITE_API_BASE as string | undefined) ?? `${window.location.protocol}//localhost:3101/api`;

export async function fetchWithAuth(getToken: () => Promise<string | null>, input: string, init: RequestInit = {}) {
  if (AUTH_DISABLED) {
    const headers = Object.assign({}, init.headers || {}, { 'Content-Type': 'application/json' });
    const resp = await fetch(input, Object.assign({}, init, { headers }));
    if (resp.status === 401) {
      throw new Error('Unexpected 401 in no-auth mode');
    }
    return resp;
  }

  const token = await getToken();
  const headers = Object.assign({}, init.headers || {}, token ? { Authorization: `Bearer ${token}` } : {}, { 'Content-Type': 'application/json' });
  const resp = await fetch(input, Object.assign({}, init, { headers }));
  if (resp.status === 401) {
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }
  return resp;
}
