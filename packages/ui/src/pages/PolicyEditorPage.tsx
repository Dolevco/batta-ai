/**
 * PolicyEditorPage — tabbed policy editor.
 *
 * Tabs:
 *   1. Framework Overview — full structure for the review type (read-only reference)
 *   2. Questionnaire      — edit Q&A items with drag-and-drop reordering
 *   3. Task Rules         — conditional tasks + baseline controls
 *   4. Settings           — name, description, active toggle
 *
 * Security:
 *   - No dangerouslySetInnerHTML used anywhere.
 *   - All user-supplied text inputs are bounded with maxLength to prevent oversized payloads.
 *   - Input rendered as React text nodes (not injected HTML).
 */
import React, { useEffect, useState, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Switch, Modal, Spin, message } from 'antd';
import {
  ArrowLeftOutlined,
  PlusOutlined,
  DeleteOutlined,
  SafetyOutlined,
  RobotOutlined,
  LockOutlined,
  ExclamationCircleOutlined,
  ReloadOutlined,
  SaveOutlined,
  QuestionCircleOutlined,
  ThunderboltOutlined,
  ApartmentOutlined,
  AuditOutlined,
  SettingOutlined,
  InfoCircleOutlined,
  NodeIndexOutlined,
  DatabaseOutlined,
  TeamOutlined,
  FundOutlined,
  EyeOutlined,
  AlertOutlined,
  SolutionOutlined,
  UserOutlined,
  GlobalOutlined,
  ControlOutlined,
  BranchesOutlined,
} from '@ant-design/icons';
import { usePolicies } from '../hooks/usePolicies';
import { useTheme } from '../hooks/useTheme';
import { T, D, dk } from '../theme';
import type { PolicyTemplate, PolicyTemplateType, SecurityTask } from '../types';

function generateId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

const SEVERITY_CONFIG: Record<string, { color: string; bg: string; darkBg: string }> = {
  critical: { color: T.red,    bg: T.redLight,   darkBg: D.redLight },
  high:     { color: T.amber,  bg: T.amberLight, darkBg: D.amberLight },
  medium:   { color: T.blue,   bg: T.blueLight,  darkBg: D.blueLight },
  low:      { color: T.stone500, bg: T.stone100, darkBg: D.bgHover },
};

const TYPE_ICONS: Record<PolicyTemplateType, React.ReactNode> = {
  security_review: <SafetyOutlined />,
  responsible_ai:  <RobotOutlined />,
  privacy:         <LockOutlined />,
};

const TYPE_COLORS: Record<PolicyTemplateType, string> = {
  security_review: T.orange,
  responsible_ai:  T.purple,
  privacy:         T.blue,
};

const TYPE_BG: Record<PolicyTemplateType, string> = {
  security_review: T.orangeLight,
  responsible_ai:  T.purpleLight,
  privacy:         T.blueLight,
};

const TYPE_BG_DARK: Record<PolicyTemplateType, string> = {
  security_review: D.orangeLight,
  responsible_ai:  D.purpleLight,
  privacy:         D.blueLight,
};

const TYPE_BORDER: Record<PolicyTemplateType, string> = {
  security_review: T.orangeBorder,
  responsible_ai:  T.purpleBorder,
  privacy:         T.blueBorder,
};

const TYPE_BORDER_DARK: Record<PolicyTemplateType, string> = {
  security_review: 'rgba(249,115,22,0.25)',
  responsible_ai:  D.purpleBorder,
  privacy:         D.blueBorder,
};

// ── Framework definitions per type (reference, not editable) ─────────────────

interface FrameworkSection {
  icon: React.ReactNode;
  label: string;
  description: string;
  tag: string;
  color: string;
  bg: string;
  border: string;
  darkBg: string;
  darkBorder: string;
  details: string[];
}

