import { useState, useEffect, useCallback } from 'react';
import { useIntegrations } from '../../hooks';
import { T as TC } from '../../theme';
import { useTheme } from '../../hooks/useTheme';
import { Row, Col, Form, Input, Select, Switch, message, Drawer, Collapse } from 'antd';
import {
  PlusOutlined,
  ApiOutlined,
  EditOutlined,
  DeleteOutlined,
  CloseCircleOutlined,
  ThunderboltOutlined,
  LoadingOutlined,
} from '@ant-design/icons';
import type {
  MCPIntegration,
  CreateMCPIntegrationRequest,
  UpdateMCPIntegrationRequest,
  MCPHttpConfig,
  MCPStdioConfig,
  DockerMCPServer,
  MCPIntegrationDetails,
} from '../../types';

// ── Design tokens ──────────────────────────────────────────────────────────────
type Tokens = ReturnType<typeof makeTokens>;

function makeTokens(isDark: boolean) {
  return {
    orange: '#F97316',
    orangeLight: isDark ? 'rgba(249,115,22,0.15)' : '#FFF7ED',
    orangeBorder: isDark ? '#C2410C' : '#FDBA74',
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

const { TextArea } = Input;

// ── MCP card ──────────────────────────────────────────────────────────────────

function MCPCard({
  integration,
  onEdit,
  onDelete,
  onClick,
  T,
}: {
  integration: MCPIntegration;
  onEdit: (i: MCPIntegration) => void;
  onDelete: (id: string) => void;
  onClick: (i: MCPIntegration) => void;
  T: Tokens;
}) {
  const isHttp = integration.transport === 'http';
  const configSummary = isHttp
    ? ('url' in integration.config ? (integration.config as any).url : '')
    : ('command' in integration.config ? (integration.config as any).command : '');

  return (
    <div
      onClick={() => onClick(integration)}
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
      {/* Top-right action buttons */}
      <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 2, zIndex: 2 }}>
        <button
          onClick={e => { e.stopPropagation(); onEdit(integration); }}
          title="Edit"
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px', borderRadius: 6, color: T.stone400, display: 'flex', alignItems: 'center', transition: 'color 0.15s' }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = T.stone700}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = T.stone400}
        >
          <EditOutlined style={{ fontSize: 13 }} />
        </button>
        <button
          onClick={e => { e.stopPropagation(); onDelete(integration.id); }}
          title="Delete"
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px', borderRadius: 6, color: T.stone400, display: 'flex', alignItems: 'center', transition: 'color 0.15s' }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = T.red}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = T.stone400}
        >
          <DeleteOutlined style={{ fontSize: 13 }} />
        </button>
      </div>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 10, flexShrink: 0,
          background: T.purpleLight, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <ApiOutlined style={{ fontSize: 18, color: T.purple }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: T.stone800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: 52 }}>
            {integration.name}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
            <span style={{
              fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 99,
              background: isHttp ? T.blueLight : T.purpleLight,
              color: isHttp ? T.blue : T.purple,
            }}>
              {integration.transport.toUpperCase()}
            </span>
            <span style={{
              fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 99,
              background: integration.enabled ? T.greenLight : T.stone100,
              color: integration.enabled ? T.green : T.stone400,
            }}>
              {integration.enabled ? 'Enabled' : 'Disabled'}
            </span>
          </div>
        </div>
      </div>

      {/* Description */}
      <div style={{ fontSize: 11, color: T.stone500, lineHeight: 1.5, flex: 1, margin: '8px 0', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any }}>
        {integration.description || configSummary || 'MCP server integration'}
      </div>

      {/* Footer */}
      <div style={{ fontSize: 10, color: T.stone400 }}>
        MCP Server
        {configSummary && <span style={{ marginLeft: 6, color: T.stone300 }}>• {configSummary.slice(0, 32)}{configSummary.length > 32 ? '…' : ''}</span>}
      </div>
    </div>
  );
}

// ── Empty state for MCP ───────────────────────────────────────────────────────

