import { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Spin, Alert, Button, Breadcrumb, Tooltip } from 'antd';
import {
  ArrowLeftOutlined,
  HomeOutlined,
  SafetyOutlined,
  InfoCircleOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  ThunderboltOutlined,
  ApartmentOutlined,
  LoadingOutlined,
  WarningOutlined,
  ApiOutlined,
  DatabaseOutlined,
  ShareAltOutlined,
  DeploymentUnitOutlined,
} from '@ant-design/icons';
import { useAssets } from '../hooks';
import { useFeatures } from '../hooks/useFeatures';
import { useTheme } from '../hooks/useTheme';
import { T as TC, D as DC } from '../theme';
import { AssetRelationshipGraph } from '../components/diagram/AssetRelationshipGraph';
import { FeatureDiagram } from '../components/diagram/FeatureDiagram';
import { ThreatModelPanel } from '../components/diagram/ThreatModelPanel';
import { ExploitabilityPanel } from '../components/ExploitabilityPanel';
import type { AssetDetail, BusinessFeatureSummary } from '../types';

// ── Design tokens ─────────────────────────────────────────────────────────────

function makeTokens(isDark: boolean) {
  return {
    orange:       TC.orange,
    orangeLight:  isDark ? DC.orangeLight  : TC.orangeLight,
    orangeBorder: isDark ? DC.orangeBorder : TC.orangeBorder,
    stone50:  isDark ? DC.bg       : TC.stone50,
    stone100: isDark ? DC.bgCard   : TC.stone100,
    stone200: isDark ? DC.borderSub: TC.stone200,
    stone300: isDark ? TC.stone600  : TC.stone300,
    stone400: isDark ? TC.stone500  : TC.stone400,
    stone500: isDark ? TC.stone400  : TC.stone500,
    stone600: isDark ? TC.stone300  : TC.stone600,
    stone700: isDark ? TC.stone200  : TC.stone700,
    stone800: isDark ? DC.text      : TC.stone800,
    stone900: isDark ? TC.stone50   : TC.stone900,
    white:    isDark ? DC.bgSub     : TC.white,
    red:        TC.red,
    redLight:   isDark ? DC.redLight   : TC.redLight,
    redBorder:  isDark ? DC.redBorder  : TC.redBorder,
    green:      TC.green,
    greenLight: isDark ? DC.greenLight : TC.greenLight,
    blue:        TC.blue,
    blueLight:   isDark ? DC.blueLight  : TC.blueLight,
    blueBorder:  isDark ? DC.blueBorder : TC.blueBorder,
    amber:       TC.amber,
    amberLight:  isDark ? DC.amberLight  : TC.amberLight,
    amberBorder: isDark ? DC.amberBorder : TC.amberBorder,
  };
}

type Tokens = ReturnType<typeof makeTokens>;

function makeRiskColors(T: Tokens) {
  return {
    critical: { color: T.red,    bg: T.redLight,   border: T.redBorder   },
    high:     { color: TC.orangeHigh, bg: T.orangeLight, border: T.orangeBorder },
    medium:   { color: T.amber,      bg: T.amberLight,  border: T.amberBorder  },
    low:      { color: T.green,      bg: T.greenLight,  border: TC.greenBorder },
  };
}

type RiskColors = ReturnType<typeof makeRiskColors>;

function riskLevel(score: number): 'critical' | 'high' | 'medium' | 'low' {
  return score >= 70 ? 'critical' : score >= 40 ? 'high' : score >= 20 ? 'medium' : 'low';
}

// ── Right-panel tab definitions ───────────────────────────────────────────────

type PanelTabId = 'overview' | 'security' | 'features' | 'exploitability';
type GraphView  = 'relationship' | 'dfd';

const PANEL_TABS: Array<{ id: PanelTabId; label: string; icon: React.ReactNode }> = [
  { id: 'overview',      label: 'Overview',      icon: <InfoCircleOutlined />  },
  { id: 'security',      label: 'Threats',       icon: <SafetyOutlined />      },
  { id: 'exploitability',label: 'Exploitability',icon: <WarningOutlined />     },
  { id: 'features',      label: 'Features',      icon: <ThunderboltOutlined /> },
];

// ── Graph view switcher ───────────────────────────────────────────────────────

interface GraphViewSwitcherProps {
  current: GraphView;
  hasDfd: boolean;
  onChange: (v: GraphView) => void;
  isDark: boolean;
}

function GraphViewSwitcher({ current, hasDfd, onChange, isDark }: GraphViewSwitcherProps) {
  const views: Array<{ id: GraphView; label: string; icon: React.ReactNode; tooltip?: string }> = [
    { id: 'relationship', label: 'Relationships',  icon: <ShareAltOutlined /> },
    { id: 'dfd',          label: 'Service DFD',    icon: <DeploymentUnitOutlined />, tooltip: hasDfd ? undefined : 'Run a scan with Feature Extraction to generate the Service DFD' },
  ];

  return (
    <div style={{
      position: 'absolute', top: 14, left: '50%', transform: 'translateX(-50%)',
      zIndex: 20,
      display: 'flex', alignItems: 'center',
      background: isDark ? 'rgba(33,31,30,0.95)' : 'rgba(255,255,255,0.95)',
      backdropFilter: 'blur(8px)',
      border: `1px solid ${isDark ? DC.border : TC.stone200}`,
      borderRadius: 10,
      padding: 3,
      boxShadow: isDark ? '0 2px 12px rgba(0,0,0,0.4)' : '0 2px 12px rgba(0,0,0,0.10)',
      gap: 2,
    }}>
      {views.map((v) => {
        const isActive   = current === v.id;
        const isDisabled = v.id === 'dfd' && !hasDfd;
        const btn = (
          <button
            key={v.id}
            onClick={() => !isDisabled && onChange(v.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 14px', borderRadius: 7,
              fontSize: 12, fontWeight: 700,
              border: 'none', cursor: isDisabled ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s',
              background: isActive ? TC.orange : 'transparent',
              color: isActive ? TC.white : isDisabled ? (isDark ? TC.stone600 : '#C4B9B0') : (isDark ? TC.stone300 : TC.stone700),
              boxShadow: isActive ? '0 1px 6px rgba(249,115,22,0.35)' : 'none',
              opacity: isDisabled ? 0.7 : 1,
            }}
          >
            <span style={{ fontSize: 13, lineHeight: 1 }}>{v.icon}</span>
            {v.label}
          </button>
        );
        return isDisabled ? (
          <Tooltip key={v.id} title={v.tooltip} placement="bottom">
            {btn}
          </Tooltip>
        ) : btn;
      })}
    </div>
  );
}

