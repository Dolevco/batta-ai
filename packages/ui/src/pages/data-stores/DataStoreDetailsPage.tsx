import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeftOutlined,
  DatabaseOutlined,
  CloudOutlined,
  LockOutlined,
  UnlockOutlined,
  LoadingOutlined,
  SafetyOutlined,
  AppstoreOutlined,
  ApiOutlined,
  BranchesOutlined,
} from '@ant-design/icons';
import { useTheme } from '../../hooks/useTheme';
import { useDataStoreDetail } from '../../hooks/useDataStores';
import { AssetRelationshipGraph } from '../../components/diagram/AssetRelationshipGraph';
import { T, D, dk } from '../../theme';
import type { DataStoreServiceAccess } from '../../types';

// ── Classification & helpers ──────────────────────────────────────────────────

const CLASSIFICATION_COLORS: Record<string, { color: string; bg: string }> = {
  restricted:   { color: T.red,    bg: T.redLight },
  confidential: { color: T.purple, bg: T.purpleLight },
  internal:     { color: T.amber,  bg: T.amberLight },
  public:       { color: T.green,  bg: T.greenLight },
};

function ClassificationPill({ value, isDark }: { value?: string; isDark: boolean }) {
  if (!value) return <span style={{ color: dk(isDark, T.stone400, D.textFaint), fontSize: 12 }}>—</span>;
  const cfg = CLASSIFICATION_COLORS[value] ?? { color: T.stone500, bg: T.stone100 };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 9px', borderRadius: 99,
      fontSize: 11, fontWeight: 600,
      color: cfg.color, background: cfg.bg,
    }}>
      {value.charAt(0).toUpperCase() + value.slice(1)}
    </span>
  );
}

function EncryptionBadge({ atRest, inTransit, isDark }: { atRest?: boolean; inTransit?: boolean; isDark: boolean }) {
  if (atRest && inTransit)
    return <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: T.green, fontSize: 12 }}><LockOutlined /> At rest & in transit</span>;
  if (atRest)
    return <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: T.amber, fontSize: 12 }}><LockOutlined /> At rest only</span>;
  if (inTransit)
    return <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: T.amber, fontSize: 12 }}><LockOutlined /> In transit only</span>;
  return <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: dk(isDark, T.stone400, D.textFaint), fontSize: 12 }}><UnlockOutlined /> Not encrypted</span>;
}

const ACCESS_PATTERN_COLORS: Record<string, string> = {
  read:       T.blue,
  write:      T.amber,
  read_write: T.orange,
};

function AccessPatternBadge({ pattern, isDark }: { pattern: string; isDark: boolean }) {
  const color = ACCESS_PATTERN_COLORS[pattern] ?? T.stone400;
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 6,
      fontSize: 11, fontWeight: 600, color,
      background: dk(isDark, T.stone100, D.bgSub),
    }}>
      {pattern.replace('_', '/')}
    </span>
  );
}

function EvidenceBadge({ evidence }: { evidence: string; isDark?: boolean }) {
  const color = evidence === 'both' ? T.green : evidence === 'dfd' ? T.blue : T.stone400;
  return (
    <span style={{ fontSize: 10, fontWeight: 600, color, letterSpacing: '0.04em' }}>
      {evidence === 'both' ? 'DFD + Code' : evidence === 'dfd' ? 'DFD' : 'Code'}
    </span>
  );
}

// ── Tab definitions ───────────────────────────────────────────────────────────

type TabKey = 'overview' | 'data-types' | 'services' | 'features' | 'security';

const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: 'overview',    label: 'Overview',    icon: <AppstoreOutlined /> },
  { key: 'data-types',  label: 'Data Types',  icon: <DatabaseOutlined /> },
  { key: 'services',    label: 'Services',    icon: <ApiOutlined /> },
  { key: 'features',    label: 'Features',    icon: <BranchesOutlined /> },
  { key: 'security',    label: 'Security',    icon: <SafetyOutlined /> },
];

// ── Main Page ─────────────────────────────────────────────────────────────────

