/**
 * ThreatModelAiAnalysisPanel
 *
 * Renders the AI-generated narrative analysis of a threat model diff.
 * This is the "hero" section of the Security Impact view — it shows:
 *   • An impact banner (positive / neutral / negative / mixed)
 *   • The executive summary from the LLM
 *   • A per-change breakdown with severity chips
 *   • The full risk narrative (markdown)
 *
 * Designed to be immediately scannable: the most critical findings float
 * to the top, and the full narrative sits below for those who want detail.
 */

import { useMemo } from 'react';
import {
  Space, Typography, Tag, theme as antdTheme,
  Tooltip, Badge,
} from 'antd';
import {
  RobotOutlined, RiseOutlined, FallOutlined, SwapOutlined,
  CheckCircleOutlined, WarningOutlined, InfoCircleOutlined,
  BulbOutlined, ArrowRightOutlined, ClockCircleOutlined,
} from '@ant-design/icons';
import type { ThreatModelAiAnalysis, ThreatModelChange } from '../types';
import { T } from '../theme';

const { Text, Paragraph, Title } = Typography;

// ── Severity helpers ─────────────────────────────────────────────────────────

const SEV_COLOR: Record<string, string> = {
  critical: 'red',
  high: 'orange',
  medium: 'gold',
  low: 'green',
  info: 'blue',
};

const SEV_RANK: Record<string, number> = {
  critical: 5, high: 4, medium: 3, low: 2, info: 1,
};

// ── Impact banner config ─────────────────────────────────────────────────────

type ImpactKey = 'positive' | 'neutral' | 'negative' | 'mixed';

const IMPACT_CONFIG: Record<ImpactKey, {
  label: string;
  antColor: string;
  borderColor: string;
  bgColor: string;
  icon: React.ReactNode;
  description: string;
}> = {
  negative: {
    label: 'SECURITY RISK INTRODUCED',
    antColor: 'error',
    borderColor: T.red,
    bgColor: 'rgba(220,38,38,0.04)',
    icon: <RiseOutlined />,
    description: 'This feature increased the attack surface or introduced new risk.',
  },
  mixed: {
    label: 'MIXED SECURITY IMPACT',
    antColor: 'warning',
    borderColor: T.amber,
    bgColor: 'rgba(217,119,6,0.04)',
    icon: <SwapOutlined />,
    description: 'Some security improvements alongside new risks — review carefully.',
  },
  neutral: {
    label: 'NO SECURITY CHANGE',
    antColor: 'default',
    borderColor: T.gray,
    bgColor: 'rgba(107,114,128,0.04)',
    icon: <InfoCircleOutlined />,
    description: 'No meaningful change to the security posture was detected.',
  },
  positive: {
    label: 'SECURITY IMPROVED',
    antColor: 'success',
    borderColor: T.emerald,
    bgColor: 'rgba(5,150,105,0.04)',
    icon: <FallOutlined />,
    description: 'The feature reduced attack surface or improved the security posture.',
  },
};

// ── Change type icon ─────────────────────────────────────────────────────────

function changeTypeIcon(changeType: string): React.ReactNode {
  switch (changeType) {
    case 'added_node':        return <RiseOutlined style={{ color: T.red }} />;
    case 'removed_node':      return <FallOutlined style={{ color: T.gray }} />;
    case 'modified_node':     return <SwapOutlined style={{ color: T.amber }} />;
    case 'added_edge':        return <ArrowRightOutlined style={{ color: T.red }} />;
    case 'removed_edge':      return <ArrowRightOutlined style={{ color: T.gray, opacity: 0.5 }} />;
    case 'severity_escalation': return <RiseOutlined style={{ color: T.red }} />;
    case 'trust_boundary':    return <WarningOutlined style={{ color: T.amber }} />;
    case 'data_sensitivity':  return <WarningOutlined style={{ color: T.amber }} />;
    default:                  return <InfoCircleOutlined />;
  }
}

