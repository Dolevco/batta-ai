import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { MainLayout } from '../layout/MainLayout';
import PlannerTaskPage from './PlannerPage/PlannerTaskPage';
import { TasksPage } from './TasksPage';
import { TaskExecutionPage } from './TaskExecutionPage/TaskExecutionPage';
import { TaskRunHistoryPage } from './TaskRunHistoryPage';
import { IntegrationsPage } from './IntegrationsPage';
import { AgentsPage } from './AgentsPage';
import { AssetsPage } from './AssetsPage';
import { OverviewPage } from './OverviewPage';
import { AssetDetailsPage } from './AssetDetailsPage';
import { FeatureDetailsPage } from './FeatureDetailsPage';
import { SecurityReviewsPage } from './SecurityReviewsPage';
import { SecurityReviewDetailsPage } from './SecurityReviewDetailsPage';
import { PoliciesPage } from './PoliciesPage';
import { PolicyEditorPage } from './PolicyEditorPage';
import { OAuthCallbackPage } from './OAuthCallbackPage';
import { ChatPage } from './ChatPage';
import { LoginPage } from './LoginPage';
import { LandingPage } from './LandingPage';
import { ProtectedRoute } from '../components/ProtectedRoute';

export function App() {
  const navigate = useNavigate();
  const location = useLocation();

  // Determine selected menu based on current path
  const getSelectedMenu = () => {
    if (location.pathname.startsWith('/execution')) return 'execution';
    if (location.pathname.startsWith('/agents/tasks')) return 'agents:tasks';
    if (location.pathname.startsWith('/agents/history')) return 'agents:history';
    if (location.pathname.startsWith('/agents/chat')) return 'agents:chat';
    if (location.pathname.startsWith('/agents')) return 'agents:settings';
    if (location.pathname.startsWith('/knowledge-base/policies')) return 'knowledge-base:policies';
    if (location.pathname.startsWith('/knowledge-base/security-reviews')) return 'knowledge-base:security-reviews';
    if (location.pathname.startsWith('/knowledge-base/features')) return 'knowledge-base:assets';
    if (location.pathname.startsWith('/knowledge-base/assets')) return 'knowledge-base:assets';
    if (location.pathname.startsWith('/integrations')) return 'integrations';
    if (location.pathname.startsWith('/planner')) return 'planner';
    if (location.pathname === '/overview') return 'overview';
    return 'overview';
  };

  const handleMenuSelect = ({ key }: any) => {
    if (key === 'overview') navigate('/overview');
    else if (key === 'planner') navigate('/planner');
    else if (key === 'integrations') navigate('/integrations');
    else if (key === 'agents:settings') navigate('/agents');
    else if (key === 'agents:tasks') navigate('/agents/tasks');
    else if (key === 'agents:history') navigate('/agents/history');
    else if (key === 'agents:chat') navigate('/agents/chat');
    else if (key === 'knowledge-base:assets') navigate('/knowledge-base/assets');
    else if (key === 'knowledge-base:security-reviews') navigate('/knowledge-base/security-reviews');
    else if (key === 'knowledge-base:policies') navigate('/knowledge-base/policies');
    else if (key === 'execution') navigate('/execution');
  };

  return (
    <>
      <Routes>
        {/* Public routes - no layout */}
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        
        {/* Protected application routes */}
        <Route path="/*" element={
          <ProtectedRoute>
            <MainLayout selectedMenu={getSelectedMenu()} onSelect={handleMenuSelect}>
              <Routes>
                <Route path="/overview" element={<OverviewPage />} />
                <Route path="/oauth/:provider/callback" element={<OAuthCallbackPage />} />
                <Route path="/planner/:taskId" element={<PlannerTaskPage />} />

                {/* Agents and nested pages */}
                <Route path="/agents" element={<AgentsPage />} />
                <Route path="/agents/tasks" element={<TasksPage />} />
                <Route path="/agents/history" element={<TaskRunHistoryPage />} />
                <Route path="/agents/chat" element={<ChatPage />} />

                {/* Knowledge Base pages */}
                <Route path="/knowledge-base/assets" element={<AssetsPage />} />
                <Route path="/knowledge-base/assets/:assetId" element={<AssetDetailsPage />} />
                <Route path="/knowledge-base/features" element={<Navigate to="/knowledge-base/assets?tab=features" replace />} />
                <Route path="/knowledge-base/features/:featureId" element={<FeatureDetailsPage />} />
                <Route path="/knowledge-base/security-reviews" element={<SecurityReviewsPage />} />
                <Route path="/knowledge-base/security-reviews/:reviewId" element={<SecurityReviewDetailsPage />} />
                <Route path="/knowledge-base/policies" element={<PoliciesPage />} />
                <Route path="/knowledge-base/policies/:policyId" element={<PolicyEditorPage />} />

                <Route path="/integrations" element={<IntegrationsPage />} />

                <Route path="/execution/:taskId" element={<TaskExecutionPage />} />
              </Routes>
            </MainLayout>
          </ProtectedRoute>
        } />
      </Routes>
    </>
  );
}

export default App;
