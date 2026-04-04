import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeftOutlined,
  BranchesOutlined,
  CodeOutlined,
  CloudOutlined,
  DeploymentUnitOutlined,
  BuildOutlined,
  AppstoreOutlined,
  GlobalOutlined,
  LoadingOutlined,
  LinkOutlined,
  WarningOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  ApiOutlined,
  FileOutlined,
  RightOutlined,
} from '@ant-design/icons';
import { useAssets } from '../hooks';
import type { AssetDetail, RepositoryArtifact, RepositoryArtifacts } from '../types';
import { getNodeIcon } from '../utils/nodeIcons';
import GitHubIcon from './icons/GitHub';
import { T, D, dk } from '../theme';

// ── Section config ────────────────────────────────────────────────────────────

interface SectionConfig {
  key: keyof Omit<RepositoryArtifacts, 'repositoryId'>;
  label: string;
  icon: React.ReactNode;
  color: string;
  lightBg: string;
  darkBg: string;
  entityType: string;
  nodeType: string;
  emptyMsg: string;
}

const SECTIONS: SectionConfig[] = [
  {
    key: 'services',
    label: 'Services',
    icon: <ApiOutlined />,
    color: T.blue,
    lightBg: T.blueLight,
    darkBg: D.blueLight,
    entityType: 'code_service',
    nodeType: 'CodeService',
    emptyMsg: 'No services found in this repository.',
  },
  {
    key: 'builds',
    label: 'Build Artifacts',
    icon: <BuildOutlined />,
    color: T.amber,
    lightBg: T.amberLight,
    darkBg: D.amberLight,
    entityType: 'build_artifact',
    nodeType: 'BuildArtifact',
    emptyMsg: 'No build artifacts (Dockerfiles, etc.) found.',
  },
  {
    key: 'deployments',
    label: 'Deployment Artifacts',
    icon: <DeploymentUnitOutlined />,
    color: T.purple,
    lightBg: T.purpleLight,
    darkBg: D.purpleLight,
    entityType: 'deployment_artifact',
    nodeType: 'DeploymentArtifact',
    emptyMsg: 'No deployment artifacts (Kubernetes, Terraform, etc.) found.',
  },
  {
    key: 'modules',
    label: 'Modules',
    icon: <CodeOutlined />,
    color: T.green,
    lightBg: T.greenLight,
    darkBg: D.greenLight,
    entityType: 'code_module',
    nodeType: 'CodeModule',
    emptyMsg: 'No modules indexed.',
  },
  {
    key: 'cloudResources',
    label: 'Cloud Resources',
    icon: <CloudOutlined />,
    color: T.orange,
    lightBg: T.orangeLight,
    darkBg: D.orangeLight,
    entityType: 'cloud_resource',
    nodeType: 'CloudResource',
    emptyMsg: 'No cloud resources connected.',
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function riskColor(score?: number) {
  if (score === undefined || score === null) return T.stone400;
  return score > 70 ? T.red : score > 40 ? T.amber : T.green;
}

function critColor(v?: string) {
  switch (v) {
    case 'critical': return T.red;
    case 'high':     return T.orangeHigh;
    case 'medium':   return T.amber;
    case 'low':      return T.green;
    default:         return T.stone400;
  }
}

function critBg(v: string | undefined, isDark: boolean) {
  switch (v) {
    case 'critical': return dk(isDark, T.redLight, D.redLight);
    case 'high':     return dk(isDark, T.orangeHighLight, D.orangeHighLight);
    case 'medium':   return dk(isDark, T.amberLight, D.amberLight);
    case 'low':      return dk(isDark, T.greenLight, D.greenLight);
    default:         return dk(isDark, T.stone100, D.bgCard);
  }
}

// ── Reusable chips ────────────────────────────────────────────────────────────

function CriticalityPill({ value, isDark }: { value?: string; isDark: boolean }) {
  if (!value) return null;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px',
      borderRadius: 99, fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
      textTransform: 'uppercase', color: critColor(value), background: critBg(value, isDark),
    }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: critColor(value) }} />
      {value}
    </span>
  );
}

