import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { MainLayout } from '../components/layout/MainLayout';
import { ProtectedRoute } from '../components/auth/ProtectedRoute';
import { IntegrationsPage } from './integrations/IntegrationsPage';
import { AssetsPage } from './assets/AssetsPage';
import { AssetDetailsPage } from './assets/AssetDetailsPage';
import { FeatureDetailsPage } from './features/FeatureDetailsPage';
import { SecurityReviewsPage } from './security-reviews/SecurityReviewsPage';
import { SecurityReviewDetailsPage } from './security-reviews/SecurityReviewDetailsPage';
import { PoliciesPage } from './policies/PoliciesPage';
import { PolicyEditorPage } from './policies/PolicyEditorPage';
import { OAuthCallbackPage } from './OAuthCallbackPage';
import { ChatPage } from './chat/ChatPage';
import { LoginPage } from './LoginPage';
import { DataStoreDetailsPage } from './data-stores/DataStoreDetailsPage';
import { OnboardingPage } from './onboarding/OnboardingPage';
import { useCapabilities } from '../hooks/useCapabilities';

function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const { capabilities } = useCapabilities();

  const getSelectedMenu = () => {
    if (location.pathname.startsWith('/knowledge-base/policies')) return 'knowledge-base:policies';
    if (location.pathname.startsWith('/knowledge-base/security-reviews')) return 'knowledge-base:security-reviews';
    if (location.pathname.startsWith('/knowledge-base/assets')) return 'knowledge-base:assets';
    if (location.pathname.startsWith('/onboarding')) return 'onboarding';
    if (location.pathname.startsWith('/chat')) return 'chat';
    if (location.pathname.startsWith('/integrations')) return 'integrations';
    return 'knowledge-base:assets';
  };

  const handleMenuSelect = ({ key }: { key: string }) => {
    if (key === 'integrations') navigate('/integrations');
    else if (key === 'onboarding') navigate('/onboarding');
    else if (key === 'chat') navigate('/chat');
    else if (key === 'knowledge-base:assets') navigate('/knowledge-base/assets');
    else if (key === 'knowledge-base:security-reviews') navigate('/knowledge-base/security-reviews');
    else if (key === 'knowledge-base:policies') navigate('/knowledge-base/policies');
  };

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route path="/*" element={
        <ProtectedRoute>
          <MainLayout selectedMenu={getSelectedMenu()} onSelect={handleMenuSelect} capabilities={capabilities}>
            <Routes>
              <Route path="/oauth/:provider/callback" element={<OAuthCallbackPage />} />

              <Route path="/chat" element={<ChatPage />} />
              <Route path="/onboarding" element={<OnboardingPage />} />
              <Route path="/agents/chat" element={<Navigate to="/chat" replace />} />

              <Route path="/knowledge-base/assets" element={<AssetsPage />} />
              <Route path="/knowledge-base/assets/:assetId" element={<AssetDetailsPage />} />
              <Route path="/knowledge-base/features/:featureId" element={<FeatureDetailsPage />} />
              <Route path="/knowledge-base/data-stores/:storeId" element={<DataStoreDetailsPage />} />
              <Route path="/knowledge-base/security-reviews" element={<SecurityReviewsPage />} />
              <Route path="/knowledge-base/security-reviews/:reviewId" element={<SecurityReviewDetailsPage />} />
              <Route path="/knowledge-base/policies" element={<PoliciesPage />} />
              <Route path="/knowledge-base/policies/:policyId" element={<PolicyEditorPage />} />

              <Route path="/integrations" element={<IntegrationsPage />} />

              <Route path="*" element={<Navigate to="/onboarding" replace />} />
            </Routes>
          </MainLayout>
        </ProtectedRoute>
      } />
    </Routes>
  );
}

export default App;
