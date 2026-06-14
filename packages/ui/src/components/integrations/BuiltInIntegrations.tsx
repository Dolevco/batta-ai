import { useState, useEffect } from 'react';
import { Row, Col, Button, Spin, message, Drawer, Form, Input } from 'antd';
import { T as TC } from '../../theme';
import { PlusOutlined, DeleteOutlined, CheckCircleOutlined, CloseCircleOutlined, ApiOutlined } from '@ant-design/icons';
import type { BuiltInIntegration, BuiltInIntegrationCategory, CustomIntegrationField } from '../../types';
import { useIntegrations, useBuiltInIntegrations } from '../../hooks';
import { useTheme } from '../../hooks/useTheme';
import MicrosoftIcon from '../icons/Microsoft';
import SlackIcon from '../icons/Slack';
import GitHubIcon from '../icons/GitHub';
import GitLabIcon from '../icons/GitLab';
import AWSIcon from '../icons/AWS';
import JiraIcon from '../icons/Jira';

// ── Build theme tokens based on dark/light mode ────────────────────────────────
function makeTokens(isDark: boolean) {
  return {
    orange: '#F97316',
    orangeLight: isDark ? 'rgba(249,115,22,0.15)' : '#FFF7ED',
    stone50: isDark ? '#1C1917' : '#FAFAF9',
    stone100: isDark ? '#292524' : '#F5F5F4',
    stone200: isDark ? '#3C3836' : '#E7E5E4',
    stone300: isDark ? '#57534E' : '#D6D3D1',
    stone400: isDark ? '#78716C' : '#A8A29E',
    stone500: isDark ? '#A8A29E' : '#78716C',
    stone600: isDark ? '#D6D3D1' : '#57534E',
    stone700: isDark ? '#E7E5E4' : '#44403C',
    stone800: isDark ? '#F5F5F4' : '#292524',
    stone900: isDark ? '#FAFAF9' : '#1C1917',
    white: isDark ? '#211F1E' : '#FFFFFF',
    red: '#DC2626',
    redLight: isDark ? 'rgba(220,38,38,0.15)' : '#FEF2F2',
    green: '#16A34A',
    greenLight: isDark ? 'rgba(22,163,74,0.15)' : '#F0FDF4',
    blue: '#2563EB',
    blueLight: isDark ? 'rgba(37,99,235,0.15)' : '#EFF6FF',
    purple: '#7C3AED',
    purpleLight: isDark ? 'rgba(124,58,237,0.15)' : '#F5F3FF',
  };
}

