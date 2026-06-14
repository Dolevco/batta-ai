import { Dropdown } from 'antd';
import type { MenuProps } from 'antd';
import {
  ApiOutlined,
  CommentOutlined,
  LogoutOutlined,
  DatabaseOutlined,
  SafetyOutlined,
  FileProtectOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  RocketOutlined,
} from '@ant-design/icons';
import { useAuth } from '../../hooks/useAuth';
import { useTheme } from '../../hooks/useTheme';
import { T, D } from '../../theme';
import type { CapabilitiesResponse } from '../../types';

// ── Nav structure ─────────────────────────────────────────────────────────────

interface NavItem {
  key: string;
  icon: React.ReactNode;
  label: string;
  children?: NavItem[];
}

const NAV_ITEMS: NavItem[] = [
  { key: 'onboarding',                      icon: <RocketOutlined />,      label: 'Agent Setup'      },
  { key: 'knowledge-base:assets',           icon: <DatabaseOutlined />,    label: 'Assets'           },
  { key: 'knowledge-base:security-reviews', icon: <SafetyOutlined />,      label: 'Security Reviews' },
  { key: 'knowledge-base:policies',         icon: <FileProtectOutlined />, label: 'Policies'         },
  { key: 'chat',                            icon: <CommentOutlined />,     label: 'Chat'             },
  { key: 'integrations',                    icon: <ApiOutlined />,         label: 'Integrations'     },
];

// ── Component ─────────────────────────────────────────────────────────────────

export function Sidebar({ selected, onSelect, collapsed, onToggleCollapse, capabilities }: {
  selected: string;
  onSelect: (info: { key: string }) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  capabilities?: CapabilitiesResponse | null;
}) {
  const { userInfo, logout } = useAuth();
  const { theme: appTheme, toggleTheme } = useTheme();
  const isDark = appTheme === 'dark';

  // Theme-aware tokens
  const bg          = isDark ? D.bg          : T.stone50;
  const border      = isDark ? D.border      : T.stone200;
  const textPrimary = isDark ? D.text        : T.stone800;
  const textMuted   = isDark ? T.stone400    : T.stone500;
  const hoverBg     = isDark ? D.border      : T.stone100;
  const activeBg    = isDark ? D.orangeLight : T.orangeLight;
  const portalChat = capabilities?.capabilities.find(capability => capability.id === 'portalChat');

  const dropdownItems: MenuProps['items'] = [
    {
      key: 'profile', disabled: true,
      label: (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '2px 0' }}>
          <UserAvatar name={userInfo?.name || userInfo?.email || 'U'} size={28} />
          <div>
            <div style={{ fontWeight: 600, fontSize: 13, color: textPrimary }}>{userInfo?.name || userInfo?.email || 'User'}</div>
            {userInfo?.email && userInfo?.name && <div style={{ fontSize: 11, color: textMuted }}>{userInfo.email}</div>}
          </div>
        </div>
      ),
    },
    { type: 'divider' },
    { key: 'theme',  label: isDark ? 'Light Mode' : 'Dark Mode' },
    { type: 'divider' },
    { key: 'logout', label: 'Sign out', danger: true, icon: <LogoutOutlined /> },
  ];

  const handleDropdownClick: MenuProps['onClick'] = ({ key }) => {
    if (key === 'logout') logout();
    else if (key === 'theme') toggleTheme();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: bg }}>

      {/* Logo header */}
      <div style={{
        height: 72, display: 'flex', alignItems: 'center',
        justifyContent: collapsed ? 'center' : 'space-between',
        padding: collapsed ? 0 : '0 12px 0 16px',
        borderBottom: `1px solid ${border}`, flexShrink: 0,
      }}>
        {!collapsed && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img
              src="/images/logo.svg"
              alt="batta-ai"
              style={{
                height: 36, width: 36, flexShrink: 0,
                filter: 'brightness(0) saturate(100%) invert(55%) sepia(90%) saturate(500%) hue-rotate(345deg) brightness(1.05)',
              }}
            />
            <div style={{ lineHeight: 1.2 }}>
              <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-0.02em', color: textPrimary }}>
                batta<span style={{ color: T.orange }}>-ai</span>
              </div>
              <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: textMuted }}>
                Open Security Platform
              </div>
            </div>
          </div>
        )}
        <button
          onClick={onToggleCollapse}
          style={{
            width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: 6, background: 'none', border: 'none', cursor: 'pointer',
            color: textMuted, flexShrink: 0, transition: 'background 0.15s, color 0.15s',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = hoverBg; (e.currentTarget as HTMLElement).style.color = textPrimary; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = textMuted; }}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <MenuUnfoldOutlined style={{ fontSize: 14 }} /> : <MenuFoldOutlined style={{ fontSize: 14 }} />}
        </button>
      </div>

      {/* Navigation */}
      <nav style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: collapsed ? '16px 8px' : '16px 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {NAV_ITEMS.map(item => {
          const disabled = item.key === 'chat' && portalChat?.available === false;
          const disabledReason = disabled ? portalChat?.reasons.join('. ') : undefined;
          if (!item.children) {
            return (
              <NavBtn
                key={item.key}
                icon={item.icon} label={item.label}
                active={selected === item.key} collapsed={collapsed}
                activeBg={activeBg} hoverBg={hoverBg}
                textMuted={textMuted}
                disabled={disabled}
                disabledReason={disabledReason}
                onClick={() => {
                  if (disabled) onSelect({ key: 'integrations' });
                  else onSelect({ key: item.key });
                }}
              />
            );
          }

          return (
            <div key={item.key} style={{ marginTop: 6 }}>
              {/* Group label */}
              {collapsed ? (
                <div style={{ height: 1, background: border, margin: '2px 8px 4px' }} />
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 16px 3px' }}>
                  <span style={{ fontSize: 18, color: textMuted, display: 'flex' }}>{item.icon}</span>
                  <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: textMuted }}>
                    {item.label}
                  </span>
                </div>
              )}
              {item.children.map(child => (
                <NavBtn
                  key={child.key}
                  icon={child.icon} label={child.label}
                  active={selected === child.key} collapsed={collapsed}
                  activeBg={activeBg} hoverBg={hoverBg}
                  textMuted={textMuted}
                  indent={!collapsed}
                  onClick={() => onSelect({ key: child.key })}
                />
              ))}
            </div>
          );
        })}
      </nav>

      {/* User */}
      <div style={{
        padding: collapsed ? '10px 0' : '10px 12px',
        borderTop: `1px solid ${border}`,
        display: 'flex', justifyContent: collapsed ? 'center' : 'flex-start',
      }}>
        <Dropdown menu={{ items: dropdownItems, onClick: handleDropdownClick }} placement="topLeft" trigger={['click']}>
          <div style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
            <UserAvatar name={userInfo?.name || userInfo?.email || 'U'} size={32} />
            {!collapsed && (
              <span style={{ fontSize: 13, fontWeight: 500, color: textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {userInfo?.name || userInfo?.email || 'User'}
              </span>
            )}
          </div>
        </Dropdown>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function UserAvatar({ name, size }: { name: string; size: number }) {
  const initials = name.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase() || '?';
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: 'linear-gradient(135deg, #FDBA74, #F97316)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: Math.round(size * 0.36), fontWeight: 700, color: T.white,
      letterSpacing: '0.01em',
    }}>
      {initials}
    </div>
  );
}

