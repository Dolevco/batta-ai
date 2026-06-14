/**
 * ChatEntityTable
 *
 * Renders a TableProjection payload (from chat tool results) as a professional,
 * clickable table — matching the look & feel of SecurityReviewsPage and FeatureListView.
 *
 * Entity types:
 *  - 'security_review'  →  navigates to /knowledge-base/security-reviews/:id
 *  - 'feature'          →  navigates to /knowledge-base/features/:id
 *  - 'service'          →  navigates to /knowledge-base/assets?highlight=:id
 */

import { useNavigate } from 'react-router-dom';
import { useTheme } from '../../hooks/useTheme';
import { T, D, dk } from '../../theme';
import {
  ThunderboltOutlined,
  SafetyOutlined,
  ApiOutlined,
  EyeOutlined,
} from '@ant-design/icons';
import AgentIcon from '../icons/AgentIcon';

// ── Types (mirror core graph.types but kept local for UI independence) ─────────

export type TableEntityType = 'feature' | 'security_review' | 'service';

interface TableColumn {
  key: string;
  label: string;
  renderHint?: 'text' | 'badge' | 'risk_score' | 'severity' | 'status' | 'date' | 'tags' | 'compliance';
}

interface TableRow {
  id: string;
  columns: Record<string, string | number | null | undefined>;
  metadata?: Record<string, any>;
}

export interface TableProjection {
  entityType: TableEntityType;
  title: string;
  columns: TableColumn[];
  rows: TableRow[];
  explanation?: string;
  totalCount?: number;
}

// ── Status config (mirrors SecurityReviewsPage) ───────────────────────────────

const STATUS_CONFIG: Record<string, { color: string; bg: string; darkBg: string; border: string; darkBorder: string; dot: string; label: string }> = {
  questionnaire_pending:  { color: T.stone500, bg: T.stone100,   darkBg: D.bgCard,     border: T.stone300, darkBorder: '#4A4744', dot: T.stone400, label: 'Questionnaire Pending' },
  questionnaire_answered: { color: T.blue,     bg: T.blueLight,  darkBg: D.blueLight,  border: T.blueBorder,  darkBorder: 'rgba(37,99,235,0.4)', dot: T.blue, label: 'Awaiting Acknowledgement' },
  tasks_acknowledged:     { color: T.amber,    bg: T.amberLight, darkBg: D.amberLight, border: T.amberBorder, darkBorder: 'rgba(217,119,6,0.4)', dot: T.amber, label: 'In Progress' },
  attested:               { color: T.green,    bg: T.greenLight, darkBg: D.greenLight, border: T.greenBorder, darkBorder: 'rgba(22,163,74,0.4)', dot: T.green, label: 'Attested' },
};

// ── Sub-renderers ─────────────────────────────────────────────────────────────

function StatusPill({ status, isDark }: { status: string; isDark: boolean }) {
  const cfg = STATUS_CONFIG[status] ?? { color: T.stone500, bg: T.stone100, darkBg: D.bgCard, border: T.stone300, darkBorder: '#4A4744', dot: T.stone400, label: status };
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

function SeverityPill({ value, isDark }: { value?: string | null; isDark: boolean }) {
  if (!value) return <span style={{ color: dk(isDark, T.stone300, D.textFaint), fontSize: 12 }}>—</span>;
  const cfg: Record<string, { color: string; bg: string; darkBg: string }> = {
    critical: { color: T.red,    bg: T.redLight,   darkBg: D.redLight },
    high:     { color: T.orangeHigh, bg: T.orangeHighLight, darkBg: D.orangeHighLight },
    medium:   { color: T.amber,  bg: T.amberLight,  darkBg: D.amberLight },
    low:      { color: T.green,  bg: T.greenLight,  darkBg: D.greenLight },
  };
  const c = cfg[value] ?? { color: T.stone500, bg: T.stone100, darkBg: D.bgCard };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '2px 10px', borderRadius: 99,
      fontSize: 11, fontWeight: 600, letterSpacing: '0.02em',
      color: c.color, background: dk(isDark, c.bg, c.darkBg),
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: c.color, display: 'inline-block', flexShrink: 0 }} />
      {value.charAt(0).toUpperCase() + value.slice(1)}
    </span>
  );
}