export function DataStoreDetailsPage() {
  const { storeId: id } = useParams<{ storeId: string }>();
  const navigate = useNavigate();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [activeTab, setActiveTab] = useState<TabKey>('overview');

  const { store, relationships, loading, error, refetch } = useDataStoreDetail(id ?? '');

  useEffect(() => {
    refetch();
  }, [id]);

  const border = dk(isDark, T.stone200, D.border);
  const bg = dk(isDark, T.white, D.bg);
  const bgCard = dk(isDark, T.stone50, D.bgCard);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
        <LoadingOutlined style={{ fontSize: 32, color: T.orange }} />
      </div>
    );
  }

  if (error || !store) {
    return (
      <div style={{ padding: 32, color: T.red }}>
        {error ?? 'Data store not found'}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: bg }}>
      {/* Header / breadcrumb */}
      <div style={{
        padding: '14px 24px', borderBottom: `1px solid ${border}`,
        display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
      }}>
        <button
          onClick={() => navigate('/knowledge-base/data-stores')}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: dk(isDark, T.stone400, D.textFaint), fontSize: 14, padding: 0, display: 'flex' }}
        >
          <ArrowLeftOutlined />
        </button>
        <DatabaseOutlined style={{ color: T.orange, fontSize: 16 }} />
        <span style={{ fontSize: 15, fontWeight: 700, color: dk(isDark, T.stone900, D.text) }}>{store.name}</span>
        {store.technology && (
          <span style={{
            fontSize: 11, fontFamily: 'monospace',
            color: dk(isDark, T.stone500, D.textMuted),
            background: dk(isDark, T.stone100, D.bgSub),
            padding: '2px 7px', borderRadius: 5,
          }}>
            {store.technology}
          </span>
        )}
        <ClassificationPill value={store.dataClassification} isDark={isDark} />
      </div>

      {/* Two-column body */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Left — graph */}
        <div style={{
          width: '40%', minWidth: 320, flexShrink: 0,
          borderRight: `1px solid ${border}`,
          display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ padding: '10px 16px 6px', borderBottom: `1px solid ${border}`, flexShrink: 0 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: dk(isDark, T.stone400, D.textFaint) }}>
              Relationship Graph
            </span>
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            {relationships && (
              <AssetRelationshipGraph
                graph={relationships.graph ?? { nodes: [], edges: [] }}
              />
            )}
          </div>
        </div>

        {/* Right — tabs */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Tab bar */}
          <div style={{
            display: 'flex', borderBottom: `1px solid ${border}`, flexShrink: 0,
            padding: '0 16px', overflowX: 'auto',
          }}>
            {TABS.map(tab => {
              const active = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '10px 14px', border: 'none', background: 'none', cursor: 'pointer',
                    fontSize: 12, fontWeight: active ? 700 : 400,
                    color: active ? T.orange : dk(isDark, T.stone500, D.textMuted),
                    borderBottom: active ? `2px solid ${T.orange}` : '2px solid transparent',
                    marginBottom: -1, whiteSpace: 'nowrap', transition: 'color 0.15s',
                  }}
                >
                  {tab.icon} {tab.label}
                </button>
              );
            })}
          </div>

          {/* Tab content */}
          <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
            {activeTab === 'overview' && <OverviewTab store={store} isDark={isDark} bg={bg} bgCard={bgCard} border={border} />}
            {activeTab === 'data-types' && <DataTypesTab store={store} isDark={isDark} bg={bg} bgCard={bgCard} border={border} />}
            {activeTab === 'services' && <ServicesTab store={store} isDark={isDark} bg={bg} bgCard={bgCard} border={border} />}
            {activeTab === 'features' && <FeaturesTab store={store} isDark={isDark} navigate={navigate} />}
            {activeTab === 'security' && <SecurityTab store={store} isDark={isDark} bg={bg} bgCard={bgCard} border={border} />}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Tab Components ────────────────────────────────────────────────────────────

