import { useState } from 'react';
import { Sidebar } from './Sidebar';
import { useTheme } from '../../hooks/useTheme';
import { T, D } from '../../theme';

export function MainLayout({ selectedMenu, onSelect, children, capabilities }: any) {
  const { theme: appTheme } = useTheme();
  const isDark = appTheme === 'dark';
  const [collapsed, setCollapsed] = useState(false);

  const sidebarWidth = collapsed ? 56 : 220;

  return (
    <div style={{
      display: 'flex', minHeight: '100vh',
      background: isDark ? '#141210' : T.stone100,
      transition: 'background 0.3s',
    }}>
      {/* Sidebar */}
      <div style={{
        width: sidebarWidth, flexShrink: 0,
        position: 'sticky', top: 0, height: '100vh', overflow: 'hidden',
        borderRight: `1px solid ${isDark ? D.border : T.stone200}`,
        boxShadow: isDark
          ? '2px 0 12px rgba(0,0,0,0.4)'
          : '2px 0 8px rgba(28,25,23,0.06)',
        transition: 'width 0.2s cubic-bezier(0.2, 0, 0, 1)',
        zIndex: 100,
      }}>
        <Sidebar
          selected={selectedMenu}
          onSelect={onSelect}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed(c => !c)}
          capabilities={capabilities}
        />
      </div>

      {/* Content */}
      <div style={{
        flex: 1, minWidth: 0, overflow: 'auto',
        transition: 'all 0.2s cubic-bezier(0.2, 0, 0, 1)',
      }}>
        <div style={{ padding: 16, minHeight: '100%' }}>
          {children}
        </div>
      </div>
    </div>
  );
}