const FRAMEWORK_SECTIONS: Record<PolicyTemplateType, FrameworkSection[]> = {
  security_review: [
    {
      icon: <QuestionCircleOutlined />, label: 'Questionnaire',
      description: 'Adaptive questions to identify security-relevant patterns in the feature under review.',
      tag: 'Editable', color: T.orange, bg: T.orangeLight, border: T.orangeBorder, darkBg: D.orangeLight, darkBorder: 'rgba(249,115,22,0.3)',
      details: ['Authentication & Authorization', 'Data Sensitivity & PII', 'Input Validation', 'Cryptography & Secrets', 'Third-party Dependencies', 'Network Exposure', 'Data Retention', 'Supply Chain', 'Error Handling'],
    },
    {
      icon: <ApartmentOutlined />, label: 'STRIDE Threat Model',
      description: 'Systematic threat identification across all STRIDE categories applied to the feature.',
      tag: 'Framework', color: T.red, bg: T.redLight, border: T.redBorder, darkBg: D.redLight, darkBorder: 'rgba(220,38,38,0.3)',
      details: ['Spoofing identity', 'Tampering with data', 'Repudiation attacks', 'Information disclosure', 'Denial of service', 'Elevation of privilege'],
    },
    {
      icon: <NodeIndexOutlined />, label: 'Data Flow Diagram',
      description: 'Trust boundary mapping and data path classification through the system.',
      tag: 'Architecture', color: T.blue, bg: T.blueLight, border: T.blueBorder, darkBg: D.blueLight, darkBorder: D.blueBorder,
      details: ['Trust boundary identification', 'Data entry/exit points', 'Component interactions', 'Protocol & encryption mapping', 'Cross-boundary flows'],
    },
    {
      icon: <ThunderboltOutlined />, label: 'Conditional Task Rules',
      description: 'Security tasks automatically triggered when questionnaire answers indicate risk.',
      tag: 'Editable', color: T.amber, bg: T.amberLight, border: T.amberBorder, darkBg: D.amberLight, darkBorder: 'rgba(217,119,6,0.3)',
      details: ['Triggered by "Yes" answers', 'Severity-tiered (critical→low)', 'Principle-tagged tasks', 'Per-question task sets'],
    },
    {
      icon: <AuditOutlined />, label: 'Baseline Controls',
      description: 'Mandatory security tasks that always apply regardless of questionnaire answers.',
      tag: 'Editable', color: T.green, bg: T.greenLight, border: T.greenBorder, darkBg: D.greenLight, darkBorder: 'rgba(22,163,74,0.3)',
      details: ['Always-on requirements', 'Attestation documentation', 'Audit trail creation', 'Security decision recording'],
    },
    {
      icon: <BranchesOutlined />, label: 'Architecture Diff',
      description: 'Baseline vs. post-implementation architecture comparison for audit purposes.',
      tag: 'Automated', color: T.purple, bg: T.purpleLight, border: T.purpleBorder, darkBg: D.purpleLight, darkBorder: D.purpleBorder,
      details: ['Data flow change tracking', 'Classification tier diffs', 'Structured audit record', 'Per-feature history'],
    },
  ],
  responsible_ai: [
    {
      icon: <QuestionCircleOutlined />, label: 'Questionnaire',
      description: 'AI-specific risk questions evaluating bias, safety, autonomy, and misuse potential.',
      tag: 'Editable', color: T.purple, bg: T.purpleLight, border: T.purpleBorder, darkBg: D.purpleLight, darkBorder: D.purpleBorder,
      details: ['Bias & demographic fairness', 'Explainability & contestability', 'Hallucination & grounding risks', 'Training data usage', 'Autonomous action scope', 'Misuse & adversarial risk'],
    },
    {
      icon: <FundOutlined />, label: 'Fairness & Bias Assessment',
      description: 'Structured evaluation of demographic bias in model outputs before and after deployment.',
      tag: 'Framework', color: T.blue, bg: T.blueLight, border: T.blueBorder, darkBg: D.blueLight, darkBorder: D.blueBorder,
      details: ['Demographic group benchmarking', 'Disparity analysis', 'Bias mitigation strategies', 'Ongoing production monitoring', 'Trigger thresholds for review'],
    },
    {
      icon: <EyeOutlined />, label: 'Transparency & Explainability',
      description: 'Requirements for explainable AI decisions and human escalation pathways.',
      tag: 'Framework', color: T.teal, bg: T.tealLight, border: T.tealBorder, darkBg: D.tealLight, darkBorder: D.tealBorder,
      details: ['In-product explanation mechanisms', 'Confidence score surfacing', 'Human review request option', 'Documented SLA for escalations'],
    },
    {
      icon: <TeamOutlined />, label: 'Human Oversight (HITL)',
      description: 'Human-in-the-loop approval gates for autonomous AI actions.',
      tag: 'Framework', color: T.green, bg: T.greenLight, border: T.greenBorder, darkBg: D.greenLight, darkBorder: 'rgba(22,163,74,0.3)',
      details: ['Autonomous action inventory', 'Blast-radius scoping', 'Approval gate requirements', 'Rollback & undo capability'],
    },
    {
      icon: <AlertOutlined />, label: 'Content Safety',
      description: 'Filtering and hardening against harmful outputs, prompt injection, and jailbreaks.',
      tag: 'Framework', color: T.red, bg: T.redLight, border: T.redBorder, darkBg: D.redLight, darkBorder: 'rgba(220,38,38,0.3)',
      details: ['Output safety classifiers', 'Prompt injection hardening', 'Jailbreak resistance testing', 'Adversarial prompt coverage'],
    },
    {
      icon: <SolutionOutlined />, label: 'Model Card & Documentation',
      description: 'Structured model card with training data, use cases, limitations, and scope.',
      tag: 'Baseline', color: T.amber, bg: T.amberLight, border: T.amberBorder, darkBg: D.amberLight, darkBorder: 'rgba(217,119,6,0.3)',
      details: ['Model name & version', 'Training data provenance', 'Intended use cases', 'Known limitations', 'Out-of-scope uses'],
    },
  ],
  privacy: [
    {
      icon: <QuestionCircleOutlined />, label: 'Questionnaire',
      description: 'Privacy-focused questions assessing personal data collection, consent, rights, and transfers.',
      tag: 'Editable', color: T.blue, bg: T.blueLight, border: T.blueBorder, darkBg: D.blueLight, darkBorder: D.blueBorder,
      details: ['Personal data collection scope', 'Consent mechanism', 'Data subject rights support', 'Cross-border transfers', 'Third-party data sharing', 'Retention & deletion'],
    },
    {
      icon: <NodeIndexOutlined />, label: 'Data Flow Diagram (DFD)',
      description: 'Privacy DFD mapping personal data collection, processing, storage, and sharing paths.',
      tag: 'Architecture', color: T.purple, bg: T.purpleLight, border: T.purpleBorder, darkBg: D.purpleLight, darkBorder: D.purpleBorder,
      details: ['Collection entry points', 'Processing purposes', 'Storage locations & jurisdiction', 'Third-party processor flows', 'Cross-border transfer paths'],
    },
    {
      icon: <DatabaseOutlined />, label: 'Data Inventory & Classification',
      description: 'Structured data register with classification tiers, legal bases, and retention schedules.',
      tag: 'RoPA', color: T.teal, bg: T.tealLight, border: T.tealBorder, darkBg: D.tealLight, darkBorder: D.tealBorder,
      details: ['Classification tiers (Public→Restricted)', 'Legal basis per processing activity', 'Retention schedule per data type', 'Record of Processing Activities (RoPA)', 'Field-level encryption requirements'],
    },
    {
      icon: <UserOutlined />, label: 'Data Subject Rights',
      description: 'DSAR workflows covering access, rectification, erasure, and portability.',
      tag: 'DSAR', color: T.green, bg: T.greenLight, border: T.greenBorder, darkBg: D.greenLight, darkBorder: 'rgba(22,163,74,0.3)',
      details: ['Access request workflow', 'Rectification mechanism', 'Erasure (right to be forgotten)', 'Data portability (JSON/CSV)', '30-day SLA compliance'],
    },
    {
      icon: <GlobalOutlined />, label: 'Cross-Border Transfer Controls',
      description: 'Legal basis and safeguards documentation for international data transfers.',
      tag: 'Transfer Mechanism', color: T.amber, bg: T.amberLight, border: T.amberBorder, darkBg: D.amberLight, darkBorder: 'rgba(217,119,6,0.3)',
      details: ['SCCs / BCRs / Adequacy decisions', 'DPA register maintenance', 'Vendor sub-processor inventory', 'Transfer impact assessment'],
    },
    {
      icon: <ControlOutlined />, label: 'Consent & Privacy Impact',
      description: 'Consent management with PIA/DPIA documentation and DPO sign-off tracking.',
      tag: 'PIA / DPIA', color: T.red, bg: T.redLight, border: T.redBorder, darkBg: D.redLight, darkBorder: 'rgba(220,38,38,0.3)',
      details: ['Granular consent per purpose', 'Consent withdrawal mechanism', 'PIA/DPIA completion', 'DPO notification & sign-off', 'Privacy notice versioning'],
    },
  ],
};

// ── Shared sub-components ─────────────────────────────────────────────────────

function SeverityBadge({ severity, isDark }: { severity: string; isDark: boolean }) {
  const cfg = SEVERITY_CONFIG[severity] ?? SEVERITY_CONFIG.low;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '2px 8px', borderRadius: 6,
      fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' as const,
      color: cfg.color,
      background: dk(isDark, cfg.bg, cfg.darkBg),
    }}>
      {severity}
    </span>
  );
}

function DragHandle({ color }: { color: string }) {
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 2.5, cursor: 'grab', padding: '2px 4px', flexShrink: 0 }}>
      {[0, 1, 2].map(i => (
        <span key={i} style={{ display: 'flex', gap: 2.5 }}>
          {[0, 1].map(j => (
            <span key={j} style={{ width: 3, height: 3, borderRadius: '50%', background: color, display: 'inline-block' }} />
          ))}
        </span>
      ))}
    </span>
  );
}