export function BuiltInIntegrations({ activeCategory }: { activeCategory: BuiltInIntegrationCategory }) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const T = makeTokens(isDark);
  const [integrations, setIntegrations] = useState<BuiltInIntegration[]>([]);
  const [loading, setLoading] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedIntegration, setSelectedIntegration] = useState<BuiltInIntegration | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [form] = Form.useForm();
  const [existingMap, setExistingMap] = useState<Record<string, string>>({});
  const [storedConfigMap, setStoredConfigMap] = useState<Record<string, Record<string, string>>>({});
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<{ valid: boolean; error?: string } | null>(null);

  // GitHub auth mode state (lives in the drawer)
  const [githubAuthMode, setGithubAuthMode] = useState<'select' | 'oauth' | 'token'>('select');
  const [githubTokenValue, setGithubTokenValue] = useState('');
  const [githubTokenLoading, setGithubTokenLoading] = useState(false);
  const [githubTokenError, setGithubTokenError] = useState('');

  const integrationsHook = useIntegrations();
  const builtInHook = useBuiltInIntegrations();

  const { createMCPIntegration, createCodeIntegration, createCustomIntegration, deleteMCPIntegration, getMCPIntegration, getCustomIntegration, deleteCustomIntegration, getAllIntegrations, getAllCustomIntegrations, configureGitHubToken } = integrationsHook;
  const { getBuiltInIntegrations, validateBuiltInIntegration } = builtInHook;

  // Helper to load built-in templates + stored integrations (used in multiple places)
  const loadIntegrations = async () => {
    setLoading(true);
    try {
      const [builtIns, all, customs] = await Promise.all([
        getBuiltInIntegrations ? getBuiltInIntegrations() : Promise.resolve([]),
        getAllIntegrations(),
        getAllCustomIntegrations(),
      ]);
      setIntegrations(builtIns || []);

      const map: Record<string, string> = {};
      const configMap: Record<string, Record<string, string>> = {};
      for (const integ of all) {
        const key = `${integ.type}:${integ.name}`;
        map[key] = integ.id;
        if (integ.config) configMap[key] = integ.config as Record<string, string>;
      }
      for (const c of customs) {
        const key = `${c.type}:${c.name}`;
        map[key] = c.id;
        if (c.config) configMap[key] = c.config as Record<string, string>;
      }
      setExistingMap(map);
      setStoredConfigMap(configMap);
    } catch {
      message.error('Failed to load built-in integrations');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadIntegrations();
  }, []);

  // Open OAuth in a popup window and wait for it to close, then refresh integrations
  const openPopupAndWait = (authorizeUrl: string, provider: string = 'oauth') => {
    const resolved = authorizeUrl.startsWith('http') ? authorizeUrl : `${window.location.origin}${authorizeUrl.startsWith('/') ? '' : '/'}${authorizeUrl}`;
    return new Promise<void>((resolve, reject) => {
      const popup = window.open(resolved, 'oauth_popup', 'width=600,height=700');
      if (!popup) {
        message.error('Popup blocked. Please allow popups or use the Connect button in the drawer.');
        reject(new Error('Popup blocked'));
        return;
      }

      const start = Date.now();
      const interval = window.setInterval(async () => {
        try {
          if (popup.closed) {
            window.clearInterval(interval);
            setTimeout(async () => {
              try {
                await loadIntegrations();
                message.success(`${provider} connected successfully!`);
                resolve();
              } catch (e) {
                reject(e);
              }
            }, 500);
          } else if (Date.now() - start > 2 * 60 * 1000) {
            try { popup.close(); } catch {}
            window.clearInterval(interval);
            reject(new Error('OAuth timeout'));
          }
        } catch {
          // ignore cross-origin access until the popup closes
        }
      }, 500);
    });
  };

  const handleAdd = async (integration: BuiltInIntegration) => {
    try {
      if (integration.type === 'mcp') {
        await createMCPIntegration({
          name: integration.name,
          description: integration.description,
          transport: 'command' in integration.config ? 'stdio' : 'http',
          config: integration.config as any,
          enabled: true,
        });
      } else {
        await createCodeIntegration({
          name: integration.name,
          description: integration.description,
          config: integration.config as any,
          enabled: true,
        });
      }
      message.success(`${integration.name} added successfully`);
      await loadIntegrations();
    } catch {
      message.error(`Failed to add ${integration.name}`);
    }
  };

  void handleAdd;

  const resetGithubAuthState = () => {
    setGithubAuthMode('select');
    setGithubTokenValue('');
    setGithubTokenError('');
    setGithubTokenLoading(false);
  };

  const openConfig = (integration: BuiltInIntegration) => {
    setSelectedIntegration(integration);
    setDrawerLoading(false);
    resetGithubAuthState();

    const initial: any = { name: integration.name, description: integration.description };

    if (integration.configSchema && Array.isArray(integration.configSchema)) {
      for (const field of integration.configSchema) {
        if (field.key) initial[field.key] = '';
      }
    } else if (integration.config && typeof integration.config === 'object') {
      for (const [k, v] of Object.entries(integration.config as Record<string, any>)) {
        if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) initial[k] = v;
        else initial[k] = JSON.stringify(v);
      }
    }

    form.setFieldsValue(initial);
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    setSelectedIntegration(null);
    form.resetFields();
    setValidationResult(null);
    setDrawerLoading(false);
    resetGithubAuthState();
  };

  const handleValidate = async () => {
    if (!selectedIntegration) return;

    try {
      const values = await form.validateFields();
      setValidating(true);
      setValidationResult(null);

      const config: any = {};
      if (selectedIntegration.configSchema && Array.isArray(selectedIntegration.configSchema)) {
        for (const field of selectedIntegration.configSchema) {
          config[field.key] = values[field.key];
        }
      }

      const result = await validateBuiltInIntegration(selectedIntegration.id, config);
      setValidationResult(result);

      if (result.valid) {
        message.success('Configuration validated successfully');
      }
    } catch (err: any) {
      if (err.errorFields) {
        message.error('Please fill in all required fields');
      } else {
        message.error('Validation failed');
      }
    } finally {
      setValidating(false);
    }
  };

  const handleCreateFromConfig = async (values: any) => {
    if (!selectedIntegration) return;

    if (validationResult && !validationResult.valid) {
      message.error('Please fix validation errors before adding the integration');
      return;
    }

    try {
      const baseConfig: any = {};

      if (selectedIntegration.configSchema && Array.isArray(selectedIntegration.configSchema)) {
        for (const field of selectedIntegration.configSchema) {
          const val = values[field.key];
          baseConfig[field.key] = val;
        }
      } else if (selectedIntegration.config && typeof selectedIntegration.config === 'object') {
        for (const key of Object.keys(selectedIntegration.config as Record<string, any>)) {
          const val = values[key];
          if (typeof val === 'string' && (val.trim().startsWith('{') || val.trim().startsWith('['))) {
            try {
              baseConfig[key] = JSON.parse(val);
            } catch {
              baseConfig[key] = val;
            }
          } else {
            baseConfig[key] = val;
          }
        }
      }

      const payloadName = values.name ?? selectedIntegration.name;
      const payloadDescription = values.description ?? selectedIntegration.description;

      if (selectedIntegration.type === 'mcp') {
        await createMCPIntegration({
          name: payloadName,
          description: payloadDescription,
          transport: 'command' in baseConfig ? 'stdio' : 'http',
          config: baseConfig,
          enabled: true,
        });
      } else if (selectedIntegration.type === 'custom') {
        await createCustomIntegration({
          name: payloadName,
          description: payloadDescription,
          config: Object.fromEntries(Object.entries(baseConfig).map(([k, v]) => [k, String(v ?? '')])),
          enabled: true,
        });
      } else {
        await createCodeIntegration({
          name: payloadName,
          description: payloadDescription,
          config: baseConfig,
          enabled: true,
        });
      }

      message.success(`${payloadName} added successfully`);
      await loadIntegrations();
      closeDrawer();
    } catch {
      message.error('Failed to create integration');
    }
  };

  const deleteExisting = async (integration: BuiltInIntegration) => {
    const key = `${integration.type}:${integration.name}`;
    const id = existingMap[key];
    if (!id) {
      message.error('Integration not found');
      return;
    }

    try {
      if (integration.type === 'mcp') {
        await deleteMCPIntegration(id);
      } else {
        await deleteCustomIntegration(id);
      }
      message.success(`${integration.name} removed`);
      await loadIntegrations();
    } catch {
      message.error('Failed to remove integration');
    }
  };

  const handleCardClick = async (integration: BuiltInIntegration) => {
    const key = `${integration.type}:${integration.name}`;
    const id = existingMap[key];

    if (!id) {
      openConfig(integration);
      return;
    }

    // Exists — load stored details and show in drawer
    try {
      setSelectedIntegration(integration);
      setDrawerOpen(true);
      setDrawerLoading(true);
      resetGithubAuthState();

      let stored: any = null;
      if (integration.type === 'mcp') {
        stored = await getMCPIntegration(id);
      } else {
        stored = await getCustomIntegration(id);
      }

      const combined: BuiltInIntegration = {
        ...integration,
        description: stored.description ?? integration.description,
        config: stored.config ?? integration.config,
      };

      setSelectedIntegration(combined);

      const initial: any = { name: combined.name, description: combined.description };
      if (combined.config && typeof combined.config === 'object') {
        for (const [k, v] of Object.entries(combined.config as Record<string, any>)) {
          if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) initial[k] = v;
          else initial[k] = JSON.stringify(v);
        }
      }

      form.setFieldsValue(initial);
      setDrawerLoading(false);
    } catch {
      message.error('Failed to load integration details');
      setDrawerLoading(false);
    }
  };

  const handleGithubTokenConnect = async () => {
    if (!githubTokenValue.trim()) {
      setGithubTokenError('Token is required');
      return;
    }
    setGithubTokenLoading(true);
    setGithubTokenError('');
    try {
      await configureGitHubToken(githubTokenValue.trim());
      await loadIntegrations();
      message.success('GitHub connected successfully!');
      closeDrawer();
    } catch (e: any) {
      setGithubTokenError(e?.message || 'Failed to configure token');
    } finally {
      setGithubTokenLoading(false);
    }
  };

  const filteredIntegrations = integrations.filter(
    (integration) =>
      activeCategory === 'all' || (integration.uiCategory ?? integration.category) === activeCategory
  );

  const getIntegrationIcon = (name?: string) => {
    if (!name) return <ApiOutlined />;
    const lower = name.toLowerCase();
    if (lower.includes('microsoft')) return <MicrosoftIcon />;
    if (lower.includes('slack')) return <SlackIcon />;
    if (lower.includes('github')) return <GitHubIcon />;
    if (lower.includes('gitlab')) return <GitLabIcon />;
    if (lower.includes('aws') || lower.includes('amazon')) return <AWSIcon />;
    if (lower.includes('jira')) return <JiraIcon />;
    return <ApiOutlined />;
  };

  const isConnected = (integration: BuiltInIntegration | null) =>
    integration ? Boolean(existingMap[`${integration.type}:${integration.name}`]) : false;

  const connectedLabel = (integration: BuiltInIntegration | null): string => {
    if (!integration) return '';
    const cfg = storedConfigMap[`${integration.type}:${integration.name}`];
    if (cfg?.authType === 'token') return `Connected via PAT · ${cfg.accountLogin || ''}`;
    if (cfg?.installationId) return `Connected via GitHub App · ${cfg.accountLogin || ''}`;
    return '';
  };

  // Renders the auth-mode section inside the drawer for integrations with authModes (GitHub)
  const renderAuthModes = (integration: BuiltInIntegration) => {
    const oauthMode = integration.authModes!.find(m => m.id === 'oauth');
    const connected = isConnected(integration);

    if (connected) {
      // Show which mode is active
      const label = connectedLabel(integration);
      return (
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${T.stone100}` }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: T.stone400, marginBottom: 8 }}>
            Authorization
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: T.green }}>
            <CheckCircleOutlined style={{ fontSize: 13 }} />
            <span>{label || 'Connected'}</span>
          </div>
        </div>
      );
    }

    if (githubAuthMode === 'select') {
      return (
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${T.stone100}` }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: T.stone400, marginBottom: 10 }}>
            Authorization
          </div>
          <p style={{ fontSize: 12, color: T.stone500, lineHeight: 1.6, margin: '0 0 12px' }}>
            Choose how to connect your GitHub account.
          </p>
          {integration.authModes!.map(mode => (
            <button
              key={mode.id}
              onClick={() => {
                if (mode.id === 'oauth' && oauthMode?.oauth?.authorizeUrl) {
                  openPopupAndWait(oauthMode.oauth.authorizeUrl, integration.name).catch((e: any) => {
                    message.error(e?.message || 'OAuth failed or timed out');
                  });
                  closeDrawer();
                } else {
                  setGithubAuthMode('token');
                }
              }}
              style={{
                width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                padding: '10px 12px', borderRadius: 8, marginBottom: 8, cursor: 'pointer',
                border: `1px solid ${T.stone200}`, background: T.stone100,
                textAlign: 'left', transition: 'border-color 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = T.orange}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = T.stone200}
            >
              <span style={{ fontSize: 12, fontWeight: 600, color: T.stone800 }}>{mode.label}</span>
              <span style={{ fontSize: 11, color: T.stone500, marginTop: 2 }}>{mode.description}</span>
            </button>
          ))}
        </div>
      );
    }

    if (githubAuthMode === 'token') {
      return (
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${T.stone100}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <button
              onClick={() => { setGithubAuthMode('select'); setGithubTokenError(''); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: T.stone400, fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}
            >
              ← Back
            </button>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: T.stone400 }}>
              Personal Access Token
            </span>
          </div>
          <p style={{ fontSize: 12, color: T.stone500, lineHeight: 1.6, margin: '0 0 10px' }}>
            Enter a GitHub PAT with <code>repo</code> scope.
          </p>
          <Input.Password
            value={githubTokenValue}
            onChange={e => setGithubTokenValue(e.target.value)}
            placeholder="ghp_…"
            size="small"
            disabled={githubTokenLoading}
            onPressEnter={handleGithubTokenConnect}
            style={{ marginBottom: githubTokenError ? 8 : 0 }}
          />
          {githubTokenError && (
            <div style={{
              marginTop: 8, padding: '6px 10px', borderRadius: 6,
              background: T.redLight, border: `1px solid ${T.red}33`,
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <CloseCircleOutlined style={{ color: T.red, fontSize: 12, flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: T.red }}>{githubTokenError}</span>
            </div>
          )}
        </div>
      );
    }

    return null;
  };

  // Determine footer buttons for the drawer
  const renderFooter = () => {
    if (!selectedIntegration) return null;
    const connected = isConnected(selectedIntegration);
    const hasAuthModes = Boolean(selectedIntegration.authModes?.length);

    return (
      <div style={{
        padding: '12px 16px', borderTop: `1px solid ${T.stone200}`,
        display: 'flex', justifyContent: 'flex-end', gap: 8, flexShrink: 0,
      }}>
        <Button onClick={closeDrawer} style={{ borderRadius: 6 }}>Cancel</Button>

        {connected ? (
          <Button
            danger
            style={{ borderRadius: 6 }}
            onClick={async () => { await deleteExisting(selectedIntegration); closeDrawer(); }}
          >
            Remove
          </Button>
        ) : hasAuthModes ? (
          githubAuthMode === 'token' ? (
            <Button
              type="primary"
              style={{ borderRadius: 6 }}
              loading={githubTokenLoading}
              onClick={handleGithubTokenConnect}
            >
              Connect
            </Button>
          ) : null
        ) : !selectedIntegration.oauth ? (
          <Button
            type="primary"
            style={{ borderRadius: 6 }}
            onClick={validationResult && validationResult.valid ? () => form.submit() : handleValidate}
            loading={validating}
          >
            {validationResult && validationResult.valid ? 'Add Integration' : 'Validate'}
          </Button>
        ) : null}
      </div>
    );
  };

  return (
    <div>
      <Spin spinning={loading}>
        <Row gutter={[16, 16]}>

          {filteredIntegrations.map((integration) => (
            <Col key={integration.id} xs={24} sm={24} md={12} lg={12} xl={8}>
              <div
                onClick={() => handleCardClick(integration)}
                style={{
                  height: 160, borderRadius: 12, position: 'relative', cursor: 'pointer',
                  background: T.white, border: `1px solid ${T.stone200}`,
                  boxShadow: '0 1px 3px rgba(28,25,23,0.06)',
                  padding: 14, display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
                  transition: 'border-color 0.15s, box-shadow 0.15s',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.borderColor = T.orange;
                  (e.currentTarget as HTMLElement).style.boxShadow = `0 0 0 3px ${T.orangeLight}`;
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.borderColor = T.stone200;
                  (e.currentTarget as HTMLElement).style.boxShadow = '0 1px 3px rgba(28,25,23,0.06)';
                }}
              >
                {/* Top-right action button */}
                <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 2, zIndex: 2 }}>
                  {existingMap[`${integration.type}:${integration.name}`] ? (
                    <button
                      onClick={e => { e.stopPropagation(); deleteExisting(integration); }}
                      title={`Delete ${integration.name}`}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px', borderRadius: 6, color: T.stone400, display: 'flex', alignItems: 'center', transition: 'color 0.15s' }}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = T.red}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = T.stone400}
                    >
                      <DeleteOutlined style={{ fontSize: 13 }} />
                    </button>
                  ) : (
                    <button
                      onClick={e => { e.stopPropagation(); openConfig(integration); }}
                      title={`Configure ${integration.name}`}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px', borderRadius: 6, color: T.stone400, display: 'flex', alignItems: 'center', transition: 'color 0.15s' }}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = T.orange}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = T.stone400}
                    >
                      <PlusOutlined style={{ fontSize: 13 }} />
                    </button>
                  )}
                </div>

                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 10, flexShrink: 0, background: T.stone100, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: T.stone600 }}>{getIntegrationIcon(integration.name)}</span>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: T.stone800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: 52 }}>
                      {integration.name}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                      <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 99, background: integration.category === 'security' ? TC.orangeLight : T.blueLight, color: integration.category === 'security' ? T.orange : T.blue }}>
                        {integration.category}
                      </span>
                      <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 99, background: T.stone100, color: T.stone500 }}>
                        {integration.type === 'custom' ? 'Built-in' : integration.type.toUpperCase()}
                      </span>
                      {(integration.oauth || integration.authModes?.length) && (
                        <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 99, background: T.greenLight, color: T.green }}>OAuth</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Description */}
                <div style={{ fontSize: 11, color: T.stone500, lineHeight: 1.5, flex: 1, margin: '8px 0', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any }}>
                  {integration.description}
                </div>

                {/* Footer */}
                <div style={{ fontSize: 10, color: T.stone400 }}>
                  {(() => {
                    const cfg = storedConfigMap[`${integration.type}:${integration.name}`];
                    if (cfg?.authType === 'token') return `Connected via PAT · ${cfg.accountLogin || ''}`;
                    if (cfg?.installationId) return `Connected via GitHub App · ${cfg.accountLogin || ''}`;
                    return 'Pre-configured • Verified';
                  })()}
                </div>
              </div>
            </Col>
          ))}
        </Row>
      </Spin>

      {/* Configuration drawer */}
      <Drawer
        title={null}
        width={400}
        placement="right"
        onClose={closeDrawer}
        open={drawerOpen}
        destroyOnClose
        styles={{ body: { padding: 0, display: 'flex', flexDirection: 'column', height: '100%' } }}
      >
        {drawerLoading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 220 }}>
            <Spin size="large" />
          </div>
        ) : (
          <Form layout="vertical" form={form} onFinish={handleCreateFromConfig} style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

            {/* ── Panel header ── */}
            <div style={{ padding: '16px 16px 14px', borderBottom: `1px solid ${T.stone200}`, flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 10, flexShrink: 0,
                  background: T.stone100, border: `1px solid ${T.stone200}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
                  color: T.stone600,
                }}>
                  {getIntegrationIcon(selectedIntegration?.name)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: T.stone900, letterSpacing: '-0.01em', marginBottom: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {selectedIntegration?.name}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {selectedIntegration?.category && (
                      <span style={{
                        fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 99,
                        background: selectedIntegration.category === 'security' ? T.orangeLight : T.blueLight,
                        color: selectedIntegration.category === 'security' ? T.orange : T.blue,
                      }}>
                        {selectedIntegration.category}
                      </span>
                    )}
                    {selectedIntegration?.type && (
                      <span style={{
                        fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 99,
                        background: T.stone100, color: T.stone500,
                      }}>
                        {selectedIntegration.type === 'custom' ? 'Built-in' : selectedIntegration.type.toUpperCase()}
                      </span>
                    )}
                    {(selectedIntegration?.oauth || selectedIntegration?.authModes?.length) && (
                      <span style={{
                        fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 99,
                        background: T.greenLight, color: T.green,
                      }}>
                        OAuth
                      </span>
                    )}
                    {selectedIntegration && isConnected(selectedIntegration) && (
                      <span style={{
                        fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 99,
                        background: T.greenLight, color: T.green,
                        display: 'inline-flex', alignItems: 'center', gap: 3,
                      }}>
                        <CheckCircleOutlined style={{ fontSize: 9 }} /> Connected
                      </span>
                    )}
                  </div>
                </div>
                {/* Close button */}
                <button
                  onClick={closeDrawer}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', borderRadius: 6, color: T.stone400, fontSize: 16, flexShrink: 0, lineHeight: 1 }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = T.stone700}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = T.stone400}
                >
                  ×
                </button>
              </div>

              {selectedIntegration?.description && (
                <p style={{ margin: '10px 0 0', fontSize: 12, color: T.stone500, lineHeight: 1.6 }}>
                  {selectedIntegration.description}
                </p>
              )}
            </div>

            {/* ── Scrollable body ── */}
            <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>

              {/* Validation result */}
              {validationResult && (
                <div style={{ padding: '12px 16px', borderBottom: `1px solid ${T.stone100}` }}>
                  <div style={{
                    padding: '10px 12px', borderRadius: 8,
                    background: validationResult.valid ? T.greenLight : T.redLight,
                    border: `1px solid ${validationResult.valid ? TC.greenBorder : TC.redBorder}`,
                    display: 'flex', alignItems: 'flex-start', gap: 8,
                  }}>
                    <span style={{ color: validationResult.valid ? T.green : T.red, fontSize: 14, flexShrink: 0, marginTop: 1 }}>
                      {validationResult.valid ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
                    </span>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: validationResult.valid ? T.green : T.red, marginBottom: 2 }}>
                        {validationResult.valid ? 'Configuration valid' : 'Configuration invalid'}
                      </div>
                      {!validationResult.valid && validationResult.error && (
                        <div style={{ fontSize: 11, color: T.red, lineHeight: 1.5 }}>{validationResult.error}</div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Auth modes section (GitHub and similar multi-mode integrations) */}
              {selectedIntegration?.authModes?.length && renderAuthModes(selectedIntegration)}

              {/* OAuth section (single-mode OAuth integrations like Slack) */}
              {selectedIntegration && selectedIntegration.oauth && !selectedIntegration.authModes?.length && (
                <div style={{ padding: '12px 16px', borderBottom: `1px solid ${T.stone100}` }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: T.stone400, marginBottom: 8 }}>
                    Authorization
                  </div>
                  <p style={{ fontSize: 12, color: T.stone500, lineHeight: 1.6, margin: '0 0 12px' }}>
                    Connect via OAuth to enable this integration&apos;s tools.
                  </p>
                  <Button
                    type="primary"
                    onClick={async () => {
                      try {
                        await openPopupAndWait(selectedIntegration.oauth!.authorizeUrl, selectedIntegration.name);
                      } catch (e: any) {
                        message.error(e?.message || 'Consent failed or timed out');
                      }
                    }}
                    disabled={isConnected(selectedIntegration)}
                    style={{ borderRadius: 6 }}
                  >
                    Connect
                  </Button>
                </div>
              )}

              {/* Config fields from schema */}
              {selectedIntegration && selectedIntegration.configSchema && Array.isArray(selectedIntegration.configSchema) && selectedIntegration.configSchema.length > 0 && (
                <div style={{ padding: '12px 16px', borderBottom: `1px solid ${T.stone100}` }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: T.stone400, marginBottom: 12 }}>
                    Configuration
                  </div>
                  {selectedIntegration.configSchema.map((field: CustomIntegrationField) => (
                    <Form.Item
                      key={field.key}
                      name={field.key}
                      label={<span style={{ fontSize: 11, fontWeight: 600, color: T.stone700 }}>{field.displayName}</span>}
                      rules={field.required ? [{ required: true, message: `${field.displayName} is required` }] : []}
                      extra={field.description ? <span style={{ fontSize: 11, color: T.stone400 }}>{field.description}</span> : undefined}
                      style={{ marginBottom: 12 }}
                    >
                      {field.type === 'password' ? (
                        <Input.Password placeholder={field.placeholder} size="small" />
                      ) : field.type === 'textarea' ? (
                        <Input.TextArea placeholder={field.placeholder} rows={3} size="small" />
                      ) : (
                        <Input placeholder={field.placeholder} size="small" />
                      )}
                    </Form.Item>
                  ))}
                </div>
              )}

              {/* Config fields from raw config object */}
              {selectedIntegration && (!selectedIntegration.configSchema || !Array.isArray(selectedIntegration.configSchema) || selectedIntegration.configSchema.length === 0) && !selectedIntegration.authModes?.length && selectedIntegration.config && typeof selectedIntegration.config === 'object' && (
                <div style={{ padding: '12px 16px', borderBottom: `1px solid ${T.stone100}` }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: T.stone400, marginBottom: 12 }}>
                    Configuration
                  </div>
                  {Object.entries(selectedIntegration.config as Record<string, any>).map(([key, val]) => (
                    <Form.Item
                      key={key}
                      name={key}
                      label={<span style={{ fontSize: 11, fontWeight: 600, color: T.stone700 }}>{key.replace(/_/g, ' ')}</span>}
                      style={{ marginBottom: 12 }}
                    >
                      {typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean' ? (
                        <Input size="small" />
                      ) : (
                        <Input.TextArea rows={3} size="small" />
                      )}
                    </Form.Item>
                  ))}
                </div>
              )}

              {/* Details section */}
              <div style={{ padding: '12px 16px' }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: T.stone400, marginBottom: 4 }}>
                  Details
                </div>
                <div style={{ display: 'flex', alignItems: 'center', padding: '6px 0', borderBottom: `1px solid ${T.stone100}` }}>
                  <span style={{ fontSize: 11, color: T.stone400, minWidth: 100, flexShrink: 0 }}>Type</span>
                  <span style={{ fontSize: 11, color: T.stone700 }}>{selectedIntegration?.type === 'custom' ? 'Built-in' : selectedIntegration?.type?.toUpperCase()}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', padding: '6px 0', borderBottom: `1px solid ${T.stone100}` }}>
                  <span style={{ fontSize: 11, color: T.stone400, minWidth: 100, flexShrink: 0 }}>Category</span>
                  <span style={{ fontSize: 11, color: T.stone700, textTransform: 'capitalize' }}>{selectedIntegration?.category || '—'}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', padding: '6px 0' }}>
                  <span style={{ fontSize: 11, color: T.stone400, minWidth: 100, flexShrink: 0 }}>Verified</span>
                  <span style={{ fontSize: 11, color: T.green, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <CheckCircleOutlined style={{ fontSize: 11 }} /> Pre-configured
                  </span>
                </div>
              </div>

            </div>

            {/* ── Footer actions ── */}
            {renderFooter()}

          </Form>
        )}
      </Drawer>
    </div>
  );
}
