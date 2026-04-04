import { useState } from 'react';
import { AppstoreOutlined, ApiOutlined, SafetyOutlined, MessageOutlined } from '@ant-design/icons';
import { MCPIntegrations } from '../components/MCPIntegrations';
import { BuiltInIntegrations } from '../components/BuiltInIntegrations';
import type { BuiltInIntegrationCategory } from '../types';
import { useTheme } from '../hooks/useTheme';
import { T, D, dk } from '../theme';

type ActiveView = BuiltInIntegrationCategory | 'mcp';

interface NavItem {
  key: ActiveView;
  icon: React.ReactNode;
  label: string;
  desc: string;
  group?: string;
}

const NAV_ITEMS: NavItem[] = [
  { key: 'all',           icon: <AppstoreOutlined />,  label: 'All',           desc: 'All configured integrations',              group: 'Built-in' },
  { key: 'security',      icon: <SafetyOutlined />,    label: 'Security',      desc: 'Security-focused integrations',             group: 'Built-in' },
  { key: 'communication', icon: <MessageOutlined />,   label: 'Communication', desc: 'Communication and collaboration tools',     group: 'Built-in' },
  { key: 'mcp',           icon: <ApiOutlined />,       label: 'MCP Servers',   desc: 'Model Context Protocol servers',            group: 'MCP' },
];

export function IntegrationsPage() {
  const [activeView, setActiveView] = useState<ActiveView>('all');
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const activeItem = NAV_ITEMS.find(n => n.key === activeView)!;

  const renderNavGroup = (groupLabel: string) => (
    <div style={{ padding: '10px 16px 4px', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: dk(isDark, T.stone400, T.stone500) }}>
      {groupLabel}
    </div>
  );

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 'calc(100vh - 24px)' }}>

      {/* ── Left nav panel ── */}
      <aside style={{
        width: 220, flexShrink: 0,
        background: dk(isDark, T.stone50, D.bg),
        borderRight: `1px solid ${dk(isDark, T.stone200, D.borderSub)}`,
        borderRadius: '12px 0 0 12px',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{ padding: '14px 16px 10px', borderBottom: `1px solid ${dk(isDark, T.stone200, D.borderSub)}` }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: dk(isDark, T.stone400, T.stone500) }}>
            Categories
          </span>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
          {NAV_ITEMS.map((item, i) => {
            const active = activeView === item.key;
            const prevGroup = i > 0 ? NAV_ITEMS[i - 1].group : null;
            const showGroupHeader = item.group !== prevGroup;
            return (
              <div key={item.key}>
                {showGroupHeader && renderNavGroup(item.group!)}
                <div
                  onClick={() => setActiveView(item.key)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 16px', cursor: 'pointer',
                    background: active ? dk(isDark, T.orangeLight, D.orangeLight) : 'transparent',
                    borderLeft: `3px solid ${active ? T.orange : 'transparent'}`,
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = dk(isDark, T.stone100, D.bgCard); }}
                  onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                >
                  <span style={{ fontSize: 13, color: active ? T.orange : dk(isDark, T.stone400, T.stone500), display: 'flex' }}>{item.icon}</span>
                  <span style={{ fontSize: 13, fontWeight: active ? 600 : 400, color: active ? dk(isDark, T.stone800, D.text) : dk(isDark, T.stone500, D.textMuted) }}>
                    {item.label}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </aside>

      {/* ── Main content ── */}
      <div style={{
        flex: 1, minWidth: 0, background: dk(isDark, T.white, D.bgSub),
        borderRadius: '0 12px 12px 0',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '14px 24px', borderBottom: `1px solid ${dk(isDark, T.stone100, D.border)}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
        }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: dk(isDark, T.stone900, D.text) }}>
              {activeItem.label}
            </h2>
            <p style={{ margin: 0, fontSize: 12, color: dk(isDark, T.stone400, D.textMuted), marginTop: 2 }}>
              {activeItem.desc}
            </p>
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px' }}>
          {activeView === 'mcp' ? (
            <MCPIntegrations showHeader={true} />
          ) : activeView === 'all' ? (
            <>
              <BuiltInIntegrations activeCategory="all" />
              <div style={{ marginTop: 32 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: dk(isDark, T.stone400, T.stone500) }}>
                    MCP Servers
                  </span>
                </div>
                <MCPIntegrations showHeader={false} />
              </div>
            </>
          ) : (
            <BuiltInIntegrations activeCategory={activeView} />
          )}
        </div>
      </div>
    </div>
  );
}
