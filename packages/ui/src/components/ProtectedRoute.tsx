import { Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { Spin } from 'antd';

export function ProtectedRoute({ children }: { children: JSX.Element }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <Spin size="large" />
      </div>
    );
  }

  if (isAuthenticated) return children;
  return <Navigate to="/login" replace />;
}
