/**
 * PoliciesPage — minimal policy overview.
 *
 * Security: no dangerouslySetInnerHTML; all data rendered as React children only.
 */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Spin } from 'antd';
import {
  SafetyOutlined,
  RobotOutlined,
  LockOutlined,
  QuestionCircleOutlined,
  ThunderboltOutlined,
  EditOutlined,
  CheckCircleOutlined,
  IssuesCloseOutlined,
} from '@ant-design/icons';
import { usePolicies } from '../../hooks/usePolicies';
import { useTheme } from '../../hooks/useTheme';
import { T, D, dk } from '../../theme';
import type { PolicyTemplate, PolicyTemplateType } from '../../types';

// ── Pillar config ─────────────────────────────────────────────────────────────

interface PillarConfig {
  type: PolicyTemplateType;
  icon: React.ReactNode;
  label: string;
  subtitle: string;
  color: string;
  bgLight: string;
  bgDark: string;
  borderLight: string;
  borderDark: string;
  standard: string;
}

const PILLARS: PillarConfig[] = [
  {
    type: 'security_review',
    icon: <SafetyOutlined />,
    label: 'Security Review',
    subtitle: 'STRIDE threat modeling with adaptive questionnaire',
    color: T.orange,
    bgLight: T.orangeLight,
    bgDark: D.orangeLight,
    borderLight: T.orangeBorder,
    borderDark: D.orangeBorder,
    standard: 'OWASP / NIST CSF',
  },
  {
    type: 'responsible_ai',
    icon: <RobotOutlined />,
    label: 'Responsible AI',
    subtitle: 'Fairness, explainability, safety, and human oversight',
    color: T.purple,
    bgLight: T.purpleLight,
    bgDark: D.purpleLight,
    borderLight: T.purpleBorder,
    borderDark: D.purpleBorder,
    standard: 'EU AI Act / NIST AI RMF',
  },
  {
    type: 'privacy',
    icon: <LockOutlined />,
    label: 'Privacy Review',
    subtitle: 'GDPR/CCPA-aligned data flows and subject rights',
    color: T.blue,
    bgLight: T.blueLight,
    bgDark: D.blueLight,
    borderLight: T.blueBorder,
    borderDark: D.blueBorder,
    standard: 'GDPR / CCPA / ISO 27701',
  },
  {
    type: 'work_item_review',
    icon: <IssuesCloseOutlined />,
    label: 'Work Item Review',
    subtitle: 'Autonomous agent review of Jira work items for security risks',
    color: T.teal,
    bgLight: T.tealLight,
    bgDark: D.tealLight,
    borderLight: T.tealBorder,
    borderDark: D.tealBorder,
    standard: 'Internal',
  },
];

// ── Policy card ───────────────────────────────────────────────────────────────