// ── Service DFD canvas (full-canvas version) ──────────────────────────────────

function ServiceDFDCanvas({ asset, isDark }: { asset: AssetDetail; isDark: boolean }) {
  const dfd = asset.serviceDfd;

  if (!dfd) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 14 }}>
        <div style={{ width: 64, height: 64, borderRadius: '50%', background: isDark ? DC.bgCard : TC.stone100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <DeploymentUnitOutlined style={{ fontSize: 28, color: isDark ? TC.stone600 : TC.stone300 }} />
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: isDark ? DC.text : TC.stone700, marginBottom: 4 }}>No Service DFD available</div>
          <div style={{ fontSize: 12, color: isDark ? TC.stone500 : TC.stone400, lineHeight: 1.6, maxWidth: 300 }}>
            Run a scan with Feature Extraction enabled to generate the service-level Data Flow Diagram.
          </div>
        </div>
      </div>
    );
  }

  const dfdd   = dfd.dataFlowDiagram as any;
  const nodes  = (dfdd?.actors?.length ?? 0) + (dfdd?.processes?.length ?? 0) + (dfdd?.dataStores?.length ?? 0);
  const flows  = dfdd?.flows?.length ?? 0;
  const stores = dfdd?.dataStores?.length ?? 0;

  const syntheticFeature: import('../types').BusinessFeature = {
    id: asset.id,
    tenantId: '',
    entityType: 'feature_analysis',
    name: asset.name,
    description: asset.responsibility ?? '',
    businessValue: '',
    userStories: [],
    technicalSummary: '',
    correlationTags: [],
    sourceServiceIds: [asset.id],
    dataFlowDiagram: dfd.dataFlowDiagram as any,
    threatModel: (asset.serviceThreatModel as any) ?? ({} as any),
    confidence: 'heuristic',
    createdAt: dfd.generatedAt,
    updatedAt: dfd.generatedAt,
    metadata: {},
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Stats bar */}
      <div style={{
        position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)',
        zIndex: 20,
        display: 'flex', alignItems: 'center', gap: 16,
        background: isDark ? 'rgba(33,31,30,0.94)' : 'rgba(255,255,255,0.94)', backdropFilter: 'blur(6px)',
        border: `1px solid ${isDark ? DC.border : TC.stone200}`, borderRadius: 10,
        padding: '7px 16px',
        boxShadow: isDark ? '0 2px 10px rgba(0,0,0,0.3)' : '0 2px 10px rgba(0,0,0,0.07)',
        pointerEvents: 'none',
      }}>
        <StatPill icon={<ApartmentOutlined />} value={nodes} label="nodes" color={TC.orange} isDark={isDark} />
        <div style={{ width: 1, height: 16, background: isDark ? DC.border : TC.stone200 }} />
        <StatPill icon={<ApiOutlined />} value={flows} label="flows" color={isDark ? TC.stone400 : TC.stone500} isDark={isDark} />
        <div style={{ width: 1, height: 16, background: isDark ? DC.border : TC.stone200 }} />
        <StatPill icon={<DatabaseOutlined />} value={stores} label="stores" color={isDark ? TC.stone400 : TC.stone500} isDark={isDark} />
        {dfd.featuresCovered?.length > 0 && (
          <>
            <div style={{ width: 1, height: 16, background: isDark ? DC.border : TC.stone200 }} />
            <StatPill icon={<ThunderboltOutlined />} value={dfd.featuresCovered.length} label="features merged" color={isDark ? TC.stone400 : TC.stone500} isDark={isDark} />
          </>
        )}
      </div>

      {/* DFD canvas */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <FeatureDiagram feature={syntheticFeature} />
      </div>
    </div>
  );
}