function OverviewTab({ store, isDark, bgCard, border }: { store: any; isDark: boolean; bg?: string; bgCard: string; border: string }) {
  const row = (label: string, value: React.ReactNode) => (
    <div style={{ display: 'flex', gap: 12, padding: '8px 0', borderBottom: `1px solid ${border}` }}>
      <div style={{ width: 130, flexShrink: 0, fontSize: 11, fontWeight: 600, color: dk(isDark, T.stone400, D.textFaint), textTransform: 'uppercase', letterSpacing: '0.05em', paddingTop: 1 }}>
        {label}
      </div>
      <div style={{ fontSize: 13, color: dk(isDark, T.stone700, D.text) }}>{value}</div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {store.responsibility && (
        <div style={{ background: bgCard, border: `1px solid ${border}`, borderRadius: 10, padding: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: dk(isDark, T.stone400, D.textFaint), marginBottom: 6 }}>Responsibility</div>
          <p style={{ margin: 0, fontSize: 13, color: dk(isDark, T.stone700, D.text), lineHeight: 1.6 }}>{store.responsibility}</p>
        </div>
      )}
      <div style={{ background: bgCard, border: `1px solid ${border}`, borderRadius: 10, padding: 14 }}>
        {row('Store Type', <span style={{ fontSize: 12, fontWeight: 500, textTransform: 'capitalize' }}>{store.storeType?.replace('_', ' ')}</span>)}
        {row('Technology', store.technology ? <code style={{ fontSize: 12 }}>{store.technology}</code> : '—')}
        {row('Classification', <ClassificationPill value={store.dataClassification} isDark={isDark} />)}
        {row('Encryption', <EncryptionBadge atRest={store.encryptionAtRest} inTransit={store.encryptionInTransit} isDark={isDark} />)}
        {store.cloudResourceName && row('Cloud Resource', (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <CloudOutlined style={{ color: T.blue }} /> {store.cloudResourceName}
          </span>
        ))}
        {store.lastIndexedAt && row('Last Indexed', <span style={{ fontSize: 12 }}>{new Date(store.lastIndexedAt).toLocaleString()}</span>)}
      </div>
    </div>
  );
}