function PolicyCard({
  pillar,
  policy,
  isDark,
  onClick,
}: {
  pillar: PillarConfig;
  policy: PolicyTemplate | undefined;
  isDark: boolean;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const taskCount = policy
    ? policy.taskRules.reduce((s, r) => s + r.tasks.length, 0) + policy.baselineTasks.length
    : 0;
  const questionCount = policy?.questions.length ?? 0;

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: dk(isDark, T.white, D.bgCard),
        border: `1px solid ${hovered
          ? dk(isDark, pillar.borderLight, pillar.borderDark)
          : dk(isDark, T.stone200, D.borderSub)}`,
        borderRadius: 14,
        padding: '20px 22px',
        cursor: 'pointer',
        transition: 'border-color 0.15s, box-shadow 0.15s',
        boxShadow: hovered
          ? `0 4px 20px ${dk(isDark, pillar.bgLight, pillar.bgDark)}`
          : dk(isDark, '0 1px 3px rgba(28,25,23,0.05)', 'none'),
        display: 'flex', flexDirection: 'column', gap: 16,
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18, color: pillar.color,
            background: dk(isDark, pillar.bgLight, pillar.bgDark),
            border: `1px solid ${dk(isDark, pillar.borderLight, pillar.borderDark)}`,
          }}>
            {pillar.icon}
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: dk(isDark, T.stone800, D.text), marginBottom: 2, letterSpacing: '-0.01em' }}>
              {pillar.label}
            </div>
            <div style={{ fontSize: 11, color: dk(isDark, T.stone400, D.textFaint) }}>
              {pillar.standard}
            </div>
          </div>
        </div>

        {policy?.isActive && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '3px 9px', borderRadius: 99, fontSize: 10, fontWeight: 600,
            color: T.green,
            background: dk(isDark, T.greenLight, D.greenLight),
            border: `1px solid ${dk(isDark, T.greenBorder, D.greenBorder)}`,
            flexShrink: 0,
          }}>
            <CheckCircleOutlined style={{ fontSize: 10 }} />
            Active
          </span>
        )}
      </div>

      {/* Description */}
      <p style={{ margin: 0, fontSize: 12, color: dk(isDark, T.stone500, D.textMuted), lineHeight: 1.55 }}>
        {pillar.subtitle}
      </p>

      {/* Stats + action row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto' }}>
        <div style={{ display: 'flex', gap: 16 }}>
          <span style={{ fontSize: 11, color: dk(isDark, T.stone400, D.textFaint), display: 'flex', alignItems: 'center', gap: 4 }}>
            <QuestionCircleOutlined style={{ fontSize: 11, color: dk(isDark, T.stone400, D.textFaint) }} />
            {questionCount} questions
          </span>
          <span style={{ fontSize: 11, color: dk(isDark, T.stone400, D.textFaint), display: 'flex', alignItems: 'center', gap: 4 }}>
            <ThunderboltOutlined style={{ fontSize: 11, color: T.amber }} />
            {taskCount} tasks
          </span>
        </div>

        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          fontSize: 11, fontWeight: 600, color: pillar.color,
          opacity: hovered ? 1 : 0.6,
          transition: 'opacity 0.15s',
        }}>
          <EditOutlined style={{ fontSize: 11 }} />
          Configure
        </span>
      </div>

      {/* Version */}
      {policy && (
        <div style={{
          paddingTop: 12,
          borderTop: `1px solid ${dk(isDark, T.stone100, D.border)}`,
          fontSize: 10, color: dk(isDark, T.stone400, D.textFaint),
        }}>
          v{policy.version} · Updated {new Date(policy.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function PoliciesPage() {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const navigate = useNavigate();
  const { listPolicies, loading } = usePolicies();
  const [policies, setPolicies] = useState<PolicyTemplate[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const data = await listPolicies();
        const ORDER: PolicyTemplateType[] = ['security_review', 'responsible_ai', 'privacy', 'work_item_review'];
        data.sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type));
        setPolicies(data);
      } catch {
        // handled via usePolicies error state
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{
      padding: '32px 36px 60px',
      minHeight: '100vh',
      background: dk(isDark, T.stone50, D.bg),
    }}>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{
          margin: '0 0 6px', fontSize: 22, fontWeight: 800,
          color: dk(isDark, T.stone900, D.text), letterSpacing: '-0.02em',
        }}>
          Review Policies
        </h1>
        <p style={{
          margin: 0, fontSize: 13, color: dk(isDark, T.stone500, D.textMuted),
          lineHeight: 1.5,
        }}>
          Configure the questionnaire, tasks, and controls for each review type.
        </p>
      </div>

      {/* Cards */}
      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 240 }}>
          <Spin size="large" />
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
          {PILLARS.map(pillar => {
            const policy = policies.find(p => p.type === pillar.type);
            return (
              <PolicyCard
                key={pillar.type}
                pillar={pillar}
                policy={policy}
                isDark={isDark}
                onClick={() => { if (policy) navigate(`/knowledge-base/policies/${policy.id}`); }}
              />
            );
          })}
          {policies.length === 0 && (
            <div style={{
              gridColumn: '1 / -1',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              height: 200, borderRadius: 12,
              border: `2px dashed ${dk(isDark, T.stone200, D.borderSub)}`,
              color: dk(isDark, T.stone400, D.textFaint), fontSize: 14,
            }}>
              No policies found.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
