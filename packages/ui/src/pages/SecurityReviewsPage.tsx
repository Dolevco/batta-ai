import { useState, useEffect } from 'react';
import { Button } from 'antd';
import {
  SafetyOutlined, CheckCircleOutlined, ClockCircleOutlined,
  ExclamationCircleOutlined, ReloadOutlined, ApiOutlined, LinkOutlined,
  GithubOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import type { SecurityReview, SecurityReviewStatus } from '../types';
import AgentIcon from '../components/icons/AgentIcon';
import { useSecurityReviews } from '../hooks/useSecurityReviews';
import { useTheme } from '../hooks/useTheme';
import { T, D, dk } from '../theme';

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<SecurityReviewStatus, { color: string; bg: string; dot: string; label: string; darkBg: string; border: string; darkBorder: string }> = {
  questionnaire_pending:  { color: T.stone500, bg: T.stone100,   dot: T.stone400, label: 'Questionnaire Pending',    darkBg: D.bgCard,      border: T.stone300,   darkBorder: '#4A4744' },
  questionnaire_answered: { color: T.blue,     bg: T.blueLight,  dot: T.blue,     label: 'Awaiting Acknowledgement', darkBg: D.blueLight,   border: T.blueBorder,    darkBorder: 'rgba(37,99,235,0.4)' },
  tasks_acknowledged:     { color: T.amber,    bg: T.amberLight, dot: T.amber,    label: 'In Progress',              darkBg: D.amberLight,  border: T.amberBorder,    darkBorder: 'rgba(217,119,6,0.4)' },
  attested:               { color: T.green,    bg: T.greenLight, dot: T.green,    label: 'Attested',                 darkBg: D.greenLight,  border: T.greenBorder,    darkBorder: 'rgba(22,163,74,0.4)' },
};

function StatusPill({ status, isDark }: { status: SecurityReviewStatus; isDark: boolean }) {
  const cfg = STATUS_CONFIG[status] ?? { color: T.stone500, bg: T.stone100, dot: T.stone400, label: status, darkBg: D.bgCard, border: T.stone300, darkBorder: '#4A4744' };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '3px 10px', borderRadius: 99,
      fontSize: 11, fontWeight: 600,
      color: cfg.color,
      background: dk(isDark, cfg.bg, cfg.darkBg),
      border: `1px solid ${dk(isDark, cfg.border, cfg.darkBorder)}`,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: cfg.dot, display: 'inline-block', flexShrink: 0 }} />
      {cfg.label}
    </span>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function StatCard({ label, value, color, icon, isDark }: { label: string; value: number; color: string; icon: React.ReactNode; isDark: boolean }) {
  return (
    <div style={{
      background: dk(isDark, T.white, D.bgCard),
      border: `1px solid ${dk(isDark, T.stone200, D.borderSub)}`,
      borderRadius: 14,
      padding: '16px 20px', flex: 1,
      boxShadow: isDark ? 'none' : '0 1px 3px rgba(28,25,23,0.04)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ color, fontSize: 15 }}>{icon}</span>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: T.stone400 }}>{label}</span>
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
    </div>
  );
}

// ── Filter bar ────────────────────────────────────────────────────────────────

const FILTER_OPTIONS: { key: SecurityReviewStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'questionnaire_pending', label: 'Questionnaire Pending' },
  { key: 'questionnaire_answered', label: 'Awaiting Acknowledgement' },
  { key: 'tasks_acknowledged', label: 'In Progress' },
  { key: 'attested', label: 'Attested' },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export function SecurityReviewsPage() {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const { listReviews, loading, error } = useSecurityReviews();
  const [reviews, setReviews] = useState<SecurityReview[]>([]);
  const [statusFilter, setStatusFilter] = useState<SecurityReviewStatus | 'all'>('all');

  const load = async () => {
    try {
      const data = await listReviews();
      setReviews(data.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
    } catch { /* handled by hook */ }
  };

  useEffect(() => { load(); }, []);

  const total = reviews.length;
  const attested = reviews.filter(r => r.status === 'attested').length;
  const inProgress = reviews.filter(r =>
    r.status === 'tasks_acknowledged' || r.status === 'questionnaire_pending' || r.status === 'questionnaire_answered'
  ).length;
  const criticalOpenCount = reviews.reduce((sum, r) =>
    sum + (Array.isArray(r.tasks) ? r.tasks : []).filter(t => {
      if (t.severity !== 'critical') return false;
      const att = (Array.isArray(r.attestations) ? r.attestations : []).find(a => a.taskId === t.id);
      return !att || !att.handled;
    }).length, 0
  );

  const filtered = statusFilter === 'all' ? reviews : reviews.filter(r => r.status === statusFilter);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, width: '100%' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: dk(isDark, T.orangeLight, D.orangeLight), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <SafetyOutlined style={{ fontSize: 18, color: T.orange }} />
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: dk(isDark, T.stone900, D.text) }}>Security Reviews</h2>
            <p style={{ margin: 0, fontSize: 12, color: T.stone400, marginTop: 1 }}>Feature security posture and attestation tracking</p>
          </div>
        </div>
        <Button icon={<ReloadOutlined />} onClick={load} loading={loading} style={{ borderRadius: 8 }}>
          Refresh
        </Button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', borderRadius: 10, background: dk(isDark, T.redLight, D.redLight), color: T.red, fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* Stat cards */}
      <div style={{ display: 'flex', gap: 12 }}>
        <StatCard isDark={isDark} label="Total Reviews"  value={total}               color={dk(isDark, T.stone600, D.textMuted)}              icon={<SafetyOutlined />} />
        <StatCard isDark={isDark} label="Attested"       value={attested}            color={T.green}                                           icon={<CheckCircleOutlined />} />
        <StatCard isDark={isDark} label="In Progress"    value={inProgress}          color={T.amber}                                           icon={<ClockCircleOutlined />} />
        <StatCard isDark={isDark} label="Critical Open"  value={criticalOpenCount}   color={criticalOpenCount > 0 ? T.red : T.green}           icon={<ExclamationCircleOutlined />} />
      </div>

      {/* Table card */}
      <div style={{
        background: dk(isDark, T.white, D.bgCard),
        border: `1px solid ${dk(isDark, T.stone200, D.borderSub)}`,
        borderRadius: 16, overflow: 'hidden',
        boxShadow: isDark ? 'none' : '0 1px 3px rgba(28,25,23,0.04)',
      }}>

        {/* Filter bar */}
        <div style={{
          padding: '12px 20px',
          borderBottom: `1px solid ${dk(isDark, T.stone100, D.border)}`,
          display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center',
        }}>
          {FILTER_OPTIONS.map(opt => {
            const active = statusFilter === opt.key;
            const count = opt.key === 'all' ? reviews.length : reviews.filter(r => r.status === opt.key).length;
            return (
              <button
                key={opt.key}
                onClick={() => setStatusFilter(opt.key)}
                style={{
                  padding: '5px 12px', borderRadius: 8, fontSize: 12,
                  fontWeight: active ? 600 : 500, cursor: 'pointer',
                  border: active ? 'none' : `1px solid ${dk(isDark, T.stone200, D.borderSub)}`,
                  background: active ? T.orange : dk(isDark, T.white, D.bgSub),
                  color: active ? T.white : dk(isDark, T.stone500, D.textMuted),
                  display: 'flex', alignItems: 'center', gap: 5,
                  transition: 'all 0.15s',
                }}
              >
                {opt.label}
                <span style={{
                  fontSize: 10, fontWeight: 700,
                  background: active ? 'rgba(255,255,255,0.25)' : dk(isDark, T.stone100, D.border),
                  color: active ? T.white : T.stone400,
                  padding: '0 5px', borderRadius: 99, minWidth: 16, textAlign: 'center',
                }}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Table */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1000 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${dk(isDark, T.stone100, D.border)}` }}>
                {['Feature', 'Initiated By', 'Human Responsible', 'Repository', 'Services & Features', 'Status', 'Tasks', 'Compliance', 'Created', 'Completed'].map((col, i) => (
                  <th key={i} style={{
                    padding: '10px 16px', textAlign: 'left',
                    fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase',
                    color: T.stone400, whiteSpace: 'nowrap',
                  }}>
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={10} style={{ padding: '48px 0', textAlign: 'center' }}>
                    <div style={{ fontSize: 13, color: dk(isDark, T.stone300, D.textFaint) }}>No security reviews found</div>
                    <div style={{ fontSize: 12, color: dk(isDark, T.stone300, D.textFaint), marginTop: 4 }}>
                      Security reviews are created by coding agents via the MCP tools
                    </div>
                  </td>
                </tr>
              ) : filtered.map(review => (
                <ReviewRow key={review.id} review={review} onNavigate={path => navigate(path)} isDark={isDark} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Review row ────────────────────────────────────────────────────────────────

function ReviewRow({ review, onNavigate, isDark }: { review: SecurityReview; onNavigate: (path: string) => void; isDark: boolean }) {
  const tasks = Array.isArray(review.tasks) ? review.tasks : [];
  const attestations = Array.isArray(review.attestations) ? review.attestations : [];
  const criticalTasks = tasks.filter(t => t.severity === 'critical').length;
  const totalTasks = tasks.length;

  const compliancePct = review.status === 'attested' && totalTasks > 0
    ? Math.round((attestations.filter(a => a.handled).length / totalTasks) * 100)
    : null;

  const complianceColor = compliancePct === null ? dk(isDark, T.stone300, D.textFaint)
    : compliancePct === 100 ? T.green
    : compliancePct >= 80 ? T.amber
    : T.red;

  const services = Array.isArray(review.services) ? review.services : [];
  const linkedIds = new Set(Array.isArray(review.linkedFeatureIds) ? review.linkedFeatureIds : []);
  const features = linkedIds.size > 0 ? (Array.isArray(review.matchedFeatures) ? review.matchedFeatures : []).filter(f => linkedIds.has(f.id)) : [];

  return (
    <tr
      onClick={() => onNavigate(`/knowledge-base/security-reviews/${review.id}`)}
      style={{ borderBottom: `1px solid ${dk(isDark, T.stone50, D.border)}`, cursor: 'pointer', transition: 'background 0.1s' }}
      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = dk(isDark, T.stone50, D.bgHover)}
      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}
    >
      {/* Feature */}
      <td style={{ padding: '13px 16px', maxWidth: 260 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: dk(isDark, T.stone800, D.text) }}>
            {review.title ?? review.featureDescription}
          </span>
          {review.title && (
            <span style={{ fontSize: 11, color: T.stone400, lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const }}>
              {review.featureDescription}
            </span>
          )}
        </div>
      </td>

      {/* Initiated By */}
      <td style={{ padding: '13px 16px', width: 160 }}>
        {review.agentName ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, maxWidth: 150 }}>
            <AgentIcon agentName={review.agentName} fontSize={13} />
            <span style={{ fontSize: 12, color: dk(isDark, T.stone500, D.textMuted), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {review.agentName}
            </span>
          </div>
        ) : (
          <span style={{ color: dk(isDark, T.stone300, D.textFaint), fontSize: 12 }}>—</span>
        )}
      </td>

      {/* Human Responsible */}
      <td style={{ padding: '13px 16px', width: 160 }}>
        {review.humanResponsible ? (
          <span style={{ fontSize: 12, color: dk(isDark, T.stone600, D.textMuted), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block', maxWidth: 150 }}>
            {review.humanResponsible}
          </span>
        ) : (
          <span style={{ color: dk(isDark, T.stone300, D.textFaint), fontSize: 12 }}>—</span>
        )}
      </td>

      {/* Repository */}
      <td style={{ padding: '13px 16px', width: 200 }}>
        {review.repository || review.prLink ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {review.repository && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, maxWidth: 180 }}>
                <GithubOutlined style={{ fontSize: 12, color: dk(isDark, T.stone400, D.textFaint), flexShrink: 0 }} />
                <span style={{
                  fontSize: 12, color: dk(isDark, T.stone600, D.textMuted),
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  fontFamily: 'monospace',
                }}>
                  {review.repository}
                </span>
              </div>
            )}
            {review.prLink && (
              <a
                href={review.prLink}
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  fontSize: 11, fontWeight: 600,
                  color: T.blue,
                  background: dk(isDark, T.blueLight, D.blueLight),
                  padding: '2px 7px', borderRadius: 6,
                  textDecoration: 'none', maxWidth: 180,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}
              >
                <LinkOutlined style={{ fontSize: 9, flexShrink: 0 }} /> PR
              </a>
            )}
          </div>
        ) : (
          <span style={{ color: dk(isDark, T.stone300, D.textFaint), fontSize: 12 }}>—</span>
        )}
      </td>

      {/* Services & Features */}
      <td style={{ padding: '13px 16px', width: 220 }}>
        {services.length === 0 && features.length === 0 ? (
          <span style={{ color: dk(isDark, T.stone300, D.textFaint), fontSize: 12 }}>—</span>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {services.length > 0 && (
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {services.map(svc => (
                  <span key={svc} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 3,
                    fontSize: 10, fontWeight: 600, color: T.blue, background: dk(isDark, T.blueLight, D.blueLight),
                    padding: '2px 7px', borderRadius: 6,
                  }}>
                    <ApiOutlined style={{ fontSize: 9 }} /> {svc}
                  </span>
                ))}
              </div>
            )}
            {features.length > 0 && (
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {features.slice(0, 2).map(f => (
                  <span
                    key={f.id}
                    onClick={e => { e.stopPropagation(); onNavigate(`/knowledge-base/features/${encodeURIComponent(f.id)}`); }}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 3,
                      fontSize: 10, fontWeight: 600, color: T.purple, background: dk(isDark, T.purpleLight, D.purpleLight),
                      padding: '2px 7px', borderRadius: 6, cursor: 'pointer',
                    }}
                  >
                    <LinkOutlined style={{ fontSize: 9 }} /> {f.name}
                  </span>
                ))}
                {features.length > 2 && (
                  <span style={{ fontSize: 10, color: T.stone400, background: dk(isDark, T.stone100, D.border), padding: '2px 7px', borderRadius: 6 }}>
                    +{features.length - 2} more
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </td>

      {/* Status */}
      <td style={{ padding: '13px 16px', width: 200 }}>
        <StatusPill status={review.status} isDark={isDark} />
      </td>

      {/* Tasks */}
      <td style={{ padding: '13px 16px', width: 130 }}>
        {totalTasks === 0 ? (
          <span style={{ color: dk(isDark, T.stone300, D.textFaint), fontSize: 12 }}>—</span>
        ) : (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: dk(isDark, T.stone600, D.textMuted), background: dk(isDark, T.stone100, D.border), padding: '2px 8px', borderRadius: 6 }}>
              {totalTasks} tasks
            </span>
            {criticalTasks > 0 && (
              <span style={{ fontSize: 11, fontWeight: 600, color: T.red, background: dk(isDark, T.redLight, D.redLight), padding: '2px 8px', borderRadius: 6 }}>
                {criticalTasks} critical
              </span>
            )}
          </div>
        )}
      </td>

      {/* Compliance */}
      <td style={{ padding: '13px 16px', width: 110 }}>
        {compliancePct === null ? (
          <span style={{ fontSize: 12, color: dk(isDark, T.stone300, D.textFaint) }}>
            {review.status === 'attested' ? '—' : 'Pending'}
          </span>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <div style={{ width: 36, height: 5, borderRadius: 99, background: dk(isDark, T.stone100, D.border), overflow: 'hidden' }}>
              <div style={{ width: `${compliancePct}%`, height: '100%', borderRadius: 99, background: complianceColor }} />
            </div>
            <span style={{ fontSize: 12, fontWeight: 700, color: complianceColor }}>{compliancePct}%</span>
          </div>
        )}
      </td>

      {/* Created */}
      <td style={{ padding: '13px 16px', width: 155, whiteSpace: 'nowrap' }}>
        <span style={{ fontSize: 12, color: T.stone400 }}>{formatDate(review.createdAt)}</span>
      </td>

      {/* Completed */}
      <td style={{ padding: '13px 16px', width: 155, whiteSpace: 'nowrap' }}>
        {review.completedAt ? (
          <span style={{ fontSize: 12, color: T.stone400 }}>{formatDate(review.completedAt)}</span>
        ) : (
          <span style={{ fontSize: 12, color: dk(isDark, T.stone300, D.textFaint) }}>—</span>
        )}
      </td>
    </tr>
  );
}