function DataTypesTab({ store, isDark, bgCard, border }: { store: any; isDark: boolean; bg?: string; bgCard: string; border: string }) {
  if (!store.dataTypes?.length) {
    return <div style={{ color: dk(isDark, T.stone400, D.textFaint), fontSize: 13 }}>No data types recorded.</div>;
  }

  // Build a map: dataType → services that use it
  const dtServiceMap = new Map<string, Set<string>>();
  for (const dt of store.dataTypes) {
    dtServiceMap.set(dt, new Set());
  }
  for (const sa of (store.serviceAccess ?? []) as DataStoreServiceAccess[]) {
    for (const dt of sa.dataTypes) {
      if (dtServiceMap.has(dt)) dtServiceMap.get(dt)!.add(sa.serviceName);
    }
  }

  return (
    <div style={{ background: bgCard, border: `1px solid ${border}`, borderRadius: 10, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${border}` }}>
            {['Data Type', 'Services'].map((h, i) => (
              <th key={i} style={{ padding: '8px 14px', textAlign: 'left', fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: dk(isDark, T.stone400, D.textFaint) }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from(dtServiceMap).map(([dt, svcs]) => (
            <tr key={dt} style={{ borderBottom: `1px solid ${border}` }}>
              <td style={{ padding: '9px 14px' }}>
                <code style={{ fontSize: 12, color: dk(isDark, T.stone700, D.text) }}>{dt}</code>
              </td>
              <td style={{ padding: '9px 14px' }}>
                {svcs.size > 0
                  ? Array.from(svcs).map(s => (
                    <span key={s} style={{ display: 'inline-block', marginRight: 6, marginBottom: 2, fontSize: 11, background: dk(isDark, T.stone100, D.bgSub), color: dk(isDark, T.stone600, D.textMuted), padding: '1px 6px', borderRadius: 4 }}>{s}</span>
                  ))
                  : <span style={{ color: dk(isDark, T.stone300, D.textFaint), fontSize: 11 }}>—</span>
                }
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ServicesTab({ store, isDark, bgCard, border }: { store: any; isDark: boolean; bg?: string; bgCard: string; border: string }) {
  const accesses: DataStoreServiceAccess[] = store.serviceAccess ?? [];
  if (!accesses.length) {
    return <div style={{ color: dk(isDark, T.stone400, D.textFaint), fontSize: 13 }}>No services access this data store.</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {accesses.map(sa => (
        <div key={sa.serviceId} style={{ background: bgCard, border: `1px solid ${border}`, borderRadius: 10, padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <ApiOutlined style={{ color: T.orange }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: dk(isDark, T.stone800, D.text) }}>{sa.serviceName}</span>
            <AccessPatternBadge pattern={sa.accessPattern} isDark={isDark} />
            <EvidenceBadge evidence={sa.evidence} isDark={isDark} />
          </div>
          {sa.dataTypes.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: dk(isDark, T.stone400, D.textFaint), marginRight: 8 }}>Data Types</span>
              {sa.dataTypes.map(dt => (
                <span key={dt} style={{ display: 'inline-block', marginRight: 5, marginBottom: 2, fontSize: 11, background: dk(isDark, T.stone100, D.bgSub), color: dk(isDark, T.stone600, D.textMuted), padding: '1px 6px', borderRadius: 4 }}>{dt}</span>
              ))}
            </div>
          )}
          {sa.resourceNames && sa.resourceNames.length > 0 && (
            <div>
              <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: dk(isDark, T.stone400, D.textFaint), marginRight: 8 }}>Tables / Buckets</span>
              {sa.resourceNames.map(r => (
                <span key={r} style={{ display: 'inline-block', marginRight: 5, marginBottom: 2, fontSize: 11, fontFamily: 'monospace', background: dk(isDark, T.stone100, D.bgSub), color: dk(isDark, T.stone600, D.textMuted), padding: '1px 6px', borderRadius: 4 }}>{r}</span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function FeaturesTab({ store, isDark, navigate }: { store: any; isDark: boolean; navigate: (path: string) => void }) {
  const featureIds: string[] = store.featureIds ?? [];
  const featureNames: string[] = store.featureNames ?? [];

  if (!featureIds.length) {
    return <div style={{ color: dk(isDark, T.stone400, D.textFaint), fontSize: 13 }}>No features reference this data store.</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {featureIds.map((fid, i) => (
        <div
          key={fid}
          onClick={() => navigate(`/knowledge-base/features/${encodeURIComponent(fid)}`)}
          style={{
            padding: '12px 14px', borderRadius: 10,
            border: `1px solid ${dk(isDark, T.stone200, D.border)}`,
            background: dk(isDark, T.stone50, D.bgCard),
            cursor: 'pointer', transition: 'background 0.1s',
            display: 'flex', alignItems: 'center', gap: 10,
          }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = dk(isDark, T.stone100, D.bgHover)}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = dk(isDark, T.stone50, D.bgCard)}
        >
          <BranchesOutlined style={{ color: T.orange }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: dk(isDark, T.stone800, D.text) }}>
            {featureNames[i] ?? fid}
          </span>
        </div>
      ))}
    </div>
  );
}

function SecurityTab({ store, isDark, bgCard, border }: { store: any; isDark: boolean; bg?: string; bgCard: string; border: string }) {
  const row = (label: string, value: React.ReactNode) => (
    <div style={{ display: 'flex', gap: 12, padding: '8px 0', borderBottom: `1px solid ${border}` }}>
      <div style={{ width: 140, flexShrink: 0, fontSize: 11, fontWeight: 600, color: dk(isDark, T.stone400, D.textFaint), textTransform: 'uppercase', letterSpacing: '0.05em', paddingTop: 1 }}>{label}</div>
      <div style={{ fontSize: 13, color: dk(isDark, T.stone700, D.text) }}>{value}</div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ background: bgCard, border: `1px solid ${border}`, borderRadius: 10, padding: 14 }}>
        {row('Classification', <ClassificationPill value={store.dataClassification} isDark={isDark} />)}
        {row('Encryption', <EncryptionBadge atRest={store.encryptionAtRest} inTransit={store.encryptionInTransit} isDark={isDark} />)}
        {row('At Rest', (
          <span style={{ fontSize: 12, color: store.encryptionAtRest ? T.green : dk(isDark, T.stone400, D.textFaint) }}>
            {store.encryptionAtRest ? '✓ Encrypted' : '✗ Not confirmed'}
          </span>
        ))}
        {row('In Transit', (
          <span style={{ fontSize: 12, color: store.encryptionInTransit ? T.green : dk(isDark, T.stone400, D.textFaint) }}>
            {store.encryptionInTransit ? '✓ Encrypted' : '✗ Not confirmed'}
          </span>
        ))}
      </div>

      {store.dataClassification === 'restricted' || store.dataClassification === 'confidential' ? (
        <div style={{ background: T.redLight, border: `1px solid ${T.redBorder}`, borderRadius: 10, padding: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: T.red, marginBottom: 4 }}>⚠ High-sensitivity data store</div>
          <div style={{ fontSize: 12, color: T.red, lineHeight: 1.5 }}>
            This store is classified as <strong>{store.dataClassification}</strong>. Verify that access is restricted to authorised services only, that data is encrypted at rest and in transit, and that audit logging is enabled.
          </div>
        </div>
      ) : null}
    </div>
  );
}
