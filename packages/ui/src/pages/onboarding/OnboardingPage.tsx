import { Button, Input, Typography } from 'antd';
import type React from 'react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CloudOutlined,
  CodeOutlined,
  CopyOutlined,
  ExperimentOutlined,
  SafetyOutlined,
} from '@ant-design/icons';
import { useTheme } from '../../hooks/useTheme';
import { T, D, dk } from '../../theme';
import {
  buildAgentLedBootstrapPrompt,
  buildClaudeMcpConfig,
  buildMcpUrl,
  buildVsCodeMcpConfig,
} from '../../constants/agentSetup';

const { Text } = Typography;

export function OnboardingPage() {
  const { theme } = useTheme();
  const navigate = useNavigate();
  const isDark = theme === 'dark';
  const [repoKey, setRepoKey] = useState('batta-ai');
  const snippets = useMemo(() => ({
    agentPrompt: buildAgentLedBootstrapPrompt(repoKey),
    mcpUrl: buildMcpUrl(repoKey),
    vsCodeConfig: buildVsCodeMcpConfig(repoKey),
    claudeConfig: buildClaudeMcpConfig(repoKey),
  }), [repoKey]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, width: '100%' }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <div style={{ width: 36, height: 36, borderRadius: 8, background: dk(isDark, T.orangeLight, D.orangeLight), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <SafetyOutlined style={{ color: T.orange, fontSize: 18 }} />
          </div>
          <h2 style={{ margin: 0, fontSize: 20, color: dk(isDark, T.stone900, D.text) }}>Agent Setup</h2>
        </div>
        <p style={{ margin: 0, fontSize: 13, color: dk(isDark, T.stone500, D.textMuted) }}>
          Open your target repository in a coding agent, choose a stable repo key, and paste the prompt below. The agent will configure MCP and index the repo before reviews begin.
        </p>
      </div>

      <Panel isDark={isDark} title="Repository key">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Input
            aria-label="Repository key"
            value={repoKey}
            onChange={(event) => setRepoKey(event.target.value)}
            placeholder="payments-service"
            style={{ maxWidth: 360 }}
          />
          <Text style={{ color: dk(isDark, T.stone500, D.textMuted), fontSize: 12 }}>
            Use the same value every time so Batta can resume indexing and security reviews for this repository.
          </Text>
        </div>
      </Panel>

      <Panel isDark={isDark} title="Onboard with your coding agent">
        <CodeBlock value={snippets.agentPrompt} multiline />
      </Panel>

      <Panel isDark={isDark} title="Unlock cloud graph context">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Text style={{ color: dk(isDark, T.stone600, D.textMuted), fontSize: 13, lineHeight: 1.6 }}>
            Connect an LLM/embeddings provider and a cloud integration so Batta can map live cloud resources into the knowledge graph. This links code, services, identities, and infrastructure for richer impact analysis and cloud-aware reviews.
          </Text>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <SetupHint icon={<ExperimentOutlined />} label="Configure LLM and embeddings" isDark={isDark} />
            <Button size="small" icon={<CloudOutlined />} onClick={() => navigate('/integrations')} style={{ borderRadius: 6 }}>
              Connect AWS or Azure
            </Button>
          </div>
        </div>
      </Panel>

      <Panel isDark={isDark} title="Manual MCP reference">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <CodeBlock value={snippets.mcpUrl} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
            <SnippetGroup title="VS Code .vscode/mcp.json" value={snippets.vsCodeConfig} isDark={isDark} />
            <SnippetGroup title="Claude Code .claude/mcp.json" value={snippets.claudeConfig} isDark={isDark} />
          </div>
          <Text style={{ color: dk(isDark, T.stone500, D.textMuted), fontSize: 12 }}>
            Full docs are in <Text code>docs/agent-integration/README.md</Text>.
          </Text>
        </div>
      </Panel>
    </div>
  );
}

function Panel({ title, children, isDark }: { title: string; children: React.ReactNode; isDark: boolean }) {
  return (
    <section style={{
      background: dk(isDark, T.white, D.bgCard),
      border: `1px solid ${dk(isDark, T.stone200, D.borderSub)}`,
      borderRadius: 8,
      padding: 18,
    }}>
      <h3 style={{ margin: '0 0 12px', fontSize: 15, color: dk(isDark, T.stone900, D.text) }}>{title}</h3>
      {children}
    </section>
  );
}

function SetupHint({ icon, label, isDark }: { icon: React.ReactNode; label: string; isDark: boolean }) {
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      minHeight: 24,
      padding: '2px 8px',
      borderRadius: 6,
      border: `1px solid ${dk(isDark, T.stone200, D.borderSub)}`,
      color: dk(isDark, T.stone700, D.text),
      background: dk(isDark, T.stone50, D.bgSub),
      fontSize: 12,
      fontWeight: 600,
    }}>
      {icon}
      {label}
    </span>
  );
}

function SnippetGroup({ title, value, isDark }: { title: string; value: string; isDark: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <Text style={{ color: dk(isDark, T.stone700, D.text), fontSize: 12, fontWeight: 600 }}>{title}</Text>
      <CodeBlock value={value} multiline />
    </div>
  );
}

function CodeBlock({ value, multiline }: { value: string; multiline?: boolean }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: multiline ? 'flex-start' : 'center',
      gap: 8,
      background: '#111827',
      color: '#E5E7EB',
      borderRadius: 8,
      padding: '10px 12px',
      overflow: 'auto',
    }}>
      <CodeOutlined style={{ color: '#93C5FD', marginTop: multiline ? 3 : 0 }} />
      <Text copyable={{ text: value, icon: <CopyOutlined style={{ color: '#E5E7EB' }} /> }} style={{ color: '#E5E7EB', fontSize: 12, whiteSpace: multiline ? 'pre-wrap' : 'nowrap', fontFamily: 'monospace' }}>
        {value}
      </Text>
    </div>
  );
}