function NavBtn({
  icon, label, active, collapsed, activeBg, hoverBg, textMuted, indent, disabled, disabledReason, onClick,
}: {
  icon: React.ReactNode; label: string; active: boolean; collapsed: boolean;
  activeBg: string; hoverBg: string; textMuted: string;
  indent?: boolean; disabled?: boolean; disabledReason?: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={disabledReason || (collapsed ? label : undefined)}
      style={{
        width: '100%', display: 'flex', alignItems: 'center',
        gap: collapsed ? 0 : 10,
        justifyContent: collapsed ? 'center' : 'flex-start',
        padding: collapsed ? '10px 0' : `10px 12px 10px ${indent ? 28 : 12}px`,
        background: active ? activeBg : 'transparent',
        border: 'none',
        borderLeft: 'none',
        borderRadius: 8,
        cursor: disabled ? 'help' : 'pointer',
        transition: 'background 0.2s, color 0.2s',
        textAlign: 'left',
        outline: 'none',
        boxShadow: active ? `0 1px 3px rgba(249,115,22,0.12)` : 'none',
      }}
      onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = hoverBg; }}
      onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
    >
      <span style={{ fontSize: 18, color: disabled ? T.stone300 : active ? T.orange : textMuted, display: 'flex', flexShrink: 0 }}>{icon}</span>
      {!collapsed && (
        <span style={{ fontSize: 14, fontWeight: active ? 500 : 400, color: disabled ? T.stone300 : active ? T.orange : textMuted, whiteSpace: 'nowrap' }}>
          {label}
        </span>
      )}
    </button>
  );
}
