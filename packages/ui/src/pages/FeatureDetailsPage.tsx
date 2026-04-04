/**
 * FeatureDetailsPage — enterprise-grade feature security posture view.
 *
 * Layout:
 *   ┌─────────────────────────────────────────────────────┬──────────────┐
 *   │  Header bar (breadcrumb · feature name · actions)   │              │
 *   ├────────────────────────────────────────────────────▶│  Right panel │
 *   │  Data Flow Diagram (ReactFlow canvas, fills space)  │  (tabs)      │
 *   └─────────────────────────────────────────────────────┴──────────────┘
 *
 * Security: featureId from URL is validated by sanitizeId() before any API call.
 * All feature data is rendered as React children only — no dangerouslySetInnerHTML.
 */
import { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Spin, Alert, Button, Breadcrumb, Tooltip } from 'antd';
import {
  ArrowLeftOutlined,
  HomeOutlined,
  DownloadOutlined,
  SafetyOutlined,
  ApiOutlined,
  ApartmentOutlined,
  InfoCircleOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from '@ant-design/icons';
import type { BusinessFeature, ThreatSeverity } from '../types';
import { useFeatures } from '../hooks/useFeatures';
import { useTheme } from '../hooks/useTheme';
import { T, D } from '../theme';
import { FeatureDiagram } from '../components/diagram/FeatureDiagram';
import { FeatureOverviewPanel } from '../components/diagram/FeatureOverviewPanel';
import { ThreatModelPanel } from '../components/diagram/ThreatModelPanel';
import { TrustBoundariesPanel } from '../components/diagram/TrustBoundariesPanel';
import { DataFlowsPanel } from '../components/diagram/DataFlowsPanel';

// ── Input validation (security: only allow safe ID formats) ──────────────────
const SAFE_ID_RE = /^[a-zA-Z0-9_\-]{1,128}$/;
function sanitizeId(raw: string | undefined): string | null {
  if (!raw || !SAFE_ID_RE.test(raw)) return null;
  return raw;
}

// ── Design tokens ─────────────────────────────────────────────────────────────
const SEVERITY_COLOR: Record<ThreatSeverity, { color: string; bg: string; border: string }> = {
  critical: { color: T.red,       bg: T.redLight,   border: T.redBorder       },
  high:     { color: T.orangeHigh, bg: T.orangeLight, border: T.orangeHighBorder },
  medium:   { color: T.amber,     bg: T.amberLight,  border: T.amberBorder     },
  low:      { color: T.lime,      bg: T.limeLight,   border: T.greenBorder     },
  info:     { color: T.gray,      bg: T.grayLight,   border: T.grayBorder      },
};

// ── Right-panel tab definitions ───────────────────────────────────────────────

type PanelTabId = 'overview' | 'threats' | 'boundaries' | 'dataflows';

const PANEL_TABS: Array<{ id: PanelTabId; label: string; icon: React.ReactNode }> = [
  { id: 'overview',   label: 'Overview',   icon: <InfoCircleOutlined /> },
  { id: 'threats',    label: 'Threats',    icon: <SafetyOutlined />    },
  { id: 'boundaries', label: 'Boundaries', icon: <ApartmentOutlined /> },
  { id: 'dataflows',  label: 'Data Flows', icon: <ApiOutlined />       },
];

// ── Main page ─────────────────────────────────────────────────────────────────

export function FeatureDetailsPage() {
  const { featureId: rawFeatureId } = useParams<{ featureId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { getFeatureById, getArchitectureDoc } = useFeatures();
  const { theme: appTheme } = useTheme();
  const isDark = appTheme === 'dark';

  const [feature, setFeature] = useState<BusinessFeature | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [archDocLoading, setArchDocLoading] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<PanelTabId>('overview');

  // Security: validate featureId from URL before any API call
  const featureId = sanitizeId(rawFeatureId);

  useEffect(() => {
    if (!featureId) {
      setLoadError('Invalid feature identifier in URL.');
      return;
    }
    setLoading(true);
    setLoadError(null);
    getFeatureById(featureId)
      .then(setFeature)
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Failed to load feature';
        setLoadError(msg);
      })
      .finally(() => setLoading(false));
  }, [featureId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDownloadArchDoc = async () => {
    setArchDocLoading(true);
    try {
      const { markdown } = await getArchitectureDoc();
      const blob = new Blob([markdown], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'ARCHITECTURE.md';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // non-critical download failure
    } finally {
      setArchDocLoading(false);
    }
  };

  // ── Theme tokens ────────────────────────────────────────────────────────────
  const bg          = isDark ? D.bg      : T.stone50;
  const headerBg    = isDark ? D.bg      : T.white;
  const border      = isDark ? D.border  : T.stone200;
  const textPrimary = isDark ? D.text    : T.stone900;
  const textMuted   = T.stone500;
  const panelBg     = isDark ? D.bgSub   : T.white;
  const tabActiveBg = isDark ? D.orangeLight : T.orangeLight;

  // ── Loading / error states ──────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', background: bg }}>
        <Spin size="large" />
      </div>
    );
  }

  if (loadError || !feature) {
    return (
      <div style={{ padding: '24px 32px', background: bg, height: '100%' }}>
        <Alert
          type="error" showIcon
          message="Failed to load feature"
          description={loadError || 'Feature not found'}
          action={
            <Button size="small" icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)}>
              Back to Features
            </Button>
          }
        />
      </div>
    );
  }

  const tm = feature.threatModel;
  const riskLevel: ThreatSeverity = tm.overallRiskScore >= 70 ? 'critical'
    : tm.overallRiskScore >= 40 ? 'high'
    : tm.overallRiskScore >= 20 ? 'medium' : 'low';
  const riskColors = SEVERITY_COLOR[riskLevel];

  const tabBadges: Partial<Record<PanelTabId, number>> = {
    threats:    tm.strideThreats.length,
    boundaries: tm.trustBoundaryAnalysis.length,
    dataflows:  feature.dataFlowDiagram.flows.length,
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      height: '100vh', overflow: 'hidden',
      background: bg,
      margin: -16,
    }}>
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div style={{
        flexShrink: 0,
        background: headerBg,
        borderBottom: `1px solid ${border}`,
        padding: '10px 20px',
      }}>
        <Breadcrumb
          style={{ marginBottom: 6, fontSize: 12 }}
          items={[
            {
              title: (
                <span onClick={() => navigate('/knowledge-base/assets')} style={{ cursor: 'pointer', color: textMuted }}>
                  <HomeOutlined style={{ marginRight: 4 }} />Assets
                </span>
              ),
            },
            {
              title: (
                <span onClick={() => navigate(-1)} style={{ cursor: 'pointer', color: textMuted }}>
                  Features
                </span>
              ),
            },
            { title: <span style={{ color: textPrimary, fontWeight: 600 }}>{feature.name}</span> },
          ]}
        />

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
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
              <h1 style={{
                margin: 0, fontSize: 17, fontWeight: 800,
                color: textPrimary, letterSpacing: '-0.02em',
                lineHeight: 1.2,
              }}>
                {feature.name}
              </h1>

              <span style={{
                display: 'inline-flex', alignItems: 'center',
                fontSize: 10, fontWeight: 700, padding: '2px 9px',
                borderRadius: 9999, flexShrink: 0,
                color: riskColors.color, background: riskColors.bg,
                border: `1px solid ${riskColors.border}`,
              }}>
                Risk {tm.overallRiskScore}/100 · {riskLevel.toUpperCase()}
              </span>

              {tm.strideThreats.length > 0 && (
                <span style={{
                  fontSize: 10, fontWeight: 600, padding: '2px 9px',
                  borderRadius: 9999, flexShrink: 0,
                  color: T.red, background: T.redLight,
                  border: `1px solid ${T.redBorder}`,
                }}>
                  {tm.strideThreats.length} STRIDE threats
                </span>
              )}

              {tm.complianceConsiderations.slice(0, 2).map((c) => (
                <span key={c} style={{
                  fontSize: 10, fontWeight: 600, padding: '2px 8px',
                  borderRadius: 9999, flexShrink: 0,
                  color: T.blue, background: T.blueLight,
                  border: `1px solid ${T.blueBorder}`,
                }}>
                  {c}
                </span>
              ))}
            </div>

            {feature.description && (
              <p style={{
                margin: '3px 0 0', fontSize: 12, color: textMuted,
                lineHeight: 1.5, overflow: 'hidden',
                display: '-webkit-box', WebkitLineClamp: 1,
                WebkitBoxOrient: 'vertical' as React.CSSProperties['WebkitBoxOrient'],
              }}>
                {feature.description}
              </p>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <Tooltip title="Download ARCHITECTURE.md">
              <Button
                size="small" icon={<DownloadOutlined />}
                loading={archDocLoading}
                onClick={handleDownloadArchDoc}
                style={{ fontSize: 11 }}
              >
                ARCH.md
              </Button>
            </Tooltip>

            <Tooltip title={panelOpen ? 'Collapse details panel' : 'Show details panel'}>
              <button
                onClick={() => setPanelOpen((v) => !v)}
                style={{
                  width: 30, height: 30,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  borderRadius: 6, background: 'none', border: `1px solid ${border}`,
                  cursor: 'pointer', color: textMuted, transition: 'all 0.15s',
                }}
              >
                {panelOpen
                  ? <MenuFoldOutlined style={{ fontSize: 13 }} />
                  : <MenuUnfoldOutlined style={{ fontSize: 13 }} />}
              </button>
            </Tooltip>
          </div>
        </div>
      </div>

      {/* ── Body: diagram + right panel ─────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>

        {/* Diagram canvas */}
        <div style={{ flex: 1, position: 'relative', minWidth: 0, background: isDark ? '#141211' : T.stone50 }}>
          <FeatureDiagram feature={feature} />
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
              <div style={{
                display: 'flex',
                borderBottom: `1px solid ${border}`,
                flexShrink: 0,
              }}>
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
                          borderRadius: 9999, lineHeight: '14px',
                          background: isActive ? T.orange : (isDark ? D.bgCard : T.stone100),
                          color: isActive ? T.white : textMuted,
                        }}>
                          {badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Section title */}
              <div style={{
                padding: '10px 16px 2px',
                fontSize: 13, fontWeight: 700,
                color: textPrimary, flexShrink: 0,
                letterSpacing: '-0.01em',
              }}>
                {PANEL_TABS.find((t) => t.id === activeTab)?.label}
              </div>

              {/* Scrollable content */}
              <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
                {activeTab === 'overview'   && <FeatureOverviewPanel feature={feature} />}
                {activeTab === 'threats'    && <ThreatModelPanel     threats={tm.strideThreats} />}
                {activeTab === 'boundaries' && <TrustBoundariesPanel feature={feature} />}
                {activeTab === 'dataflows'  && <DataFlowsPanel       feature={feature} />}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