function RiskScoreBadge({ score, isDark }: { score?: number | null; isDark: boolean }) {
  if (score === undefined || score === null || score < 0) {
    return <span style={{ color: dk(isDark, T.stone300, D.textFaint), fontSize: 12 }}>—</span>;
  }
  const color = score > 70 ? T.red : score > 40 ? T.amber : T.green;
  const bg    = score > 70 ? dk(isDark, T.redLight, D.redLight) : score > 40 ? dk(isDark, T.amberLight, D.amberLight) : dk(isDark, T.greenLight, D.greenLight);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
      <div style={{ width: 52, height: 5, borderRadius: 99, background: dk(isDark, T.stone100, D.bgCard), overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(100, score)}%`, height: '100%', borderRadius: 99, background: color }} />
      </div>
      <span style={{ fontSize: 11, fontWeight: 700, color, padding: '1px 5px', borderRadius: 4, background: bg, fontVariantNumeric: 'tabular-nums' }}>
        {score}
      </span>
    </div>
  );
}

function ComplianceBadge({ pct, isDark }: { pct: number | null | undefined; isDark: boolean }) {
  if (pct === null || pct === undefined || pct < 0) {
    return <span style={{ fontSize: 12, color: dk(isDark, T.stone300, D.textFaint) }}>Pending</span>;
  }
  const color = pct === 100 ? T.green : pct >= 80 ? T.amber : T.red;
  const bg    = pct === 100 ? dk(isDark, T.greenLight, D.greenLight) : pct >= 80 ? dk(isDark, T.amberLight, D.amberLight) : dk(isDark, T.redLight, D.redLight);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
      <div style={{ width: 36, height: 5, borderRadius: 99, background: dk(isDark, T.stone100, D.bgCard), overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', borderRadius: 99, background: color }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, color, background: bg, padding: '1px 5px', borderRadius: 4 }}>{pct}%</span>
    </div>
  );
}

function TagList({ value, isDark }: { value: string; isDark: boolean }) {
  if (!value) return <span style={{ color: dk(isDark, T.stone300, D.textFaint), fontSize: 12 }}>—</span>;
  const tags = value.split(',').map(s => s.trim()).filter(Boolean);
  if (tags.length === 0) return <span style={{ color: dk(isDark, T.stone300, D.textFaint), fontSize: 12 }}>—</span>;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {tags.slice(0, 3).map(tag => (
        <span key={tag} style={{
          display: 'inline-flex', alignItems: 'center', gap: 3,
          fontSize: 10, fontWeight: 600, color: T.blue,
          background: dk(isDark, T.blueLight, D.blueLight),
          padding: '2px 7px', borderRadius: 6,
        }}>
          <ApiOutlined style={{ fontSize: 9 }} /> {tag}
        </span>
      ))}
      {tags.length > 3 && (
        <span style={{ fontSize: 10, color: T.stone400, background: dk(isDark, T.stone100, D.border), padding: '2px 7px', borderRadius: 6 }}>
          +{tags.length - 3}
        </span>
      )}
    </div>
  );
}

function ComplianceTags({ value, isDark }: { value: string; isDark: boolean }) {
  if (!value) return <span style={{ color: dk(isDark, T.stone300, D.textFaint), fontSize: 12 }}>—</span>;
  const tags = value.split(',').map(s => s.trim()).filter(Boolean);
  if (tags.length === 0) return <span style={{ color: dk(isDark, T.stone300, D.textFaint), fontSize: 12 }}>—</span>;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {tags.slice(0, 2).map(tag => (
        <span key={tag} style={{ fontSize: 10, fontWeight: 500, color: dk(isDark, T.stone600, D.textMuted), background: dk(isDark, T.stone100, D.bgCard), padding: '2px 7px', borderRadius: 6 }}>
          {tag}
        </span>
      ))}
      {tags.length > 2 && (
        <span style={{ fontSize: 10, color: T.stone400, background: dk(isDark, T.stone100, D.bgCard), padding: '2px 7px', borderRadius: 6 }}>
          +{tags.length - 2}
        </span>
      )}
    </div>
  );
}

function NumberBadge({ value, isDark }: { value: string | number | null | undefined; isDark: boolean }) {
  if (value === null || value === undefined || value === '') return <span style={{ color: dk(isDark, T.stone300, D.textFaint), fontSize: 12 }}>—</span>;
  const n = Number(value);
  const color = n > 5 ? T.red : n > 2 ? T.amber : dk(isDark, T.stone600, D.textMuted);
  const bg    = n > 5 ? dk(isDark, T.redLight, D.redLight) : n > 2 ? dk(isDark, T.amberLight, D.amberLight) : dk(isDark, T.stone100, D.bgCard);
  return (
    <span style={{ fontSize: 11, fontWeight: 700, color, background: bg, padding: '2px 8px', borderRadius: 99 }}>
      {value}
    </span>
  );
}

function DateCell({ value, isDark }: { value: string | number | null | undefined; isDark: boolean }) {
  if (!value) return <span style={{ color: dk(isDark, T.stone300, D.textFaint), fontSize: 12 }}>—</span>;
  const d = new Date(String(value));
  if (isNaN(d.getTime())) return <span style={{ fontSize: 12, color: dk(isDark, T.stone400, D.textMuted) }}>{String(value)}</span>;
  return (
    <span style={{ fontSize: 12, color: dk(isDark, T.stone400, D.textMuted), whiteSpace: 'nowrap' }}>
      {d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
    </span>
  );
}

// ── Entity icon ───────────────────────────────────────────────────────────────

function EntityIcon({ entityType }: { entityType: TableEntityType }) {
  if (entityType === 'feature') return <ThunderboltOutlined style={{ color: T.orange, fontSize: 14 }} />;
  if (entityType === 'security_review') return <SafetyOutlined style={{ color: T.orange, fontSize: 14 }} />;
  return <ApiOutlined style={{ color: T.blue, fontSize: 14 }} />;
}

// ── Cell renderer ─────────────────────────────────────────────────────────────

function CellRenderer({
  column,
  row,
  entityType,
  isDark,
}: {
  column: TableColumn;
  row: TableRow;
  entityType: TableEntityType;
  isDark: boolean;
}) {
  const raw = row.columns[column.key];
  const meta = row.metadata ?? {};

  // First column: show entity icon + name
  if (column.key === 'name' || column.key === 'featureDescription') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ flexShrink: 0 }}><EntityIcon entityType={entityType} /></span>
        <span style={{ fontSize: 13, fontWeight: 600, color: dk(isDark, T.stone800, D.text) }}>
          {raw ?? '—'}
        </span>
      </div>
    );
  }

  switch (column.renderHint) {
    case 'risk_score':
      return <RiskScoreBadge score={raw as number} isDark={isDark} />;

    case 'severity':
      return <SeverityPill value={meta.highestSeverity ?? raw as string} isDark={isDark} />;

    case 'status':
      return <StatusPill status={raw as string} isDark={isDark} />;

    case 'compliance':
      if (column.key === 'compliance') {
        // For security_review compliance column, render progress bar
        if (entityType === 'security_review') {
          return <ComplianceBadge pct={meta.compliancePct} isDark={isDark} />;
        }
        // For features, render compliance tags
        return <ComplianceTags value={String(raw ?? '')} isDark={isDark} />;
      }
      return <ComplianceTags value={String(raw ?? '')} isDark={isDark} />;

    case 'badge':
      if (column.key === 'tasks') {
        const total = meta.taskCount ?? Number(raw) ?? 0;
        const critical = meta.criticalTaskCount ?? 0;
        if (total === 0) return <span style={{ color: dk(isDark, T.stone300, D.textFaint), fontSize: 12 }}>—</span>;
        return (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: dk(isDark, T.stone600, D.textMuted), background: dk(isDark, T.stone100, D.bgCard), padding: '2px 8px', borderRadius: 6 }}>
              {total}
            </span>
            {critical > 0 && (
              <span style={{ fontSize: 11, fontWeight: 600, color: T.red, background: dk(isDark, T.redLight, D.redLight), padding: '2px 8px', borderRadius: 6 }}>
                {critical} crit
              </span>
            )}
          </div>
        );
      }
      if (column.key === 'relevance') {
        if (raw === null || raw === undefined) return <span style={{ color: dk(isDark, T.stone300, D.textFaint), fontSize: 12 }}>—</span>;
        const pct = Number(raw);
        const color = pct >= 80 ? T.green : pct >= 50 ? T.amber : dk(isDark, T.stone500, D.textMuted);
        const bg    = pct >= 80 ? dk(isDark, T.greenLight, D.greenLight) : pct >= 50 ? dk(isDark, T.amberLight, D.amberLight) : dk(isDark, T.stone100, D.bgCard);
        return <span style={{ fontSize: 11, fontWeight: 600, color, background: bg, padding: '2px 8px', borderRadius: 99 }}>{pct}%</span>;
      }
      return <NumberBadge value={raw} isDark={isDark} />;

    case 'tags':
      return <TagList value={String(raw ?? '')} isDark={isDark} />;

    case 'date':
      return <DateCell value={raw} isDark={isDark} />;

    case 'text':
    default:
      if (column.key === 'agentName' && raw) {
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, maxWidth: 160 }}>
            <AgentIcon agentName={String(raw)} fontSize={13} />
            <span style={{ fontSize: 12, color: dk(isDark, T.stone500, D.textMuted), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {raw}
            </span>
          </div>
        );
      }
      if (column.key === 'serviceType') {
        return (
          <span style={{ fontSize: 11, fontWeight: 500, color: dk(isDark, T.stone500, D.textMuted), background: dk(isDark, T.stone100, D.bgSub), padding: '2px 8px', borderRadius: 6 }}>
            {String(raw ?? '').replace(/_/g, ' ')}
          </span>
        );
      }
      if (!raw) return <span style={{ color: dk(isDark, T.stone300, D.textFaint), fontSize: 12 }}>—</span>;
      return (
        <span style={{
          fontSize: 12, color: dk(isDark, T.stone500, D.textMuted),
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          {String(raw)}
        </span>
      );
  }
}

// ── Navigation helper ─────────────────────────────────────────────────────────

function getNavPath(entityType: TableEntityType, id: string): string {
  switch (entityType) {
    case 'security_review': return `/knowledge-base/security-reviews/${encodeURIComponent(id)}`;
    case 'feature':         return `/knowledge-base/features/${encodeURIComponent(id)}`;
    case 'service':         return `/knowledge-base/assets/${encodeURIComponent(id)}`;
  }
}

// ── Entity label ─────────────────────────────────────────────────────────────

function entityLabel(entityType: TableEntityType): string {
  switch (entityType) {
    case 'security_review': return 'Security Reviews';
    case 'feature':         return 'Features';
    case 'service':         return 'Services';
  }
}

// ── Main component ────────────────────────────────────────────────────────────

interface ChatEntityTableProps {
  table: TableProjection;
}

export function ChatEntityTable({ table }: ChatEntityTableProps) {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const { entityType, title, columns, rows, explanation, totalCount } = table;

  const headerBg  = dk(isDark, T.stone50, D.bgSub);
  const borderCol = dk(isDark, T.stone200, D.borderSub);

  return (
    <div style={{
      border: `1px solid ${borderCol}`,
      borderRadius: 14,
      overflow: 'hidden',
      background: dk(isDark, T.white, D.bgCard),
      boxShadow: isDark ? 'none' : '0 1px 4px rgba(28,25,23,0.06)',
    }}>
      {/* Header bar */}
      <div style={{
        padding: '10px 16px',
        borderBottom: `1px solid ${borderCol}`,
        background: headerBg,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
            <EntityIcon entityType={entityType} />
          </span>
          <span style={{ fontSize: 13, fontWeight: 700, color: dk(isDark, T.stone800, D.text) }}>{title}</span>
          {totalCount !== undefined && (
            <span style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '0.05em',
              color: T.stone400, background: dk(isDark, T.stone100, D.border),
              padding: '1px 7px', borderRadius: 99,
            }}>
              {totalCount} {entityLabel(entityType)}
            </span>
          )}
        </div>
        <span style={{ fontSize: 11, color: dk(isDark, T.stone400, D.textFaint), fontStyle: 'italic' }}>
          Click any row to open →
        </span>
      </div>

      {/* Explanation */}
      {explanation && (
        <div style={{
          padding: '6px 16px',
          borderBottom: `1px solid ${dk(isDark, T.stone100, D.border)}`,
          background: dk(isDark, T.white, D.bgCard),
          fontSize: 11, color: dk(isDark, T.stone500, D.textMuted), fontStyle: 'italic',
        }}>
          {explanation}
        </div>
      )}

      {/* Table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${dk(isDark, T.stone100, D.border)}` }}>
              {columns.map(col => (
                <th key={col.key} style={{
                  padding: '8px 14px',
                  textAlign: 'left',
                  fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase',
                  color: dk(isDark, T.stone400, D.textFaint),
                  whiteSpace: 'nowrap',
                  background: dk(isDark, T.stone50, D.bgSub),
                }}>
                  {col.label}
                </th>
              ))}
              <th style={{ padding: '8px 10px', background: dk(isDark, T.stone50, D.bgSub), width: 36 }} />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + 1}
                  style={{ padding: '32px 0', textAlign: 'center', fontSize: 13, color: dk(isDark, T.stone300, D.textFaint) }}
                >
                  No {entityLabel(entityType).toLowerCase()} found.
                </td>
              </tr>
            ) : rows.map((row) => (
              <tr
                key={row.id}
                onClick={() => navigate(getNavPath(entityType, row.id), { state: { fromChat: true } })}
                style={{
                  borderBottom: `1px solid ${dk(isDark, T.stone50, D.border)}`,
                  cursor: 'pointer', transition: 'background 0.1s',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = dk(isDark, T.stone50, D.bgHover); }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = ''; }}
              >
                {columns.map(col => (
                  <td key={col.key} style={{ padding: '11px 14px', maxWidth: col.key === 'description' || col.key === 'responsibility' ? 260 : undefined }}>
                    <CellRenderer column={col} row={row} entityType={entityType} isDark={isDark} />
                  </td>
                ))}
                {/* Navigate arrow */}
                <td style={{ padding: '11px 10px', width: 36 }}>
                  <button
                    onClick={e => { e.stopPropagation(); navigate(getNavPath(entityType, row.id), { state: { fromChat: true } }); }}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: dk(isDark, T.stone300, D.textFaint), fontSize: 13,
                      padding: '2px 4px', borderRadius: 4, display: 'flex',
                      transition: 'color 0.15s',
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = T.orange; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = dk(isDark, T.stone300, D.textFaint); }}
                    aria-label="View details"
                  >
                    <EyeOutlined />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer: show count when truncated */}
      {totalCount !== undefined && totalCount > rows.length && (
        <div style={{
          padding: '8px 16px',
          borderTop: `1px solid ${dk(isDark, T.stone100, D.border)}`,
          background: dk(isDark, T.stone50, D.bgSub),
          fontSize: 11, color: dk(isDark, T.stone400, D.textFaint), textAlign: 'center',
        }}>
          Showing {rows.length} of {totalCount} {entityLabel(entityType).toLowerCase()} — ask for more to see the rest
        </div>
      )}
    </div>
  );
}