function RiskBar({ score, isDark }: { score?: number; isDark: boolean }) {
  if (score === undefined || score === null) return null;
  const color = riskColor(score);
  const bg = score > 70 ? dk(isDark, T.redLight, D.redLight)
    : score > 40 ? dk(isDark, T.amberLight, D.amberLight)
    : dk(isDark, T.greenLight, D.greenLight);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ width: 44, height: 3, borderRadius: 99, background: dk(isDark, T.stone200, D.bgCard), overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(100, score)}%`, height: '100%', borderRadius: 99, background: color }} />
      </div>
      <span style={{ fontSize: 10, fontWeight: 700, color, background: bg, padding: '1px 5px', borderRadius: 4 }}>
        {score}
      </span>
    </div>
  );
}

function Tag({ label, color, bg }: { label: string; color: string; bg: string }) {
  return (
    <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color, background: bg, padding: '2px 7px', borderRadius: 99 }}>
      {label}
    </span>
  );
}

function ArtifactIcon({ artifact, size = 16 }: { artifact: RepositoryArtifact; size?: number }) {
  const nodeTypeMap: Record<string, string> = {
    code_service:        'CodeService',
    code_module:         'CodeModule',
    build_artifact:      'BuildArtifact',
    deployment_artifact: 'DeploymentArtifact',
    cloud_resource:      'CloudResource',
    azure_identity:      'AzureIdentity',
  };
  const nodeType = nodeTypeMap[artifact.entityType];
  if (!nodeType) return <FileOutlined style={{ fontSize: size }} />;
  const iconPath = getNodeIcon(nodeType, { ...artifact.metadata, entityType: artifact.entityType });
  return (
    <img
      src={iconPath}
      alt={artifact.entityType}
      width={size}
      height={size}
      style={{ objectFit: 'contain', display: 'block', flexShrink: 0 }}
      onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
    />
  );
}

// ── Artifact card ─────────────────────────────────────────────────────────────

function ArtifactCard({
  artifact,
  section,
  isDark,
  onViewDetails,
  repositoryName,
}: {
  artifact: RepositoryArtifact;
  section: SectionConfig;
  isDark: boolean;
  onViewDetails: (id: string) => void;
  repositoryName?: string;
}) {
  const [hovered, setHovered] = useState(false);

  const badges: { label: string; color: string; bg: string }[] = [];
  if (artifact.serviceType)    badges.push({ label: artifact.serviceType,    color: T.blue,   bg: dk(isDark, T.blueLight, D.blueLight) });
  if (artifact.buildType)      badges.push({ label: artifact.buildType,      color: T.amber,  bg: dk(isDark, T.amberLight, D.amberLight) });
  if (artifact.deploymentType) badges.push({ label: artifact.deploymentType, color: T.purple, bg: dk(isDark, T.purpleLight, D.purpleLight) });
  if (artifact.technology)     badges.push({ label: artifact.technology,     color: T.green,  bg: dk(isDark, T.greenLight, D.greenLight) });
  if (artifact.isEntryPoint && artifact.entryType)
    badges.push({ label: artifact.entryType, color: T.orange, bg: dk(isDark, T.orangeLight, D.orangeLight) });

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        border: `1px solid ${hovered ? section.color : dk(isDark, T.stone200, D.border)}`,
        borderRadius: 12,
        background: hovered
          ? dk(isDark, section.lightBg, section.darkBg)
          : dk(isDark, T.white, D.bgCard),
        padding: '14px 16px',
        transition: 'border-color 0.15s, background 0.15s',
        display: 'flex', flexDirection: 'column', gap: 10,
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{
          width: 30, height: 30, borderRadius: 8, flexShrink: 0,
          background: dk(isDark, section.lightBg, section.darkBg),
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <ArtifactIcon artifact={artifact} size={17} />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 5, marginBottom: 2 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: dk(isDark, T.stone900, D.text), wordBreak: 'break-all' }}>
              {artifact.name}
            </span>
            {badges.map((b, i) => <Tag key={i} label={b.label} color={b.color} bg={b.bg} />)}
          </div>

          {artifact.codePath && (
            <div style={{ fontSize: 11, color: dk(isDark, T.stone400, D.textFaint), fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {artifact.codePath}
            </div>
          )}
          {(repositoryName ?? artifact.repositoryName) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
              <LinkOutlined style={{ fontSize: 9, color: dk(isDark, T.stone400, D.textFaint), flexShrink: 0 }} />
              <span style={{
                fontSize: 10, color: dk(isDark, T.stone400, D.textFaint),
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                fontFamily: 'monospace',
              }}>
                {repositoryName ?? artifact.repositoryName}
              </span>
            </div>
          )}
        </div>

        {/* Risk + criticality */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
          <CriticalityPill value={artifact.businessCriticality} isDark={isDark} />
          <RiskBar score={artifact.riskScore} isDark={isDark} />
        </div>
      </div>

      {/* Responsibility */}
      {artifact.responsibility && (
        <div style={{
          fontSize: 12, color: dk(isDark, T.stone500, D.textMuted),
          lineHeight: 1.65, padding: '8px 10px', borderRadius: 8,
          background: dk(isDark, T.stone50, D.bgSub),
          border: `1px solid ${dk(isDark, T.stone100, D.border)}`,
        }}>
          {artifact.responsibility}
        </div>
      )}

      {/* Footer */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {artifact.language && (
            <span style={{ fontSize: 10, color: dk(isDark, T.stone500, D.textMuted), background: dk(isDark, T.stone100, D.bgSub), padding: '2px 7px', borderRadius: 6 }}>
              {artifact.language}
            </span>
          )}
          {artifact.techStack?.slice(0, 3).map((t, i) => (
            <span key={i} style={{ fontSize: 10, color: dk(isDark, T.stone500, D.textMuted), background: dk(isDark, T.stone100, D.bgSub), padding: '2px 7px', borderRadius: 6 }}>
              {t}
            </span>
          ))}
          {artifact.techStack && artifact.techStack.length > 3 && (
            <span style={{ fontSize: 10, color: dk(isDark, T.stone400, D.textFaint) }}>+{artifact.techStack.length - 3}</span>
          )}
        </div>

        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          {artifact.link && (
            <a
              href={artifact.link}
              target="_blank"
              rel="noreferrer"
              onClick={e => e.stopPropagation()}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '4px 9px', borderRadius: 7,
                border: `1px solid ${dk(isDark, T.stone200, D.border)}`,
                background: dk(isDark, T.white, D.bgCard),
                color: dk(isDark, T.stone500, D.textMuted),
                fontSize: 11, fontWeight: 500, textDecoration: 'none',
              }}
            >
              <LinkOutlined style={{ fontSize: 10 }} />
            </a>
          )}
          <button
            onClick={() => onViewDetails(artifact.id)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '4px 10px', borderRadius: 7, border: 'none',
              background: hovered ? section.color : dk(isDark, T.stone100, D.bgSub),
              color: hovered ? T.white : dk(isDark, T.stone500, D.textMuted),
              fontSize: 11, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s',
            }}
          >
            Details <RightOutlined style={{ fontSize: 9 }} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Section block ─────────────────────────────────────────────────────────────

function SectionBlock({
  section,
  artifacts,
  isDark,
  onViewDetails,
  defaultCollapsed,
  repositoryName,
}: {
  section: SectionConfig;
  artifacts: RepositoryArtifact[];
  isDark: boolean;
  onViewDetails: (id: string) => void;
  defaultCollapsed?: boolean;
  repositoryName?: string;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed ?? false);

  return (
    <div style={{ marginBottom: 24 }}>
      <button
        onClick={() => setCollapsed(c => !c)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, width: '100%',
          background: 'none', border: 'none', cursor: 'pointer', padding: '0 0 12px',
          textAlign: 'left',
        }}
      >
        <div style={{
          width: 28, height: 28, borderRadius: 8,
          background: dk(isDark, section.lightBg, section.darkBg),
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: section.color, fontSize: 13, flexShrink: 0,
        }}>
          {section.icon}
        </div>
        <span style={{ fontSize: 13, fontWeight: 700, color: dk(isDark, T.stone800, D.text), flex: 1 }}>
          {section.label}
        </span>
        <span style={{
          fontSize: 10, fontWeight: 700, color: section.color,
          background: dk(isDark, section.lightBg, section.darkBg),
          padding: '2px 8px', borderRadius: 99,
        }}>
          {artifacts.length}
        </span>
        <span style={{ fontSize: 10, color: dk(isDark, T.stone400, D.textFaint), marginLeft: 4 }}>
          {collapsed ? '▶' : '▼'}
        </span>
      </button>

      {!collapsed && (
        artifacts.length === 0 ? (
          <div style={{ padding: '16px 0', fontSize: 12, color: dk(isDark, T.stone400, D.textFaint), fontStyle: 'italic' }}>
            {section.emptyMsg}
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: artifacts.length === 1 ? '1fr' : 'repeat(auto-fill, minmax(340px, 1fr))',
            gap: 10,
          }}>
            {artifacts.map(artifact => (
              <ArtifactCard
                key={artifact.id}
                artifact={artifact}
                section={section}
                isDark={isDark}
                onViewDetails={onViewDetails}
                repositoryName={repositoryName}
              />
            ))}
          </div>
        )
      )}
    </div>
  );
}

// ── Stat chip ─────────────────────────────────────────────────────────────────

function StatChip({ label, value, color, bg, icon }: { label: string; value: number | string; color: string; bg: string; icon: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '10px 18px', borderRadius: 12, background: bg, minWidth: 72 }}>
      <span style={{ fontSize: 16, color, lineHeight: 1 }}>{icon}</span>
      <span style={{ fontSize: 20, fontWeight: 800, color, lineHeight: 1 }}>{value}</span>
      <span style={{ fontSize: 9, fontWeight: 700, color, opacity: 0.75, textTransform: 'uppercase', letterSpacing: '0.07em', textAlign: 'center' }}>{label}</span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface RepositoryDetailPanelProps {
  assetId: string;
  isDark: boolean;
  onBack: () => void;
}

export function RepositoryDetailPanel({ assetId, isDark, onBack }: RepositoryDetailPanelProps) {
  const navigate = useNavigate();
  const [asset, setAsset] = useState<AssetDetail | null>(null);
  const [artifacts, setArtifacts] = useState<RepositoryArtifacts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { getAssetById, getRepositoryArtifacts } = useAssets();

  useEffect(() => {
    setAsset(null);
    setArtifacts(null);
    setError(null);
    setLoading(true);

    Promise.all([
      getAssetById(assetId),
      getRepositoryArtifacts(assetId),
    ]).then(([a, r]) => {
      setAsset(a);
      setArtifacts(r);
    }).catch(err => {
      setError(err.message || 'Failed to load repository');
    }).finally(() => setLoading(false));
  }, [assetId]);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 80 }}>
        <div style={{ textAlign: 'center' }}>
          <LoadingOutlined style={{ fontSize: 28, color: T.orange }} />
          <div style={{ marginTop: 12, fontSize: 13, color: dk(isDark, T.stone400, D.textMuted) }}>Loading repository…</div>
        </div>
      </div>
    );
  }

  if (error || !asset) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <div style={{ fontSize: 14, color: T.red, marginBottom: 8 }}>{error || 'Repository not found'}</div>
        <button onClick={onBack} style={{ fontSize: 12, color: T.orange, background: 'none', border: 'none', cursor: 'pointer' }}>← Back</button>
      </div>
    );
  }

  const responsibility = asset.responsibility || asset.metadata?.responsibility;
  const repoUrl = asset.link || asset.metadata?.url;
  const defaultBranch = asset.metadata?.defaultBranch || (asset.fullEntity as any)?.defaultBranch;

  // Summary counts
  const services    = artifacts?.services ?? [];
  const builds      = artifacts?.builds ?? [];
  const deployments = artifacts?.deployments ?? [];
  const modules     = artifacts?.modules ?? [];
  const cloudRes    = artifacts?.cloudResources ?? [];

  const allArtifacts = [...services, ...builds, ...deployments, ...modules, ...cloudRes];
  const highRiskCount  = allArtifacts.filter(a => (a.riskScore ?? 0) > 70).length;
  const criticalCount  = allArtifacts.filter(a => a.businessCriticality === 'critical').length;

  // Only show sections that have data (or always show services/builds/deployments even if empty)
  const sectionsToShow = SECTIONS.filter(s => {
    const data = artifacts?.[s.key] ?? [];
    if (s.key === 'modules' && data.length === 0) return false;
    if (s.key === 'cloudResources' && data.length === 0) return false;
    return true;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: dk(isDark, T.white, D.bg) }}>

      {/* ── Top bar ── */}
      <div style={{
        padding: '12px 24px',
        borderBottom: `1px solid ${dk(isDark, T.stone100, D.border)}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0, background: dk(isDark, T.white, D.bg),
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={onBack}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '6px 11px', borderRadius: 8,
              border: `1px solid ${dk(isDark, T.stone200, D.border)}`,
              background: dk(isDark, T.white, D.bgCard),
              color: dk(isDark, T.stone500, D.textMuted),
              fontSize: 12, fontWeight: 500, cursor: 'pointer',
            }}
          >
            <ArrowLeftOutlined style={{ fontSize: 10 }} /> Repositories
          </button>

          <div style={{ width: 1, height: 18, background: dk(isDark, T.stone200, D.border) }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: dk(isDark, T.stone800, D.text), display: 'flex', fontSize: 18 }}><GitHubIcon /></span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: dk(isDark, T.stone900, D.text), lineHeight: 1.2 }}>
                {asset.name}
              </div>
              {defaultBranch && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: dk(isDark, T.stone400, D.textFaint) }}>
                  <BranchesOutlined style={{ fontSize: 10 }} /> {defaultBranch}
                </div>
              )}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          {repoUrl && (
            <a
              href={repoUrl}
              target="_blank"
              rel="noreferrer"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '6px 12px', borderRadius: 8,
                border: `1px solid ${dk(isDark, T.stone200, D.border)}`,
                background: dk(isDark, T.white, D.bgCard),
                color: dk(isDark, T.stone600, D.textMuted),
                fontSize: 12, fontWeight: 500, textDecoration: 'none',
              }}
            >
              <LinkOutlined style={{ fontSize: 11 }} /> GitHub
            </a>
          )}
        </div>
      </div>

      {/* ── Scrollable body ── */}
      <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px', background: dk(isDark, T.stone50, D.bg) }}>

        {/* ── Summary card ── */}
        <div style={{
          background: dk(isDark, T.white, D.bgCard),
          border: `1px solid ${dk(isDark, T.stone200, D.border)}`,
          borderRadius: 16, padding: '18px 22px', marginBottom: 28,
          boxShadow: isDark ? 'none' : '0 1px 4px rgba(28,25,23,0.05)',
        }}>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>

            {/* Responsibility */}
            <div style={{ flex: 1, minWidth: 220 }}>
              {(asset.businessCriticality || asset.riskScore !== undefined) && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
                  <CriticalityPill value={asset.businessCriticality} isDark={isDark} />
                  <RiskBar score={asset.riskScore} isDark={isDark} />
                </div>
              )}
              {responsibility ? (
                <p style={{ fontSize: 13, color: dk(isDark, T.stone600, D.textMuted), lineHeight: 1.7, margin: 0 }}>
                  {responsibility}
                </p>
              ) : (
                <p style={{ fontSize: 13, color: dk(isDark, T.stone400, D.textFaint), margin: 0, fontStyle: 'italic' }}>
                  No responsibility description — run a scan with semantic analysis to generate one.
                </p>
              )}
            </div>

            {/* Stats */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', flexShrink: 0 }}>
              {services.length > 0 && (
                <StatChip label="Services" value={services.length} color={T.blue} bg={dk(isDark, T.blueLight, D.blueLight)} icon={<ApiOutlined />} />
              )}
              {(builds.length + deployments.length) > 0 && (
                <StatChip label="Artifacts" value={builds.length + deployments.length} color={T.amber} bg={dk(isDark, T.amberLight, D.amberLight)} icon={<AppstoreOutlined />} />
              )}
              {modules.length > 0 && (
                <StatChip label="Modules" value={modules.length} color={T.green} bg={dk(isDark, T.greenLight, D.greenLight)} icon={<CodeOutlined />} />
              )}
              {highRiskCount > 0 && (
                <StatChip label="High Risk" value={highRiskCount} color={T.red} bg={dk(isDark, T.redLight, D.redLight)} icon={<WarningOutlined />} />
              )}
              {criticalCount > 0 && (
                <StatChip label="Critical" value={criticalCount} color={T.red} bg={dk(isDark, T.redLight, D.redLight)} icon={<ExclamationCircleOutlined />} />
              )}
              {allArtifacts.length > 0 && highRiskCount === 0 && criticalCount === 0 && (
                <StatChip label="All Clear" value="✓" color={T.green} bg={dk(isDark, T.greenLight, D.greenLight)} icon={<CheckCircleOutlined />} />
              )}
            </div>
          </div>
        </div>

        {/* ── No artifacts empty state ── */}
        {allArtifacts.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '60px 0', gap: 14 }}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: dk(isDark, T.stone100, D.bgCard), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <GlobalOutlined style={{ fontSize: 22, color: dk(isDark, T.stone300, D.textFaint) }} />
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: dk(isDark, T.stone800, D.text), marginBottom: 5 }}>No connected artifacts found</div>
              <div style={{ fontSize: 13, color: dk(isDark, T.stone400, D.textMuted), maxWidth: 360, lineHeight: 1.6 }}>
                Run a scan to discover services, builds, deployments, and modules connected to this repository.
              </div>
            </div>
          </div>
        )}

        {/* ── Artifact sections ── */}
        {sectionsToShow.map(section => {
          const sectionArtifacts = artifacts?.[section.key] ?? [];
          const handleViewDetails = section.key === 'modules'
            ? (id: string) => {
                const artifact = sectionArtifacts.find(a => a.id === id);
                // Build GitHub file link: repoUrl/blob/<branch>/<codePath>
                // Fall back to repoUrl alone if no codePath, or artifact.link if available
                const url = artifact?.link
                  ?? (repoUrl && artifact?.codePath
                    ? `${repoUrl.replace(/\/$/, '')}/blob/${defaultBranch ?? 'main'}/${artifact.codePath.replace(/^\//, '')}`
                    : repoUrl);
                if (url) window.open(url, '_blank', 'noreferrer');
              }
            : (id: string) => navigate(`/knowledge-base/assets/${encodeURIComponent(id)}`);
          return (
            <SectionBlock
              key={section.key}
              section={section}
              artifacts={sectionArtifacts}
              isDark={isDark}
              onViewDetails={handleViewDetails}
              defaultCollapsed={true}
              repositoryName={asset.name}
            />
          );
        })}
      </div>
    </div>
  );
}
