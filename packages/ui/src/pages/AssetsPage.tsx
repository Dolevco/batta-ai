import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Modal, Switch, notification,
} from 'antd';
import { useTheme } from '../hooks/useTheme';
import { T, D, dk } from '../theme';
import {
  DatabaseOutlined,
  CloudOutlined,
  UserOutlined,
  GlobalOutlined,
  CodeOutlined,
  SafetyOutlined,
  KeyOutlined,
  ScanOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  LoadingOutlined,
  ReloadOutlined,
  CloseCircleOutlined,
  BranchesOutlined,
  ThunderboltOutlined,
  AppstoreOutlined,
  DeleteOutlined,
  EyeOutlined,
} from '@ant-design/icons';
import { useAssets } from '../hooks';
import { useFeatures } from '../hooks/useFeatures';
import { useIntegrations } from '../hooks/useIntegrations';
import type { Asset, AssetCategory, ScanRecord, ScanOptions, ScanStageInfo, ScanRepositoryInfo } from '../types';
import { FeatureListView } from '../components/FeatureListView';
import { RepositoryDetailPanel } from '../components/RepositoryDetailPanel';
import { getNodeIcon } from '../utils/nodeIcons';
import GitHubIcon from '../components/icons/GitHub';

const categoryIcons: Record<string, React.ReactNode> = {
  code_repository:     <span style={{ color: T.stone900 }}><GitHubIcon /></span>,
  code_service:        <img src="/images/Icons/api.svg" alt="service" width={14} height={14} style={{ objectFit: 'contain', display: 'block' }} />,
  cloud_resource:      <CloudOutlined />,
  azure_identity:      <KeyOutlined />,
  data_store:          <DatabaseOutlined />,
  api_endpoint:        <GlobalOutlined />,
  identity:            <UserOutlined />,
  network_segment:     <SafetyOutlined />,
  external_dependency: <GlobalOutlined />,
};

// Map asset entity types to the node types used by getNodeIcon
const ASSET_TYPE_TO_NODE_TYPE: Record<string, string> = {
  code_repository:  'CodeService',
  code_service:     'CodeService',
  cloud_resource:   'CloudResource',
  azure_identity:   'AzureIdentity',
  data_store:       'CodeModule',
  api_endpoint:     'CodeService',
};

function EntityIcon({ asset, size = 18 }: { asset: Asset; size?: number }) {
  const nodeType = ASSET_TYPE_TO_NODE_TYPE[asset.type];

  if (asset.type === 'code_repository') {
    return <span style={{ color: T.stone900 }}><GitHubIcon /></span>;
  }

  if (nodeType) {
    // Pass full metadata so getNodeIcon can specialise (e.g. cloud resource type, identity kind).
    // Use entityType for the asset category — do NOT overwrite metadata.type, which for cloud
    // resources holds the ARM resource type string (e.g. "microsoft.cognitiveservices/accounts").
    const iconPath = getNodeIcon(nodeType, { ...asset.metadata, entityType: asset.type });
    return (
      <img
        src={iconPath}
        alt={asset.type}
        width={size}
        height={size}
        style={{ objectFit: 'contain', display: 'block' }}
        onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
      />
    );
  }

  return <>{categoryIcons[asset.type] ?? <CodeOutlined />}</>;
}

const criticalityConfig: Record<string, { color: string; bg: string; label: string }> = {
  critical: { color: T.red,      bg: T.redLight,   label: 'Critical' },
  high:     { color: T.orangeHigh,  bg: T.orangeLight,     label: 'High' },
  medium:   { color: T.amber,    bg: T.amberLight,  label: 'Medium' },
  low:      { color: T.green,    bg: T.greenLight,  label: 'Low' },
};

function stageStatusColor(status: ScanStageInfo['status']): string {
  switch (status) {
    case 'completed': return T.green;
    case 'running':   return T.blue;
    case 'failed':    return T.red;
    default:          return T.stone400;
  }
}

function scanProgress(stages: ScanStageInfo[]): number {
  if (!stages.length) return 0;
  const active = stages.filter(s => s.status !== 'skipped');
  if (!active.length) return 0;
  const done = active.filter(s => s.status === 'completed' || s.status === 'failed').length;
  return Math.round((done / active.length) * 100);
}

const STAGE_ICONS: Record<string, React.ReactNode> = {
  'Code Discovery': <BranchesOutlined />,
  'Cloud Discovery': <CloudOutlined />,
  'Correlation': <DatabaseOutlined />,
  'Security Analysis': <ThunderboltOutlined />,
};

// ── Reusable components ───────────────────────────────────────────────────────

function CriticalityPill({ value, isDark }: { value?: string; isDark: boolean }) {
  if (!value) return <span style={{ color: dk(isDark, T.stone400, D.textFaint), fontSize: 12 }}>—</span>;
  const cfg = criticalityConfig[value] ?? { color: T.stone500, bg: T.stone100, label: value };
  const bg = value === 'critical' ? dk(isDark, cfg.bg, D.redLight)
    : value === 'high'     ? dk(isDark, cfg.bg, 'rgba(234,88,12,0.15)')
    : value === 'medium'   ? dk(isDark, cfg.bg, D.amberLight)
    : dk(isDark, cfg.bg, D.greenLight);
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '2px 10px', borderRadius: 99,
      fontSize: 11, fontWeight: 600, letterSpacing: '0.02em',
      color: cfg.color, background: bg,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: cfg.color, display: 'inline-block', flexShrink: 0 }} />
      {cfg.label}
    </span>
  );
}