// ── Add task mini form ────────────────────────────────────────────────────────
// Security: maxLength applied to all text inputs to prevent oversized payloads.

function AddTaskForm({ isDark, onAdd, onCancel }: {
  isDark: boolean;
  onAdd: (task: Omit<SecurityTask, 'id'>) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<'critical' | 'high' | 'medium' | 'low'>('medium');
  const [principle, setPrinciple] = useState('');

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '7px 10px', fontSize: 12,
    borderRadius: 8, border: `1px solid ${dk(isDark, T.stone200, D.borderSub)}`,
    background: dk(isDark, T.white, D.bgCard),
    color: dk(isDark, T.stone800, D.text),
    outline: 'none', boxSizing: 'border-box',
  };

  return (
    <div style={{
      marginTop: 8, padding: 14, borderRadius: 10,
      border: `1px solid ${dk(isDark, T.stone200, D.borderSub)}`,
      background: dk(isDark, T.stone50, D.bgSub),
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      {/* Security: maxLength prevents oversized inputs from reaching the API */}
      <input placeholder="Task title *" value={title} onChange={e => setTitle(e.target.value)} maxLength={200} style={inputStyle} />
      <textarea
        placeholder="Description"
        value={description}
        onChange={e => setDescription(e.target.value)}
        rows={2}
        maxLength={1000}
        style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
      />
      <div style={{ display: 'flex', gap: 8 }}>
        <select value={severity} onChange={e => setSeverity(e.target.value as any)} style={{ ...inputStyle, flex: 1 }}>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <input placeholder="Principle" value={principle} onChange={e => setPrinciple(e.target.value)} maxLength={100} style={{ ...inputStyle, flex: 1 }} />
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={{
          padding: '5px 12px', borderRadius: 7, fontSize: 12, cursor: 'pointer', fontWeight: 500,
          border: `1px solid ${dk(isDark, T.stone200, D.borderSub)}`,
          background: 'transparent', color: dk(isDark, T.stone500, D.textMuted),
        }}>Cancel</button>
        <button
          disabled={!title.trim()}
          onClick={() => {
            if (!title.trim()) return;
            onAdd({ title: title.trim(), description: description.trim(), severity, principle: principle.trim() || 'General' });
          }}
          style={{
            padding: '5px 12px', borderRadius: 7, fontSize: 12, cursor: 'pointer', fontWeight: 600,
            border: 'none', background: T.orange, color: T.white, opacity: title.trim() ? 1 : 0.5,
          }}
        >Add Task</button>
      </div>
    </div>
  );
}

// ── Left nav ──────────────────────────────────────────────────────────────────

type TabId = 'overview' | 'questionnaire' | 'tasks' | 'settings';

const TAB_DEFS: Array<{ id: TabId; icon: React.ReactNode; label: string; sublabel: string }> = [
  { id: 'overview',      icon: <InfoCircleOutlined />,    label: 'Overview',       sublabel: 'Framework structure' },
  { id: 'questionnaire', icon: <QuestionCircleOutlined />, label: 'Questionnaire', sublabel: 'Questions & hints' },
  { id: 'tasks',         icon: <ThunderboltOutlined />,   label: 'Task Rules',     sublabel: 'Conditional & baseline' },
  { id: 'settings',      icon: <SettingOutlined />,       label: 'Settings',       sublabel: 'Name, status, metadata' },
];

function LeftNav({ active, onChange, accentColor, isDark, policy }: {
  active: TabId; onChange: (t: TabId) => void; accentColor: string; isDark: boolean;
  policy: PolicyTemplate;
}) {
  const tabBadges: Partial<Record<TabId, number>> = {
    questionnaire: policy.questions.length,
    tasks: policy.taskRules.reduce((s, r) => s + r.tasks.length, 0) + policy.baselineTasks.length,
  };

  return (
    <div style={{
      width: 200, flexShrink: 0,
      borderRight: `1px solid ${dk(isDark, T.stone200, D.border)}`,
      background: dk(isDark, T.white, D.bgCard),
      display: 'flex', flexDirection: 'column',
      padding: '12px 8px',
      gap: 2,
    }}>
      {TAB_DEFS.map(tab => {
        const isActive = tab.id === active;
        const badge = tabBadges[tab.id];
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '9px 10px', borderRadius: 8, border: 'none',
              background: isActive ? dk(isDark, `${accentColor}14`, `${accentColor}18`) : 'transparent',
              cursor: 'pointer', transition: 'background 0.12s',
              textAlign: 'left', width: '100%',
            }}
          >
            <span style={{
              fontSize: 14, color: isActive ? accentColor : dk(isDark, T.stone400, D.textMuted),
              flexShrink: 0,
            }}>
              {tab.icon}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 12, fontWeight: isActive ? 700 : 500,
                color: isActive ? accentColor : dk(isDark, T.stone700, D.text),
                display: 'flex', alignItems: 'center', gap: 5,
              }}>
                {tab.label}
                {badge !== undefined && badge > 0 && (
                  <span style={{
                    fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 99,
                    background: isActive ? accentColor : dk(isDark, T.stone100, D.bgHover),
                    color: isActive ? T.white : dk(isDark, T.stone500, D.textMuted),
                  }}>
                    {badge}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 10, color: dk(isDark, T.stone400, D.textFaint), marginTop: 1 }}>
                {tab.sublabel}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ── Framework Overview tab ────────────────────────────────────────────────────

function FrameworkOverviewTab({ policy, isDark }: { policy: PolicyTemplate; isDark: boolean }) {
  const sections = FRAMEWORK_SECTIONS[policy.type];
  const accentColor = TYPE_COLORS[policy.type];
  const taskCount = policy.taskRules.reduce((s, r) => s + r.tasks.length, 0) + policy.baselineTasks.length;

  return (
    <div style={{ maxWidth: 860, padding: '28px 32px' }}>
      {/* Intro card */}
      <div style={{
        padding: '20px 24px', borderRadius: 14, marginBottom: 28,
        background: dk(isDark, TYPE_BG[policy.type], TYPE_BG_DARK[policy.type]),
        border: `1px solid ${dk(isDark, TYPE_BORDER[policy.type], TYPE_BORDER_DARK[policy.type])}`,
        display: 'flex', alignItems: 'flex-start', gap: 16,
      }}>
        <div style={{
          width: 44, height: 44, borderRadius: 12, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 20, color: accentColor,
          background: dk(isDark, T.white, D.bgCard),
          border: `1px solid ${dk(isDark, TYPE_BORDER[policy.type], TYPE_BORDER_DARK[policy.type])}`,
        }}>
          {TYPE_ICONS[policy.type]}
        </div>
        <div>
          <h3 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 800, color: dk(isDark, T.stone800, D.text) }}>
            {policy.name} — Framework Structure
          </h3>
          <p style={{ margin: '0 0 12px', fontSize: 12.5, color: dk(isDark, T.stone500, D.textMuted), lineHeight: 1.5 }}>
            {policy.description}
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[
              { label: `${policy.questions.length} Questions`, color: accentColor },
              { label: `${taskCount} Task Rules`, color: T.amber },
              { label: `${sections.length} Dimensions`, color: T.purple },
              { label: `v${policy.version}`, color: dk(isDark, T.stone500, D.textMuted) },
            ].map(stat => (
              <span key={stat.label} style={{
                fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 7,
                background: dk(isDark, T.white, D.bgCard),
                border: `1px solid ${dk(isDark, T.stone200, D.borderSub)}`,
                color: stat.color,
              }}>
                {stat.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Section grid */}
      <div style={{
        fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' as const,
        color: dk(isDark, T.stone400, D.textFaint), marginBottom: 12,
      }}>
        Review Framework Dimensions
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {sections.map(sec => (
          <div key={sec.label} style={{
            display: 'flex', gap: 14,
            padding: '16px 18px', borderRadius: 12,
            background: dk(isDark, T.white, D.bgCard),
            border: `1px solid ${dk(isDark, T.stone200, D.borderSub)}`,
          }}>
            {/* Icon */}
            <div style={{
              width: 38, height: 38, borderRadius: 10, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 16, color: sec.color,
              background: dk(isDark, sec.bg, sec.darkBg),
              border: `1px solid ${dk(isDark, sec.border, sec.darkBorder)}`,
            }}>
              {sec.icon}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: sec.color }}>{sec.label}</span>
                <span style={{
                  fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                  background: dk(isDark, sec.bg, sec.darkBg),
                  border: `1px solid ${dk(isDark, sec.border, sec.darkBorder)}`,
                  color: sec.color, letterSpacing: '0.05em', textTransform: 'uppercase' as const,
                }}>
                  {sec.tag}
                </span>
              </div>
              <p style={{ margin: '0 0 10px', fontSize: 12, color: dk(isDark, T.stone500, D.textMuted), lineHeight: 1.5 }}>
                {sec.description}
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {sec.details.map(d => (
                  <span key={d} style={{
                    fontSize: 10.5, padding: '3px 8px', borderRadius: 5,
                    background: dk(isDark, T.stone50, D.bgSub),
                    border: `1px solid ${dk(isDark, T.stone200, D.borderSub)}`,
                    color: dk(isDark, T.stone500, D.textMuted),
                  }}>
                    {d}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={{
        marginTop: 20, padding: '12px 16px', borderRadius: 10,
        background: dk(isDark, T.blueLight, D.blueLight),
        border: `1px solid ${dk(isDark, T.blueBorder, D.blueBorder)}`,
        fontSize: 12, color: dk(isDark, T.blue, '#93C5FD'), lineHeight: 1.5,
      }}>
        <InfoCircleOutlined style={{ marginRight: 8 }} />
        The <strong>Questionnaire</strong> and <strong>Task Rules</strong> tabs let you edit the questions and
        conditional tasks for this policy. Framework dimensions marked <em>Framework</em> are structural guidelines
        that inform how reviewers interpret the questionnaire — they are not independently configurable.
      </div>
    </div>
  );
}

// ── Questionnaire tab ─────────────────────────────────────────────────────────

function QuestionnaireTab({
  policy,
  isDark,
  accentColor,
  mutate,
}: {
  policy: PolicyTemplate;
  isDark: boolean;
  accentColor: string;
  mutate: (fn: (p: PolicyTemplate) => PolicyTemplate) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(policy.questions[0]?.id ?? null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newQText, setNewQText] = useState('');
  const [newQHint, setNewQHint] = useState('');
  const dragIndexRef = useRef<number | null>(null);

  const selectedQ = policy.questions.find(q => q.id === selectedId);

  function onDragStart(i: number) { dragIndexRef.current = i; }
  function onDragOver(e: React.DragEvent, i: number) {
    e.preventDefault();
    const from = dragIndexRef.current;
    if (from === null || from === i) return;
    mutate(p => {
      const qs = [...p.questions];
      const [moved] = qs.splice(from, 1);
      qs.splice(i, 0, moved);
      dragIndexRef.current = i;
      return { ...p, questions: qs };
    });
  }
  function onDragEnd() { dragIndexRef.current = null; }

  const textareaStyle: React.CSSProperties = {
    width: '100%', padding: '10px 12px', fontSize: 13,
    borderRadius: 8, border: `1px solid ${dk(isDark, T.stone200, D.borderSub)}`,
    background: dk(isDark, T.stone50, D.bgSub),
    color: dk(isDark, T.stone800, D.text),
    resize: 'vertical', fontFamily: 'inherit', outline: 'none',
    boxSizing: 'border-box', lineHeight: 1.5,
  };

  return (
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
      {/* ── Question list panel ── */}
      <div style={{
        width: 300, flexShrink: 0,
        borderRight: `1px solid ${dk(isDark, T.stone200, D.border)}`,
        background: dk(isDark, T.white, D.bgCard),
        display: 'flex', flexDirection: 'column', overflowY: 'auto',
        padding: '16px 12px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase' as const, color: dk(isDark, T.stone400, D.textMuted) }}>
            Questions ({policy.questions.length})
          </span>
          <button
            onClick={() => setShowAddForm(v => !v)}
            style={{
              display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px',
              borderRadius: 6, border: `1px solid ${dk(isDark, T.stone200, D.borderSub)}`,
              background: 'transparent', cursor: 'pointer', fontSize: 11, fontWeight: 600,
              color: dk(isDark, T.stone500, D.textMuted),
            }}
          >
            <PlusOutlined style={{ fontSize: 10 }} /> Add
          </button>
        </div>

        {/* Add form */}
        {showAddForm && (
          <div style={{
            marginBottom: 10, padding: 10, borderRadius: 8,
            border: `1px solid ${dk(isDark, T.stone200, D.borderSub)}`,
            background: dk(isDark, T.stone50, D.bgSub),
            display: 'flex', flexDirection: 'column', gap: 6,
          }}>
            <textarea
              placeholder="Question text *"
              value={newQText}
              onChange={e => setNewQText(e.target.value)}
              rows={2}
              maxLength={500}
              style={{
                width: '100%', padding: '7px 10px', fontSize: 12, borderRadius: 6,
                border: `1px solid ${dk(isDark, T.stone200, D.borderSub)}`,
                background: dk(isDark, T.white, D.bgCard),
                color: dk(isDark, T.stone800, D.text),
                resize: 'vertical', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
              }}
            />
            <input
              placeholder="Hint (optional)"
              value={newQHint}
              onChange={e => setNewQHint(e.target.value)}
              maxLength={300}
              style={{
                width: '100%', padding: '7px 10px', fontSize: 12, borderRadius: 6,
                border: `1px solid ${dk(isDark, T.stone200, D.borderSub)}`,
                background: dk(isDark, T.white, D.bgCard),
                color: dk(isDark, T.stone800, D.text), outline: 'none', boxSizing: 'border-box',
              }}
            />
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
              <button onClick={() => { setShowAddForm(false); setNewQText(''); setNewQHint(''); }} style={{
                padding: '4px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer',
                border: `1px solid ${dk(isDark, T.stone200, D.borderSub)}`, background: 'transparent',
                color: dk(isDark, T.stone500, D.textMuted),
              }}>Cancel</button>
              <button
                disabled={!newQText.trim()}
                onClick={() => {
                  const newId = generateId();
                  mutate(p => ({
                    ...p,
                    questions: [...p.questions, { id: newId, question: newQText.trim(), hint: newQHint.trim() || undefined }],
                  }));
                  setSelectedId(newId);
                  setShowAddForm(false);
                  setNewQText(''); setNewQHint('');
                }}
                style={{
                  padding: '4px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer',
                  border: 'none', background: accentColor, color: T.white, fontWeight: 600,
                  opacity: newQText.trim() ? 1 : 0.5,
                }}
              >Add</button>
            </div>
          </div>
        )}

        {/* List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {policy.questions.map((q, idx) => {
            const isSelected = q.id === selectedId;
            const ruleCount = policy.taskRules.find(r => r.questionId === q.id)?.tasks.length ?? 0;
            return (
              <div
                key={q.id}
                draggable
                onDragStart={() => onDragStart(idx)}
                onDragOver={e => onDragOver(e, idx)}
                onDragEnd={onDragEnd}
                onClick={() => setSelectedId(q.id)}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 6,
                  padding: '8px 8px', borderRadius: 8, cursor: 'pointer',
                  background: isSelected ? dk(isDark, TYPE_BG[policy.type], TYPE_BG_DARK[policy.type]) : 'transparent',
                  borderLeft: `3px solid ${isSelected ? accentColor : 'transparent'}`,
                  transition: 'background 0.1s',
                }}
              >
                <DragHandle color={dk(isDark, T.stone300, D.textFaint)} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 10, color: dk(isDark, T.stone400, D.textFaint), marginBottom: 2 }}>{idx + 1}.</div>
                  <div style={{
                    fontSize: 11.5, fontWeight: isSelected ? 600 : 400,
                    color: isSelected ? accentColor : dk(isDark, T.stone700, D.text),
                    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                  }}>
                    {q.question}
                  </div>
                  {ruleCount > 0 && (
                    <span style={{ fontSize: 10, color: dk(isDark, T.stone400, D.textFaint), marginTop: 2, display: 'block' }}>
                      {ruleCount} task{ruleCount > 1 ? 's' : ''} on Yes
                    </span>
                  )}
                </div>
                <button
                  onClick={e => {
                    e.stopPropagation();
                    mutate(p => ({
                      ...p,
                      questions: p.questions.filter(x => x.id !== q.id),
                      taskRules: p.taskRules.filter(r => r.questionId !== q.id),
                    }));
                    if (selectedId === q.id) {
                      setSelectedId(policy.questions.filter(x => x.id !== q.id)[0]?.id ?? null);
                    }
                  }}
                  style={{ padding: '2px 4px', border: 'none', background: 'transparent', cursor: 'pointer', color: dk(isDark, T.stone300, D.textFaint), fontSize: 12 }}
                >
                  <DeleteOutlined />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Question editor panel ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '28px 32px', background: dk(isDark, T.stone50, D.bg) }}>
        {!selectedQ ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 10, color: dk(isDark, T.stone400, D.textFaint) }}>
            <span style={{ fontSize: 36 }}>←</span>
            <span style={{ fontSize: 13 }}>Select a question to edit</span>
          </div>
        ) : (
          <div style={{ maxWidth: 680 }}>
            {/* Question text */}
            <div style={{
              background: dk(isDark, T.white, D.bgCard),
              border: `1px solid ${dk(isDark, T.stone200, D.borderSub)}`,
              borderRadius: 14, padding: 20, marginBottom: 18,
            }}>
              <label style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase' as const, color: dk(isDark, T.stone400, D.textMuted), display: 'block', marginBottom: 8 }}>
                Question Text
              </label>
              {/* Security: maxLength=500 prevents oversized question text */}
              <textarea
                value={selectedQ.question}
                onChange={e => mutate(p => ({
                  ...p,
                  questions: p.questions.map(q => q.id === selectedId ? { ...q, question: e.target.value } : q),
                }))}
                rows={3}
                maxLength={500}
                style={textareaStyle}
              />
              <label style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase' as const, color: dk(isDark, T.stone400, D.textMuted), display: 'block', marginTop: 14, marginBottom: 8 }}>
                Hint <span style={{ fontWeight: 400, textTransform: 'none', fontSize: 10 }}>(shown to agents during review)</span>
              </label>
              {/* Security: maxLength=300 */}
              <textarea
                value={selectedQ.hint ?? ''}
                onChange={e => mutate(p => ({
                  ...p,
                  questions: p.questions.map(q => q.id === selectedId ? { ...q, hint: e.target.value || undefined } : q),
                }))}
                rows={2}
                placeholder="Optional guidance for the reviewing agent…"
                maxLength={300}
                style={{ ...textareaStyle, fontSize: 12, color: dk(isDark, T.stone600, D.textMuted) }}
              />
            </div>

            {/* Task rules for this question */}
            <TaskRulesForQuestion
              policy={policy}
              questionId={selectedId!}
              isDark={isDark}
              accentColor={accentColor}
              mutate={mutate}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Task rules for a specific question (used inside Questionnaire tab) ────────

function TaskRulesForQuestion({
  policy, questionId, isDark, accentColor: _accentColor, mutate,
}: {
  policy: PolicyTemplate;
  questionId: string;
  isDark: boolean;
  accentColor: string;
  mutate: (fn: (p: PolicyTemplate) => PolicyTemplate) => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const rule = policy.taskRules.find(r => r.questionId === questionId);

  return (
    <div style={{
      background: dk(isDark, T.white, D.bgCard),
      border: `1px solid ${dk(isDark, T.stone200, D.borderSub)}`,
      borderRadius: 14, padding: 20,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: dk(isDark, T.stone700, D.text) }}>Conditional Task Rules</div>
          <div style={{ fontSize: 11, color: dk(isDark, T.stone400, D.textMuted), marginTop: 2 }}>
            Tasks added when the agent answers "Yes" to this question
          </div>
        </div>
        <button
          onClick={() => setShowAdd(v => !v)}
          style={{
            display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px',
            borderRadius: 8, border: `1px solid ${dk(isDark, T.stone200, D.borderSub)}`,
            background: 'transparent', cursor: 'pointer', fontSize: 12, fontWeight: 600,
            color: dk(isDark, T.stone600, D.textMuted),
          }}
        >
          <PlusOutlined style={{ fontSize: 11 }} /> Add Task
        </button>
      </div>

      {showAdd && (
        <AddTaskForm
          isDark={isDark}
          onAdd={task => {
            mutate(p => {
              const existing = p.taskRules.find(r => r.questionId === questionId);
              if (existing) {
                return { ...p, taskRules: p.taskRules.map(r => r.questionId === questionId ? { ...r, tasks: [...r.tasks, task] } : r) };
              }
              return { ...p, taskRules: [...p.taskRules, { questionId, tasks: [task] }] };
            });
            setShowAdd(false);
          }}
          onCancel={() => setShowAdd(false)}
        />
      )}

      {rule && rule.tasks.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: showAdd ? 10 : 0 }}>
          {rule.tasks.map((task, taskIdx) => (
            <div key={taskIdx} style={{
              padding: '12px 14px', borderRadius: 10,
              border: `1px solid ${dk(isDark, T.stone200, D.borderSub)}`,
              background: dk(isDark, T.stone50, D.bgSub),
              display: 'flex', alignItems: 'flex-start', gap: 10,
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                  <SeverityBadge severity={task.severity} isDark={isDark} />
                  {task.principle && (
                    <span style={{ fontSize: 10, color: dk(isDark, T.stone400, D.textFaint), fontStyle: 'italic' }}>
                      {task.principle}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: dk(isDark, T.stone700, D.text), marginBottom: 4 }}>{task.title}</div>
                {task.description && (
                  <div style={{ fontSize: 12, color: dk(isDark, T.stone500, D.textMuted), lineHeight: 1.5 }}>{task.description}</div>
                )}
              </div>
              <button
                onClick={() => mutate(p => ({
                  ...p,
                  taskRules: p.taskRules.map(r =>
                    r.questionId === questionId
                      ? { ...r, tasks: r.tasks.filter((_, i) => i !== taskIdx) }
                      : r
                  ).filter(r => r.tasks.length > 0),
                }))}
                style={{ padding: '2px 4px', border: 'none', background: 'transparent', cursor: 'pointer', color: dk(isDark, T.stone300, D.textFaint) }}
              >
                <DeleteOutlined />
              </button>
            </div>
          ))}
        </div>
      ) : (
        !showAdd && (
          <div style={{
            padding: 20, textAlign: 'center', borderRadius: 10,
            border: `2px dashed ${dk(isDark, T.stone200, D.borderSub)}`,
            color: dk(isDark, T.stone400, D.textFaint), fontSize: 13,
          }}>
            No task rules for this question. Add one above.
          </div>
        )
      )}
    </div>
  );
}

// ── Task Rules tab ────────────────────────────────────────────────────────────

function TaskRulesTab({
  policy, isDark, accentColor, mutate,
}: {
  policy: PolicyTemplate;
  isDark: boolean;
  accentColor: string;
  mutate: (fn: (p: PolicyTemplate) => PolicyTemplate) => void;
}) {
  const [showAddBaseline, setShowAddBaseline] = useState(false);

  const sectionHeader = (title: string, count: number, badge: string) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: dk(isDark, T.stone700, D.text) }}>{title}</span>
      <span style={{
        fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 5,
        background: dk(isDark, T.stone100, D.bgHover), color: dk(isDark, T.stone500, D.textMuted),
        border: `1px solid ${dk(isDark, T.stone200, D.borderSub)}`,
      }}>
        {count} tasks
      </span>
      <span style={{
        fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
        background: `${accentColor}18`, color: accentColor,
        border: `1px solid ${accentColor}33`, letterSpacing: '0.05em', textTransform: 'uppercase' as const,
      }}>
        {badge}
      </span>
    </div>
  );

  return (
    <div style={{ overflowY: 'auto', padding: '28px 32px', background: dk(isDark, T.stone50, D.bg) }}>
      <div style={{ maxWidth: 760 }}>
        {/* Conditional rules per question */}
        <div style={{ marginBottom: 32 }}>
          {sectionHeader('Conditional Task Rules', policy.taskRules.reduce((s, r) => s + r.tasks.length, 0), 'Triggered by Yes answers')}
          <p style={{ fontSize: 12, color: dk(isDark, T.stone500, D.textMuted), margin: '0 0 16px' }}>
            These tasks are added to a review when the agent answers "Yes" to the linked question.
            Edit individual question rules from the <strong>Questionnaire</strong> tab.
          </p>

          {policy.taskRules.length === 0 ? (
            <div style={{
              padding: 24, textAlign: 'center', borderRadius: 12,
              border: `2px dashed ${dk(isDark, T.stone200, D.borderSub)}`,
              color: dk(isDark, T.stone400, D.textFaint), fontSize: 13,
            }}>
              No conditional task rules. Add them from the Questionnaire tab.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {policy.taskRules.map(rule => {
                const q = policy.questions.find(q => q.id === rule.questionId);
                return (
                  <div key={rule.questionId} style={{
                    borderRadius: 12,
                    border: `1px solid ${dk(isDark, T.stone200, D.borderSub)}`,
                    background: dk(isDark, T.white, D.bgCard),
                    overflow: 'hidden',
                  }}>
                    {/* Question label */}
                    <div style={{
                      padding: '10px 14px',
                      background: dk(isDark, T.stone50, D.bgSub),
                      borderBottom: `1px solid ${dk(isDark, T.stone200, D.borderSub)}`,
                      display: 'flex', alignItems: 'center', gap: 8,
                    }}>
                      <QuestionCircleOutlined style={{ color: accentColor, fontSize: 12 }} />
                      <span style={{ fontSize: 11.5, color: dk(isDark, T.stone600, D.textMuted), fontStyle: 'italic', flex: 1, minWidth: 0 }}>
                        {q?.question ?? rule.questionId}
                      </span>
                      <span style={{
                        fontSize: 10, padding: '2px 7px', borderRadius: 5, fontWeight: 700,
                        background: `${accentColor}18`, color: accentColor,
                        border: `1px solid ${accentColor}33`,
                      }}>
                        {rule.tasks.length} task{rule.tasks.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    {/* Tasks */}
                    <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {rule.tasks.map((task, idx) => (
                        <div key={idx} style={{
                          display: 'flex', alignItems: 'flex-start', gap: 10,
                          padding: '10px 12px', borderRadius: 8,
                          background: dk(isDark, T.stone50, D.bgSub),
                          border: `1px solid ${dk(isDark, T.stone200, D.borderSub)}`,
                        }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
                              <SeverityBadge severity={task.severity} isDark={isDark} />
                              {task.principle && <span style={{ fontSize: 10, color: dk(isDark, T.stone400, D.textFaint), fontStyle: 'italic' }}>{task.principle}</span>}
                            </div>
                            <div style={{ fontSize: 12.5, fontWeight: 600, color: dk(isDark, T.stone700, D.text), marginBottom: 3 }}>{task.title}</div>
                            {task.description && <div style={{ fontSize: 11.5, color: dk(isDark, T.stone500, D.textMuted), lineHeight: 1.5 }}>{task.description}</div>}
                          </div>
                          <button
                            onClick={() => mutate(p => ({
                              ...p,
                              taskRules: p.taskRules.map(r =>
                                r.questionId === rule.questionId
                                  ? { ...r, tasks: r.tasks.filter((_, i) => i !== idx) }
                                  : r
                              ).filter(r => r.tasks.length > 0),
                            }))}
                            style={{ padding: '2px', border: 'none', background: 'transparent', cursor: 'pointer', color: dk(isDark, T.stone300, D.textFaint), flexShrink: 0 }}
                          >
                            <DeleteOutlined />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Baseline tasks */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            {sectionHeader('Baseline Controls', policy.baselineTasks.length, 'Always-on')}
            <button
              onClick={() => setShowAddBaseline(v => !v)}
              style={{
                display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px',
                borderRadius: 8, border: `1px solid ${dk(isDark, T.stone200, D.borderSub)}`,
                background: 'transparent', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                color: dk(isDark, T.stone600, D.textMuted),
              }}
            >
              <PlusOutlined style={{ fontSize: 11 }} /> Add
            </button>
          </div>
          <p style={{ fontSize: 12, color: dk(isDark, T.stone500, D.textMuted), margin: '0 0 16px' }}>
            Baseline tasks always apply to every review of this type, regardless of questionnaire answers.
          </p>
          {showAddBaseline && (
            <AddTaskForm
              isDark={isDark}
              onAdd={task => { mutate(p => ({ ...p, baselineTasks: [...p.baselineTasks, task] })); setShowAddBaseline(false); }}
              onCancel={() => setShowAddBaseline(false)}
            />
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: showAddBaseline ? 10 : 0 }}>
            {policy.baselineTasks.map((task, idx) => (
              <div key={idx} style={{
                display: 'flex', alignItems: 'flex-start', gap: 10,
                padding: '12px 14px', borderRadius: 10,
                border: `1px solid ${dk(isDark, T.stone200, D.borderSub)}`,
                background: dk(isDark, T.white, D.bgCard),
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
                    <SeverityBadge severity={task.severity} isDark={isDark} />
                    {task.principle && <span style={{ fontSize: 10, color: dk(isDark, T.stone400, D.textFaint), fontStyle: 'italic' }}>{task.principle}</span>}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: dk(isDark, T.stone700, D.text), marginBottom: 4 }}>{task.title}</div>
                  {task.description && <div style={{ fontSize: 12, color: dk(isDark, T.stone500, D.textMuted), lineHeight: 1.5 }}>{task.description}</div>}
                </div>
                <button
                  onClick={() => mutate(p => ({ ...p, baselineTasks: p.baselineTasks.filter((_, i) => i !== idx) }))}
                  style={{ padding: '2px', border: 'none', background: 'transparent', cursor: 'pointer', color: dk(isDark, T.stone300, D.textFaint) }}
                >
                  <DeleteOutlined />
                </button>
              </div>
            ))}
            {policy.baselineTasks.length === 0 && !showAddBaseline && (
              <div style={{
                padding: 20, textAlign: 'center', borderRadius: 10,
                border: `2px dashed ${dk(isDark, T.stone200, D.borderSub)}`,
                color: dk(isDark, T.stone400, D.textFaint), fontSize: 13,
              }}>
                No baseline tasks. These always apply regardless of answers.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Settings tab ──────────────────────────────────────────────────────────────

function SettingsTab({ policy, isDark, accentColor: _accentColor, mutate }: {
  policy: PolicyTemplate;
  isDark: boolean;
  accentColor: string;
  mutate: (fn: (p: PolicyTemplate) => PolicyTemplate) => void;
}) {
  const fieldStyle: React.CSSProperties = {
    width: '100%', padding: '10px 12px', fontSize: 13,
    borderRadius: 8, border: `1px solid ${dk(isDark, T.stone200, D.borderSub)}`,
    background: dk(isDark, T.white, D.bgCard),
    color: dk(isDark, T.stone800, D.text),
    outline: 'none', boxSizing: 'border-box',
  };

  return (
    <div style={{ overflowY: 'auto', padding: '28px 32px', background: dk(isDark, T.stone50, D.bg) }}>
      <div style={{ maxWidth: 560, display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Policy name */}
        <div style={{ background: dk(isDark, T.white, D.bgCard), border: `1px solid ${dk(isDark, T.stone200, D.borderSub)}`, borderRadius: 14, padding: 20 }}>
          <label style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase' as const, color: dk(isDark, T.stone400, D.textMuted), display: 'block', marginBottom: 8 }}>
            Policy Name
          </label>
          {/* Security: maxLength=120 */}
          <input
            value={policy.name}
            onChange={e => mutate(p => ({ ...p, name: e.target.value }))}
            maxLength={120}
            style={fieldStyle}
          />
        </div>

        {/* Description */}
        <div style={{ background: dk(isDark, T.white, D.bgCard), border: `1px solid ${dk(isDark, T.stone200, D.borderSub)}`, borderRadius: 14, padding: 20 }}>
          <label style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase' as const, color: dk(isDark, T.stone400, D.textMuted), display: 'block', marginBottom: 8 }}>
            Description
          </label>
          {/* Security: maxLength=500 */}
          <textarea
            value={policy.description}
            onChange={e => mutate(p => ({ ...p, description: e.target.value }))}
            rows={3}
            maxLength={500}
            style={{ ...fieldStyle, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}
          />
        </div>

        {/* Active toggle */}
        <div style={{ background: dk(isDark, T.white, D.bgCard), border: `1px solid ${dk(isDark, T.stone200, D.borderSub)}`, borderRadius: 14, padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: dk(isDark, T.stone700, D.text), marginBottom: 4 }}>Policy Active</div>
              <div style={{ fontSize: 12, color: dk(isDark, T.stone400, D.textMuted) }}>
                When active, this policy is used for all new reviews of this type.
              </div>
            </div>
            <Switch
              checked={policy.isActive}
              onChange={val => mutate(p => ({ ...p, isActive: val }))}
            />
          </div>
        </div>

        {/* Meta info */}
        <div style={{ background: dk(isDark, T.white, D.bgCard), border: `1px solid ${dk(isDark, T.stone200, D.borderSub)}`, borderRadius: 14, padding: 20 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase' as const, color: dk(isDark, T.stone400, D.textMuted), marginBottom: 14 }}>
            Policy Metadata
          </div>
          {[
            { label: 'Policy ID', value: policy.id },
            { label: 'Type', value: policy.type },
            { label: 'Version', value: `v${policy.version}` },
            { label: 'Created', value: new Date(policy.createdAt).toLocaleString() },
            { label: 'Last Updated', value: new Date(policy.updatedAt).toLocaleString() },
          ].map(row => (
            <div key={row.label} style={{
              display: 'flex', alignItems: 'baseline', gap: 12,
              padding: '8px 0', borderBottom: `1px solid ${dk(isDark, T.stone100, D.border)}`,
            }}>
              <span style={{ fontSize: 11, color: dk(isDark, T.stone400, D.textMuted), minWidth: 100, flexShrink: 0 }}>{row.label}</span>
              <span style={{ fontSize: row.label === 'Policy ID' ? 11 : 12, color: dk(isDark, T.stone700, D.text), fontFamily: row.label === 'Policy ID' ? 'monospace' : 'inherit' }}>
                {row.value}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function PolicyEditorPage() {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const navigate = useNavigate();
  const { policyId } = useParams<{ policyId: string }>();
  const { getPolicy, updatePolicy, resetToDefaults, loading } = usePolicies();

  const [localPolicy, setLocalPolicy] = useState<PolicyTemplate | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!policyId) return;
    getPolicy(policyId)
      .then(p => setLocalPolicy(p))
      .catch(() => navigate('/knowledge-base/policies'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [policyId]);

  function mutate(updater: (p: PolicyTemplate) => PolicyTemplate) {
    setLocalPolicy(prev => prev ? updater(prev) : prev);
    setIsDirty(true);
  }

  async function handleSave() {
    if (!localPolicy) return;
    setSaving(true);
    try {
      const updated = await updatePolicy(localPolicy.id, {
        name: localPolicy.name,
        description: localPolicy.description,
        questions: localPolicy.questions,
        taskRules: localPolicy.taskRules,
        baselineTasks: localPolicy.baselineTasks,
        isActive: localPolicy.isActive,
      });
      setLocalPolicy(updated);
      setIsDirty(false);
      message.success('Policy saved');
    } catch {
      message.error('Failed to save policy');
    } finally {
      setSaving(false);
    }
  }

  function handleRestoreDefaults() {
    if (!localPolicy) return;
    Modal.confirm({
      title: 'Restore to defaults?',
      icon: <ExclamationCircleOutlined style={{ color: T.red }} />,
      content: 'This will replace all questions and task rules with the factory defaults. This cannot be undone.',
      okText: 'Restore',
      okButtonProps: { danger: true },
      cancelText: 'Cancel',
      onOk: async () => {
        const reset = await resetToDefaults(localPolicy.type);
        setLocalPolicy(reset);
        setIsDirty(false);
        message.success('Restored to defaults');
      },
    });
  }

  const accentColor = localPolicy ? (TYPE_COLORS[localPolicy.type] ?? T.orange) : T.orange;

  if (loading && !localPolicy) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: dk(isDark, T.stone50, D.bg) }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!localPolicy) return null;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100vh',
      background: dk(isDark, T.stone50, D.bg),
    }}>
      {/* ── Header ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '0 24px', height: 60, flexShrink: 0,
        background: dk(isDark, T.white, D.bgCard),
        borderBottom: `1px solid ${dk(isDark, T.stone200, D.border)}`,
        boxShadow: isDark ? 'none' : '0 1px 3px rgba(28,25,23,0.06)',
      }}>
        {/* Back */}
        <button
          onClick={() => navigate('/knowledge-base/policies')}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px',
            borderRadius: 7, border: `1px solid ${dk(isDark, T.stone200, D.borderSub)}`,
            background: 'transparent', cursor: 'pointer', fontSize: 12,
            color: dk(isDark, T.stone500, D.textMuted),
          }}
        >
          <ArrowLeftOutlined style={{ fontSize: 11 }} /> Policies
        </button>

        {/* Type pill */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 7,
          padding: '5px 12px', borderRadius: 20,
          background: dk(isDark, TYPE_BG[localPolicy.type], TYPE_BG_DARK[localPolicy.type]),
          border: `1px solid ${dk(isDark, TYPE_BORDER[localPolicy.type], TYPE_BORDER_DARK[localPolicy.type])}`,
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 13, color: accentColor }}>{TYPE_ICONS[localPolicy.type]}</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: accentColor }}>
            {localPolicy.type === 'security_review' ? 'Security' : localPolicy.type === 'responsible_ai' ? 'Responsible AI' : 'Privacy'}
          </span>
        </div>

        {/* Name (editable) */}
        <input
          value={localPolicy.name}
          onChange={e => mutate(p => ({ ...p, name: e.target.value }))}
          maxLength={120}
          style={{
            fontSize: 15, fontWeight: 700, border: 'none', background: 'transparent', outline: 'none',
            color: dk(isDark, T.stone800, D.text), minWidth: 0, flex: 1,
          }}
        />

        {/* Version badge */}
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6,
          background: dk(isDark, T.stone100, D.bgHover), color: dk(isDark, T.stone500, D.textMuted),
          border: `1px solid ${dk(isDark, T.stone200, D.borderSub)}`, flexShrink: 0,
        }}>
          v{localPolicy.version}
        </span>

        {/* Dirty indicator */}
        {isDirty && (
          <span style={{ fontSize: 10, fontWeight: 600, color: T.amber, flexShrink: 0 }}>● Unsaved</span>
        )}

        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', flexShrink: 0 }}>
          <button
            onClick={handleRestoreDefaults}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
              borderRadius: 8, border: `1px solid ${dk(isDark, T.stone200, D.borderSub)}`,
              background: 'transparent', cursor: 'pointer', fontSize: 12, fontWeight: 500,
              color: dk(isDark, T.stone600, D.textMuted),
            }}
          >
            <ReloadOutlined style={{ fontSize: 11 }} /> Restore Defaults
          </button>
          <button
            onClick={handleSave}
            disabled={!isDirty || saving}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px',
              borderRadius: 8,
              border: 'none',
              background: isDirty ? accentColor : dk(isDark, T.stone200, D.bgHover),
              cursor: isDirty ? 'pointer' : 'not-allowed',
              fontSize: 12, fontWeight: 700,
              color: isDirty ? T.white : dk(isDark, T.stone400, D.textFaint),
              opacity: saving ? 0.7 : 1,
              transition: 'background 0.15s',
            }}
          >
            <SaveOutlined style={{ fontSize: 11 }} /> {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* ── Body: left nav + content ── */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
        <LeftNav
          active={activeTab}
          onChange={setActiveTab}
          accentColor={accentColor}
          isDark={isDark}
          policy={localPolicy}
        />

        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {activeTab === 'overview' && (
            <div style={{ flex: 1, overflowY: 'auto' }}>
              <FrameworkOverviewTab policy={localPolicy} isDark={isDark} />
            </div>
          )}
          {activeTab === 'questionnaire' && (
            <QuestionnaireTab
              policy={localPolicy}
              isDark={isDark}
              accentColor={accentColor}
              mutate={mutate}
            />
          )}
          {activeTab === 'tasks' && (
            <TaskRulesTab
              policy={localPolicy}
              isDark={isDark}
              accentColor={accentColor}
              mutate={mutate}
            />
          )}
          {activeTab === 'settings' && (
            <SettingsTab
              policy={localPolicy}
              isDark={isDark}
              accentColor={accentColor}
              mutate={mutate}
            />
          )}
        </div>
      </div>
    </div>
  );
}