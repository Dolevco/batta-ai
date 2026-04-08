import { useState, useEffect, useCallback } from 'react';
import {
  Space, Typography, Breadcrumb, Spin, Alert, Timeline, Table, Tag, Collapse, Input, Button,
} from 'antd';
import {
  SafetyOutlined, CheckCircleOutlined, CloseCircleOutlined,
  ClockCircleOutlined, ExclamationCircleOutlined, QuestionCircleOutlined,
  InfoCircleOutlined, AuditOutlined, FileSearchOutlined,
  WarningOutlined, ApartmentOutlined,
  ApiOutlined, LinkOutlined, ThunderboltOutlined, BookOutlined,
  LockOutlined, RobotOutlined, GlobalOutlined, ArrowLeftOutlined,
  GithubOutlined, BranchesOutlined, SyncOutlined, EditOutlined, CheckOutlined, EyeOutlined,
} from '@ant-design/icons';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import type {
  SecurityReview, CorrelatedPR,
  SecurityReviewStatus, SecurityReviewAttestationSummary, PolicyTemplate, PolicyTemplateType,
} from '../types';
import { useSecurityReviews } from '../hooks/useSecurityReviews';
import { usePolicies } from '../hooks/usePolicies';
import { useTheme } from '../hooks/useTheme';
import { T, D, dk } from '../theme';
import AgentIcon from '../components/icons/AgentIcon';
import { ArchitectureDiffPanel } from '../components/ArchitectureDiffPanel';

const { Text } = Typography;

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<SecurityReviewStatus, { color: string; label: string; icon: React.ReactNode; step: number; bg: string; border: string; darkBg: string; darkBorder: string }> = {
  questionnaire_pending:  { color: T.stone500, label: 'Questionnaire Pending',         icon: <ClockCircleOutlined />,       step: 0, bg: T.stone100,   border: T.stone300,   darkBg: D.bgCard,      darkBorder: D.borderSub   },
  questionnaire_answered: { color: T.blue,     label: 'Tasks Pending Acknowledgement', icon: <ClockCircleOutlined />,       step: 1, bg: T.blueLight,  border: T.blueBorder,    darkBg: D.blueLight,   darkBorder: D.blueBorder  },
  tasks_acknowledged:     { color: T.amber,    label: 'Implementation In Progress',    icon: <ExclamationCircleOutlined />, step: 2, bg: T.amberLight, border: T.amberBorder, darkBg: D.amberLight, darkBorder: D.amberBorder },
  attested:               { color: T.green,    label: 'Attested',                      icon: <CheckCircleOutlined />,       step: 3, bg: T.greenLight, border: T.greenBorder, darkBg: D.greenLight, darkBorder: D.greenBorder },
};

const SEVERITY_CONFIG: Record<string, { color: string; bg: string; border: string; label: string; darkBg: string; darkBorder: string }> = {
  critical: { color: T.red,    bg: T.redLight,   border: T.redBorder,   label: 'Critical', darkBg: D.redLight,   darkBorder: D.redBorder   },
  high:     { color: T.orangeHigh, bg: T.orangeLight,   border: T.orangeHighBorder,     label: 'High',     darkBg: 'rgba(234,88,12,0.15)', darkBorder: 'rgba(234,88,12,0.3)' },
  medium:   { color: T.amber,  bg: T.amberLight, border: T.amberBorder, label: 'Medium',   darkBg: D.amberLight, darkBorder: D.amberBorder  },
  low:      { color: T.green,  bg: T.greenLight, border: T.greenBorder, label: 'Low',      darkBg: D.greenLight, darkBorder: D.greenBorder  },
};

function StatusPill({ status, isDark }: { status: SecurityReviewStatus; isDark: boolean }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '3px 10px', borderRadius: 20,
      fontSize: 11, fontWeight: 600, letterSpacing: '0.02em',
      background: dk(isDark, cfg.bg, cfg.darkBg),
      border: `1px solid ${dk(isDark, cfg.border, cfg.darkBorder)}`,
      color: cfg.color,
    }}>
      {cfg.icon} {cfg.label}
    </span>
  );
}

function SeverityBadge({ severity, isDark }: { severity: string; isDark: boolean }) {
  const cfg = SEVERITY_CONFIG[severity] ?? { color: T.stone500, bg: T.stone100, border: T.stone300, label: severity, darkBg: D.bgCard, darkBorder: D.borderSub };
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 4,
      fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' as const,
      background: dk(isDark, cfg.bg, cfg.darkBg),
      border: `1px solid ${dk(isDark, cfg.border, cfg.darkBorder)}`,
      color: cfg.color,
    }}>
      {cfg.label}
    </span>
  );
}

function formatDate(iso?: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function SectionHeader({ title, subtitle, isDark }: { title: string; subtitle?: string; isDark: boolean }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: dk(isDark, T.stone900, D.text) }}>{title}</h3>
      {subtitle && <p style={{ margin: '3px 0 0', fontSize: 12, color: T.stone400 }}>{subtitle}</p>}
    </div>
  );
}

function MetaRow({ label, children, isDark }: { label: string; children: React.ReactNode; isDark: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 12, padding: '10px 0', borderBottom: `1px solid ${dk(isDark, T.stone100, D.border)}`, alignItems: 'flex-start' }}>
      <span style={{ fontSize: 12, color: T.stone400, minWidth: 140, flexShrink: 0, paddingTop: 2 }}>{label}</span>
      <span style={{ fontSize: 13, color: dk(isDark, T.stone800, D.text), flex: 1 }}>{children}</span>
    </div>
  );
}

// ── Overview section ───────────────────────────────────────────────────────────