function RiskScoreBadge({ score, isDark }: { score?: number; isDark: boolean }) {
  if (score === undefined || score === null) return <span style={{ color: dk(isDark, T.stone400, D.textFaint), fontSize: 12 }}>—</span>;
  const color = score > 70 ? T.red : score > 40 ? T.amber : T.green;
  const bg = score > 70 ? dk(isDark, T.redLight, D.redLight) : score > 40 ? dk(isDark, T.amberLight, D.amberLight) : dk(isDark, T.greenLight, D.greenLight);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ width: 56, height: 5, borderRadius: 99, background: dk(isDark, T.stone100, D.bgCard), overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(100, score)}%`, height: '100%', borderRadius: 99, background: color }} />
      </div>
      <span style={{
        fontSize: 11, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums',
        minWidth: 22, textAlign: 'right', padding: '1px 5px', borderRadius: 4, background: bg,
      }}>
        {score}
      </span>
    </div>
  );
}

// ── Scan panel ────────────────────────────────────────────────────────────────

function ScanPanel({ scan, onClose, isDark }: { scan: ScanRecord; onClose: () => void; isDark: boolean }) {
  const progress = scanProgress(scan.stages);
  const isActive = scan.status === 'queued' || scan.status === 'running';

  const statusCfg = ({
    queued:    { label: 'Queued',      color: T.blue,  bg: dk(isDark, T.blueLight, D.blueLight),   icon: <LoadingOutlined /> },
    running:   { label: 'In Progress', color: T.blue,  bg: dk(isDark, T.blueLight, D.blueLight),   icon: <LoadingOutlined spin /> },
    completed: { label: 'Complete',    color: T.green, bg: dk(isDark, T.greenLight, D.greenLight),  icon: <CheckCircleOutlined /> },
    failed:    { label: 'Failed',      color: T.red,   bg: dk(isDark, T.redLight, D.redLight),      icon: <ExclamationCircleOutlined /> },
  } as any)[scan.status] ?? { label: scan.status, color: dk(isDark, T.stone500, D.textMuted), bg: dk(isDark, T.stone100, D.bgCard), icon: null };

  return (
    <div style={{
      border: `1px solid ${isActive ? dk(isDark, T.blueBorder, '#1E3A5F') : dk(isDark, T.stone200, D.border)}`,
      background: isActive ? dk(isDark, T.blueLight, 'rgba(37,99,235,0.08)') : dk(isDark, T.white, D.bgCard),
      borderRadius: 14, padding: '18px 22px', marginBottom: 18, position: 'relative',
    }}>
      <button
        onClick={onClose}
        style={{ position: 'absolute', top: 12, right: 12, background: 'none', border: 'none', cursor: 'pointer', color: dk(isDark, T.stone400, D.textFaint), display: 'flex', padding: 4, borderRadius: 6 }}
      >
        <CloseCircleOutlined style={{ fontSize: 15 }} />
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <span style={{ color: statusCfg.color, fontSize: 16 }}>{statusCfg.icon}</span>
        <span style={{ fontWeight: 700, fontSize: 14, color: dk(isDark, T.stone900, D.text) }}>Scan {statusCfg.label}</span>
        <span style={{
          fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
          color: statusCfg.color, background: statusCfg.bg, padding: '1px 7px', borderRadius: 99,
        }}>
          {scan.status}
        </span>
        {scan.options?.runType && (
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
            color: scan.options.runType === 'incremental' ? T.blue : T.amber,
            background: scan.options.runType === 'incremental' ? dk(isDark, T.blueLight, D.blueLight) : dk(isDark, T.amberLight, D.amberLight),
            padding: '1px 7px', borderRadius: 99,
          }}>
            {scan.options.runType === 'incremental' ? '⚡ Incremental' : '↺ Full'}
          </span>
        )}
      </div>

      <div style={{ width: '100%', height: 5, borderRadius: 99, background: dk(isDark, T.stone100, D.bgCard), marginBottom: 14, overflow: 'hidden' }}>
        <div style={{
          width: `${progress}%`, height: '100%', borderRadius: 99, transition: 'width 0.6s ease',
          background: scan.status === 'failed' ? T.red : `linear-gradient(90deg, ${T.blue}, ${T.green})`,
        }} />
      </div>

      <div style={{ display: 'flex', gap: 24, marginBottom: 14 }}>
        {scan.repositoriesDiscovered !== undefined && (
          <div>
            <div style={{ fontSize: 11, color: dk(isDark, T.stone500, D.textMuted), marginBottom: 1 }}>Repositories</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: dk(isDark, T.stone900, D.text) }}>{scan.repositoriesDiscovered}</div>
          </div>
        )}
        {(() => {
          const totalItems = scan.stages
            .filter(s => s.status === 'completed' && s.itemsProcessed !== undefined)
            .reduce((sum, s) => sum + (s.itemsProcessed ?? 0), 0);
          if (totalItems > 0) return (
            <div>
              <div style={{ fontSize: 11, color: dk(isDark, T.stone500, D.textMuted), marginBottom: 1 }}>Items Indexed</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: T.green }}>{totalItems.toLocaleString()}</div>
            </div>
          );
          if (scan.tasksEnqueued !== undefined) return (
            <div>
              <div style={{ fontSize: 11, color: dk(isDark, T.stone500, D.textMuted), marginBottom: 1 }}>Tasks Enqueued</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: dk(isDark, T.stone900, D.text) }}>{scan.tasksEnqueued}</div>
            </div>
          );
          return null;
        })()}
      </div>

      {scan.error && (
        <div style={{ padding: '8px 12px', borderRadius: 8, background: dk(isDark, T.redLight, D.redLight), color: T.red, fontSize: 12, marginBottom: 12 }}>
          {scan.error}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {scan.stages.map((stage, i) => {
          const isPending = stage.status === 'skipped' || stage.status === 'pending';
          const color = stageStatusColor(stage.status);
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 5, height: 5, borderRadius: '50%', background: isPending ? dk(isDark, T.stone200, D.borderSub) : color, flexShrink: 0 }} />
              <span style={{ color: isPending ? dk(isDark, T.stone300, D.textFaint) : color, fontSize: 12, display: 'flex', width: 14 }}>{STAGE_ICONS[stage.name]}</span>
              <span style={{ fontSize: 12, color: isPending ? dk(isDark, T.stone400, D.textFaint) : dk(isDark, T.stone700, D.textMuted), flex: 1 }}>{stage.name}</span>
              {stage.itemsProcessed !== undefined && stage.itemsProcessed > 0 && (
                <span style={{ fontSize: 10, fontWeight: 600, color: T.blue, background: dk(isDark, T.blueLight, D.blueLight), padding: '1px 6px', borderRadius: 99 }}>
                  {stage.itemsProcessed.toLocaleString()} items
                </span>
              )}
              {stage.status === 'running' && <span style={{ fontSize: 11, color: T.blue }}>Processing…</span>}
              {stage.status === 'completed' && stage.startedAt && stage.completedAt && (
                <span style={{ fontSize: 10, color: dk(isDark, T.stone400, D.textFaint) }}>
                  {Math.round((new Date(stage.completedAt).getTime() - new Date(stage.startedAt).getTime()) / 1000)}s
                </span>
              )}
              {stage.status === 'failed' && stage.error && (
                <span style={{ fontSize: 11, color: T.red }}>{stage.error}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Scan dialog ───────────────────────────────────────────────────────────────

interface ScanDialogProps {
  open: boolean;
  loading: boolean;
  repositories: ScanRepositoryInfo[];
  loadingRepos: boolean;
  onStart: (options: ScanOptions) => void;
  onCancel: () => void;
  isDark: boolean;
  hasCloudIntegration: boolean;
  cloudIntegrationName?: string;
}

function ScanDialog({ open, loading, repositories, loadingRepos, onStart, onCancel, isDark, hasCloudIntegration, cloudIntegrationName }: ScanDialogProps) {
  const [opts, setOpts] = useState<ScanOptions>({
    enableCloudDiscovery: false,
    scope: 'all',
    runType: 'incremental',
  });
  const [selectedRepos, setSelectedRepos] = useState<string[] | undefined>(undefined);

  useEffect(() => {
    if (open) {
      setOpts({
        enableCloudDiscovery: hasCloudIntegration,
        scope: 'all',
        runType: 'incremental',
      });
      setSelectedRepos(undefined);
    }
  }, [open, hasCloudIntegration]);

  useEffect(() => {
    if (open && repositories.length > 0 && selectedRepos === undefined) {
      setSelectedRepos(repositories.map(r => r.name));
    }
  }, [open, repositories]);

  const allRepoNames = repositories.map(r => r.name);
  const allSelected = selectedRepos === undefined || selectedRepos.length === allRepoNames.length;
  const handleToggleAll = (checked: boolean) => setSelectedRepos(checked ? allRepoNames : []);
  const handleToggleRepo = (name: string, checked: boolean) => {
    const base = selectedRepos ?? allRepoNames;
    setSelectedRepos(checked ? [...base, name] : base.filter(r => r !== name));
  };
  const handleStart = () => {
    const reposFilter = selectedRepos && selectedRepos.length < allRepoNames.length ? selectedRepos : undefined;
    onStart({ ...opts, repositories: reposFilter });
  };

  return (
    <Modal
      open={open}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ScanOutlined style={{ color: T.orange, fontSize: 16 }} />
          <span style={{ fontSize: 15, fontWeight: 700 }}>Start Asset Scan</span>
        </div>
      }
      onCancel={onCancel}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 8 }}>
          <button onClick={onCancel} disabled={loading} style={{ padding: '7px 16px', borderRadius: 8, border: `1px solid ${dk(isDark, T.stone200, D.border)}`, background: dk(isDark, T.white, D.bgCard), color: dk(isDark, T.stone600, D.textMuted), fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
            Cancel
          </button>
          <button
            onClick={handleStart}
            disabled={loading || (opts.scope !== 'cloud' && selectedRepos !== undefined && selectedRepos.length === 0)}
            style={{ padding: '7px 18px', borderRadius: 8, border: 'none', background: T.orange, color: T.white, fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: loading ? 0.7 : 1, display: 'flex', alignItems: 'center', gap: 6 }}
          >
            {loading && <LoadingOutlined />} Start Scan
          </button>
        </div>
      }
      width={520}
      styles={{ body: { padding: '4px 24px 8px' } }}
    >
      <p style={{ fontSize: 13, color: dk(isDark, T.stone400, D.textMuted), margin: '8px 0 16px' }}>
        Discover and index your organization's assets — repositories, cloud resources, APIs, and more.
      </p>

      {/* Scan mode: Incremental / Full */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: dk(isDark, T.stone400, D.textMuted), marginBottom: 8 }}>Scan Mode</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['incremental', 'full'] as const).map(rt => {
            const isSelected = opts.runType === rt;
            return (
              <button
                key={rt}
                onClick={() => setOpts(o => ({ ...o, runType: rt }))}
                title={
                  rt === 'incremental'
                    ? 'Only re-index files changed since the last scan (faster)'
                    : 'Re-index everything from scratch (slower, no duplicates)'
                }
                style={{
                  padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                  cursor: 'pointer',
                  border: isSelected ? 'none' : `1px solid ${dk(isDark, T.stone200, D.border)}`,
                  background: isSelected ? T.orange : dk(isDark, T.white, D.bgCard),
                  color: isSelected ? T.white : dk(isDark, T.stone600, D.textMuted),
                }}
              >
                {rt === 'incremental' ? '⚡ Incremental' : '↺ Full'}
              </button>
            );
          })}
        </div>
        <div style={{ fontSize: 11, color: dk(isDark, T.stone400, D.textMuted), marginTop: 6, lineHeight: 1.5 }}>
          {opts.runType === 'incremental'
            ? 'Only changed files are re-indexed. Unchanged entities are preserved as-is.'
            : 'All repositories are re-indexed from scratch. Safe to run at any time — no duplicates created.'}
        </div>
      </div>

      {/* Scope buttons */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: dk(isDark, T.stone400, D.textMuted), marginBottom: 8 }}>Scan Scope</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['all', 'code', 'cloud'] as const).map(scope => (
            <button key={scope} onClick={() => setOpts(o => ({ ...o, scope }))} style={{
              padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              border: opts.scope === scope ? 'none' : `1px solid ${dk(isDark, T.stone200, D.border)}`,
              background: opts.scope === scope ? T.orange : dk(isDark, T.white, D.bgCard),
              color: opts.scope === scope ? T.white : dk(isDark, T.stone600, D.textMuted),
            }}>
              {scope === 'all' ? 'All Sources' : scope === 'code' ? 'Code Only' : 'Cloud Only'}
            </button>
          ))}
        </div>
      </div>

      {/* Repositories */}
      {(opts.scope === 'all' || opts.scope === 'code') && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: dk(isDark, T.stone400, D.textMuted), marginBottom: 8 }}>Repositories</div>
          {loadingRepos ? (
            <div style={{ padding: 12, color: dk(isDark, T.stone400, D.textMuted), fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
              <LoadingOutlined /> Discovering repositories…
            </div>
          ) : repositories.length === 0 ? (
            <div style={{ fontSize: 13, color: dk(isDark, T.stone400, D.textMuted) }}>No repositories found (check your code integration).</div>
          ) : (
            <div style={{ border: `1px solid ${dk(isDark, T.stone200, D.border)}`, borderRadius: 10, overflow: 'hidden', maxHeight: 180, overflowY: 'auto' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: `1px solid ${dk(isDark, T.stone100, D.border)}`, cursor: 'pointer', background: dk(isDark, T.stone50, D.bgSub) }}>
                <input type="checkbox" checked={allSelected} onChange={e => handleToggleAll(e.target.checked)} style={{ accentColor: T.orange }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: dk(isDark, T.stone700, D.text) }}>All repositories ({allRepoNames.length})</span>
              </label>
              {repositories.map(repo => (
                <label key={repo.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', cursor: 'pointer', background: dk(isDark, T.white, D.bgCard) }}>
                  <input type="checkbox" checked={(selectedRepos ?? allRepoNames).includes(repo.name)} onChange={e => handleToggleRepo(repo.name, e.target.checked)} style={{ accentColor: T.orange }} />
                  <CodeOutlined style={{ color: dk(isDark, T.stone400, D.textFaint), fontSize: 12 }} />
                  <span style={{ fontSize: 12, color: dk(isDark, T.stone700, D.text) }}>{repo.name}</span>
                  <span style={{ fontSize: 11, color: dk(isDark, T.stone400, D.textMuted) }}>{repo.defaultBranch}</span>
                </label>
              ))}
            </div>
          )}
          {selectedRepos !== undefined && selectedRepos.length < allRepoNames.length && (
            <div style={{ fontSize: 11, color: dk(isDark, T.stone400, D.textMuted), marginTop: 4 }}>{selectedRepos.length} of {allRepoNames.length} selected</div>
          )}
        </div>
      )}

      {/* Cloud Discovery */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '11px 0', borderBottom: `1px solid ${dk(isDark, T.stone100, D.border)}` }}>
        <div style={{ flex: 1, paddingRight: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: dk(isDark, hasCloudIntegration ? T.stone800 : T.stone400, hasCloudIntegration ? D.text : D.textFaint) }}>Cloud Discovery</span>
          </div>
          <div style={{ fontSize: 12, color: dk(isDark, T.stone400, D.textMuted), lineHeight: 1.5 }}>
            {hasCloudIntegration
              ? <>Will use <strong>{cloudIntegrationName ?? 'Microsoft Defender for Cloud'}</strong> to discover and index Azure resources.</>
              : <>No cloud integration configured. Add a Cloud integration in the integrations page to enable this.</>}
          </div>
        </div>
        <Switch checked={opts.enableCloudDiscovery} onChange={v => setOpts(o => ({ ...o, enableCloudDiscovery: v }))} size="small" disabled={!hasCloudIntegration} style={{ flexShrink: 0, marginTop: 2 }} />
      </div>

      <div style={{ marginTop: 14, padding: '10px 12px', borderRadius: 10, background: dk(isDark, T.blueLight, D.blueLight), fontSize: 12, color: T.blue, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <ClockCircleOutlined style={{ marginTop: 1, flexShrink: 0 }} />
        <span>Progress is shown in real-time — each stage updates as it completes.</span>
      </div>
    </Modal>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ onScan, isDark }: { onScan: () => void; isDark: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 0', gap: 16 }}>
      <div style={{ width: 72, height: 72, borderRadius: '50%', background: dk(isDark, T.stone100, D.bgCard), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <ScanOutlined style={{ fontSize: 28, color: dk(isDark, T.stone300, D.textFaint) }} />
      </div>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: dk(isDark, T.stone800, D.text), marginBottom: 6 }}>No assets indexed yet</div>
        <div style={{ fontSize: 13, color: dk(isDark, T.stone400, D.textMuted), maxWidth: 360, lineHeight: 1.6 }}>
          Run a scan to discover and index your organization's assets — repositories, cloud resources, APIs, and more.
        </div>
      </div>
      <button onClick={onScan} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 24px', borderRadius: 10, border: 'none', background: T.orange, color: T.white, fontSize: 14, fontWeight: 600, cursor: 'pointer', marginTop: 4 }}>
        <ScanOutlined /> Start Your First Scan
      </button>
    </div>
  );
}

// ── Assets table ──────────────────────────────────────────────────────────────

function AssetsTable({ assets, loading, onRowClick, isDark }: { assets: Asset[]; loading: boolean; onRowClick: (id: string) => void; isDark: boolean }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
        <LoadingOutlined style={{ fontSize: 24, color: T.orange }} />
      </div>
    );
  }

  const toggleExpand = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };

  const rowHoverBg = isDark ? D.bgHover : T.stone50;

  return (
    <div style={{ background: dk(isDark, T.white, D.bgCard), border: `1px solid ${dk(isDark, T.stone200, D.border)}`, borderRadius: 16, overflow: 'hidden', boxShadow: isDark ? 'none' : '0 1px 3px rgba(28,25,23,0.04)' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${dk(isDark, T.stone100, D.border)}` }}>
            {['Name', 'Owner', 'Repository', 'Business Criticality', 'Risk Score', 'Type', ''].map((col, i) => (
              <th key={i} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: dk(isDark, T.stone400, D.textFaint), whiteSpace: 'nowrap' }}>
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {assets.map((asset) => {
            const isExpanded = expanded.has(asset.id);
            return (
              <>
                <tr
                  key={asset.id}
                  onClick={() => onRowClick(asset.id)}
                  style={{ borderBottom: `1px solid ${dk(isDark, T.stone50, D.border)}`, cursor: 'pointer', transition: 'background 0.1s' }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = rowHoverBg}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}
                >
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ color: T.orange, fontSize: 14, display: 'flex', flexShrink: 0 }}>
                        <EntityIcon asset={asset} size={18} />
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: dk(isDark, T.stone800, D.text) }}>{asset.name}</span>
                    </div>
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 12, color: asset.owner ? dk(isDark, T.stone500, D.textMuted) : dk(isDark, T.stone300, D.textFaint) }}>
                    {asset.owner || '—'}
                  </td>
                  <td style={{ padding: '12px 16px', maxWidth: 160 }}>
                    {asset.metadata?.repositoryName ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ color: dk(isDark, T.stone400, D.textFaint), fontSize: 12, display: 'flex', flexShrink: 0 }}><GitHubIcon /></span>
                        <span style={{
                          fontSize: 11, color: dk(isDark, T.stone600, D.textMuted),
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          fontFamily: 'monospace',
                        }}>
                          {asset.metadata.repositoryName}
                        </span>
                      </div>
                    ) : (
                      <span style={{ color: dk(isDark, T.stone300, D.textFaint), fontSize: 12 }}>—</span>
                    )}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <CriticalityPill value={asset.businessCriticality} isDark={isDark} />
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <RiskScoreBadge score={asset.riskScore} isDark={isDark} />
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ fontSize: 11, fontWeight: 500, color: dk(isDark, T.stone500, D.textMuted), background: dk(isDark, T.stone100, D.bgSub), padding: '2px 8px', borderRadius: 6 }}>
                      {asset.type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px', width: 40 }}>
                    <button
                      onClick={e => toggleExpand(asset.id, e)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: dk(isDark, T.stone300, D.textFaint), fontSize: 10, padding: '2px 4px', borderRadius: 4, transition: 'color 0.15s' }}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = dk(isDark, T.stone500, D.textMuted)}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = dk(isDark, T.stone300, D.textFaint)}
                    >
                      {isExpanded ? '▲' : '▼'}
                    </button>
                  </td>
                </tr>
                {isExpanded && (
                  <tr key={`${asset.id}-expand`}>
                    <td colSpan={7} style={{ background: dk(isDark, T.stone50, D.bgSub), padding: '12px 24px 16px 52px', borderBottom: `1px solid ${dk(isDark, T.stone100, D.border)}` }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {asset.metadata?.responsibility && (
                          <div>
                            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: dk(isDark, T.stone400, D.textFaint), marginBottom: 4 }}>Responsibility</div>
                            <div style={{ padding: '8px 12px', background: dk(isDark, T.white, D.bgCard), border: `1px solid ${dk(isDark, T.stone200, D.border)}`, borderRadius: 8, fontSize: 12, color: dk(isDark, T.stone600, D.textMuted), lineHeight: 1.6 }}>
                              {asset.metadata.responsibility}
                            </div>
                          </div>
                        )}
                        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: 12, color: dk(isDark, T.stone500, D.textMuted) }}>
                          {asset.metadata?.url && <span><b style={{ color: dk(isDark, T.stone600, D.text) }}>URL:</b> {asset.metadata.url}</span>}
                          {asset.metadata?.cloudProvider && <span><b style={{ color: dk(isDark, T.stone600, D.text) }}>Cloud:</b> {asset.metadata.cloudProvider}</span>}
                          {asset.metadata?.resourceType && <span><b style={{ color: dk(isDark, T.stone600, D.text) }}>Resource:</b> {asset.metadata.resourceType}</span>}
                          {asset.metadata?.dataClassification && <span><b style={{ color: dk(isDark, T.stone600, D.text) }}>Classification:</b> {asset.metadata.dataClassification}</span>}
                          {/* Azure identity-specific fields */}
                          {asset.type === 'azure_identity' && asset.metadata?.identityKind && (
                            <span>
                              <b style={{ color: dk(isDark, T.stone600, D.text) }}>Identity Kind:</b>{' '}
                              {(asset.metadata.identityKind as string).replace(/_/g, ' ')}
                            </span>
                          )}
                          {asset.type === 'azure_identity' && asset.metadata?.principalId && (
                            <span>
                              <b style={{ color: dk(isDark, T.stone600, D.text) }}>Object ID:</b>{' '}
                              <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{asset.metadata.principalId}</span>
                            </span>
                          )}
                          {asset.type === 'azure_identity' && asset.metadata?.clientId && (
                            <span>
                              <b style={{ color: dk(isDark, T.stone600, D.text) }}>Client ID:</b>{' '}
                              <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{asset.metadata.clientId}</span>
                            </span>
                          )}
                          {asset.type === 'azure_identity' && asset.metadata?.region && (
                            <span><b style={{ color: dk(isDark, T.stone600, D.text) }}>Region:</b> {asset.metadata.region}</span>
                          )}
                        </div>
                        <button
                          onClick={e => { e.stopPropagation(); onRowClick(asset.id); }}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 8, border: 'none', background: T.orange, color: T.white, fontSize: 12, fontWeight: 600, cursor: 'pointer', alignSelf: 'flex-start' }}
                        >
                          <EyeOutlined /> View Full Details & Graph
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            );
          })}
        </tbody>
      </table>
      {assets.length === 0 && (
        <div style={{ padding: '48px 0', textAlign: 'center', fontSize: 13, color: dk(isDark, T.stone300, D.textFaint) }}>No assets in this category.</div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function AssetsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [categories, setCategories] = useState<AssetCategory[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>(searchParams.get('category') ?? '');
  const [loadingCategories, setLoadingCategories] = useState(true);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [scanDialogOpen, setScanDialogOpen] = useState(false);
  const [scanLoading, setScanLoading] = useState(false);
  const [activeScan, setActiveScan] = useState<ScanRecord | null>(null);
  const [repositories, setRepositories] = useState<ScanRepositoryInfo[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [activeTab, setActiveTab] = useState<string>(searchParams.get('tab') === 'features' ? 'features' : 'assets');
  const streamAbortRef = useRef<(() => void) | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null);

  const [hasCloudIntegration, setHasCloudIntegration] = useState(false);
  const [cloudIntegrationName, setCloudIntegrationName] = useState<string | undefined>(undefined);

  const { getAssetCategories, getAssetsByCategory, getScanHistory, listRepositories, streamScan, pollScanUntilDone, deleteAllAssets } = useAssets();
  const { listFeatures } = useFeatures();
  const { getAllCustomIntegrations } = useIntegrations();
  const { theme: appTheme } = useTheme();
  const isDark = appTheme === 'dark';
  const [featureCount, setFeatureCount] = useState<number | undefined>(undefined);

  useEffect(() => {
    loadCategories();
    checkExistingScans();
    listFeatures().then(f => setFeatureCount(f.length)).catch(() => {});
    return () => { streamAbortRef.current?.(); };
  }, []);


  useEffect(() => {
    if (!scanDialogOpen) return;
    setLoadingRepos(true);
    listRepositories().then(setRepositories).catch(() => setRepositories([])).finally(() => setLoadingRepos(false));
    getAllCustomIntegrations(true).then((integrations: any[]) => {
      const defender = integrations.find((i: any) =>
        i.name?.toLowerCase().includes('defender') ||
        i.name?.toLowerCase().includes('microsoft') ||
        (i.config?.clientId && i.config?.clientSecret)
      );
      setHasCloudIntegration(!!defender);
      setCloudIntegrationName(defender?.name);
    }).catch(() => {
      setHasCloudIntegration(false);
      setCloudIntegrationName(undefined);
    });
  }, [scanDialogOpen]);

  const loadCategories = async () => {
    setLoadingCategories(true);
    try {
      const data = await getAssetCategories();
      setCategories(data);
      if (data.length > 0) {
        const existingCategory = searchParams.get('category');
        const initial = (existingCategory && data.find(c => c.type === existingCategory)) ? existingCategory : data[0].type;
        setSelectedCategory(initial);
        loadAssets(initial);
      }
    } catch { /* silent */ } finally { setLoadingCategories(false); }
  };

  const loadAssets = async (category: string) => {
    setLoadingAssets(true);
    try { setAssets(await getAssetsByCategory(category)); } catch { /* silent */ } finally { setLoadingAssets(false); }
  };

  const checkExistingScans = async () => {
    try {
      const scans = await getScanHistory();
      const running = scans.find(s => s.status === 'queued' || s.status === 'running');
      if (running) {
        setActiveScan(running);
        const stop = pollScanUntilDone(running.scanId, (record) => {
          setActiveScan(record);
          if (record.status === 'completed') {
            streamAbortRef.current = null;
            notification.success({ message: 'Scan complete', description: `${record.repositoriesDiscovered ?? 0} repositories discovered.`, duration: 5 });
            loadCategories();
          } else if (record.status === 'failed') {
            streamAbortRef.current = null;
            notification.error({ message: 'Scan failed', description: record.error ?? 'An error occurred.', duration: 5 });
          }
        });
        streamAbortRef.current = stop;
      }
    } catch { /* no scans yet */ }
  };

  const handleDeleteAll = useCallback(() => {
    Modal.confirm({
      title: 'Delete all indexed assets?',
      icon: <DeleteOutlined style={{ color: T.red }} />,
      content: 'This will permanently delete all indexed assets from both the vector store and graph database. This action cannot be undone.',
      okText: 'Delete All', okType: 'danger', cancelText: 'Cancel',
      onOk: async () => {
        setDeleteLoading(true);
        try {
          await deleteAllAssets();
          notification.success({ message: 'All assets deleted', duration: 4 });
          setCategories([]); setAssets([]); setSelectedCategory('');
        } catch (err: any) {
          notification.error({ message: 'Delete failed', description: err.message, duration: 5 });
        } finally { setDeleteLoading(false); }
      },
    });
  }, [deleteAllAssets]);

  const handleStartScan = useCallback(async (options: ScanOptions) => {
    setScanLoading(true);
    setScanDialogOpen(false);
    streamAbortRef.current?.();
    const abort = streamScan(options, (record) => {
      setActiveScan(record);
      if (record.status === 'completed') {
        setScanLoading(false);
        notification.success({ message: 'Scan complete', description: `${record.repositoriesDiscovered ?? 0} repositories discovered.`, duration: 5 });
        loadCategories();
      } else if (record.status === 'failed') {
        setScanLoading(false);
        notification.error({ message: 'Scan failed', description: record.error ?? 'An error occurred.', duration: 5 });
      }
    }, (message) => {
      setScanLoading(false);
      notification.error({ message: 'Scan error', description: message, duration: 5 });
    });
    streamAbortRef.current = abort;
  }, [streamScan]);

  const isEmpty = categories.length === 0;
  const NAV_FEATURES = '__features__';
  const activeView = activeTab === 'features' ? NAV_FEATURES : selectedCategory;
  const scanRunning = activeScan?.status === 'queued' || activeScan?.status === 'running';
  const navItems = [
    ...categories.map(c => ({ key: c.type, icon: categoryIcons[c.type], label: c.label, count: c.count })),
    { key: NAV_FEATURES, icon: <AppstoreOutlined />, label: 'Feature Analysis', count: featureCount },
  ];
  const handleNavSelect = (key: string) => {
    setSelectedRepoId(null);
    if (key === NAV_FEATURES) {
      setActiveTab('features');
      setSearchParams({ tab: 'features' }, { replace: true });
    } else {
      setActiveTab('assets');
      setSelectedCategory(key);
      loadAssets(key);
      setSearchParams({ category: key }, { replace: true });
    }
  };

  if (loadingCategories) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400, background: dk(isDark, T.white, D.bg) }}>
        <LoadingOutlined style={{ fontSize: 28, color: T.orange }} />
      </div>
    );
  }

  return (
    <>
      <div style={{ display: 'flex', height: '100%', minHeight: 'calc(100vh - 24px)' }}>

        {/* ── Left nav panel ── */}
        <aside style={{
          width: 220, flexShrink: 0,
          background: dk(isDark, T.stone50, D.bgSub),
          borderRight: `1px solid ${dk(isDark, T.stone200, D.border)}`,
          borderRadius: '12px 0 0 12px',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
          <div style={{ padding: '14px 16px 10px', borderBottom: `1px solid ${dk(isDark, T.stone200, D.border)}` }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: dk(isDark, T.stone400, D.textFaint) }}>Asset Categories</span>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
            {isEmpty ? (
              <div style={{ padding: '12px 16px', fontSize: 12, color: dk(isDark, T.stone400, D.textMuted) }}>No assets indexed yet</div>
            ) : navItems.map(item => {
              const active = activeView === item.key;
              return (
                <div
                  key={item.key}
                  onClick={() => handleNavSelect(item.key)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '8px 16px', cursor: 'pointer',
                    background: active ? dk(isDark, T.orangeLight, D.orangeLight) : 'transparent',
                    borderLeft: `3px solid ${active ? T.orange : 'transparent'}`,
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = dk(isDark, T.stone100, D.bgHover); }}
                  onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 13, color: active ? T.orange : dk(isDark, T.stone400, D.textFaint), display: 'flex' }}>{item.icon}</span>
                    <span style={{ fontSize: 13, fontWeight: active ? 600 : 400, color: active ? dk(isDark, T.stone800, D.text) : dk(isDark, T.stone500, D.textMuted) }}>{item.label}</span>
                  </div>
                  {item.count !== undefined && (
                    <span style={{ fontSize: 10, fontWeight: 700, background: active ? T.orange : dk(isDark, T.stone200, D.bgCard), color: active ? T.white : dk(isDark, T.stone500, D.textMuted), borderRadius: 99, padding: '1px 7px', minWidth: 20, textAlign: 'center' }}>
                      {item.count}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </aside>

        {/* ── Main content ── */}
        <div style={{ flex: 1, minWidth: 0, background: dk(isDark, T.white, D.bg), borderRadius: '0 12px 12px 0', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Header */}
          <div style={{ padding: '14px 24px', borderBottom: `1px solid ${dk(isDark, T.stone100, D.border)}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: dk(isDark, T.stone900, D.text) }}>
                {activeTab === 'features' ? 'Feature Analysis' : categories.find(c => c.type === selectedCategory)?.label ?? 'Assets'}
              </h2>
              <p style={{ margin: 0, fontSize: 12, color: dk(isDark, T.stone400, D.textMuted), marginTop: 2 }}>
                {activeTab === 'features'
                  ? 'AI-extracted business features with STRIDE threat models'
                  : selectedRepoId
                    ? 'Repository deep analysis — services, builds, deployments & modules'
                    : "View and manage your organization's indexed assets"}
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {activeTab === 'assets' && !isEmpty && (
                <button onClick={() => loadCategories()} title="Refresh" style={{ padding: '7px 11px', borderRadius: 8, border: `1px solid ${dk(isDark, T.stone200, D.border)}`, background: dk(isDark, T.white, D.bgCard), color: dk(isDark, T.stone500, D.textMuted), cursor: 'pointer', display: 'flex' }}>
                  <ReloadOutlined style={{ fontSize: 13 }} />
                </button>
              )}
              {!isEmpty && activeTab === 'assets' && (
                <button onClick={handleDeleteAll} disabled={deleteLoading} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 12px', borderRadius: 8, border: `1px solid ${dk(isDark, T.redBorder, 'rgba(220,38,38,0.3)')}`, background: dk(isDark, T.redLight, D.redLight), color: T.red, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                  <DeleteOutlined /> Delete All
                </button>
              )}
              <button
                onClick={() => setScanDialogOpen(true)} disabled={scanRunning}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 16px', borderRadius: 8, border: 'none', background: scanRunning ? dk(isDark, T.stone200, D.bgCard) : T.orange, color: scanRunning ? dk(isDark, T.stone400, D.textFaint) : T.white, fontSize: 13, fontWeight: 600, cursor: scanRunning ? 'not-allowed' : 'pointer' }}
              >
                <ScanOutlined /> {scanRunning ? 'Scan Running…' : 'Start Scan'}
              </button>
            </div>
          </div>

          {activeScan && (
            <div style={{ padding: '16px 24px 0' }}>
              <ScanPanel scan={activeScan} isDark={isDark} onClose={() => {
                if (activeScan?.status === 'queued' || activeScan?.status === 'running') {
                  streamAbortRef.current?.(); streamAbortRef.current = null; setScanLoading(false);
                }
                setActiveScan(null);
              }} />
            </div>
          )}

          <div style={{ flex: 1, overflow: 'auto', padding: selectedRepoId ? 0 : '16px 24px' }}>
            {activeTab === 'features' ? (
              <FeatureListView onSelect={(id) => navigate(`/knowledge-base/features/${encodeURIComponent(id)}`)} />
            ) : isEmpty ? (
              <EmptyState onScan={() => setScanDialogOpen(true)} isDark={isDark} />
            ) : selectedRepoId ? (
              <RepositoryDetailPanel
                assetId={selectedRepoId}
                isDark={isDark}
                onBack={() => setSelectedRepoId(null)}
              />
            ) : (
              <AssetsTable
                assets={assets}
                loading={loadingAssets}
                onRowClick={(id) => {
                  if (selectedCategory === 'code_repository') {
                    setSelectedRepoId(id);
                  } else {
                    navigate(`/knowledge-base/assets/${encodeURIComponent(id)}`);
                  }
                }}
                isDark={isDark}
              />
            )}
          </div>
        </div>
      </div>

      <ScanDialog open={scanDialogOpen} loading={scanLoading} repositories={repositories} loadingRepos={loadingRepos} onStart={handleStartScan} onCancel={() => setScanDialogOpen(false)} isDark={isDark} hasCloudIntegration={hasCloudIntegration} cloudIntegrationName={cloudIntegrationName} />
    </>
  );
}
