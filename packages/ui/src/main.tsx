import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import Clarity from '@microsoft/clarity';

// Initialize Microsoft Clarity analytics.
// PII masking: add data-clarity-mask attribute to any element that should be redacted
// in session replays (e.g. inputs containing sensitive data).
Clarity.init('vx7ws8b92c');
import { ConfigProvider, theme as antdTheme } from 'antd';
import { AuthProvider } from './hooks/useAuth';
import { ThemeProvider, useTheme } from './hooks/useTheme';
import { ChatHistoryProvider } from './hooks/useChatHistory';
import App from './pages/App';
import { antdTokens } from './theme';
import './index.css';

function Root() {
  return (
    <ThemeProvider>
      <ThemedApp />
    </ThemeProvider>
  );
}

function ThemedApp() {
  const { theme } = useTheme();
  
  return (
    <ConfigProvider
      theme={{
        algorithm: theme === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: antdTokens,
      }}
    >
      <AuthProvider>
        <ChatHistoryProvider>
          <App />
        </ChatHistoryProvider>
      </AuthProvider>
    </ConfigProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Root />
    </BrowserRouter>
  </StrictMode>
);