function MCPEmptyState({ onAdd, T }: { onAdd: () => void; T: Tokens }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 0', gap: 14 }}>
      <div style={{ width: 64, height: 64, borderRadius: '50%', background: T.stone100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <ApiOutlined style={{ fontSize: 24, color: T.stone300 }} />
      </div>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: T.stone800, marginBottom: 4 }}>No MCP servers configured</div>
        <div style={{ fontSize: 13, color: T.stone400, maxWidth: 320, lineHeight: 1.6 }}>
          Connect to Model Context Protocol servers via HTTP or STDIO to extend your AI agent&apos;s capabilities.
        </div>
      </div>
      <button
        onClick={onAdd}
        style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 20px', borderRadius: 10, border: 'none', background: T.orange, color: T.white, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
      >
        <PlusOutlined /> Add MCP Server
      </button>
    </div>
  );
}

// ── Details drawer ────────────────────────────────────────────────────────────

function MCPDetailsDrawer({
  open,
  loading,
  integration,
  onClose,
  T,
}: {
  open: boolean;
  loading: boolean;
  integration: MCPIntegrationDetails | null;
  onClose: () => void;
  T: Tokens;
}) {
  if (!open) return null;

  const statusColor = integration?.connectionStatus === 'connected' ? T.green
    : integration?.connectionStatus === 'error' ? T.red : T.stone400;
  const statusBg = integration?.connectionStatus === 'connected' ? T.greenLight
    : integration?.connectionStatus === 'error' ? T.redLight : T.stone100;
  const statusBorder = integration?.connectionStatus === 'connected' ? TC.greenBorder
    : integration?.connectionStatus === 'error' ? TC.redBorder : T.stone200;
  const statusLabel = integration?.connectionStatus === 'connected' ? 'Connected'
    : integration?.connectionStatus === 'error' ? 'Error' : 'Disconnected';

  return (
    <Drawer
      title={null}
      placement="right"
      width={480}
      onClose={onClose}
      open={open}
      styles={{ body: { padding: 0, display: 'flex', flexDirection: 'column', height: '100%' } }}
    >
      {/* ── Panel header ── */}
      <div style={{ padding: '16px 16px 14px', borderBottom: `1px solid ${T.stone200}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 10, flexShrink: 0,
            background: T.purpleLight, border: `1px solid ${TC.purpleBorder}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <ApiOutlined style={{ fontSize: 20, color: T.purple }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: T.stone900, letterSpacing: '-0.01em', marginBottom: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {integration?.name ?? 'MCP Server'}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {integration && (
                <span style={{
                  fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 99,
                  background: integration.transport === 'http' ? T.blueLight : T.purpleLight,
                  color: integration.transport === 'http' ? T.blue : T.purple,
                }}>
                  {integration.transport.toUpperCase()}
                </span>
              )}
              {integration && (
                <span style={{
                  fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 99,
                  background: integration.enabled ? T.greenLight : T.stone100,
                  color: integration.enabled ? T.green : T.stone400,
                }}>
                  {integration.enabled ? 'Enabled' : 'Disabled'}
                </span>
              )}
              {integration && (
                <span style={{
                  fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 99,
                  background: statusBg, color: statusColor, border: `1px solid ${statusBorder}`,
                }}>
                  {statusLabel}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', borderRadius: 6, color: T.stone400, fontSize: 16, flexShrink: 0, lineHeight: 1 }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = T.stone700}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = T.stone400}
          >
            ×
          </button>
        </div>
        {integration?.description && (
          <p style={{ margin: '10px 0 0', fontSize: 12, color: T.stone500, lineHeight: 1.6 }}>
            {integration.description}
          </p>
        )}
      </div>

      {/* ── Scrollable body ── */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 200 }}>
            <LoadingOutlined style={{ fontSize: 28, color: T.orange }} />
          </div>
        ) : integration ? (
          <>
            {/* Error banner */}
            {integration.error && (
              <div style={{ padding: '12px 16px', borderBottom: `1px solid ${T.stone100}` }}>
                <div style={{
                  padding: '10px 12px', borderRadius: 8,
                  background: T.redLight, border: `1px solid ${TC.redBorder}`,
                  display: 'flex', alignItems: 'flex-start', gap: 8,
                }}>
                  <CloseCircleOutlined style={{ color: T.red, fontSize: 14, flexShrink: 0, marginTop: 1 }} />
                  <div style={{ fontSize: 11, color: T.red, lineHeight: 1.5 }}>{integration.error}</div>
                </div>
              </div>
            )}

            {/* Configuration section */}
            <div style={{ padding: '12px 16px', borderBottom: `1px solid ${T.stone100}` }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: T.stone400, marginBottom: 4 }}>
                Configuration
              </div>
              {integration.transport === 'http' && 'url' in integration.config && (
                <div style={{ display: 'flex', alignItems: 'flex-start', padding: '6px 0', borderBottom: `1px solid ${T.stone100}` }}>
                  <span style={{ fontSize: 11, color: T.stone400, minWidth: 80, flexShrink: 0 }}>URL</span>
                  <span style={{ fontSize: 11, color: T.stone700, fontFamily: 'monospace', wordBreak: 'break-all' }}>{(integration.config as any).url}</span>
                </div>
              )}
              {integration.transport === 'stdio' && 'command' in integration.config && (
                <>
                  <div style={{ display: 'flex', alignItems: 'flex-start', padding: '6px 0', borderBottom: `1px solid ${T.stone100}` }}>
                    <span style={{ fontSize: 11, color: T.stone400, minWidth: 80, flexShrink: 0 }}>Command</span>
                    <span style={{ fontSize: 11, color: T.stone700, fontFamily: 'monospace' }}>{(integration.config as any).command}</span>
                  </div>
                  {(integration.config as any).args?.length > 0 && (
                    <div style={{ display: 'flex', alignItems: 'flex-start', padding: '6px 0', borderBottom: `1px solid ${T.stone100}` }}>
                      <span style={{ fontSize: 11, color: T.stone400, minWidth: 80, flexShrink: 0 }}>Args</span>
                      <span style={{ fontSize: 11, color: T.stone700, fontFamily: 'monospace' }}>{(integration.config as any).args.join(', ')}</span>
                    </div>
                  )}
                </>
              )}
              <div style={{ display: 'flex', alignItems: 'center', padding: '6px 0' }}>
                <span style={{ fontSize: 11, color: T.stone400, minWidth: 80, flexShrink: 0 }}>Transport</span>
                <span style={{ fontSize: 11, color: T.stone700 }}>{integration.transport.toUpperCase()}</span>
              </div>
            </div>

            {/* Tools section */}
            <div style={{ padding: '12px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: T.stone400 }}>
                  Available Tools
                </span>
                <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 99, background: T.stone100, color: T.stone500 }}>
                  {integration.tools?.length ?? 0}
                </span>
              </div>
              {integration.tools && integration.tools.length > 0 ? (
                <Collapse
                  size="small"
                  style={{ background: 'transparent', border: `1px solid ${T.stone200}`, borderRadius: 10, overflow: 'hidden' }}
                  items={integration.tools.map((tool, i) => ({
                    key: i.toString(),
                    label: <span style={{ fontSize: 12, fontWeight: 600, color: T.stone800 }}>{tool.name}</span>,
                    children: (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {tool.description && <div style={{ fontSize: 12, color: T.stone500, lineHeight: 1.5 }}>{tool.description}</div>}
                        {tool.inputSchema?.properties && Object.entries(tool.inputSchema.properties).map(([key, val]: [string, any]) => (
                          <div key={key} style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                            <span style={{ fontSize: 11, fontFamily: 'monospace', background: T.stone100, color: T.stone700, padding: '1px 6px', borderRadius: 4, flexShrink: 0 }}>{key}</span>
                            {tool.inputSchema?.required?.includes(key) && (
                              <span style={{ fontSize: 10, color: T.red, background: T.redLight, padding: '1px 5px', borderRadius: 99, flexShrink: 0 }}>required</span>
                            )}
                            <span style={{ fontSize: 11, color: T.stone400 }}>{val.description || val.type}</span>
                          </div>
                        ))}
                      </div>
                    ),
                  }))}
                />
              ) : (
                <div style={{ padding: 16, background: T.stone50, borderRadius: 10, border: `1px solid ${T.stone200}`, fontSize: 12, color: T.stone400, textAlign: 'center' }}>
                  No tools available or could not connect to retrieve them.
                </div>
              )}
            </div>
          </>
        ) : null}
      </div>
    </Drawer>
  );
}

// ── Add/Edit modal (styled) ───────────────────────────────────────────────────

function MCPFormDrawer({
  open,
  editingIntegration,
  onClose,
  onSubmit,
  T,
}: {
  open: boolean;
  editingIntegration: MCPIntegration | null;
  onClose: () => void;
  onSubmit: (values: any) => Promise<void>;
  T: Tokens;
}) {
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const transportType = Form.useWatch('transport', form);
  const isEdit = !!editingIntegration;

  useEffect(() => {
    if (open) {
      if (editingIntegration) {
        form.setFieldsValue({
          name: editingIntegration.name,
          description: editingIntegration.description,
          transport: editingIntegration.transport,
          enabled: editingIntegration.enabled,
          ...editingIntegration.config,
        });
      } else {
        form.resetFields();
        form.setFieldsValue({ transport: 'http', enabled: true });
      }
    }
  }, [open, editingIntegration]);

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      await onSubmit(values);
    } catch {
      // validation error shown inline
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Drawer
      title={null}
      placement="right"
      width={440}
      onClose={onClose}
      open={open}
      destroyOnClose
      styles={{ body: { padding: 0, display: 'flex', flexDirection: 'column', height: '100%' } }}
    >
      <Form form={form} layout="vertical" onFinish={onSubmit} style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

        {/* ── Panel header ── */}
        <div style={{ padding: '16px 16px 14px', borderBottom: `1px solid ${T.stone200}`, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 44, height: 44, borderRadius: 10, flexShrink: 0,
              background: T.purpleLight, border: `1px solid ${TC.purpleBorder}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <ApiOutlined style={{ fontSize: 20, color: T.purple }} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: T.stone900, letterSpacing: '-0.01em', marginBottom: 4 }}>
                {isEdit ? 'Edit MCP Server' : 'Add MCP Server'}
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 99, background: T.purpleLight, color: T.purple }}>MCP</span>
                {isEdit && <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 99, background: T.stone100, color: T.stone500 }}>Editing</span>}
              </div>
            </div>
            <button
              onClick={onClose}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', borderRadius: 6, color: T.stone400, fontSize: 16, flexShrink: 0, lineHeight: 1 }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = T.stone700}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = T.stone400}
            >
              ×
            </button>
          </div>
        </div>

        {/* ── Scrollable body ── */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>

          {/* Basic info section */}
          <div style={{ padding: '12px 16px', borderBottom: `1px solid ${T.stone100}` }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: T.stone400, marginBottom: 12 }}>
              Basic Info
            </div>
            <Form.Item name="name" label={<span style={{ fontSize: 11, fontWeight: 600, color: T.stone700 }}>Name</span>} rules={[{ required: true, message: 'Please enter a name' }]} style={{ marginBottom: 12 }}>
              <Input placeholder="e.g., GitHub MCP Server" size="small" />
            </Form.Item>
            <Form.Item name="description" label={<span style={{ fontSize: 11, fontWeight: 600, color: T.stone700 }}>Description</span>} style={{ marginBottom: 12 }}>
              <TextArea rows={2} placeholder="Brief description of this integration" size="small" />
            </Form.Item>
            <Form.Item name="transport" label={<span style={{ fontSize: 11, fontWeight: 600, color: T.stone700 }}>Transport Type</span>} rules={[{ required: true }]} style={{ marginBottom: 0 }}>
              <Select disabled={isEdit} size="small">
                <Select.Option value="http">HTTP</Select.Option>
                <Select.Option value="stdio">STDIO</Select.Option>
              </Select>
            </Form.Item>
          </div>

          {/* Transport-specific config section */}
          <div style={{ padding: '12px 16px', borderBottom: `1px solid ${T.stone100}` }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: T.stone400, marginBottom: 12 }}>
              Connection
            </div>
            {transportType === 'http' || !transportType ? (
              <>
                <Form.Item name="url" label={<span style={{ fontSize: 11, fontWeight: 600, color: T.stone700 }}>URL</span>} rules={[{ required: true, message: 'Please enter URL' }]} style={{ marginBottom: 12 }}>
                  <Input placeholder="https://api.example.com/mcp" size="small" />
                </Form.Item>
                <Form.Item name="headers" label={<span style={{ fontSize: 11, fontWeight: 600, color: T.stone700 }}>Headers (JSON)</span>} style={{ marginBottom: 0 }}>
                  <TextArea rows={3} placeholder={'{\n  "Authorization": "Bearer token"\n}'} size="small" style={{ fontFamily: 'monospace', fontSize: 11 }} />
                </Form.Item>
              </>
            ) : (
              <>
                <Form.Item name="command" label={<span style={{ fontSize: 11, fontWeight: 600, color: T.stone700 }}>Command</span>} rules={[{ required: true, message: 'Please enter command' }]} style={{ marginBottom: 12 }}>
                  <Input placeholder="docker" size="small" />
                </Form.Item>
                <Form.Item name="args" label={<span style={{ fontSize: 11, fontWeight: 600, color: T.stone700 }}>Arguments (comma-separated)</span>} style={{ marginBottom: 12 }}>
                  <Input placeholder="mcp, gateway, run" size="small" />
                </Form.Item>
                <Form.Item name="env" label={<span style={{ fontSize: 11, fontWeight: 600, color: T.stone700 }}>Environment Variables (JSON)</span>} style={{ marginBottom: 0 }}>
                  <TextArea rows={3} placeholder={'{\n  "ENV_VAR": "value"\n}'} size="small" style={{ fontFamily: 'monospace', fontSize: 11 }} />
                </Form.Item>
              </>
            )}
          </div>

          {/* Settings section */}
          <div style={{ padding: '12px 16px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: T.stone400, marginBottom: 12 }}>
              Settings
            </div>
            <Form.Item name="enabled" label={<span style={{ fontSize: 11, fontWeight: 600, color: T.stone700 }}>Enabled</span>} valuePropName="checked" style={{ marginBottom: 0 }}>
              <Switch />
            </Form.Item>
          </div>

        </div>

        {/* ── Footer actions ── */}
        <div style={{
          padding: '12px 16px', borderTop: `1px solid ${T.stone200}`,
          display: 'flex', justifyContent: 'flex-end', gap: 8, flexShrink: 0,
        }}>
          <button
            type="button"
            onClick={onClose}
            style={{ padding: '6px 14px', borderRadius: 6, border: `1px solid ${T.stone200}`, background: T.white, color: T.stone600, fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 16px', borderRadius: 6, border: 'none', background: T.orange, color: T.white, fontSize: 13, fontWeight: 600, cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.7 : 1 }}
          >
            {submitting && <LoadingOutlined />} {isEdit ? 'Save Changes' : 'Add Server'}
          </button>
        </div>

      </Form>
    </Drawer>
  );
}

// ── Docker quick-add drawer ───────────────────────────────────────────────────

function DockerDrawer({
  open,
  loading,
  servers,
  adding,
  onClose,
  onAdd,
  T,
}: {
  open: boolean;
  loading: boolean;
  servers: DockerMCPServer[];
  adding: string | null;
  onClose: () => void;
  onAdd: (name: string) => void;
  T: Tokens;
}) {
  return (
    <Drawer
      title={null}
      placement="right"
      width={440}
      onClose={onClose}
      open={open}
      styles={{ body: { padding: 0, display: 'flex', flexDirection: 'column', height: '100%' } }}
    >
      {/* ── Panel header ── */}
      <div style={{ padding: '16px 16px 14px', borderBottom: `1px solid ${T.stone200}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 10, flexShrink: 0,
            background: T.orangeLight, border: `1px solid ${T.orangeBorder}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <ThunderboltOutlined style={{ fontSize: 20, color: T.orange }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: T.stone900, letterSpacing: '-0.01em', marginBottom: 4 }}>
              Docker MCP Servers
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 99, background: T.stone100, color: T.stone500 }}>Local</span>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', borderRadius: 6, color: T.stone400, fontSize: 16, flexShrink: 0, lineHeight: 1 }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = T.stone700}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = T.stone400}
          >
            ×
          </button>
        </div>
        <p style={{ margin: '10px 0 0', fontSize: 12, color: T.stone500, lineHeight: 1.6 }}>
          Quickly add MCP integrations from locally available Docker MCP servers.
        </p>
      </div>

      {/* ── Scrollable body ── */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '12px 16px' }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
            <LoadingOutlined style={{ fontSize: 24, color: T.orange }} />
          </div>
        ) : servers.length === 0 ? (
          <div style={{ textAlign: 'center', color: T.stone400, fontSize: 13, padding: '32px 0' }}>No Docker MCP servers found.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {servers.map(server => (
              <div
                key={server.name}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderRadius: 10, border: `1px solid ${T.stone200}`, background: T.white }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <ApiOutlined style={{ color: T.purple, fontSize: 13 }} />
                    <span style={{ fontSize: 12, fontWeight: 600, color: T.stone800 }}>{server.name}</span>
                    <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 99, background: T.greenLight, color: T.green }}>{server.toolCount} tools</span>
                  </div>
                  {server.description && <div style={{ fontSize: 11, color: T.stone400, marginTop: 3, marginLeft: 21 }}>{server.description}</div>}
                </div>
                <button
                  onClick={() => onAdd(server.name)}
                  disabled={adding !== null}
                  style={{ padding: '5px 12px', borderRadius: 6, border: 'none', background: adding === server.name ? T.stone200 : T.orange, color: adding === server.name ? T.stone400 : T.white, fontSize: 12, fontWeight: 600, cursor: adding !== null ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0, marginLeft: 12 }}
                >
                  {adding === server.name ? <LoadingOutlined /> : <PlusOutlined />} Add
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Drawer>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function MCPIntegrations({ showHeader = true }: { showHeader?: boolean }) {
  const [integrations, setIntegrations] = useState<MCPIntegration[]>([]);
  const [loading, setLoading] = useState(false);
  const [formDrawerOpen, setFormDrawerOpen] = useState(false);
  const [editingIntegration, setEditingIntegration] = useState<MCPIntegration | null>(null);
  const [dockerDrawerOpen, setDockerDrawerOpen] = useState(false);
  const [dockerServers, setDockerServers] = useState<DockerMCPServer[]>([]);
  const [loadingDocker, setLoadingDocker] = useState(false);
  const [addingDocker, setAddingDocker] = useState<string | null>(null);
  const [detailsDrawerOpen, setDetailsDrawerOpen] = useState(false);
  const [selectedDetails, setSelectedDetails] = useState<MCPIntegrationDetails | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  const { theme } = useTheme();
  const T = makeTokens(theme === 'dark');

  const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

  const { getAllMCPIntegrations, listDockerMCPServers, addDockerMCPIntegration, deleteMCPIntegration, createMCPIntegration, updateMCPIntegration, getMCPIntegrationDetails } = useIntegrations();

  const refresh = useCallback(async () => {
    try {
      const data = await getAllMCPIntegrations();
      setIntegrations(data);
    } catch { /* silent */ }
  }, [getAllMCPIntegrations]);

  useEffect(() => {
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const handleOpenDockerDrawer = async () => {
    setDockerDrawerOpen(true);
    setLoadingDocker(true);
    try { setDockerServers(await listDockerMCPServers()); } catch { message.error('Failed to load Docker MCP servers'); } finally { setLoadingDocker(false); }
  };

  const handleAddDocker = async (serverName: string) => {
    setAddingDocker(serverName);
    try {
      await addDockerMCPIntegration(serverName);
      message.success(`Added ${serverName}`);
      await refresh();
      setDockerDrawerOpen(false);
    } catch (error: any) {
      if (error.message?.includes('already exists')) message.warning('Integration already exists');
      else message.error('Failed to add integration');
    } finally { setAddingDocker(null); }
  };

  const handleCardClick = async (integration: MCPIntegration) => {
    setDetailsDrawerOpen(true);
    setLoadingDetails(true);
    setSelectedDetails(null);
    try { setSelectedDetails(await getMCPIntegrationDetails(integration.id)); } catch { message.error('Failed to load integration details'); } finally { setLoadingDetails(false); }
  };

  const handleEdit = (integration: MCPIntegration) => {
    setEditingIntegration(integration);
    setFormDrawerOpen(true);
  };

  const handleDelete = async (id: string) => {
    try { await deleteMCPIntegration(id); message.success('Deleted'); await refresh(); } catch { message.error('Failed to delete integration'); }
  };

  const handleSubmit = async (values: any) => {
    const transport = values.transport as 'http' | 'stdio';
    let config: MCPHttpConfig | MCPStdioConfig;
    if (transport === 'http') {
      config = { url: values.url, headers: values.headers ? JSON.parse(values.headers) : undefined };
    } else {
      config = { command: values.command, args: values.args ? values.args.split(',').map((s: string) => s.trim()) : undefined, env: values.env ? JSON.parse(values.env) : undefined };
    }

    if (editingIntegration) {
      const req: UpdateMCPIntegrationRequest = { name: values.name, description: values.description, config, enabled: values.enabled };
      await updateMCPIntegration(editingIntegration.id, req);
      message.success('Updated');
    } else {
      const req: CreateMCPIntegrationRequest = { name: values.name, description: values.description, transport, config, enabled: values.enabled ?? true };
      await createMCPIntegration(req);
      message.success('Added');
    }

    await refresh();
    setFormDrawerOpen(false);
    setEditingIntegration(null);
  };

  return (
    <div>
      {showHeader && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, marginBottom: 20 }}>
          {isLocalhost && (
            <button
              onClick={handleOpenDockerDrawer}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, border: `1px solid ${T.stone200}`, background: T.white, color: T.stone600, fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
            >
              <ThunderboltOutlined style={{ color: T.orange }} /> Docker MCP
            </button>
          )}
          <button
            onClick={() => { setEditingIntegration(null); setFormDrawerOpen(true); }}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 16px', borderRadius: 8, border: 'none', background: T.orange, color: T.white, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            <PlusOutlined /> Add MCP Server
          </button>
        </div>
      )}

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
          <LoadingOutlined style={{ fontSize: 24, color: T.orange }} />
        </div>
      ) : integrations.length === 0 ? (
        <MCPEmptyState onAdd={() => { setEditingIntegration(null); setFormDrawerOpen(true); }} T={T} />
      ) : (
        <Row gutter={[16, 16]}>
          {integrations.map(integration => (
            <Col key={integration.id} xs={24} sm={24} md={12} lg={12} xl={8}>
              <MCPCard
                integration={integration}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onClick={handleCardClick}
                T={T}
              />
            </Col>
          ))}
        </Row>
      )}

      <MCPFormDrawer
        open={formDrawerOpen}
        editingIntegration={editingIntegration}
        onClose={() => { setFormDrawerOpen(false); setEditingIntegration(null); }}
        onSubmit={handleSubmit}
        T={T}
      />

      <MCPDetailsDrawer
        open={detailsDrawerOpen}
        loading={loadingDetails}
        integration={selectedDetails}
        onClose={() => setDetailsDrawerOpen(false)}
        T={T}
      />

      <DockerDrawer
        open={dockerDrawerOpen}
        loading={loadingDocker}
        servers={dockerServers}
        adding={addingDocker}
        onClose={() => setDockerDrawerOpen(false)}
        onAdd={handleAddDocker}
        T={T}
      />
    </div>
  );
}