function changeTypeLabel(changeType: string): string {
  switch (changeType) {
    case 'added_node':          return 'New Entity';
    case 'removed_node':        return 'Removed';
    case 'modified_node':       return 'Modified';
    case 'added_edge':          return 'New Flow';
    case 'removed_edge':        return 'Flow Removed';
    case 'severity_escalation': return 'Escalation';
    case 'trust_boundary':      return 'Trust Boundary';
    case 'data_sensitivity':    return 'Data Sensitivity';
    default:                    return changeType.replace(/_/g, ' ');
  }
}

// ── Change row ───────────────────────────────────────────────────────────────

function ChangeRow({ change }: { change: ThreatModelChange }) {
  const { token } = antdTheme.useToken();

  return (
    <div style={{
      display: 'flex',
      gap: 12,
      padding: '10px 14px',
      borderBottom: `1px solid ${token.colorBorderSecondary}`,
      alignItems: 'flex-start',
    }}>
      {/* Severity indicator bar */}
      <div style={{
        width: 3,
        minHeight: 40,
        borderRadius: 2,
        background: SEV_COLOR[change.severity] === 'red' ? T.red :
                    SEV_COLOR[change.severity] === 'orange' ? T.orangeHigh :
                    SEV_COLOR[change.severity] === 'gold' ? T.amber :
                    SEV_COLOR[change.severity] === 'green' ? T.emerald : T.blue,
        flexShrink: 0,
        marginTop: 2,
      }} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
          {changeTypeIcon(change.changeType)}
          <Text strong style={{ fontSize: 13 }}>{change.title}</Text>
          <Tag color={SEV_COLOR[change.severity]} style={{ margin: 0, fontSize: 10, letterSpacing: '0.04em' }}>
            {change.severity.toUpperCase()}
          </Tag>
          <Tag style={{ margin: 0, fontSize: 10 }}>{changeTypeLabel(change.changeType)}</Tag>
        </div>

        <Text style={{ fontSize: 12, display: 'block', color: token.colorTextSecondary }}>
          {change.securityImplication}
        </Text>

        {change.recommendation && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginTop: 6 }}>
            <BulbOutlined style={{ color: token.colorWarning, fontSize: 12, marginTop: 2, flexShrink: 0 }} />
            <Text style={{ fontSize: 11, color: token.colorTextTertiary, fontStyle: 'italic' }}>
              {change.recommendation}
            </Text>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export interface ThreatModelAiAnalysisPanelProps {
  analysis: ThreatModelAiAnalysis;
  /** Whether to start with the change list collapsed */
  defaultCollapsed?: boolean;
}

export function ThreatModelAiAnalysisPanel({
  analysis,
}: ThreatModelAiAnalysisPanelProps) {
  const { token } = antdTheme.useToken();
  const impact = analysis.overallImpact as ImpactKey;
  const cfg = IMPACT_CONFIG[impact] ?? IMPACT_CONFIG.neutral;

  // Sort changes by severity (most critical first)
  const sortedChanges = useMemo(
    () => [...analysis.changes].sort(
      (a, b) => (SEV_RANK[b.severity] ?? 0) - (SEV_RANK[a.severity] ?? 0)
    ),
    [analysis.changes],
  );

  const criticalCount = sortedChanges.filter(c => c.severity === 'critical').length;
  const highCount     = sortedChanges.filter(c => c.severity === 'high').length;

  return (
    <Space direction="vertical" size={0} style={{ width: '100%' }}>
      {/* ── Impact banner ─────────────────────────────────────────────────── */}
      <div style={{
        background: cfg.bgColor,
        border: `1px solid ${cfg.borderColor}`,
        borderRadius: '8px 8px 0 0',
        padding: '14px 18px',
        borderBottom: 'none',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
          <Space align="center">
            <RobotOutlined style={{ fontSize: 18, color: token.colorPrimary }} />
            <div>
              <Space size={8} align="center">
                <Title level={5} style={{ margin: 0 }}>AI Security Analysis</Title>
                <Tag
                  color={cfg.antColor}
                  icon={cfg.icon}
                  style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em' }}
                >
                  {cfg.label}
                </Tag>
              </Space>
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 2 }}>
                {cfg.description}
              </Text>
            </div>
          </Space>

          <Space size={6} wrap>
            {criticalCount > 0 && (
              <Tooltip title="Critical findings">
                <Badge count={criticalCount} color={T.red}>
                  <Tag color="red" style={{ fontSize: 11 }}>Critical</Tag>
                </Badge>
              </Tooltip>
            )}
            {highCount > 0 && (
              <Tooltip title="High-severity findings">
                <Badge count={highCount} color={T.orangeHigh}>
                  <Tag color="orange" style={{ fontSize: 11 }}>High</Tag>
                </Badge>
              </Tooltip>
            )}
            {analysis.model && (
              <Tooltip title={`Analysis generated by ${analysis.model}`}>
                <Text type="secondary" style={{ fontSize: 10, marginTop: 2 }}>
                  via {analysis.model}
                </Text>
              </Tooltip>
            )}
          </Space>
        </div>
      </div>

      {/* ── Executive summary ─────────────────────────────────────────────── */}
      <div style={{
        background: token.colorBgContainer,
        border: `1px solid ${token.colorBorder}`,
        borderTop: 'none',
        padding: '12px 18px',
        borderBottom: 'none',
      }}>
        <Text style={{ fontSize: 13, lineHeight: 1.6 }}>{analysis.summary}</Text>
      </div>

      {/* ── Per-change breakdown ───────────────────────────────────────────── */}
      {sortedChanges.length > 0 && (
        <div style={{
          border: `1px solid ${token.colorBorder}`,
          borderTop: 'none',
          borderRadius: '0 0 0 0',
          overflow: 'hidden',
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 14px',
            background: token.colorFillSecondary,
            borderBottom: `1px solid ${token.colorBorder}`,
          }}>
            <WarningOutlined style={{ color: token.colorTextSecondary, fontSize: 12 }} />
            <Text type="secondary" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Change Breakdown
            </Text>
            <Badge count={sortedChanges.length} color={token.colorPrimary} size="small" />
          </div>
          {sortedChanges.map((change, idx) => (
            <ChangeRow key={`${change.changeType}-${idx}`} change={change} />
          ))}
        </div>
      )}

      {/* ── Risk narrative ─────────────────────────────────────────────────── */}
      {analysis.riskNarrative && analysis.riskNarrative !== analysis.summary && (
        <div style={{
          background: token.colorFillAlter,
          border: `1px solid ${token.colorBorder}`,
          borderTop: 'none',
          borderRadius: '0 0 8px 8px',
          padding: '12px 18px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <InfoCircleOutlined style={{ fontSize: 12, color: token.colorTextSecondary }} />
            <Text type="secondary" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Risk Narrative
            </Text>
          </div>
          <Paragraph style={{ fontSize: 12, margin: 0, color: token.colorTextSecondary, lineHeight: 1.7 }}>
            {analysis.riskNarrative}
          </Paragraph>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
            <Space size={4}>
              <ClockCircleOutlined style={{ fontSize: 10, color: token.colorTextTertiary }} />
              <Text type="secondary" style={{ fontSize: 10 }}>
                Generated: {new Date(analysis.generatedAt).toLocaleString(undefined, {
                  year: 'numeric', month: 'short', day: 'numeric',
                  hour: '2-digit', minute: '2-digit',
                })}
              </Text>
            </Space>
          </div>
        </div>
      )}

      {/* ── No-change state ────────────────────────────────────────────────── */}
      {sortedChanges.length === 0 && (
        <div style={{
          border: `1px solid ${token.colorBorder}`,
          borderTop: 'none',
          borderRadius: '0 0 8px 8px',
          padding: '12px 18px',
          background: token.colorBgContainer,
        }}>
          <Space>
            <CheckCircleOutlined style={{ color: token.colorSuccess }} />
            <Text type="secondary" style={{ fontSize: 12 }}>
              No individual changes to report — the threat model is structurally identical.
            </Text>
          </Space>
        </div>
      )}
    </Space>
  );
}
