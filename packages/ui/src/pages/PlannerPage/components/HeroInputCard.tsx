import { useState } from 'react';
import { Card, Input, Space, Button, Dropdown, Checkbox, Avatar, theme } from 'antd';
import { SendOutlined, ToolOutlined, RobotOutlined, DownOutlined } from '@ant-design/icons';
import { useTheme } from '../../../hooks';
const { TextArea } = Input;

export default function HeroInputCard({
  input,
  setInput,
  loading,
  agents = [],
  selectedAgentId,
  setSelectedAgentId,
  integrations = [],
  selectedIntegrationIds = [],
  setSelectedIntegrationIds,
  onSend,
  onKeyPress,
  inputRef,
}: any) {
  const [agentOpen, setAgentOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const { token } = theme.useToken();
  const { theme: appTheme } = useTheme();

  const toggleIntegration = (id: string) => {
    if (!setSelectedIntegrationIds) return;
    const exists = selectedIntegrationIds.includes(id);
    if (exists) {
      setSelectedIntegrationIds(selectedIntegrationIds.filter((s: string) => s !== id));
    } else {
      setSelectedIntegrationIds([...selectedIntegrationIds, id]);
    }
  };

  return (
    <Card
      style={{
        borderRadius: 16,
        boxShadow: appTheme === 'dark' ? '0 6px 24px rgba(0,0,0,0.6)' : '0 4px 20px rgba(0, 0, 0, 0.08)',
        border: `1px solid ${token.colorBorder}`,
        background: token.colorBgContainer,
      }}
      bodyStyle={{ padding: 24 }}
    >
      <TextArea
        ref={inputRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyPress={onKeyPress}
        placeholder="Example: Scan all S3 buckets for public access and generate a compliance report..."
        autoSize={{ minRows: 4, maxRows: 10 }}
        style={{
          fontSize: 15,
          border: 'none',
          padding: 0,
          resize: 'none',
          outline: 'none',
          boxShadow: 'none',
          color: token.colorText,
          background: 'transparent',
        }}
        disabled={loading}
      />
      <div style={{ marginTop: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <Space size={12} align="center">
          {/* Agent dropdown: text button with name */}
          <Dropdown
            open={agentOpen}
            onOpenChange={(open) => setAgentOpen(open)}
            overlay={
              <div style={{ background: token.colorBgElevated, border: `1px solid ${token.colorBorder}`, boxShadow: appTheme === 'dark' ? '0 8px 20px rgba(0,0,0,0.6)' : '0 8px 20px rgba(0,0,0,0.06)', borderRadius: 8, padding: 6, maxHeight: 260, overflow: 'auto' }}>
                {agents.map((agent: any) => (
                  <div
                    key={agent.id}
                    onClick={() => {
                      setSelectedAgentId && setSelectedAgentId(agent.id);
                      setAgentOpen(false);
                    }}
                    style={{ padding: '8px 10px', cursor: 'pointer', color: token.colorText }}
                  >
                    {agent.name}
                  </div>
                ))}
              </div>
            }
            trigger={["click"]}
          >
            <Button type="text" size="small" style={{ display: 'flex', alignItems: 'center', gap: 8, color: token.colorText }}>
              <Avatar size={20} icon={<RobotOutlined />} />
              <span style={{ fontSize: 14 }}>{agents.find((a: any) => a.id === selectedAgentId)?.name ?? 'Select agent'}</span>
              <DownOutlined />
            </Button>
          </Dropdown>

          {/* Tools dropdown: show checkboxes for integrations */}
          <Dropdown
            open={toolsOpen}
            onOpenChange={(open) => setToolsOpen(open)}
            overlay={<div style={{ background: token.colorBgElevated, border: `1px solid ${token.colorBorder}`, boxShadow: appTheme === 'dark' ? '0 8px 20px rgba(0,0,0,0.6)' : '0 8px 20px rgba(0,0,0,0.06)', borderRadius: 8, padding: 12, maxWidth: 320 }}>
              {integrations.map((it: any) => (
                <div key={it.id} style={{ padding: '6px 0' }}>
                  <Checkbox
                    checked={selectedIntegrationIds.includes(it.id)}
                    onChange={() => {
                      toggleIntegration(it.id);
                      // keep dropdown open while toggling
                      setToolsOpen(true);
                    }}
                    style={{ color: token.colorText }}
                  >
                    {it.name}
                  </Checkbox>
                </div>
              ))}
            </div>}
            trigger={["click"]}
          >
            <Button type="text" size="small" icon={<ToolOutlined />} onClick={() => setToolsOpen(!toolsOpen)} style={{ color: token.colorText }}>
              Tools ({selectedIntegrationIds.length}) <DownOutlined />
            </Button>
          </Dropdown>
        </Space>
        <Button
          type="primary"
          size="large"
          icon={<SendOutlined />}
          onClick={onSend}
          disabled={!input.trim() || loading || (!selectedAgentId)}
          loading={loading}
          style={{ paddingLeft: 32, paddingRight: 32 }}
        >
          Generate Plan
        </Button>
      </div>
    </Card>
  );
}
