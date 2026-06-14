import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Spin } from 'antd';
import { useAuth } from '../hooks/useAuth';
import { API_BASE, fetchWithAuth } from '../services/api';

export function OAuthCallbackPage() {
  const [status, setStatus] = useState<'pending' | 'success' | 'error'>('pending');
  const { acquireToken } = useAuth();
  const params = useParams();

  useEffect(() => {
    async function completeFlow() {
      const qs = new URLSearchParams(window.location.search);
      // Collect all query params into an object
      const paramsObj: Record<string, string> = {};
      for (const [k, v] of qs.entries()) {
        if (v != null) paramsObj[k] = v;
      }
      const providerFromPath = params.provider;
      const provider = (providerFromPath || qs.get('provider') || 'oauth') as string;
      const code = paramsObj.code;
      const error = paramsObj.error;

      // If the provider returned an error, notify opener and close
      if (error) {
        try {
          window.opener?.postMessage({ provider, success: false, error }, window.location.origin);
        } catch {}
        setStatus('error');
        setTimeout(() => window.close(), 800);
        return;
      }

      if (!code) {
        try {
          window.opener?.postMessage({ provider, success: false, error: 'missing_code' }, window.location.origin);
        } catch {}
        setStatus('error');
        setTimeout(() => window.close(), 800);
        return;
      }

      try {
        // Map GitHub's installation_id to installationId expected by the backend
        const body: Record<string, any> = { ...paramsObj };
        if (paramsObj.installation_id) body.installationId = paramsObj.installation_id;

        const resp = await fetchWithAuth(acquireToken, `${API_BASE}/oauth/${provider}/complete`, {
          method: 'POST',
          body: JSON.stringify(body),
        });

        const data = await resp.json().catch(() => ({}));

        if (!resp.ok) {
          const err = data?.error || 'unknown_error';
          try { window.opener?.postMessage({ provider, success: false, error: err }, window.location.origin); } catch {}
          setStatus('error');
          setTimeout(() => window.close(), 800);
          return;
        }

        // Success
        try { window.opener?.postMessage({ provider, success: true }, window.location.origin); } catch {}
        setStatus('success');
        setTimeout(() => window.close(), 600);
      } catch (e) {
        try { window.opener?.postMessage({ provider, success: false, error: String(e) }, window.location.origin); } catch {}
        setStatus('error');
        setTimeout(() => window.close(), 800);
      }
    }

    completeFlow();
  }, [params]);

  return (
    <div style={{ 
      display: 'flex', 
      flexDirection: 'column',
      alignItems: 'center', 
      justifyContent: 'center', 
      height: '100vh',
      gap: 16
    }}>
      <Spin size="large" />
      <div>
        {status === 'pending' && 'Completing authorization...'}
        {status === 'success' && 'Authorization successful. Closing...'}
        {status === 'error' && 'Authorization failed. Closing...'}
      </div>
    </div>
  );
}