function StatPill({ icon, value, label, color, isDark }: { icon: React.ReactNode; value: number; label: string; color: string; isDark: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <span style={{ fontSize: 11, color, lineHeight: 1 }}>{icon}</span>
      <span style={{ fontSize: 11, fontWeight: 700, color: isDark ? DC.text : TC.stone900, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
      <span style={{ fontSize: 11, color: isDark ? TC.stone500 : TC.stone400 }}>{label}</span>
    </div>
  );
}

// ── GraphProjection shape (matches SecurityGraph / backend response) ──────────

interface GraphProjection {
  nodes: Array<{
    id: string; type: string; label: string;
    severity?: string; metadata?: Record<string, any>; link?: string;
  }>;
  edges: Array<{
    id: string; from: string; to: string;
    type: string; confidence: string; label?: string;
  }>;
  focusNodeId?: string;
  explanation?: string;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Section({ title, children, T }: { title: string; children: React.ReactNode; T: Tokens }) {
  return (
    <div>
      <div style={{
        fontSize: 10, fontWeight: 700, letterSpacing: '0.07em',
        textTransform: 'uppercase', color: T.stone400, marginBottom: 8,
      }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function InfoRow({ label, children, T }: { label: string; children: React.ReactNode; T: Tokens }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 0', borderBottom: `1px solid ${T.stone100}` }}>
      <span style={{ fontSize: 11, color: T.stone400, minWidth: 110, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 11, color: T.stone700, flex: 1 }}>{children}</span>
    </div>
  );
}

function SeverityPill({ value, T, RISK_COLORS }: { value?: string; T: Tokens; RISK_COLORS: RiskColors }) {
  if (!value) return <span style={{ color: T.stone400 }}>—</span>;
  const v = value.toLowerCase() as keyof RiskColors;
  const cfg = RISK_COLORS[v] ?? { color: T.stone500, bg: T.stone100, border: T.stone200 };
  const bg = cfg.bg;
  const border = cfg.border;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 99,
      fontSize: 10, fontWeight: 700,
      color: cfg.color, background: bg, border: `1px solid ${border}`,
    }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: cfg.color, display: 'inline-block' }} />
      {value.toUpperCase()}
    </span>
  );
}

function RiskBar({ score, T, RISK_COLORS }: { score: number; T: Tokens; RISK_COLORS: RiskColors }) {
  const level = riskLevel(score);
  const color = RISK_COLORS[level].color;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 5, borderRadius: 99, background: T.stone100, overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(100, score)}%`, height: '100%', borderRadius: 99, background: color, transition: 'width 0.4s' }} />
      </div>
      <span style={{ fontSize: 11, fontWeight: 700, color, minWidth: 28, fontVariantNumeric: 'tabular-nums' }}>{score}</span>
    </div>
  );
}

// ── Right panel: Overview tab ─────────────────────────────────────────────────

function OverviewTab({ asset, T, RISK_COLORS }: { asset: AssetDetail; T: Tokens; RISK_COLORS: RiskColors }) {
  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Section title="Basic Information" T={T}>
        <div>
          <InfoRow label="Name" T={T}><strong>{asset.name}</strong></InfoRow>
          <InfoRow label="Type" T={T}>
            <span style={{ fontFamily: 'monospace', fontSize: 10, background: T.stone100, color: T.stone700, padding: '1px 5px', borderRadius: 4 }}>
              {asset.type.replace(/_/g, ' ')}
            </span>
          </InfoRow>
          <InfoRow label="ID" T={T}>
            <span style={{ fontFamily: 'monospace', fontSize: 10, color: T.stone500 }}>{asset.id}</span>
          </InfoRow>
          {asset.owner && <InfoRow label="Owner" T={T}>{asset.owner}</InfoRow>}
          {asset.businessCriticality && (
            <InfoRow label="Criticality" T={T}><SeverityPill value={asset.businessCriticality} T={T} RISK_COLORS={RISK_COLORS} /></InfoRow>
          )}
          {asset.riskScore !== undefined && (
            <InfoRow label="Risk Score" T={T}><RiskBar score={asset.riskScore} T={T} RISK_COLORS={RISK_COLORS} /></InfoRow>
          )}
          {asset.link && (
            <InfoRow label="Link" T={T}>
              <a href={asset.link} target="_blank" rel="noopener noreferrer" style={{ color: T.blue, fontSize: 11 }}>
                {asset.type === 'azure_identity'
                  ? 'Open in Entra ID'
                  : asset.type === 'cloud_resource'
                  ? 'Open in Azure Portal'
                  : 'Open repository'}
              </a>
            </InfoRow>
          )}
        </div>
      </Section>

      {asset.responsibility && (
        <Section title="Responsibility" T={T}>
          <p style={{ fontSize: 12, color: T.stone500, lineHeight: 1.65, margin: 0 }}>{asset.responsibility}</p>
        </Section>
      )}

      {/* Azure Managed Identity details */}
      {asset.type === 'azure_identity' && (
        <Section title="Managed Identity" T={T}>
          <div>
            {asset.metadata?.identityKind && (
              <InfoRow label="Kind" T={T}>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '2px 8px', borderRadius: 99,
                  fontSize: 10, fontWeight: 700,
                  color: T.blue, background: T.blueLight,
                  border: `1px solid ${T.blueBorder}`,
                }}>
                  {(asset.metadata.identityKind as string).replace(/_/g, ' ')
                    .replace(/\b\w/g, (c) => c.toUpperCase())}
                </span>
              </InfoRow>
            )}
            {asset.metadata?.principalId && (
              <InfoRow label="Object ID (Principal)" T={T}>
                <span style={{ fontFamily: 'monospace', fontSize: 10, color: T.stone600, wordBreak: 'break-all' }}>
                  {asset.metadata.principalId}
                </span>
              </InfoRow>
            )}
            {asset.metadata?.clientId && (
              <InfoRow label="Client ID (App ID)" T={T}>
                <span style={{ fontFamily: 'monospace', fontSize: 10, color: T.stone600, wordBreak: 'break-all' }}>
                  {asset.metadata.clientId}
                </span>
              </InfoRow>
            )}
            {asset.metadata?.region && (
              <InfoRow label="Region" T={T}>{asset.metadata.region}</InfoRow>
            )}
            {asset.metadata?.resourceId && (
              <InfoRow label="ARM Resource ID" T={T}>
                <span style={{ fontFamily: 'monospace', fontSize: 10, color: T.stone500, wordBreak: 'break-all' }}>
                  {asset.metadata.resourceId}
                </span>
              </InfoRow>
            )}
            {asset.metadata?.resourceGroup && (
              <InfoRow label="Resource Group" T={T}>{asset.metadata.resourceGroup}</InfoRow>
            )}
          </div>
        </Section>
      )}

      {/* Additional metadata — skip fields already shown above for identities */}
      {Object.keys(asset.metadata).filter((k) => {
        if (['responsibility', 'owner'].includes(k)) return false;
        if (asset.type === 'azure_identity' &&
            ['identityKind', 'principalId', 'clientId', 'region', 'resourceId', 'resourceGroup', 'dataClassification'].includes(k)) return false;
        return true;
      }).length > 0 && (
        <Section title="Additional Information" T={T}>
          <div>
            {Object.entries(asset.metadata)
              .filter(([k]) => {
                if (['responsibility', 'owner'].includes(k)) return false;
                if (asset.type === 'azure_identity' &&
                    ['identityKind', 'principalId', 'clientId', 'region', 'resourceId', 'resourceGroup', 'dataClassification'].includes(k)) return false;
                return true;
              })
              .map(([k, v]) => (
                <InfoRow key={k} label={k.replace(/_/g, ' ')} T={T}>
                  {typeof v === 'object' ? (
                    <span style={{ fontFamily: 'monospace', fontSize: 10 }}>{JSON.stringify(v)}</span>
                  ) : String(v)}
                </InfoRow>
              ))}
          </div>
        </Section>
      )}
    </div>
  );
}

// ── Right panel: Security (Service Threat Model) tab ─────────────────────────

function makeTBMeta(isDark: boolean): Record<string, { color: string; bg: string; border: string; desc: string }> {
  return {
    INTERNET: { color: isDark ? '#9CA3AF' : '#374151', bg: isDark ? 'rgba(156,163,175,0.1)' : TC.grayLight, border: isDark ? 'rgba(156,163,175,0.25)' : '#D1D5DB', desc: 'Public internet clients ↔ system' },
    IDENTITY: { color: isDark ? '#C084FC' : '#7E22CE', bg: isDark ? 'rgba(192,132,252,0.1)' : TC.purpleLight, border: isDark ? 'rgba(192,132,252,0.25)' : TC.purpleBorder, desc: 'Authentication / identity validation' },
    SERVICE:  { color: isDark ? '#818CF8' : TC.indigo, bg: isDark ? 'rgba(129,140,248,0.1)' : '#EEF2FF', border: isDark ? 'rgba(129,140,248,0.25)' : '#C7D2FE', desc: 'Internal microservice boundary' },
    DATA:     { color: isDark ? '#4ADE80' : TC.green,   bg: isDark ? 'rgba(74,222,128,0.1)'  : TC.greenLight, border: isDark ? 'rgba(74,222,128,0.25)'  : TC.greenBorder, desc: 'Persistent storage access' },
    EXTERNAL: { color: isDark ? '#FB923C' : TC.orangeHigh, bg: isDark ? 'rgba(251,146,60,0.1)'  : TC.orangeLight, border: isDark ? 'rgba(251,146,60,0.25)'  : TC.orangeHighBorder, desc: 'Third-party / SaaS services' },
  };
}

function makeClassificationMeta(isDark: boolean): Record<string, { color: string; bg: string; border: string }> {
  return {
    restricted:   { color: TC.red, bg: isDark ? DC.redLight  : TC.redLight, border: isDark ? DC.redBorder  : TC.redBorder },
    confidential: { color: TC.orangeHigh, bg: isDark ? 'rgba(234,88,12,0.12)'  : TC.orangeLight, border: isDark ? 'rgba(234,88,12,0.3)'  : TC.orangeHighBorder },
    internal:     { color: TC.blue, bg: isDark ? DC.blueLight  : TC.blueLight, border: isDark ? DC.blueBorder  : TC.blueBorder },
    public:       { color: TC.green,   bg: isDark ? 'rgba(22,163,74,0.12)'  : TC.greenLight, border: isDark ? 'rgba(22,163,74,0.3)'  : TC.greenBorder },
  };
}

function ServiceSecurityTab({ asset, T, RISK_COLORS, isDark }: { asset: AssetDetail; T: Tokens; RISK_COLORS: RiskColors; isDark: boolean }) {
  const stm = asset.serviceThreatModel as any;
  const TB_META = makeTBMeta(isDark);
  const CLASSIFICATION_META = makeClassificationMeta(isDark);

  if (!stm) {
    return (
      <div style={{ padding: '32px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 56, height: 56, borderRadius: '50%', background: T.stone100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <SafetyOutlined style={{ fontSize: 24, color: T.stone300 }} />
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.stone700, marginBottom: 4 }}>No service threat model</div>
          <div style={{ fontSize: 11, color: T.stone400, lineHeight: 1.6, maxWidth: 280 }}>
            Run a scan with Feature Extraction enabled to generate the service-level STRIDE threat model.
          </div>
        </div>
      </div>
    );
  }

  const threats = stm.strideThreats ?? [];
  const trustBoundaries = stm.trustBoundaryAnalysis ?? [];
  const dataClassification = stm.dataClassificationSummary ?? [];
  const recommendations = stm.securityRecommendations ?? [];
  const attackVectors = stm.attackVectors ?? [];
  const compliance = stm.complianceConsiderations ?? [];

  const rl  = riskLevel(stm.overallRiskScore ?? 0);
  const riskCfg = RISK_COLORS[rl];
  const secBorder = T.stone100;
  const secLabel  = T.stone400;

  return (
    <div style={{ padding: '12px 0', display: 'flex', flexDirection: 'column', gap: 0 }}>

      {/* ── Risk scorecard ─────────────────────────────────────────────── */}
      <div style={{ padding: '12px 16px 16px', borderBottom: `1px solid ${secBorder}` }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: secLabel, marginBottom: 10 }}>
          Service Risk Posture
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <div style={{
            width: 56, height: 56, borderRadius: 12, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column',
            background: riskCfg.bg, border: `1.5px solid ${riskCfg.border}`,
          }}>
            <span style={{ fontSize: 18, fontWeight: 900, color: riskCfg.color, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
              {stm.overallRiskScore ?? '—'}
            </span>
            <span style={{ fontSize: 8, fontWeight: 700, color: riskCfg.color, letterSpacing: '0.05em' }}>/ 100</span>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <SeverityPill value={riskLevel(stm.overallRiskScore ?? 0)} T={T} RISK_COLORS={RISK_COLORS} />
              <span style={{ fontSize: 11, color: T.stone500 }}>overall risk</span>
            </div>
            <div style={{ height: 6, borderRadius: 99, background: T.stone100, overflow: 'hidden' }}>
              <div style={{ width: `${Math.min(100, stm.overallRiskScore ?? 0)}%`, height: '100%', borderRadius: 99, background: riskCfg.color, transition: 'width 0.4s' }} />
            </div>
          </div>
        </div>
        {/* Threat counts by severity */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
          {(['critical', 'high', 'medium', 'low'] as const).map((sev) => {
            const count = threats.filter((t: any) => t.severity === sev).length;
            const cfg = RISK_COLORS[sev];
            const cardBg = cfg.bg;
            const cardBorder = cfg.border;
            return (
              <div key={sev} style={{ padding: '6px 8px', borderRadius: 8, background: cardBg, border: `1px solid ${cardBorder}`, textAlign: 'center' }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: cfg.color, fontVariantNumeric: 'tabular-nums' }}>{count}</div>
                <div style={{ fontSize: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: cfg.color }}>{sev}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Compliance tags ────────────────────────────────────────────── */}
      {compliance.length > 0 && (
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${secBorder}` }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: secLabel, marginBottom: 8 }}>
            Compliance Scope
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {compliance.map((c: string, i: number) => (
              <span key={i} style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 99, background: T.blueLight, color: '#60A5FA', border: `1px solid ${T.blueBorder}` }}>{c}</span>
            ))}
          </div>
        </div>
      )}

      {/* ── Attack vectors ─────────────────────────────────────────────── */}
      {attackVectors.length > 0 && (
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${secBorder}` }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: secLabel, marginBottom: 8 }}>
            Attack Vectors
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {attackVectors.map((v: string, i: number) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 11, color: T.stone600 }}>
                <WarningOutlined style={{ color: TC.orangeHigh, fontSize: 11, marginTop: 2, flexShrink: 0 }} />
                <span>{v}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── STRIDE Threats ──────────────────────────────────────────────── */}
      {threats.length > 0 && (
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${secBorder}` }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: secLabel, marginBottom: 10 }}>
            STRIDE Threats ({threats.length})
          </div>
          <ThreatModelPanel threats={threats} isDark={isDark} />
        </div>
      )}

      {/* ── Trust Boundaries ────────────────────────────────────────────── */}
      {trustBoundaries.length > 0 && (
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${secBorder}` }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: secLabel, marginBottom: 10 }}>
            Trust Boundaries ({trustBoundaries.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {trustBoundaries.map((tb: any, i: number) => {
              const meta = TB_META[tb.name] ?? { color: T.stone600, bg: T.stone100, border: T.stone200, desc: '' };
              const tbBg = meta.bg;
              const tbBorder = meta.border;
              return (
                <div key={i} style={{ borderRadius: 8, border: `1px solid ${tbBorder}`, overflow: 'hidden' }}>
                  <div style={{ padding: '8px 10px', background: tbBg, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 10, fontWeight: 800, color: meta.color, fontFamily: 'monospace' }}>{tb.name}</span>
                      <span style={{ fontSize: 10, color: meta.color, opacity: 0.8 }}>{meta.desc}</span>
                    </div>
                    <SeverityPill value={tb.riskRating} T={T} RISK_COLORS={RISK_COLORS} />
                  </div>
                  {(tb.controlsRequired?.length > 0 || tb.controlsInPlace?.length > 0) && (
                    <div style={{ padding: '8px 10px', background: T.white, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      {tb.controlsRequired?.length > 0 && (
                        <div>
                          <div style={{ fontSize: 9, fontWeight: 700, color: secLabel, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Required</div>
                          {tb.controlsRequired.map((c: string, j: number) => (
                            <div key={j} style={{ fontSize: 10, color: T.stone600, lineHeight: 1.5 }}>• {c}</div>
                          ))}
                        </div>
                      )}
                      {tb.controlsInPlace?.length > 0 && (
                        <div>
                          <div style={{ fontSize: 9, fontWeight: 700, color: TC.green, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>In Place</div>
                          {tb.controlsInPlace.map((c: string, j: number) => (
                            <div key={j} style={{ fontSize: 10, color: T.stone600, lineHeight: 1.5 }}>✓ {c}</div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Data Classification ──────────────────────────────────────────── */}
      {dataClassification.length > 0 && (
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${secBorder}` }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: secLabel, marginBottom: 10 }}>
            Data Classification
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {dataClassification.map((dc: any, i: number) => {
              const meta = CLASSIFICATION_META[dc.classification] ?? CLASSIFICATION_META.internal;
              const dcBg = meta.bg;
              const dcBorder = meta.border;
              return (
                <div key={i} style={{ padding: '10px 12px', borderRadius: 8, background: dcBg, border: `1px solid ${dcBorder}`, borderLeft: `3px solid ${meta.color}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <SeverityPill value={dc.classification} T={T} RISK_COLORS={RISK_COLORS} />
                    {dc.protectionMechanisms?.length > 0 && (
                      <span style={{ fontSize: 9, color: T.stone400 }}>{dc.protectionMechanisms.length} control{dc.protectionMechanisms.length !== 1 ? 's' : ''}</span>
                    )}
                  </div>
                  {dc.dataTypes?.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: 4 }}>
                      {dc.dataTypes.map((dt: string, j: number) => (
                        <span key={j} style={{ fontSize: 9, padding: '1px 5px', borderRadius: 4, background: T.white, border: `1px solid ${dcBorder}`, color: meta.color, fontWeight: 600 }}>{dt}</span>
                      ))}
                    </div>
                  )}
                  {dc.protectionMechanisms?.length > 0 && (
                    <div style={{ fontSize: 10, color: T.stone500, lineHeight: 1.5 }}>
                      {dc.protectionMechanisms.join(' · ')}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Security Recommendations ─────────────────────────────────────── */}
      {recommendations.length > 0 && (
        <div style={{ padding: '12px 16px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: secLabel, marginBottom: 10 }}>
            Recommendations ({recommendations.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {recommendations.map((r: string, i: number) => (
              <div key={i} style={{ display: 'flex', gap: 8, padding: '8px 10px', borderRadius: 8, background: T.stone50, border: `1px solid ${secBorder}` }}>
                <span style={{ fontSize: 10, fontWeight: 800, color: T.orange, flexShrink: 0, marginTop: 1 }}>{i + 1}</span>
                <span style={{ fontSize: 11, color: T.stone600, lineHeight: 1.55 }}>{r}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Generated at */}
      {asset.serviceThreatModel?.generatedAt && (
        <div style={{ padding: '8px 16px', fontSize: 10, color: T.stone300, borderTop: `1px solid ${secBorder}` }}>
          Generated {new Date(asset.serviceThreatModel.generatedAt).toLocaleDateString()}
        </div>
      )}
    </div>
  );
}

// ── Right panel: Features tab ─────────────────────────────────────────────────

function FeaturesTab({ features, loading, onSelect, T, RISK_COLORS }: { features: BusinessFeatureSummary[]; loading: boolean; onSelect: (id: string) => void; T: Tokens; RISK_COLORS: RiskColors }) {
  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
        <LoadingOutlined style={{ fontSize: 24, color: T.orange }} />
      </div>
    );
  }

  if (features.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 20px', gap: 12 }}>
        <div style={{ width: 60, height: 60, borderRadius: '50%', background: T.stone100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <ThunderboltOutlined style={{ fontSize: 24, color: T.stone300 }} />
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.stone800, marginBottom: 4 }}>No features linked</div>
          <div style={{ fontSize: 12, color: T.stone400, lineHeight: 1.6 }}>Run a scan with Feature Extraction enabled to link features to this asset.</div>
        </div>
      </div>
    );
  }

  // Stats
  const critical = features.filter((f) => f.highestSeverity === 'critical').length;
  const avgRisk = Math.round(features.reduce((s, f) => s + f.overallRiskScore, 0) / features.length);
  const avgLevel = riskLevel(avgRisk);
  const avgColor = RISK_COLORS[avgLevel].color;
  const avgBg = RISK_COLORS[avgLevel].bg;

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        {[
          { label: 'Total', value: features.length, color: T.stone800, bg: T.stone100 },
          { label: 'Avg Risk', value: avgRisk, color: avgColor, bg: avgBg },
          { label: 'Critical', value: critical, color: critical > 0 ? T.red : T.stone500, bg: critical > 0 ? T.redLight : T.stone100 },
        ].map((s) => (
          <div key={s.label} style={{ padding: '8px 10px', borderRadius: 8, background: T.white, border: `1px solid ${T.stone200}`, textAlign: 'center' }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: s.color, fontVariantNumeric: 'tabular-nums' }}>{s.value}</div>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: T.stone400 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Feature list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {features.map((f) => {
          const lv = riskLevel(f.overallRiskScore);
          const rc = RISK_COLORS[lv];
          const rcBg = rc.bg;
          const rcBorder = rc.border;
          return (
            <button
              key={f.id}
              onClick={() => onSelect(f.id)}
              style={{
                width: '100%', textAlign: 'left', cursor: 'pointer',
                background: T.white,
                border: `1px solid ${T.stone200}`,
                borderRadius: 10,
                padding: '10px 12px', transition: 'all 0.12s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = T.orange;
                e.currentTarget.style.background = T.orangeLight;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = T.stone200;
                e.currentTarget.style.background = T.white;
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <ThunderboltOutlined style={{ color: T.orange, fontSize: 13, marginTop: 1 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: T.stone800, marginBottom: 2 }}>{f.name}</div>
                  {f.description && (
                    <div style={{ fontSize: 11, color: T.stone400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {f.description}
                    </div>
                  )}
                </div>
                <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
                  <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 99, color: rc.color, background: rcBg, border: `1px solid ${rcBorder}` }}>
                    {f.overallRiskScore}/100
                  </span>
                  {f.threatCount > 0 && (
                    <span style={{ fontSize: 9, color: T.stone400 }}>{f.threatCount} threats</span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function mapEntityTypeToGraphType(entityType: string): string {
  const mapping: Record<string, string> = {
    'code_repository':      'CodeRepository',
    'code_service':         'CodeService',
    'cloud_resource':       'CloudResource',
    'azure_identity':       'AzureIdentity',
    'iam_role_assignment':  'AzureIdentity',
    'data_store':           'DataStore',
    'api_endpoint':         'ApiEndpoint',
    'identity':             'Identity',
    'network_segment':      'NetworkSegment',
    'external_dependency':  'Dependency',
    'code_module':          'CodeModule',
    'build_artifact':       'BuildArtifact',
    'deployment_artifact':  'DeploymentArtifact',
  };
  return mapping[entityType] || 'Entity';
}

function formatEdgeLabel(edgeType: string): string {
  return edgeType.replace(/_/g, ' ').split(' ').map((w) => w[0]?.toUpperCase() + w.slice(1)).join(' ');
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function AssetDetailsPage() {
  const { assetId } = useParams<{ assetId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { getAssetById, getAssetRelationships } = useAssets();
  const { listFeatures } = useFeatures();
  const { theme: appTheme } = useTheme();
  const isDark = appTheme === 'dark';

  const [asset, setAsset]       = useState<AssetDetail | null>(null);
  const [graph, setGraph]         = useState<GraphProjection | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);
  const [features, setFeatures]   = useState<BusinessFeatureSummary[]>([]);
  const [loading, setLoading]     = useState(false);
  const [featLoading, setFeatLoading] = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [activeTab, setActiveTab]   = useState<PanelTabId>('overview');
  const [panelOpen, setPanelOpen]   = useState(true);
  const [graphView, setGraphView]   = useState<GraphView>('relationship');

  useEffect(() => {
    if (!assetId) return;
    loadAsset();
    loadGraph();
    loadFeatures();
  }, [assetId]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadAsset = async () => {
    if (!assetId) return;
    setLoading(true); setError(null);
    try {
      const data = await getAssetById(assetId);
      if (!data) { setError('Asset not found'); return; }
      setAsset(data);
    } catch (e: any) {
      setError(e.message || 'Failed to load asset');
    } finally {
      setLoading(false);
    }
  };

  const loadGraph = async () => {
    if (!assetId) return;
    setGraphLoading(true);
    try {
      const rel = await getAssetRelationships(assetId);
      if (rel?.graph) {
        const filteredNodes = rel.graph.nodes.filter((n) => n.type !== 'DataStore' && n.type !== 'data_store');
        const dsIds = new Set(rel.graph.nodes.filter((n) => n.type === 'DataStore' || n.type === 'data_store').map((n) => n.id));
        setGraph({
          ...rel.graph,
          nodes: filteredNodes,
          edges: rel.graph.edges.filter((e) => !dsIds.has(e.from) && !dsIds.has(e.to)),
        });
      } else if (rel?.nodes?.length) {
        const filteredNodes = rel.nodes.filter((n) => n.type !== 'data_store');
        const dsIds = new Set(rel.nodes.filter((n) => n.type === 'data_store').map((n) => n.id));
        setGraph({
          nodes: filteredNodes.map((n) => ({
            id: n.id, type: mapEntityTypeToGraphType(n.type), label: n.name,
            metadata: n.metadata, link: n.metadata?.link,
          })),
          edges: rel.edges
            .filter((e) => !dsIds.has(e.source) && !dsIds.has(e.target))
            .map((e) => ({
              id: e.id, from: e.source, to: e.target, type: e.type,
              confidence: e.metadata?.confidence || 'deterministic',
              label: e.metadata?.label || formatEdgeLabel(e.type),
            })),
          focusNodeId: assetId,
        });
      }
    } catch (e) {
      console.error('Failed to load asset graph:', e);
    } finally {
      setGraphLoading(false);
    }
  };

  const loadFeatures = async () => {
    if (!assetId) return;
    setFeatLoading(true);
    try {
      const all = await listFeatures();
      setFeatures(all.filter((f) => f.sourceServiceIds?.includes(assetId)));
    } catch {
      // non-critical
    } finally {
      setFeatLoading(false);
    }
  };

  const handleSelectFeature = (id: string) => {
    navigate(`/knowledge-base/features/${encodeURIComponent(id)}`);
  };

  // ── Theme tokens ──────────────────────────────────────────────────────────
  const T = makeTokens(isDark);
  const RISK_COLORS = makeRiskColors(T);
  const bg       = isDark ? DC.bg    : TC.stone50;
  const headerBg = isDark ? DC.bg    : TC.white;
  const border   = isDark ? DC.border: TC.stone200;
  const textPrimary = isDark ? DC.text      : T.stone900;
  const textMuted   = isDark ? TC.stone500  : T.stone400;
  const panelBg     = isDark ? DC.bgSub     : TC.white;
  const tabActiveBg = isDark ? DC.orangeLight : TC.orangeLight;

  const tabBadges: Partial<Record<PanelTabId, number>> = {
    features: features.length,
    security: (asset?.serviceThreatModel as any)?.strideThreats?.length ?? asset?.threatModel?.identifiedThreats?.length ?? 0,
};

  // ── Loading / error ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', background: bg }}>
        <Spin size="large" />
      </div>
    );
  }

  if (error || (!loading && !asset)) {
    return (
      <div style={{ padding: '24px 32px', background: bg, height: '100%' }}>
        <Alert
          type="error" showIcon
          message="Failed to load asset"
          description={error || 'Asset not found'}
          action={
            <Button size="small" icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)}>
              Back to Assets
            </Button>
          }
        />
      </div>
    );
  }

  if (!asset) return null;

  const assetTypeLabel = asset.type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      height: 'calc(100vh)', overflow: 'hidden', background: bg,
      margin: -16,
    }}>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div style={{
        flexShrink: 0, background: headerBg,
        borderBottom: `1px solid ${border}`,
        padding: '10px 20px',
      }}>
        <Breadcrumb
          style={{ marginBottom: 6, fontSize: 12 }}
          items={[
            {
              title: (
                <span onClick={() => navigate(-1)} style={{ cursor: 'pointer', color: textMuted }}>
                  <HomeOutlined style={{ marginRight: 4 }} />Assets
                </span>
              ),
            },
            { title: <span style={{ color: textPrimary, fontWeight: 600 }}>{asset.name}</span> },
          ]}
        />

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Back */}
          <button
            onClick={() => navigate(-1)}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              fontSize: 12, color: textMuted, background: 'none',
              border: (location.state as any)?.fromChat ? `1px solid ${border}` : 'none',
              cursor: 'pointer', padding: '4px 6px',
              borderRadius: 6, flexShrink: 0,
            }}
          >
            <ArrowLeftOutlined style={{ fontSize: 13 }} />
            {(location.state as any)?.fromChat && <span>Back to chat</span>}
          </button>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <h1 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: textPrimary, letterSpacing: '-0.02em', lineHeight: 1.2 }}>
                {asset.name}
              </h1>

              <span style={{
                display: 'inline-flex', alignItems: 'center',
                fontSize: 10, fontWeight: 600, padding: '2px 8px',
                borderRadius: 99, flexShrink: 0,
                color: T.stone600, background: T.stone100,
                border: `1px solid ${T.stone200}`,
                fontFamily: 'monospace',
              }}>
                {assetTypeLabel}
              </span>

              {asset.riskScore !== undefined && (() => {
                const lv = riskLevel(asset.riskScore);
                const rc = RISK_COLORS[lv];
                return (
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '2px 9px',
                    borderRadius: 99, flexShrink: 0,
                    color: rc.color, background: rc.bg, border: `1px solid ${rc.border}`,
                  }}>
                    Risk {asset.riskScore}/100 · {lv.toUpperCase()}
                  </span>
                );
              })()}

              {features.length > 0 && (
                <span style={{
                  fontSize: 10, fontWeight: 600, padding: '2px 9px',
                  borderRadius: 99, flexShrink: 0,
                  color: T.orange, background: T.orangeLight,
                  border: `1px solid ${T.orangeBorder}`,
                }}>
                  {features.length} feature{features.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>

            {asset.responsibility && (
              <p style={{ margin: '3px 0 0', fontSize: 12, color: textMuted, lineHeight: 1.5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 1 }}>
                {asset.responsibility}
              </p>
            )}
          </div>

          {/* Toggle buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <Tooltip title={panelOpen ? 'Collapse details panel' : 'Show details panel'}>
              <button
                onClick={() => setPanelOpen((v) => !v)}
                style={{ width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, background: 'none', border: `1px solid ${border}`, cursor: 'pointer', color: textMuted, transition: 'all 0.15s' }}
              >
                {panelOpen ? <MenuFoldOutlined style={{ fontSize: 13 }} /> : <MenuUnfoldOutlined style={{ fontSize: 13 }} />}
              </button>
            </Tooltip>
          </div>
        </div>
      </div>

      {/* ── Body ────────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>

        {/* Graph canvas */}
        <div style={{ flex: 1, position: 'relative', minWidth: 0, background: isDark ? '#141211' : TC.stone50 }}>

          {/* View switcher — centred at top (DFD only for code_service) */}
          {asset.type === 'code_service' && (
            <GraphViewSwitcher
              current={graphView}
              hasDfd={!!asset.serviceDfd}
              onChange={setGraphView}
              isDark={isDark}
            />
          )}

          {/* Relationship graph */}
          {graphView === 'relationship' && (
            graphLoading ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12 }}>
                <LoadingOutlined style={{ fontSize: 32, color: T.orange }} />
                <span style={{ fontSize: 13, color: T.stone400 }}>Loading relationship graph…</span>
              </div>
            ) : graph ? (
              <AssetRelationshipGraph graph={graph} />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12 }}>
                <ApartmentOutlined style={{ fontSize: 40, color: T.stone300 }} />
                <span style={{ fontSize: 13, color: T.stone400 }}>No relationship graph available</span>
              </div>
            )
          )}

          {/* Service DFD — only rendered for code_service */}
          {graphView === 'dfd' && asset.type === 'code_service' && (
            <ServiceDFDCanvas asset={asset} isDark={isDark} />
          )}
        </div>

        {/* Right panel */}
        <div style={{
          flexShrink: 0,
          width: panelOpen ? 380 : 0,
          overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
          borderLeft: panelOpen ? `1px solid ${border}` : 'none',
          background: panelBg,
          transition: 'width 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
        }}>
          {panelOpen && (
            <>
              {/* Tab nav */}
              <div style={{ display: 'flex', borderBottom: `1px solid ${border}`, flexShrink: 0 }}>
                {PANEL_TABS.map((tab) => {
                  const isActive = activeTab === tab.id;
                  const badge = tabBadges[tab.id];
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      title={tab.label}
                      style={{
                        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        gap: 4, padding: '11px 6px',
                        fontSize: 10, fontWeight: 700,
                        background: isActive ? tabActiveBg : 'none',
                        border: 'none',
                        borderBottom: `2px solid ${isActive ? T.orange : 'transparent'}`,
                        color: isActive ? T.orange : textMuted,
                        cursor: 'pointer', transition: 'all 0.15s',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <span style={{ fontSize: 13 }}>{tab.icon}</span>
                      {badge !== undefined && badge > 0 && (
                        <span style={{
                          fontSize: 8, fontWeight: 800, padding: '1px 5px',
                          borderRadius: 99, lineHeight: '14px',
                          background: isActive ? T.orange : T.stone100,
                          color: isActive ? TC.white : textMuted,
                        }}>
                          {badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Section title */}
              <div style={{ padding: '10px 16px 2px', fontSize: 13, fontWeight: 700, color: textPrimary, flexShrink: 0, letterSpacing: '-0.01em' }}>
                {PANEL_TABS.find((t) => t.id === activeTab)?.label}
              </div>

              {/* Scrollable content */}
              <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
                {activeTab === 'overview'       && <OverviewTab asset={asset} T={T} RISK_COLORS={RISK_COLORS} />}
                {activeTab === 'security'       && <ServiceSecurityTab asset={asset} T={T} RISK_COLORS={RISK_COLORS} isDark={isDark} />}
                {activeTab === 'exploitability' && <ExploitabilityPanel assetId={assetId!} />}
                {activeTab === 'features'       && <FeaturesTab features={features} loading={featLoading} onSelect={handleSelectFeature} T={T} RISK_COLORS={RISK_COLORS} />}
              </div>
            </>
          )}
        </div>

      </div>
    </div>
  );
}