function OverviewSection({ review, summary, isDark }: { review: SecurityReview; summary: SecurityReviewAttestationSummary | null; isDark: boolean }) {
  const navigate = useNavigate();

  const STEPS = [
    { label: 'Questionnaire',       icon: <QuestionCircleOutlined />, key: 'questionnaire_pending' },
    { label: 'Tasks Acknowledged',  icon: <AuditOutlined />,          key: 'questionnaire_answered' },
    { label: 'Implementation',      icon: <FileSearchOutlined />,     key: 'tasks_acknowledged' },
    { label: 'Attested',            icon: <CheckCircleOutlined />,    key: 'attested' },
  ];
  const currentStep = STATUS_CONFIG[review.status].step;

  const criticalCount = review.tasks.filter(t => t.severity === 'critical').length;
  const highCount     = review.tasks.filter(t => t.severity === 'high').length;
  const handledCount  = review.attestations.filter(a => a.handled).length;
  const compliancePct = review.tasks.length > 0 ? Math.round((handledCount / review.tasks.length) * 100) : null;

  return (
    <div>
      <SectionHeader isDark={isDark} title="Review Overview" subtitle="Full lifecycle status of this security review" />

      {/* Progress stepper */}
      <div style={{
        background: dk(isDark, T.stone50, D.bgSub),
        border: `1px solid ${dk(isDark, T.stone200, D.borderSub)}`,
        borderRadius: 12, padding: '24px 32px', marginBottom: 24,
      }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {STEPS.map((step, idx) => {
            const done      = currentStep > idx;
            const active    = currentStep === idx;
            const iconBg    = done ? T.green : active ? T.orange : dk(isDark, T.stone200, D.borderSub);
            const textColor = done ? T.green : active ? T.orange : T.stone400;
            return (
              <div key={idx} style={{ display: 'flex', alignItems: 'center', flex: idx < STEPS.length - 1 ? 1 : 0 }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 80 }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: '50%', display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                    background: iconBg, color: '#fff', fontSize: 15,
                    boxShadow: active ? `0 0 0 4px ${dk(isDark, T.orangeLight, D.orangeLight)}` : done ? `0 0 0 3px ${dk(isDark, T.greenLight, D.greenLight)}` : 'none',
                    transition: 'all 0.2s',
                  }}>
                    {done ? <CheckCircleOutlined /> : step.icon}
                  </div>
                  <span style={{ fontSize: 11, marginTop: 6, color: textColor, textAlign: 'center', fontWeight: active ? 600 : 400, maxWidth: 80 }}>
                    {step.label}
                  </span>
                </div>
                {idx < STEPS.length - 1 && (
                  <div style={{
                    flex: 1, height: 2, margin: '0 4px',
                    background: currentStep > idx
                      ? `linear-gradient(90deg, ${T.green}, ${currentStep > idx + 1 ? T.green : dk(isDark, T.stone300, D.borderSub)})`
                      : dk(isDark, T.stone200, D.borderSub),
                    marginBottom: 20, borderRadius: 2,
                  }} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Key stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
        {[
          { label: 'Total Tasks',    value: review.tasks.length,   color: dk(isDark, T.stone800, D.text), icon: <FileSearchOutlined /> },
          { label: 'Critical',       value: criticalCount,         color: criticalCount > 0 ? T.red : T.green, icon: <WarningOutlined /> },
          { label: 'High Severity',  value: highCount,             color: highCount > 0 ? T.orangeHigh : T.green, icon: <ExclamationCircleOutlined /> },
          { label: 'Handled',        value: `${handledCount}/${review.tasks.length}`, color: T.green, icon: <CheckCircleOutlined /> },
        ].map(stat => (
          <div key={stat.label} style={{
            background: dk(isDark, T.white, D.bgCard),
            border: `1px solid ${dk(isDark, T.stone200, D.borderSub)}`,
            borderRadius: 10, padding: '16px 20px',
          }}>
            <div style={{ fontSize: 11, color: T.stone400, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 8 }}>
              {stat.label}
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: stat.color, display: 'flex', alignItems: 'center', gap: 8 }}>
              {stat.value}
            </div>
          </div>
        ))}
      </div>

      {/* Compliance bar */}
      {compliancePct !== null && (
        <div style={{
          background: dk(isDark, T.white, D.bgCard),
          border: `1px solid ${dk(isDark, T.stone200, D.borderSub)}`,
          borderRadius: 10, padding: '16px 20px', marginBottom: 24,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, alignItems: 'center' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: dk(isDark, T.stone800, D.text) }}>Compliance Score</span>
            <span style={{ fontSize: 20, fontWeight: 700, color: compliancePct === 100 ? T.green : criticalCount > 0 ? T.red : T.amber }}>
              {compliancePct}%
            </span>
          </div>
          <div style={{ height: 8, background: dk(isDark, T.stone100, D.border), borderRadius: 4, overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${compliancePct}%`,
              background: compliancePct === 100 ? T.green : criticalCount > 0
                ? `linear-gradient(90deg, ${T.red}, ${T.amber})`
                : `linear-gradient(90deg, ${T.orange}, ${T.amber})`,
              borderRadius: 4, transition: 'width 0.5s ease',
            }} />
          </div>
        </div>
      )}

      {/* Attestation summary inline — shown in overview once attested */}
      {review.status === 'attested' && summary && (() => {
        const pct = summary.totalTasks > 0 ? Math.round((summary.handledTasks / summary.totalTasks) * 100) : 100;
        const isFullyCompliant = pct === 100 && summary.criticalUnhandledCount === 0;
        const heroColor = isFullyCompliant ? T.green : summary.criticalUnhandledCount > 0 ? T.red : T.amber;
        const heroBg = isFullyCompliant
          ? dk(isDark, `linear-gradient(135deg, ${T.greenLight}, #DCFCE7)`, `linear-gradient(135deg, ${D.greenLight}, rgba(22,163,74,0.2))`)
          : summary.criticalUnhandledCount > 0
            ? dk(isDark, `linear-gradient(135deg, ${T.redLight}, #FFE4E6)`, `linear-gradient(135deg, ${D.redLight}, rgba(220,38,38,0.2))`)
            : dk(isDark, `linear-gradient(135deg, ${T.amberLight}, #FEF9C3)`, `linear-gradient(135deg, ${D.amberLight}, rgba(217,119,6,0.2))`);
        const heroBorder = isFullyCompliant
          ? dk(isDark, T.greenBorder, D.greenBorder)
          : summary.criticalUnhandledCount > 0
            ? dk(isDark, T.redBorder, D.redBorder)
            : dk(isDark, T.amberBorder, D.amberBorder);
        return (
          <div style={{
            background: heroBg,
            border: `1px solid ${heroBorder}`,
            borderRadius: 12, padding: '18px 22px', marginBottom: 24,
            display: 'flex', alignItems: 'center', gap: 16,
          }}>
            <div style={{
              width: 46, height: 46, borderRadius: '50%', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: heroColor, color: '#fff', fontSize: 20,
            }}>
              {isFullyCompliant ? <CheckCircleOutlined /> : <ExclamationCircleOutlined />}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: heroColor }}>
                {pct}% compliant
              </div>
              <div style={{ fontSize: 12, color: dk(isDark, T.stone600, D.textMuted), marginTop: 3 }}>
                {isFullyCompliant
                  ? 'All security tasks handled — this feature is cleared for merge.'
                  : summary.criticalUnhandledCount > 0
                    ? `${summary.criticalUnhandledCount} critical task${summary.criticalUnhandledCount > 1 ? 's' : ''} unresolved — review before merging.`
                    : `${summary.unhandledTasks} task${summary.unhandledTasks > 1 ? 's' : ''} not fully handled — consider addressing before release.`
                }
              </div>
              {summary.criticalUnhandled.length > 0 && (
                <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {summary.criticalUnhandled.map(t => (
                    <span key={t.id} style={{
                      fontSize: 11, padding: '1px 8px', borderRadius: 4,
                      background: dk(isDark, T.redLight, D.redLight),
                      border: `1px solid ${dk(isDark, T.redBorder, D.redBorder)}`,
                      color: T.red,
                    }}>
                      ⚠ {t.title}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flexShrink: 0 }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: T.green }}>{summary.handledTasks}</div>
              <div style={{ fontSize: 10, color: T.stone400, textTransform: 'uppercase', letterSpacing: '0.05em' }}>handled</div>
            </div>
            {summary.unhandledTasks > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: T.red }}>{summary.unhandledTasks}</div>
                <div style={{ fontSize: 10, color: T.stone400, textTransform: 'uppercase', letterSpacing: '0.05em' }}>not handled</div>
              </div>
            )}
          </div>
        );
      })()}

      {/* Meta details */}
      <div style={{
        background: dk(isDark, T.white, D.bgCard),
        border: `1px solid ${dk(isDark, T.stone200, D.borderSub)}`,
        borderRadius: 10, padding: '4px 20px', marginBottom: 24,
      }}>
        <MetaRow isDark={isDark} label="Review ID">
          <Text code copyable style={{ fontSize: 11 }}>{review.id}</Text>
        </MetaRow>
        {review.title && (
          <MetaRow isDark={isDark} label="Title">
            <span style={{ color: dk(isDark, T.stone800, D.text), fontWeight: 600 }}>{review.title}</span>
          </MetaRow>
        )}
        <MetaRow isDark={isDark} label="Feature Description">
          <span style={{ color: dk(isDark, T.stone800, D.text) }}>{review.featureDescription}</span>
        </MetaRow>
        <MetaRow isDark={isDark} label="Status">
          <StatusPill status={review.status} isDark={isDark} />
        </MetaRow>
        <MetaRow isDark={isDark} label="Initiated by">
          {review.agentName ? (
            <Space size={6}>
              <AgentIcon agentName={review.agentName} />
              <span style={{ color: dk(isDark, T.stone800, D.text) }}>{review.agentName}</span>
            </Space>
          ) : '—'}
        </MetaRow>
        <MetaRow isDark={isDark} label="Human responsible">
          {review.humanResponsible ? (
            <span style={{ color: dk(isDark, T.stone800, D.text) }}>{review.humanResponsible}</span>
          ) : '—'}
        </MetaRow>
        <MetaRow isDark={isDark} label="Services Affected">
          {review.services?.length ? (
            <Space size={4} wrap>
              {review.services.map(svc => (
                <span key={svc} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '2px 8px', borderRadius: 4, fontSize: 11,
                  background: dk(isDark, T.blueLight, D.blueLight),
                  border: `1px solid ${dk(isDark, T.blueBorder, D.blueBorder)}`,
                  color: T.blue,
                }}>
                  <ApiOutlined style={{ fontSize: 10 }} /> {svc}
                </span>
              ))}
            </Space>
          ) : '—'}
        </MetaRow>
        <MetaRow isDark={isDark} label="Repository">
          {review.repository ? (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '2px 8px', borderRadius: 4, fontSize: 11,
              background: dk(isDark, T.stone50, D.bgSub),
              border: `1px solid ${dk(isDark, T.stone200, D.borderSub)}`,
              color: dk(isDark, T.stone600, D.textMuted),
              fontFamily: 'monospace',
            }}>
              <GithubOutlined style={{ fontSize: 11 }} /> {review.repository}
            </span>
          ) : '—'}
        </MetaRow>
        <MetaRow isDark={isDark} label="PR / MR Link">
          {review.correlatedPR ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <a
                href={review.correlatedPR.prUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  padding: '2px 8px', borderRadius: 4, fontSize: 11,
                  background: dk(isDark, T.blueLight, D.blueLight),
                  border: `1px solid ${dk(isDark, T.blueBorder, D.blueBorder)}`,
                  color: T.blue, textDecoration: 'none',
                }}
              >
                <BranchesOutlined style={{ fontSize: 11 }} />
                {review.correlatedPR.prTitle}
                <span style={{ color: T.stone400, marginLeft: 2 }}>
                  #{review.correlatedPR.prNumber}
                </span>
              </a>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <PRStateChip state={review.correlatedPR.prState} isDark={isDark} />
                <CorrelationScoreBadge score={review.correlatedPR.correlationScore} isDark={isDark} />
                <span style={{ fontSize: 10, color: T.stone400 }}>
                  {review.correlatedPR.provider === 'github' ? 'GitHub' : 'GitLab'} · {review.correlatedPR.repository}
                </span>
              </div>
            </div>
          ) : review.prLink ? (
            <a
              href={review.prLink}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '2px 8px', borderRadius: 4, fontSize: 11,
                background: dk(isDark, T.blueLight, D.blueLight),
                border: `1px solid ${dk(isDark, T.blueBorder, D.blueBorder)}`,
                color: T.blue, textDecoration: 'none',
              }}
            >
              <LinkOutlined style={{ fontSize: 11 }} /> {review.prLink}
            </a>
          ) : '—'}
        </MetaRow>
        <MetaRow isDark={isDark} label="Created">{formatDate(review.createdAt)}</MetaRow>
        <MetaRow isDark={isDark} label="Completed">{formatDate(review.completedAt)}</MetaRow>
      </div>

      {/* Linked features */}
      {(() => {
        const linkedIds = new Set(review.linkedFeatureIds ?? []);
        const linked = linkedIds.size > 0
          ? (review.matchedFeatures ?? []).filter(f => linkedIds.has(f.id))
          : [];
        if (!linked.length) return null;
        return (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <ThunderboltOutlined style={{ color: T.orange }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: dk(isDark, T.stone800, D.text) }}>Associated Features</span>
              <span style={{
                padding: '1px 7px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                background: dk(isDark, T.orangeLight, D.orangeLight),
                border: `1px solid ${dk(isDark, T.orangeBorder, D.orangeBorder)}`,
                color: T.orange,
              }}>{linked.length}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
              {linked.map(f => (
                <div
                  key={f.id}
                  onClick={() => navigate(`/knowledge-base/features/${encodeURIComponent(f.id)}`)}
                  style={{
                    background: dk(isDark, T.white, D.bgCard),
                    border: `1px solid ${dk(isDark, T.stone200, D.borderSub)}`,
                    borderRadius: 10,
                    padding: '12px 16px', cursor: 'pointer', transition: 'border-color 0.15s, box-shadow 0.15s',
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLElement).style.borderColor = T.orange;
                    (e.currentTarget as HTMLElement).style.boxShadow = `0 2px 12px rgba(249,115,22,0.12)`;
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLElement).style.borderColor = dk(isDark, T.stone200, D.borderSub);
                    (e.currentTarget as HTMLElement).style.boxShadow = 'none';
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: dk(isDark, T.stone800, D.text) }}>{f.name}</span>
                    <LinkOutlined style={{ color: T.orange, fontSize: 12 }} />
                  </div>
                  <p style={{ margin: 0, fontSize: 12, color: T.stone400, lineHeight: 1.5 }}>{f.description}</p>
                </div>
              ))}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ── Questionnaire section ──────────────────────────────────────────────────────

function QuestionnaireSection({ review, isDark }: { review: SecurityReview; isDark: boolean }) {
  const answered = review.answers.length;
  const total    = review.questions.length;
  const yesCount = review.answers.filter(a => a.answer.trim().toLowerCase().startsWith('yes')).length;
  const noCount  = review.answers.filter(a => a.answer.trim().toLowerCase().startsWith('no')).length;

  return (
    <div>
      <SectionHeader
        isDark={isDark}
        title="Security Questionnaire"
        subtitle="Agent-answered pre-flight questions that shaped the security task list"
      />

      {/* Answer stats */}
      {answered > 0 && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
          {[
            { label: 'Answered',    value: `${answered}/${total}`, color: dk(isDark, T.stone800, D.text), bg: dk(isDark, T.stone100, D.bgCard),     border: dk(isDark, T.stone200, D.borderSub) },
            { label: 'Yes answers', value: yesCount,               color: T.amber,                        bg: dk(isDark, T.amberLight, D.amberLight), border: dk(isDark, T.amberBorder, D.amberBorder) },
            { label: 'No answers',  value: noCount,                color: T.blue,                         bg: dk(isDark, T.blueLight, D.blueLight),   border: dk(isDark, T.blueBorder, D.blueBorder) },
          ].map(s => (
            <div key={s.label} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 16px', borderRadius: 8,
              background: s.bg, border: `1px solid ${s.border}`,
            }}>
              <span style={{ fontSize: 18, fontWeight: 700, color: s.color }}>{s.value}</span>
              <span style={{ fontSize: 11, color: T.stone500 }}>{s.label}</span>
            </div>
          ))}
        </div>
      )}

      {answered === 0 && (
        <div style={{
          background: dk(isDark, T.blueLight, D.blueLight),
          border: `1px solid ${dk(isDark, T.blueBorder, D.blueBorder)}`,
          borderRadius: 10,
          padding: '14px 18px', marginBottom: 20, display: 'flex', gap: 10, alignItems: 'flex-start',
        }}>
          <InfoCircleOutlined style={{ color: T.blue, marginTop: 2 }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: T.blue }}>Questionnaire not yet answered</div>
            <div style={{ fontSize: 12, color: dk(isDark, T.stone500, D.textMuted), marginTop: 2 }}>
              The coding agent will answer these questions before receiving security tasks.
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {review.questions.map((q, idx) => {
          const ans = review.answers.find(a => a.questionId === q.id);
          const isYes = ans?.answer.trim().toLowerCase().startsWith('yes');
          const isNo  = ans?.answer.trim().toLowerCase().startsWith('no');
          const pillColor = isYes ? { bg: dk(isDark, T.amberLight, D.amberLight), border: dk(isDark, T.amberBorder, D.amberBorder), color: T.amber, label: 'Yes' }
                          : isNo  ? { bg: dk(isDark, T.blueLight, D.blueLight),   border: dk(isDark, T.blueBorder, D.blueBorder),      color: T.blue,  label: 'No' }
                          : null;
          return (
            <div
              key={q.id}
              style={{
                background: dk(isDark, T.white, D.bgCard),
                border: `1px solid ${dk(isDark, T.stone200, D.borderSub)}`,
                borderRadius: 10, padding: '14px 18px',
                borderLeft: ans ? `3px solid ${isYes ? T.amber : T.blue}` : `3px solid ${dk(isDark, T.stone300, D.borderSub)}`,
              }}
            >
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <span style={{
                  flexShrink: 0, width: 22, height: 22, borderRadius: 6,
                  background: dk(isDark, T.stone100, D.border),
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 700, color: T.stone500,
                }}>
                  {idx + 1}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: dk(isDark, T.stone800, D.text), marginBottom: q.hint ? 4 : 0 }}>
                    {q.question}
                  </div>
                  {q.hint && (
                    <div style={{ fontSize: 11, color: T.stone400, marginBottom: 8 }}>{q.hint}</div>
                  )}
                  {ans ? (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 8 }}>
                      {pillColor && (
                        <span style={{
                          flexShrink: 0, display: 'inline-block', padding: '2px 10px', borderRadius: 20,
                          fontSize: 11, fontWeight: 700, background: pillColor.bg, border: `1px solid ${pillColor.border}`, color: pillColor.color,
                        }}>
                          {pillColor.label}
                        </span>
                      )}
                      <span style={{ fontSize: 12, color: dk(isDark, T.stone600, D.textMuted), lineHeight: 1.6 }}>{ans.answer}</span>
                    </div>
                  ) : (
                    <span style={{ fontSize: 12, color: T.stone400, fontStyle: 'italic' }}>Unanswered</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Tasks section ──────────────────────────────────────────────────────────────

function TasksSection({ review, isDark }: { review: SecurityReview; isDark: boolean }) {
  if (review.tasks.length === 0) {
    return (
      <div>
        <SectionHeader isDark={isDark} title="Security Tasks" subtitle="Tasks generated by the security review engine" />
        <div style={{
          background: dk(isDark, T.blueLight, D.blueLight),
          border: `1px solid ${dk(isDark, T.blueBorder, D.blueBorder)}`,
          borderRadius: 10,
          padding: '14px 18px', display: 'flex', gap: 10, alignItems: 'flex-start',
        }}>
          <InfoCircleOutlined style={{ color: T.blue }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: T.blue }}>No security tasks yet</div>
            <div style={{ fontSize: 12, color: dk(isDark, T.stone500, D.textMuted), marginTop: 2 }}>Tasks are generated after the questionnaire is answered.</div>
          </div>
        </div>
      </div>
    );
  }

  const byOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  const sorted = [...review.tasks].sort((a, b) => (byOrder[a.severity] ?? 4) - (byOrder[b.severity] ?? 4));

  return (
    <div>
      <SectionHeader
        isDark={isDark}
        title="Security Tasks"
        subtitle={`${review.tasks.length} task${review.tasks.length !== 1 ? 's' : ''} identified — ordered by severity`}
      />

      {/* Severity summary pills */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' as const }}>
        {(['critical', 'high', 'medium', 'low'] as const).map(sev => {
          const count = review.tasks.filter(t => t.severity === sev).length;
          if (!count) return null;
          const cfg = SEVERITY_CONFIG[sev];
          return (
            <span key={sev} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '4px 12px', borderRadius: 8,
              background: dk(isDark, cfg.bg, cfg.darkBg),
              border: `1px solid ${dk(isDark, cfg.border, cfg.darkBorder)}`,
            }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: cfg.color }}>{count}</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: cfg.color, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{sev}</span>
            </span>
          );
        })}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {sorted.map(task => {
          const att = review.attestations.find(a => a.taskId === task.id);
          const cfg = SEVERITY_CONFIG[task.severity];
          const isHandled   = att?.handled === true;
          const isUnhandled = att?.handled === false;

          return (
            <div
              key={task.id}
              style={{
                background: dk(isDark, T.white, D.bgCard),
                borderRadius: 10,
                border: `1px solid ${dk(isDark, T.stone200, D.borderSub)}`,
                borderLeft: `4px solid ${cfg.color}`,
                overflow: 'hidden',
              }}
            >
              <div style={{ padding: '14px 18px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' as const }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' as const }}>
                      <SeverityBadge severity={task.severity} isDark={isDark} />
                      <span style={{
                        padding: '1px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                        letterSpacing: '0.04em',
                        background: dk(isDark, T.blueLight, D.blueLight),
                        border: `1px solid ${dk(isDark, T.blueBorder, D.blueBorder)}`,
                        color: T.blue,
                        textTransform: 'uppercase' as const,
                      }}>
                        {task.principle}
                      </span>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: dk(isDark, T.stone900, D.text), marginBottom: 4 }}>{task.title}</div>
                    <div style={{ fontSize: 12, color: dk(isDark, T.stone500, D.textMuted), lineHeight: 1.6 }}>{task.description}</div>
                  </div>

                  {/* Attestation status badge */}
                  <div style={{ flexShrink: 0, display: 'flex', alignItems: 'flex-start' }}>
                    {isHandled ? (
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                        background: dk(isDark, T.greenLight, D.greenLight),
                        border: `1px solid ${dk(isDark, T.greenBorder, D.greenBorder)}`,
                        color: T.green,
                      }}>
                        <CheckCircleOutlined /> Handled
                      </span>
                    ) : isUnhandled ? (
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                        background: dk(isDark, T.redLight, D.redLight),
                        border: `1px solid ${dk(isDark, T.redBorder, D.redBorder)}`,
                        color: T.red,
                      }}>
                        <CloseCircleOutlined /> Not Handled
                      </span>
                    ) : (
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                        background: dk(isDark, T.stone100, D.bgCard),
                        border: `1px solid ${dk(isDark, T.stone300, D.borderSub)}`,
                        color: T.stone500,
                      }}>
                        <ClockCircleOutlined /> Pending
                      </span>
                    )}
                  </div>
                </div>

                {/* Attestation notes */}
                {att?.notes && (
                  <div style={{
                    marginTop: 10, padding: '10px 14px', borderRadius: 8,
                    background: isHandled ? dk(isDark, T.greenLight, D.greenLight) : dk(isDark, T.redLight, D.redLight),
                    border: `1px solid ${isHandled ? dk(isDark, T.greenBorder, D.greenBorder) : dk(isDark, T.redBorder, D.redBorder)}`,
                  }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: isHandled ? T.green : T.red, marginBottom: 4 }}>
                      Agent attestation
                    </div>
                    <div style={{ fontSize: 12, color: dk(isDark, T.stone700, D.textMuted), lineHeight: 1.6 }}>{att.notes}</div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Attestations section ───────────────────────────────────────────────────────

function AttestationsSection({ review, isDark }: { review: SecurityReview; isDark: boolean }) {
  if (review.attestations.length === 0) {
    return (
      <div>
        <SectionHeader isDark={isDark} title="Attestations" subtitle="Agent-submitted proof of security task handling" />
        <div style={{
          background: dk(isDark, T.blueLight, D.blueLight),
          border: `1px solid ${dk(isDark, T.blueBorder, D.blueBorder)}`,
          borderRadius: 10,
          padding: '14px 18px', display: 'flex', gap: 10, alignItems: 'flex-start',
        }}>
          <InfoCircleOutlined style={{ color: T.blue }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: T.blue }}>No attestations yet</div>
            <div style={{ fontSize: 12, color: dk(isDark, T.stone500, D.textMuted), marginTop: 2 }}>Attestations are submitted by the coding agent after implementing the feature.</div>
          </div>
        </div>
      </div>
    );
  }

  const handled   = review.attestations.filter(a => a.handled).length;
  const unhandled = review.attestations.filter(a => !a.handled).length;

  return (
    <div>
      <SectionHeader
        isDark={isDark}
        title="Attestations"
        subtitle="Cryptographic audit trail — every task has been reviewed and documented by the agent"
      />

      {/* Summary bar */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
        <div style={{
          flex: 1,
          background: dk(isDark, T.greenLight, D.greenLight),
          border: `1px solid ${dk(isDark, T.greenBorder, D.greenBorder)}`,
          borderRadius: 10, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <CheckCircleOutlined style={{ fontSize: 20, color: T.green }} />
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, color: T.green }}>{handled}</div>
            <div style={{ fontSize: 11, color: dk(isDark, T.stone500, D.textMuted) }}>Tasks handled</div>
          </div>
        </div>
        {unhandled > 0 && (
          <div style={{
            flex: 1,
            background: dk(isDark, T.redLight, D.redLight),
            border: `1px solid ${dk(isDark, T.redBorder, D.redBorder)}`,
            borderRadius: 10, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <CloseCircleOutlined style={{ fontSize: 20, color: T.red }} />
            <div>
              <div style={{ fontSize: 22, fontWeight: 700, color: T.red }}>{unhandled}</div>
              <div style={{ fontSize: 11, color: dk(isDark, T.stone500, D.textMuted) }}>Tasks not handled</div>
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {review.tasks.map(task => {
          const att = review.attestations.find(a => a.taskId === task.id);
          const isHandled = att?.handled ?? false;

          return (
            <div
              key={task.id}
              style={{
                background: dk(isDark, T.white, D.bgCard),
                borderRadius: 10,
                border: `1px solid ${isHandled ? dk(isDark, T.greenBorder, D.greenBorder) : dk(isDark, T.redBorder, D.redBorder)}`,
                borderLeft: `4px solid ${isHandled ? T.green : T.red}`,
              }}
            >
              <div style={{ padding: '14px 18px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 8, flexWrap: 'wrap' as const }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const }}>
                    {isHandled
                      ? <CheckCircleOutlined style={{ color: T.green, fontSize: 15 }} />
                      : <CloseCircleOutlined style={{ color: T.red,   fontSize: 15 }} />
                    }
                    <span style={{ fontSize: 13, fontWeight: 600, color: dk(isDark, T.stone900, D.text) }}>{task.title}</span>
                    <SeverityBadge severity={task.severity} isDark={isDark} />
                    <span style={{
                      padding: '1px 7px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                      background: dk(isDark, T.blueLight, D.blueLight),
                      border: `1px solid ${dk(isDark, T.blueBorder, D.blueBorder)}`,
                      color: T.blue, textTransform: 'uppercase' as const,
                    }}>
                      {task.principle}
                    </span>
                  </div>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    padding: '2px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                    background: isHandled ? dk(isDark, T.greenLight, D.greenLight) : dk(isDark, T.redLight, D.redLight),
                    border: `1px solid ${isHandled ? dk(isDark, T.greenBorder, D.greenBorder) : dk(isDark, T.redBorder, D.redBorder)}`,
                    color: isHandled ? T.green : T.red,
                  }}>
                    {isHandled ? 'Handled' : 'Not Handled'}
                  </span>
                </div>

                {att ? (
                  <div style={{
                    padding: '10px 14px', borderRadius: 8,
                    background: isHandled ? dk(isDark, T.greenLight, D.greenLight) : dk(isDark, T.redLight, D.redLight),
                    border: `1px solid ${isHandled ? dk(isDark, T.greenBorder, D.greenBorder) : dk(isDark, T.redBorder, D.redBorder)}`,
                  }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: isHandled ? T.green : T.red, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <AgentIcon agentName={review.agentName ?? 'Agent'} fontSize={11} />
                      Agent notes
                    </div>
                    <div style={{ fontSize: 12, color: dk(isDark, T.stone700, D.textMuted), lineHeight: 1.6 }}>{att.notes}</div>
                  </div>
                ) : (
                  <span style={{ fontSize: 12, color: T.stone400, fontStyle: 'italic' }}>No attestation submitted for this task.</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Summary section ────────────────────────────────────────────────────────────

function SummarySection({
  review,
  summary,
  isDark,
}: {
  review: SecurityReview;
  summary: SecurityReviewAttestationSummary | null;
  isDark: boolean;
}) {
  if (review.status !== 'attested') {
    return (
      <div>
        <SectionHeader isDark={isDark} title="Summary" subtitle="Final compliance report" />
        <div style={{
          background: dk(isDark, T.blueLight, D.blueLight),
          border: `1px solid ${dk(isDark, T.blueBorder, D.blueBorder)}`,
          borderRadius: 10,
          padding: '14px 18px', display: 'flex', gap: 10, alignItems: 'flex-start',
        }}>
          <InfoCircleOutlined style={{ color: T.blue }} />
          <div style={{ fontSize: 13, color: T.blue }}>
            Attestation summary is available after the review is fully attested.
          </div>
        </div>
      </div>
    );
  }

  if (!summary) return <Spin />;

  const pct = summary.totalTasks > 0 ? Math.round((summary.handledTasks / summary.totalTasks) * 100) : 100;
  const isFullyCompliant = pct === 100 && summary.criticalUnhandledCount === 0;
  const heroColor = isFullyCompliant ? T.green : summary.criticalUnhandledCount > 0 ? T.red : T.amber;
  const heroBg = isFullyCompliant
    ? dk(isDark, `linear-gradient(135deg, ${T.greenLight}, #DCFCE7)`, `linear-gradient(135deg, ${D.greenLight}, rgba(22,163,74,0.2))`)
    : summary.criticalUnhandledCount > 0
      ? dk(isDark, `linear-gradient(135deg, ${T.redLight}, #FFE4E6)`, `linear-gradient(135deg, ${D.redLight}, rgba(220,38,38,0.2))`)
      : dk(isDark, `linear-gradient(135deg, ${T.amberLight}, #FEF9C3)`, `linear-gradient(135deg, ${D.amberLight}, rgba(217,119,6,0.2))`);
  const heroBorder = isFullyCompliant
    ? dk(isDark, T.greenBorder, D.greenBorder)
    : summary.criticalUnhandledCount > 0
      ? dk(isDark, T.redBorder, D.redBorder)
      : dk(isDark, T.amberBorder, D.amberBorder);

  return (
    <div>
      <SectionHeader isDark={isDark} title="Compliance Summary" subtitle="Final audit record for this security review" />

      {/* Hero compliance card */}
      <div style={{
        background: heroBg,
        border: `1px solid ${heroBorder}`,
        borderRadius: 14, padding: '24px 28px', marginBottom: 24,
        display: 'flex', alignItems: 'center', gap: 20,
      }}>
        <div style={{
          width: 56, height: 56, borderRadius: '50%', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: heroColor,
          color: '#fff', fontSize: 24,
        }}>
          {isFullyCompliant ? <CheckCircleOutlined /> : <ExclamationCircleOutlined />}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 26, fontWeight: 800, color: heroColor }}>
            {pct}% compliant
          </div>
          <div style={{ fontSize: 13, color: dk(isDark, T.stone600, D.textMuted), marginTop: 4 }}>
            {isFullyCompliant
              ? 'All security tasks handled — this feature is cleared for merge.'
              : summary.criticalUnhandledCount > 0
                ? `${summary.criticalUnhandledCount} critical task${summary.criticalUnhandledCount > 1 ? 's' : ''} unresolved — review before merging.`
                : `${summary.unhandledTasks} task${summary.unhandledTasks > 1 ? 's' : ''} not fully handled — consider addressing before release.`
            }
          </div>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
        {[
          { label: 'Total Tasks',        value: summary.totalTasks,              color: dk(isDark, T.stone800, D.text),    bg: dk(isDark, T.stone50, D.bgSub),      border: dk(isDark, T.stone200, D.borderSub) },
          { label: 'Handled',            value: summary.handledTasks,            color: T.green,                            bg: dk(isDark, T.greenLight, D.greenLight), border: dk(isDark, T.greenBorder, D.greenBorder) },
          { label: 'Not Handled',        value: summary.unhandledTasks,          color: summary.unhandledTasks > 0 ? T.red : T.green,       bg: summary.unhandledTasks > 0 ? dk(isDark, T.redLight, D.redLight) : dk(isDark, T.greenLight, D.greenLight),         border: summary.unhandledTasks > 0 ? dk(isDark, T.redBorder, D.redBorder) : dk(isDark, T.greenBorder, D.greenBorder) },
          { label: 'Critical Unhandled', value: summary.criticalUnhandledCount,  color: summary.criticalUnhandledCount > 0 ? T.red : T.green, bg: summary.criticalUnhandledCount > 0 ? dk(isDark, T.redLight, D.redLight) : dk(isDark, T.greenLight, D.greenLight), border: summary.criticalUnhandledCount > 0 ? dk(isDark, T.redBorder, D.redBorder) : dk(isDark, T.greenBorder, D.greenBorder) },
        ].map(s => (
          <div key={s.label} style={{
            background: s.bg, border: `1px solid ${s.border}`, borderRadius: 10, padding: '16px 20px',
          }}>
            <div style={{ fontSize: 11, color: T.stone400, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
              {s.label}
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Timeline */}
      <div style={{
        background: dk(isDark, T.white, D.bgCard),
        border: `1px solid ${dk(isDark, T.stone200, D.borderSub)}`,
        borderRadius: 10, padding: '20px 24px', marginBottom: 24,
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: dk(isDark, T.stone800, D.text), marginBottom: 16 }}>Review Timeline</div>
        <Timeline
          items={[
            { color: 'green', children: (<><span style={{ fontWeight: 600, fontSize: 13, color: dk(isDark, T.stone800, D.text) }}>Review started</span><br /><span style={{ fontSize: 12, color: T.stone400 }}>{formatDate(review.createdAt)}</span></>) },
            { color: review.answers.length > 0 ? 'green' : 'gray', children: (<><span style={{ fontWeight: 600, fontSize: 13, color: dk(isDark, T.stone800, D.text) }}>Questionnaire answered</span><br /><span style={{ fontSize: 12, color: T.stone400 }}>{review.answers.length > 0 ? `${review.questions.length} questions answered` : 'Not yet answered'}</span></>) },
            { color: ['tasks_acknowledged', 'attested'].includes(review.status) ? 'green' : 'gray', children: (<><span style={{ fontWeight: 600, fontSize: 13, color: dk(isDark, T.stone800, D.text) }}>Tasks acknowledged</span><br /><span style={{ fontSize: 12, color: T.stone400 }}>{review.tasks.length} security tasks</span></>) },
            { color: 'green', dot: <CheckCircleOutlined />, children: (<><span style={{ fontWeight: 600, fontSize: 13, color: dk(isDark, T.stone800, D.text) }}>Attestations submitted</span><br /><span style={{ fontSize: 12, color: T.stone400 }}>{formatDate(review.completedAt)}</span></>) },
          ]}
        />
      </div>

      {/* Critical unhandled */}
      {summary.criticalUnhandled.length > 0 && (
        <div style={{
          background: dk(isDark, T.redLight, D.redLight),
          border: `2px solid ${dk(isDark, T.redBorder, D.redBorder)}`,
          borderRadius: 10, padding: '18px 22px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <WarningOutlined style={{ color: T.red, fontSize: 16 }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: T.red }}>Critical Unhandled Tasks</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {summary.criticalUnhandled.map(t => (
              <div key={t.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <CloseCircleOutlined style={{ color: T.red, flexShrink: 0 }} />
                <span style={{ fontSize: 13, color: dk(isDark, T.stone800, D.text) }}>{t.title}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Feature DFD baseline panel ────────────────────────────────────────────────

const CLASSIFICATION_COLOR: Record<string, string> = {
  public: 'green',
  internal: 'blue',
  confidential: 'orange',
  restricted: 'red',
};

function FeatureBaselinePanel({ review, isDark }: { review: SecurityReview; isDark: boolean }) {
  // featureSecurityContext holds the baseline for both paths:
  //   - Existing-feature path: enriched feature contexts
  //   - New-feature path: synthetic "service-dfd" entry built from code_service DFDs
  const featuresWithDfd = (review.featureSecurityContext ?? []).filter(
    f => f.dataFlowSummary?.length > 0 || f.dataClassificationSummary?.length > 0
  );

  if (!featuresWithDfd.length) return null;

  const flowColumns = [
    {
      title: 'From',
      dataIndex: 'from',
      width: '18%',
      render: (v: string) => <span style={{ fontSize: 12, fontWeight: 600 }}>{v}</span>,
    },
    {
      title: 'To',
      dataIndex: 'to',
      width: '18%',
      render: (v: string) => <span style={{ fontSize: 12 }}>{v}</span>,
    },
    {
      title: 'Protocol',
      dataIndex: 'protocol',
      width: 90,
      render: (v: string) => <Tag style={{ fontSize: 11 }}>{v}</Tag>,
    },
    {
      title: 'Data Types',
      dataIndex: 'dataTypes',
      render: (types: string[]) => (
        <Space size={4} wrap>
          {(types ?? []).map(t => <Tag key={t} style={{ fontSize: 11 }}>{t}</Tag>)}
        </Space>
      ),
    },
    {
      title: 'Encrypted',
      dataIndex: 'encrypted',
      width: 90,
      render: (v: boolean) => (
        <Tag color={v ? 'green' : 'red'} style={{ fontSize: 11 }}>{v ? 'Yes' : 'No'}</Tag>
      ),
    },
    {
      title: 'Auth',
      dataIndex: 'authRequired',
      width: 90,
      render: (v: boolean) => (
        <Tag color={v ? 'blue' : 'default'} style={{ fontSize: 11 }}>{v ? 'Required' : 'None'}</Tag>
      ),
    },
  ];

  const classColumns = [
    {
      title: 'Classification',
      dataIndex: 'classification',
      width: 130,
      render: (v: string) => (
        <Tag color={CLASSIFICATION_COLOR[(v ?? '').toLowerCase()] ?? 'default'} style={{ fontSize: 11 }}>
          {(v ?? '').toUpperCase()}
        </Tag>
      ),
    },
    {
      title: 'Data Types',
      dataIndex: 'dataTypes',
      render: (types: string[]) => (
        <Space size={4} wrap>
          {(types ?? []).map(t => <Tag key={t} style={{ fontSize: 11 }}>{t}</Tag>)}
        </Space>
      ),
    },
    {
      title: 'Protection Mechanisms',
      dataIndex: 'protectionMechanisms',
      render: (mechs: string[]) => (
        <Space direction="vertical" size={2}>
          {(mechs ?? []).map(m => <span key={m} style={{ fontSize: 12 }}>• {m}</span>)}
        </Space>
      ),
    },
  ];

  const items = featuresWithDfd.map(f => ({
    key: f.featureId,
    label: (
      <Space size={8}>
        <ApartmentOutlined style={{ color: T.orange }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: dk(isDark, T.stone800, D.text) }}>{f.featureName}</span>
        {f.dataFlowSummary?.length > 0 && (
          <Tag style={{ fontSize: 11 }}>{f.dataFlowSummary.length} flows</Tag>
        )}
        {f.dataClassificationSummary?.length > 0 && (
          <Tag style={{ fontSize: 11 }}>{f.dataClassificationSummary.length} classifications</Tag>
        )}
      </Space>
    ),
    children: (
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        {f.dataFlowSummary?.length > 0 && (
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: dk(isDark, T.stone600, D.textMuted), marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Baseline Data Flows
            </div>
            <Table
              columns={flowColumns}
              dataSource={f.dataFlowSummary}
              rowKey={(r, i) => `${r.from}|${r.to}|${i}`}
              pagination={false}
              size="small"
              bordered
            />
          </div>
        )}
        {f.dataClassificationSummary?.length > 0 && (
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: dk(isDark, T.stone600, D.textMuted), marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Baseline Data Classification
            </div>
            <Table
              columns={classColumns}
              dataSource={f.dataClassificationSummary}
              rowKey={(r) => r.classification}
              pagination={false}
              size="small"
              bordered
            />
          </div>
        )}
      </Space>
    ),
  }));

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <InfoCircleOutlined style={{ color: T.blue }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: dk(isDark, T.stone700, D.textMuted) }}>
          Architecture Baseline
        </span>
        <span style={{ fontSize: 12, color: dk(isDark, T.stone400, D.textFaint) }}>
          — current DFD state of linked features before this change
        </span>
      </div>
      <Collapse
        size="small"
        style={{
          background: dk(isDark, T.stone50, D.bgSub),
          border: `1px solid ${dk(isDark, T.stone200, D.borderSub)}`,
          borderRadius: 8,
        }}
        items={items}
      />
    </div>
  );
}

// ── Threat Model section ───────────────────────────────────────────────────────

function ThreatModelSection({ review, isDark }: { review: SecurityReview; isDark: boolean }) {
  const diffs = review.architectureDiff;

  const baselinePanel = <FeatureBaselinePanel review={review} isDark={isDark} />;

  return (
    <div>
      <SectionHeader isDark={isDark} title="Architecture & Threat Model" subtitle="Changes to the data flow and security posture introduced by this feature" />

      {!diffs?.length ? (
        <>
          {baselinePanel}
          <div style={{
            background: dk(isDark, T.stone50, D.bgSub),
            border: `1px solid ${dk(isDark, T.stone200, D.borderSub)}`,
            borderRadius: 10,
            padding: '40px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center',
          }}>
            <ApartmentOutlined style={{ fontSize: 32, color: T.stone300 }} />
            <div style={{ fontSize: 14, fontWeight: 600, color: dk(isDark, T.stone500, D.textMuted) }}>No architecture diff yet</div>
            <div style={{ fontSize: 12, color: T.stone400, maxWidth: 400 }}>
              The diff will appear here once the agent submits attestations with updated data flows and classification.
            </div>
          </div>
        </>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <ApartmentOutlined style={{ color: T.orange }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: dk(isDark, T.stone700, D.textMuted) }}>
              Architecture Diff
            </span>
            <span style={{ fontSize: 12, color: dk(isDark, T.stone400, D.textFaint) }}>
              — what changed vs. the baseline
            </span>
          </div>
          <ArchitectureDiffPanel diffs={diffs} baseline={baselinePanel} />
        </>
      )}
    </div>
  );
}

// ── Policies section ───────────────────────────────────────────────────────────

const POLICY_META: Record<PolicyTemplateType, { label: string; icon: React.ReactNode; standard: string; description: string }> = {
  security_review: {
    label: 'Security Review',
    icon: <LockOutlined />,
    standard: 'OWASP / NIST',
    description: 'Controls for authentication, data handling, input validation, cryptography, and supply chain risk.',
  },
  responsible_ai: {
    label: 'Responsible AI',
    icon: <RobotOutlined />,
    standard: 'EU AI Act',
    description: 'Controls for fairness, explainability, hallucination risk, human oversight, and misuse prevention.',
  },
  privacy: {
    label: 'Privacy',
    icon: <GlobalOutlined />,
    standard: 'GDPR',
    description: 'Controls for personal data collection, consent, data subject rights, cross-border transfer, and retention.',
  },
};

function PoliciesSection({ review, policies, isDark }: { review: SecurityReview; policies: PolicyTemplate[]; isDark: boolean }) {
  const navigate = useNavigate();
  const usedType = review.policyTemplateType;
  const usedVersion = review.policyTemplateVersion;

  const allTypes: PolicyTemplateType[] = ['security_review', 'responsible_ai', 'privacy'];

  return (
    <div>
      <SectionHeader
        isDark={isDark}
        title="Assigned Policies"
        subtitle="Compliance frameworks evaluated during this security review"
      />

      {/* Context banner */}
      <div style={{
        background: dk(isDark, T.blueLight, D.blueLight),
        border: `1px solid ${dk(isDark, T.blueBorder, D.blueBorder)}`,
        borderRadius: 10, padding: '12px 16px', marginBottom: 20,
        display: 'flex', gap: 10, alignItems: 'flex-start',
      }}>
        <InfoCircleOutlined style={{ color: T.blue, marginTop: 2, flexShrink: 0 }} />
        <div style={{ fontSize: 12, color: dk(isDark, T.stone600, D.textMuted), lineHeight: 1.6 }}>
          {usedType
            ? <>The <strong>{POLICY_META[usedType as PolicyTemplateType]?.label}</strong> policy (v{usedVersion}) was active when this review was started. Its questions and task rules were snapshotted into the review and used to generate the security task list.</>
            : <>Policy context was not recorded for this review. The policies shown below reflect their current state.</>
          }
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {allTypes.map(type => {
          const meta = POLICY_META[type];
          const policy = policies.find(p => p.type === type);
          const isUsed = type === usedType;
          const questionCount = policy?.questions.length ?? 0;
          const taskRuleCount = policy?.taskRules.length ?? 0;
          const baselineCount = policy?.baselineTasks.length ?? 0;
          const totalTasks = taskRuleCount + baselineCount;

          return (
            <div
              key={type}
              style={{
                background: dk(isDark, T.white, D.bgCard),
                border: `1px solid ${isUsed ? dk(isDark, T.orangeBorder, D.orangeBorder) : dk(isDark, T.stone200, D.borderSub)}`,
                borderLeft: `4px solid ${isUsed ? T.orange : dk(isDark, T.stone300, D.borderSub)}`,
                borderRadius: 10, padding: '16px 20px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flex: 1, minWidth: 0 }}>
                  {/* Icon */}
                  <div style={{
                    width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                    background: isUsed ? dk(isDark, T.orangeLight, D.orangeLight) : dk(isDark, T.stone100, D.border),
                    border: `1px solid ${isUsed ? dk(isDark, T.orangeBorder, D.orangeBorder) : dk(isDark, T.stone200, D.borderSub)}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 16, color: isUsed ? T.orange : T.stone400,
                  }}>
                    {meta.icon}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' as const }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: dk(isDark, T.stone900, D.text) }}>
                        {meta.label}
                      </span>
                      {/* Standard badge */}
                      <span style={{
                        padding: '1px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                        letterSpacing: '0.04em', textTransform: 'uppercase' as const,
                        background: dk(isDark, T.blueLight, D.blueLight),
                        border: `1px solid ${dk(isDark, T.blueBorder, D.blueBorder)}`,
                        color: T.blue,
                      }}>
                        {meta.standard}
                      </span>
                      {/* Used in this review badge */}
                      {isUsed && (
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          padding: '1px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                          letterSpacing: '0.04em', textTransform: 'uppercase' as const,
                          background: dk(isDark, T.orangeLight, D.orangeLight),
                          border: `1px solid ${dk(isDark, T.orangeBorder, D.orangeBorder)}`,
                          color: T.orange,
                        }}>
                          <CheckCircleOutlined style={{ fontSize: 9 }} /> Used · v{usedVersion}
                        </span>
                      )}
                      {/* Active badge */}
                      {policy?.isActive && (
                        <span style={{
                          padding: '1px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                          letterSpacing: '0.04em', textTransform: 'uppercase' as const,
                          background: dk(isDark, T.greenLight, D.greenLight),
                          border: `1px solid ${dk(isDark, T.greenBorder, D.greenBorder)}`,
                          color: T.green,
                        }}>
                          Active
                        </span>
                      )}
                    </div>

                    <p style={{ margin: '0 0 10px', fontSize: 12, color: T.stone400, lineHeight: 1.6 }}>
                      {meta.description}
                    </p>

                    {/* Stats row */}
                    {policy ? (
                      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' as const }}>
                        {[
                          { label: 'Questions', value: questionCount },
                          { label: 'Task rules', value: taskRuleCount },
                          { label: 'Baseline tasks', value: baselineCount },
                          { label: 'Total controls', value: totalTasks },
                        ].map(s => (
                          <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <span style={{ fontSize: 14, fontWeight: 700, color: dk(isDark, T.stone700, D.text) }}>{s.value}</span>
                            <span style={{ fontSize: 11, color: T.stone400 }}>{s.label}</span>
                          </div>
                        ))}
                        {policy.version && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <span style={{ fontSize: 11, color: T.stone400 }}>Current version:</span>
                            <span style={{ fontSize: 11, fontWeight: 600, color: dk(isDark, T.stone600, D.textMuted) }}>v{policy.version}</span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <span style={{ fontSize: 12, color: T.stone400, fontStyle: 'italic' }}>Policy not configured</span>
                    )}
                  </div>
                </div>

                {/* Configure button */}
                {policy && (
                  <button
                    onClick={() => navigate(`/policies/${policy.id}`)}
                    style={{
                      flexShrink: 0, padding: '5px 12px', borderRadius: 6,
                      fontSize: 12, fontWeight: 500, cursor: 'pointer',
                      background: 'transparent',
                      border: `1px solid ${dk(isDark, T.stone300, D.borderSub)}`,
                      color: dk(isDark, T.stone600, D.textMuted),
                    }}
                  >
                    View policy
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Nav items ──────────────────────────────────────────────────────────────────

// ── PR Correlation Section ────────────────────────────────────────────────────

function CorrelationScoreBadge({ score, isDark }: { score: number; isDark: boolean }) {
  const color = score >= 80 ? T.green : score >= 60 ? T.amber : T.stone400;
  const bg    = score >= 80 ? dk(isDark, T.greenLight,  D.greenLight)
               : score >= 60 ? dk(isDark, T.amberLight, D.amberLight)
               : dk(isDark, T.stone100, D.bgCard);
  const border = score >= 80 ? dk(isDark, T.greenBorder,  D.greenBorder)
               : score >= 60 ? dk(isDark, T.amberBorder,  D.amberBorder)
               : dk(isDark, T.stone300, D.borderSub);
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700,
      color, background: bg, border: `1px solid ${border}`,
    }}>
      {score}% match
    </span>
  );
}

function PRStateChip({ state, isDark }: { state: CorrelatedPR['prState']; isDark: boolean }) {
  const cfg: Record<string, { color: string; bg: string; border: string; label: string }> = {
    open:   { color: T.green,  bg: dk(isDark, T.greenLight, D.greenLight),   border: dk(isDark, T.greenBorder, D.greenBorder),   label: 'Open' },
    closed: { color: T.red,    bg: dk(isDark, T.redLight,   D.redLight),     border: dk(isDark, T.redBorder,   D.redBorder),     label: 'Closed' },
    merged: { color: T.purple, bg: dk(isDark, T.purpleLight, D.purpleLight), border: dk(isDark, T.purpleBorder ?? T.purple, D.purpleBorder ?? D.text), label: 'Merged' },
  };
  const c = cfg[state] ?? cfg.closed;
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 6,
      fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' as const,
      color: c.color, background: c.bg, border: `1px solid ${c.border}`,
    }}>
      {c.label}
    </span>
  );
}

function PRCandidateCard({
  pr, isDark, onLink,
}: { pr: CorrelatedPR; isDark: boolean; onLink: (url: string) => void }) {
  return (
    <div style={{
      background: dk(isDark, T.white, D.bgSub),
      border: `1px solid ${dk(isDark, T.stone200, D.borderSub)}`,
      borderRadius: 10, padding: '12px 16px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
        <div>
          <a href={pr.prUrl} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 13, fontWeight: 600, color: T.blue, textDecoration: 'none' }}>
            {pr.prTitle}
          </a>
          <div style={{ fontSize: 11, color: T.stone400, marginTop: 2 }}>
            {pr.provider === 'github' ? 'GitHub' : 'GitLab'} · {pr.repository} · #{pr.prNumber} · @{pr.prAuthorLogin}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
          <PRStateChip state={pr.prState} isDark={isDark} />
          <CorrelationScoreBadge score={pr.correlationScore} isDark={isDark} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        {pr.correlationSignals.filter(s => s.matched).map(s => (
          <span key={s.signal} style={{
            fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 5,
            background: dk(isDark, T.blueLight, D.blueLight),
            border: `1px solid ${dk(isDark, T.blueBorder, D.blueBorder)}`,
            color: T.blue,
          }}>
            ✓ {s.signal}
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <a href={pr.prUrl} target="_blank" rel="noopener noreferrer"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 6,
            background: dk(isDark, T.stone100, D.bgCard),
            border: `1px solid ${dk(isDark, T.stone200, D.borderSub)}`,
            color: dk(isDark, T.stone600, D.textMuted),
            textDecoration: 'none', cursor: 'pointer',
          }}>
          <LinkOutlined style={{ fontSize: 10 }} /> View PR
        </a>
        <button
          onClick={() => onLink(pr.prUrl)}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 6,
            background: T.green,
            border: 'none', color: '#fff', cursor: 'pointer',
          }}>
          <CheckOutlined style={{ fontSize: 10 }} /> Link this PR
        </button>
      </div>
    </div>
  );
}

// ── PR Validation components ──────────────────────────────────────────────────

type PRValidationOutcome = 'confirmed' | 'disputed' | 'unverifiable';
type PRValidationOverallOutcome = 'clean' | 'attention' | 'critical';

const OUTCOME_CONFIG: Record<PRValidationOutcome, { color: string; bg: string; border: string; label: string }> = {
  confirmed:    { color: T.green,  bg: T.greenLight,  border: T.greenBorder,  label: 'Confirmed'    },
  disputed:     { color: T.red,    bg: T.redLight,    border: T.redBorder,    label: 'Disputed'     },
  unverifiable: { color: T.stone400, bg: T.stone100, border: T.stone300, label: 'Unverifiable' },
};

const OVERALL_OUTCOME_CONFIG: Record<PRValidationOverallOutcome, { color: string; label: string; icon: React.ReactNode }> = {
  clean:     { color: T.green,  label: 'Clean',     icon: <CheckCircleOutlined /> },
  attention: { color: T.amber,  label: 'Attention', icon: <WarningOutlined />     },
  critical:  { color: T.red,    label: 'Critical',  icon: <CloseCircleOutlined /> },
};

function PRValidationReportCard({ report, isDark }: { report: any; isDark: boolean }) {
  const navigate = useNavigate();

  if (report.status === 'pending' || report.status === 'running') {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '16px 20px', borderRadius: 12,
        background: dk(isDark, T.blueLight, D.blueLight),
        border: `1px solid ${dk(isDark, T.blueBorder, D.blueBorder)}`,
      }}>
        <Spin />
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: dk(isDark, T.stone800, D.text) }}>
            Validation agent is running…
          </div>
          {report.taskRunId && (
            <div style={{ fontSize: 11, color: T.stone400, marginTop: 2 }}>
              <Button
                type="link"
                size="small"
                icon={<EyeOutlined />}
                style={{ padding: 0, fontSize: 11, height: 'auto' }}
                onClick={() => navigate(`/execution/${report.taskRunId}`)}
              >
                View chain of thoughts
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (report.status === 'failed') {
    return (
      <Alert
        type="error"
        showIcon
        message="Validation failed"
        description={report.errorMessage || 'An unexpected error occurred during PR validation.'}
        style={{ borderRadius: 10 }}
      />
    );
  }

  if (report.status === 'skipped') {
    return (
      <Alert
        type="info"
        showIcon
        message="Validation was skipped"
        style={{ borderRadius: 10 }}
      />
    );
  }

  // completed
  const overall = report.overallOutcome as PRValidationOverallOutcome | undefined;
  const overallCfg = overall ? OVERALL_OUTCOME_CONFIG[overall] : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Overall outcome + executive summary */}
      <div style={{
        padding: '16px 20px', borderRadius: 12,
        background: dk(isDark, T.stone50, D.bgSub),
        border: `1px solid ${dk(isDark, T.stone200, D.borderSub)}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
          {overallCfg && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '3px 10px', borderRadius: 20,
              fontSize: 12, fontWeight: 700,
              background: overallCfg.color, color: '#fff',
            }}>
              {overallCfg.icon} {overallCfg.label}
            </span>
          )}
          <span style={{ fontSize: 11, color: T.stone400 }}>
            {report.filesReviewed} files · {report.linesReviewed} lines reviewed
          </span>
          {report.validatedAt && (
            <span style={{ fontSize: 11, color: T.stone400 }}>
              · {formatDate(report.validatedAt)}
            </span>
          )}
          {report.taskRunId && (
            <Button
              type="link"
              size="small"
              icon={<EyeOutlined />}
              style={{ padding: 0, fontSize: 11, height: 'auto', marginLeft: 'auto' }}
              onClick={() => navigate(`/execution/${report.taskRunId}`)}
            >
              View chain of thoughts
            </Button>
          )}
        </div>
        {report.executiveSummary && (
          <p style={{ margin: 0, fontSize: 13, color: dk(isDark, T.stone700, D.textMuted), lineHeight: 1.6 }}>
            {report.executiveSummary}
          </p>
        )}
      </div>

      {/* Per-finding cards — show ALL findings (confirmed, disputed, unverifiable) */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: T.stone400, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
          Security Answer Findings ({report.findings?.length ?? 0})
        </div>
        {(!report.findings || report.findings.length === 0) ? (
          <div style={{
            padding: '14px 18px', borderRadius: 10,
            background: dk(isDark, T.greenLight, D.greenLight),
            border: `1px solid ${dk(isDark, T.greenBorder, D.greenBorder)}`,
            display: 'flex', gap: 10, alignItems: 'center',
          }}>
            <CheckCircleOutlined style={{ color: T.green, fontSize: 16 }} />
            <span style={{ fontSize: 13, color: dk(isDark, T.stone700, D.textMuted) }}>
              No individual findings reported — all security answers were validated as confirmed.
            </span>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {report.findings.map((f: any, i: number) => {
              const cfg = OUTCOME_CONFIG[f.outcome as PRValidationOutcome] ?? OUTCOME_CONFIG.unverifiable;
              return (
                <div key={f.questionId ?? i} style={{
                  padding: '12px 16px', borderRadius: 10,
                  background: dk(isDark, cfg.bg, D.bgCard),
                  border: `1px solid ${dk(isDark, cfg.border, D.borderSub)}`,
                  borderLeft: `3px solid ${cfg.color}`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 6 }}>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
                      background: cfg.color, color: '#fff', flexShrink: 0, marginTop: 1,
                    }}>
                      {cfg.label}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: dk(isDark, T.stone800, D.text) }}>
                      {f.questionText}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: dk(isDark, T.stone600, D.textMuted), marginBottom: 4 }}>
                    <span style={{ fontWeight: 600 }}>Agent answer: </span>{f.agentAnswer}
                  </div>
                  <div style={{ fontSize: 12, color: dk(isDark, T.stone600, D.textMuted), marginBottom: 4 }}>
                    <span style={{ fontWeight: 600 }}>Rationale: </span>{f.rationale}
                  </div>
                  {f.relevantFiles?.length > 0 && (
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                      {f.relevantFiles.map((file: string) => (
                        <code key={file} style={{
                          fontSize: 10, padding: '1px 6px', borderRadius: 4,
                          background: dk(isDark, T.stone100, D.bgSub),
                          color: dk(isDark, T.stone600, D.textMuted),
                        }}>
                          {file}
                        </code>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Additional risks */}
      {report.additionalRisks?.filter((r: any) => r.title?.trim() && r.description?.trim()).length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: T.red, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
            Additional Risks Found ({report.additionalRisks.filter((r: any) => r.title?.trim() && r.description?.trim()).length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {report.additionalRisks.filter((r: any) => r.title?.trim() && r.description?.trim()).map((risk: any, i: number) => {
              const sev = SEVERITY_CONFIG[risk.severity] ?? SEVERITY_CONFIG.low;
              return (
                <div key={i} style={{
                  padding: '12px 16px', borderRadius: 10,
                  background: dk(isDark, sev.bg, sev.darkBg),
                  border: `1px solid ${dk(isDark, sev.border, sev.darkBorder)}`,
                  borderLeft: `3px solid ${sev.color}`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <SeverityBadge severity={risk.severity} isDark={isDark} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: dk(isDark, T.stone800, D.text) }}>
                      {risk.title}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: dk(isDark, T.stone600, D.textMuted), marginBottom: 4 }}>
                    {risk.description}
                  </div>
                  {risk.relevantFiles?.length > 0 && (
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                      {risk.relevantFiles.map((file: string) => (
                        <code key={file} style={{
                          fontSize: 10, padding: '1px 6px', borderRadius: 4,
                          background: dk(isDark, T.stone100, D.bgSub),
                          color: dk(isDark, T.stone600, D.textMuted),
                        }}>
                          {file}
                        </code>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function PRValidationSection({
  review, isDark, onReviewUpdate,
}: { review: SecurityReview; isDark: boolean; onReviewUpdate: (r: SecurityReview) => void }) {
  const { triggerPRValidation, getReview } = useSecurityReviews();
  const [error, setError] = useState<string | null>(null);
  const [triggering, setTriggering] = useState(false);

  // Poll every 5 s while pending/running
  useEffect(() => {
    const status = review.prValidationReport?.status;
    if (status !== 'pending' && status !== 'running') return;
    const intervalId = setInterval(async () => {
      const fresh = await getReview(review.id).catch(() => null);
      if (fresh) onReviewUpdate(fresh);
    }, 5000);
    return () => clearInterval(intervalId);
  }, [review.id, review.prValidationReport?.status]);

  const handleTrigger = async () => {
    setError(null);
    setTriggering(true);
    try {
      onReviewUpdate(await triggerPRValidation(review.id));
    } catch (e: any) {
      setError(e.message || 'Failed to trigger PR validation');
    } finally {
      setTriggering(false);
    }
  };

  const rpt = review.prValidationReport;
  const busy = triggering;

  return (
    <div>
      <SectionHeader
        isDark={isDark}
        title="PR Validation"
        subtitle="Agent-powered verification of security answers against the actual PR branch"
      />

      {/* No PR linked */}
      {!review.correlatedPR && (
        <Alert
          type="info"
          showIcon
          message="Link a PR in the PR / MR Correlation section first."
          style={{ marginBottom: 16, borderRadius: 10 }}
        />
      )}

      {/* Trigger button — only shown when PR is linked */}
      {review.correlatedPR && (
        <div style={{
          background: dk(isDark, T.white, D.bgCard),
          border: `1px solid ${dk(isDark, T.stone200, D.borderSub)}`,
          borderRadius: 10, padding: '16px 20px', marginBottom: 20,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <Button
              type="primary"
              icon={<ThunderboltOutlined />}
              loading={busy}
              onClick={handleTrigger}
              style={{ borderRadius: 8 }}
            >
              {rpt ? 'Re-run Validation' : 'Validate PR'}
            </Button>
            <span style={{ fontSize: 13, color: T.stone400 }}>
              Clones the PR branch and verifies each security answer against the code.
            </span>
          </div>
          {error && (
            <div style={{ color: T.red, fontSize: 12, marginTop: 8 }}>{error}</div>
          )}
        </div>
      )}

      {/* Report */}
      {rpt && <PRValidationReportCard report={rpt} isDark={isDark} />}
    </div>
  );
}

function PRCorrelationSection({
  review, isDark, onReviewUpdate,
}: { review: SecurityReview; isDark: boolean; onReviewUpdate: (r: SecurityReview) => void }) {
  const { correlatePR, getPRCandidates, linkPR, loading } = useSecurityReviews();
  const [candidates, setCandidates] = useState<CorrelatedPR[]>([]);
  const [candidatesLoaded, setCandidatesLoaded] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);
  const [correlateError, setCorrelateError] = useState<string | null>(null);

  const handleCorrelate = useCallback(async () => {
    setCorrelateError(null);
    try {
      const { review: updated, candidates: c } = await correlatePR(review.id);
      onReviewUpdate(updated);
      setCandidates(c);
      setCandidatesLoaded(true);
    } catch (e: any) {
      setCorrelateError(e.message || 'Correlation failed');
    }
  }, [review.id, correlatePR, onReviewUpdate]);

  const handleLoadCandidates = useCallback(async () => {
    setCorrelateError(null);
    try {
      const c = await getPRCandidates(review.id);
      setCandidates(c);
      setCandidatesLoaded(true);
    } catch (e: any) {
      setCorrelateError(e.message || 'Failed to load candidates');
    }
  }, [review.id, getPRCandidates]);

  const handleLinkManual = useCallback(async () => {
    setLinkError(null);
    const trimmed = linkUrl.trim();
    if (!trimmed) { setLinkError('Please enter a PR URL'); return; }
    try { new URL(trimmed); } catch { setLinkError('Please enter a valid https:// URL'); return; }
    if (!trimmed.startsWith('https://')) { setLinkError('URL must start with https://'); return; }
    try {
      const updated = await linkPR(review.id, trimmed);
      onReviewUpdate(updated);
      setLinkUrl('');
    } catch (e: any) {
      setLinkError(e.message || 'Failed to link PR');
    }
  }, [review.id, linkUrl, linkPR, onReviewUpdate]);

  const handleLinkCandidate = useCallback(async (prUrl: string) => {
    setCorrelateError(null);
    try {
      const updated = await linkPR(review.id, prUrl);
      onReviewUpdate(updated);
    } catch (e: any) {
      setCorrelateError(e.message || 'Failed to link PR');
    }
  }, [review.id, linkPR, onReviewUpdate]);

  const corPR = review.correlatedPR;
  const hasGitContext = !!review.gitContext?.branchName || !!review.gitContext?.commitSha;

  return (
    <div>
      <SectionHeader
        isDark={isDark}
        title="PR / MR Correlation"
        subtitle="Correlate this security review with a pull request or merge request"
      />

      {/* Correlated PR card */}
      {corPR ? (
        <div style={{
          background: dk(isDark, T.greenLight, D.greenLight),
          border: `1px solid ${dk(isDark, T.greenBorder, D.greenBorder)}`,
          borderRadius: 12, padding: '16px 20px', marginBottom: 20,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <BranchesOutlined style={{ color: T.green, fontSize: 16 }} />
                <span style={{ fontSize: 14, fontWeight: 700, color: dk(isDark, T.stone800, D.text) }}>
                  Correlated PR
                </span>
                <PRStateChip state={corPR.prState} isDark={isDark} />
                <CorrelationScoreBadge score={corPR.correlationScore} isDark={isDark} />
              </div>
              <a href={corPR.prUrl} target="_blank" rel="noopener noreferrer"
                style={{ fontSize: 15, fontWeight: 600, color: T.blue, textDecoration: 'none', display: 'block', marginBottom: 4 }}>
                {corPR.prTitle}
              </a>
              <div style={{ fontSize: 12, color: T.stone400 }}>
                {corPR.provider === 'github' ? 'GitHub' : 'GitLab'} · {corPR.repository} · #{corPR.prNumber}
                {' · '}@{corPR.prAuthorLogin}
                {' · '}branch: <code style={{ fontSize: 11 }}>{corPR.headBranch}</code>
                {' → '}<code style={{ fontSize: 11 }}>{corPR.baseBranch}</code>
              </div>
              {corPR.headSha && (
                <div style={{ fontSize: 11, color: T.stone400, marginTop: 2 }}>
                  SHA: <code style={{ fontSize: 11 }}>{corPR.headSha.slice(0, 7)}</code>
                </div>
              )}
            </div>
          </div>

          {/* Signal breakdown */}
          {corPR.correlationSignals.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, color: T.stone500, fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Correlation signals
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {corPR.correlationSignals.map(s => (
                  <span key={s.signal} style={{
                    fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 5,
                    background: s.matched
                      ? dk(isDark, T.blueLight, D.blueLight)
                      : dk(isDark, T.stone100, D.bgCard),
                    border: `1px solid ${s.matched ? dk(isDark, T.blueBorder, D.blueBorder) : dk(isDark, T.stone200, D.borderSub)}`,
                    color: s.matched ? T.blue : T.stone400,
                  }}>
                    {s.matched ? '✓' : '✗'} {s.signal}
                    {s.weight > 0 && <span style={{ opacity: 0.7 }}> +{s.weight}</span>}
                  </span>
                ))}
              </div>
            </div>
          )}

          {review.correlationAttemptedAt && (
            <div style={{ fontSize: 10, color: T.stone400, marginTop: 8 }}>
              Last correlated: {formatDate(review.correlationAttemptedAt)}
            </div>
          )}
        </div>
      ) : (
        <div style={{
          background: dk(isDark, T.stone50, D.bgSub),
          border: `1px solid ${dk(isDark, T.stone200, D.borderSub)}`,
          borderRadius: 12, padding: '16px 20px', marginBottom: 20,
        }}>
          <div style={{ fontSize: 13, color: dk(isDark, T.stone500, D.textMuted), marginBottom: 4 }}>
            No PR/MR has been correlated with this review yet.
          </div>
          {review.correlationAttemptedAt && (
            <div style={{ fontSize: 11, color: T.stone400 }}>
              Last attempted: {formatDate(review.correlationAttemptedAt)}
            </div>
          )}
        </div>
      )}

      {/* Git context summary */}
      {hasGitContext && review.gitContext && (
        <div style={{
          background: dk(isDark, T.stone50, D.bgSub),
          border: `1px solid ${dk(isDark, T.stone200, D.borderSub)}`,
          borderRadius: 10, padding: '12px 16px', marginBottom: 20,
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.stone400, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
            Git Context (captured at review creation)
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {review.gitContext.branchName && (
              <div>
                <span style={{ fontSize: 10, color: T.stone400 }}>Branch: </span>
                <code style={{ fontSize: 11 }}>{review.gitContext.branchName}</code>
              </div>
            )}
            {review.gitContext.commitShortSha && (
              <div>
                <span style={{ fontSize: 10, color: T.stone400 }}>Commit: </span>
                <code style={{ fontSize: 11 }}>{review.gitContext.commitShortSha}</code>
              </div>
            )}
            {review.gitContext.baseBranch && (
              <div>
                <span style={{ fontSize: 10, color: T.stone400 }}>Base: </span>
                <code style={{ fontSize: 11 }}>{review.gitContext.baseBranch}</code>
              </div>
            )}
            {review.gitContext.commitMessage && (
              <div style={{ flex: '1 0 100%' }}>
                <span style={{ fontSize: 10, color: T.stone400 }}>Message: </span>
                <span style={{ fontSize: 11, color: dk(isDark, T.stone600, D.textMuted) }}>{review.gitContext.commitMessage}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Correlation actions */}
      <div style={{
        background: dk(isDark, T.white, D.bgCard),
        border: `1px solid ${dk(isDark, T.stone200, D.borderSub)}`,
        borderRadius: 10, padding: '16px 20px', marginBottom: 20,
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: dk(isDark, T.stone800, D.text), marginBottom: 12 }}>
          Auto-correlate
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
          <Button
            icon={<SyncOutlined />}
            loading={loading}
            onClick={handleCorrelate}
            style={{ borderRadius: 8 }}
            type="primary"
          >
            {corPR ? 'Re-correlate PR' : 'Correlate PR'}
          </Button>
          <Button
            icon={<BranchesOutlined />}
            loading={loading}
            onClick={handleLoadCandidates}
            style={{ borderRadius: 8 }}
          >
            Load candidates
          </Button>
        </div>
        {correlateError && (
          <div style={{ fontSize: 12, color: T.red, marginTop: 4 }}>{correlateError}</div>
        )}
        <div style={{ fontSize: 11, color: T.stone400 }}>
          Runs scoring against open PRs in the connected GitHub/GitLab integration using branch name, commit SHA, author, and time window.
        </div>
      </div>

      {/* Manual link */}
      <div style={{
        background: dk(isDark, T.white, D.bgCard),
        border: `1px solid ${dk(isDark, T.stone200, D.borderSub)}`,
        borderRadius: 10, padding: '16px 20px', marginBottom: 20,
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: dk(isDark, T.stone800, D.text), marginBottom: 10 }}>
          Link manually
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <Input
            placeholder="https://github.com/org/repo/pull/123"
            value={linkUrl}
            onChange={e => setLinkUrl(e.target.value)}
            onPressEnter={handleLinkManual}
            style={{ borderRadius: 8, flex: 1 }}
            prefix={<EditOutlined style={{ color: T.stone400 }} />}
          />
          <Button
            icon={<CheckOutlined />}
            type="primary"
            loading={loading}
            onClick={handleLinkManual}
            style={{ borderRadius: 8, flexShrink: 0 }}
          >
            Link
          </Button>
        </div>
        {linkError && (
          <div style={{ fontSize: 12, color: T.red, marginTop: 6 }}>{linkError}</div>
        )}
      </div>

      {/* Candidates */}
      {candidatesLoaded && (
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: dk(isDark, T.stone800, D.text), marginBottom: 12 }}>
            {candidates.length > 0
              ? `Candidate PRs (${candidates.length}) — partial matches, score 40–59`
              : 'No candidate PRs found'}
          </div>
          {candidates.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {candidates.map(c => (
                <PRCandidateCard key={c.prUrl} pr={c} isDark={isDark} onLink={handleLinkCandidate} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type SectionId = 'overview' | 'questionnaire' | 'tasks' | 'attestations' | 'summary' | 'threat-model' | 'policies' | 'pr-correlation' | 'pr-validation';

interface NavItem {
  id: SectionId;
  label: string;
  icon: React.ReactNode;
  group?: string;
  getBadge?: (review: SecurityReview) => { count: number; color: string } | null;
}

const NAV_ITEMS: NavItem[] = [
  {
    id: 'overview',
    label: 'Overview',
    icon: <InfoCircleOutlined />,
    group: 'Review',
  },
  {
    id: 'questionnaire',
    label: 'Questionnaire',
    icon: <QuestionCircleOutlined />,
    group: 'Review',
    getBadge: (r) => r.questions.length > 0 ? { count: r.questions.length, color: T.stone400 } : null,
  },
  {
    id: 'tasks',
    label: 'Security Tasks',
    icon: <FileSearchOutlined />,
    group: 'Review',
    getBadge: (r) => {
      const crit = r.tasks.filter(t => t.severity === 'critical').length;
      return crit > 0 ? { count: crit, color: T.red } : r.tasks.length > 0 ? { count: r.tasks.length, color: T.stone400 } : null;
    },
  },
  {
    id: 'attestations',
    label: 'Attestations',
    icon: <AuditOutlined />,
    group: 'Audit',
    getBadge: (r) => {
      const handled = r.attestations.filter(a => a.handled).length;
      return handled > 0 ? { count: handled, color: T.green } : null;
    },
  },
  {
    id: 'summary',
    label: 'Summary',
    icon: <SafetyOutlined />,
    group: 'Audit',
  },
  {
    id: 'threat-model',
    label: 'Threat Model',
    icon: <ApartmentOutlined />,
    group: 'Architecture',
    getBadge: (r) => {
      const diffs = r.architectureDiff;
      if (!diffs?.length) return null;
      const changes = diffs.reduce((sum, d) =>
        sum +
        d.dataFlowDiff.filter(f => f.changeType !== 'unchanged').length +
        d.dataClassificationDiff.filter(c => c.changeType !== 'unchanged').length, 0);
      const hasRegression = diffs.some(d => d.dataFlowDiff.some(f =>
        f.changeType === 'changed' &&
        ((f.baseline?.encrypted && !f.updated?.encrypted) || (f.baseline?.authRequired && !f.updated?.authRequired))
      ));
      return changes > 0 ? { count: changes, color: hasRegression ? T.red : T.amber } : null;
    },
  },
  {
    id: 'policies',
    label: 'Policies',
    icon: <BookOutlined />,
    group: 'Compliance',
  },
  {
    id: 'pr-correlation',
    label: 'PR / MR Correlation',
    icon: <BranchesOutlined />,
    group: 'Integrations',
    getBadge: (r) => r.correlatedPR ? { count: r.correlatedPR.correlationScore, color: T.green } : null,
  },
  {
    id: 'pr-validation',
    label: 'PR Validation',
    icon: <ThunderboltOutlined />,
    group: 'Integrations',
    getBadge: (r) => {
      const rpt = r.prValidationReport;
      if (!rpt || rpt.status !== 'completed') return null;
      const issues = rpt.findings.filter((f: any) => f.outcome === 'disputed').length + rpt.additionalRisks.filter((r: any) => r.title?.trim() && r.description?.trim()).length;
      if (issues === 0) {
        // Clean — only show green badge if there are confirmed findings to advertise
        const confirmed = rpt.findings.filter((f: any) => f.outcome === 'confirmed').length;
        return confirmed > 0 ? { count: confirmed, color: T.green } : null;
      }
      const color = rpt.overallOutcome === 'critical' ? T.red
                  : rpt.overallOutcome === 'attention' ? T.amber : T.green;
      return { count: issues, color };
    },
  },
];

// ── Main page ─────────────────────────────────────────────────────────────────

export function SecurityReviewDetailsPage() {
  const { reviewId } = useParams<{ reviewId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const { getReview, getAttestationSummary, loading, error } = useSecurityReviews();
  const { listPolicies } = usePolicies();

  const [review, setReview] = useState<SecurityReview | null>(null);
  const [summary, setSummary] = useState<SecurityReviewAttestationSummary | null>(null);
  const [policies, setPolicies] = useState<PolicyTemplate[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<SectionId>('overview');

  useEffect(() => {
    if (!reviewId) return;
    const load = async () => {
      try {
        const r = await getReview(reviewId);
        setReview(r);
        if (r.status === 'attested') {
          try { setSummary(await getAttestationSummary(reviewId)); } catch { /* optional */ }
        }
      } catch (err: any) {
        setLoadError(err.message || 'Failed to load security review');
      }
    };
    load();
  }, [reviewId]);

  useEffect(() => {
    listPolicies().then(setPolicies).catch(() => { /* optional */ });
  }, []);

  if (loading && !review) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
        <Spin size="large" />
      </div>
    );
  }

  if (loadError || error) {
    return (
      <div style={{ padding: 24 }}>
        <Alert type="error" message="Failed to load security review" description={loadError || error} showIcon />
      </div>
    );
  }

  if (!review) return null;

  const renderNavGroup = (label: string) => (
    <div style={{
      padding: '10px 16px 4px', fontSize: 10, fontWeight: 700,
      letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: T.stone400,
    }}>
      {label}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 32px)' }}>
      {/* Breadcrumb */}
      <div style={{ padding: '0 0 16px', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
        {(location.state as any)?.fromChat && (
          <button
            onClick={() => navigate(-1)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              fontSize: 12, fontWeight: 500,
              color: dk(isDark, T.stone600, D.textMuted),
              background: dk(isDark, T.stone100, D.bgCard),
              border: `1px solid ${dk(isDark, T.stone200, D.borderSub)}`,
              borderRadius: 8, padding: '4px 10px', cursor: 'pointer',
              transition: 'border-color 0.15s, color 0.15s',
              flexShrink: 0,
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.borderColor = T.orange;
              (e.currentTarget as HTMLElement).style.color = T.orange;
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.borderColor = dk(isDark, T.stone200, D.borderSub);
              (e.currentTarget as HTMLElement).style.color = dk(isDark, T.stone600, D.textMuted);
            }}
            aria-label="Back to chat"
          >
            <ArrowLeftOutlined style={{ fontSize: 11 }} />
            Back to chat
          </button>
        )}
        <Breadcrumb
          items={[
            { title: <a onClick={() => navigate('/knowledge-base/security-reviews')}>Security Reviews</a> },
            { title: review.title ?? review.featureDescription },
          ]}
        />
      </div>

      {/* Main layout */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>

        {/* ── Left nav panel ── */}
        <aside style={{
          width: 220, flexShrink: 0,
          background: dk(isDark, T.stone50, D.bgSub),
          borderRight: `1px solid ${dk(isDark, T.stone200, D.borderSub)}`,
          borderRadius: '12px 0 0 12px',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
          {/* Mini header */}
          <div style={{
            padding: '14px 16px 12px',
            borderBottom: `1px solid ${dk(isDark, T.stone200, D.borderSub)}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <div style={{
                width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                background: T.orange, display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff', fontSize: 14,
              }}>
                <SafetyOutlined />
              </div>
              <StatusPill status={review.status} isDark={isDark} />
            </div>
            <div style={{
              fontSize: 12, fontWeight: 600, color: dk(isDark, T.stone800, D.text), lineHeight: 1.4,
              overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const,
            }}>
              {review.title ?? review.featureDescription}
            </div>
            {review.title && (
              <div style={{
                fontSize: 11, color: T.stone400, lineHeight: 1.4, marginTop: 2,
                overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const,
              }}>
                {review.featureDescription}
              </div>
            )}
            {review.agentName && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 6 }}>
                <AgentIcon agentName={review.agentName} fontSize={11} />
                <span style={{ fontSize: 11, color: T.stone400 }}>{review.agentName}</span>
              </div>
            )}
            {review.humanResponsible && (
              <div style={{ fontSize: 11, color: T.stone400, marginTop: 2 }}>
                👤 {review.humanResponsible}
              </div>
            )}
          </div>

          {/* Nav items */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
            {NAV_ITEMS.map((item, i) => {
              const active = activeSection === item.id;
              const prevGroup = i > 0 ? NAV_ITEMS[i - 1].group : null;
              const showGroup = item.group !== prevGroup;
              const badge = item.getBadge?.(review);

              return (
                <div key={item.id}>
                  {showGroup && renderNavGroup(item.group!)}
                  <div
                    onClick={() => setActiveSection(item.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between',
                      padding: '8px 16px', cursor: 'pointer',
                      background: active ? dk(isDark, T.orangeLight, D.orangeLight) : 'transparent',
                      borderLeft: `3px solid ${active ? T.orange : 'transparent'}`,
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = dk(isDark, T.stone100, D.bgHover); }}
                    onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 13, color: active ? T.orange : T.stone400, display: 'flex' }}>
                        {item.icon}
                      </span>
                      <span style={{ fontSize: 13, fontWeight: active ? 600 : 400, color: active ? dk(isDark, T.stone800, D.text) : T.stone500 }}>
                        {item.label}
                      </span>
                    </div>
                    {badge && (
                      <span style={{
                        minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9,
                        background: badge.color, color: '#fff',
                        fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        {badge.count}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footer: created date */}
          <div style={{
            padding: '10px 16px',
            borderTop: `1px solid ${dk(isDark, T.stone200, D.borderSub)}`,
            fontSize: 10, color: T.stone400,
          }}>
            <div>Created {formatDate(review.createdAt)}</div>
            {review.completedAt && <div style={{ marginTop: 2 }}>Completed {formatDate(review.completedAt)}</div>}
          </div>
        </aside>

        {/* ── Main content ── */}
        <div style={{
          flex: 1, minWidth: 0,
          background: dk(isDark, T.white, D.bgCard),
          borderRadius: '0 12px 12px 0',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
          {/* Section header bar */}
          <div style={{
            padding: '14px 28px',
            borderBottom: `1px solid ${dk(isDark, T.stone100, D.border)}`,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
          }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: dk(isDark, T.stone900, D.text) }}>
                {NAV_ITEMS.find(n => n.id === activeSection)?.label}
              </h2>
            </div>
          </div>

          {/* Scrollable content */}
          <div style={{ flex: 1, overflow: 'auto', padding: '24px 28px' }}>
            {activeSection === 'overview'        && <OverviewSection      review={review} summary={summary} isDark={isDark} />}
            {activeSection === 'questionnaire'   && <QuestionnaireSection review={review} isDark={isDark} />}
            {activeSection === 'tasks'           && <TasksSection         review={review} isDark={isDark} />}
            {activeSection === 'attestations'    && <AttestationsSection  review={review} isDark={isDark} />}
            {activeSection === 'summary'         && <SummarySection       review={review} summary={summary} isDark={isDark} />}
            {activeSection === 'threat-model'    && <ThreatModelSection   review={review} isDark={isDark} />}
            {activeSection === 'policies'        && <PoliciesSection      review={review} policies={policies} isDark={isDark} />}
            {activeSection === 'pr-correlation'  && <PRCorrelationSection review={review} isDark={isDark} onReviewUpdate={setReview} />}
            {activeSection === 'pr-validation'   && <PRValidationSection  review={review} isDark={isDark} onReviewUpdate={setReview} />}
          </div>
        </div>
      </div>
    </div>
  );
}
