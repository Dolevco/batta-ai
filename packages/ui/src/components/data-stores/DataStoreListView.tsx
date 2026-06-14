import { useState, useEffect } from 'react';
import {
  DatabaseOutlined,
  CloudOutlined,
  LockOutlined,
  UnlockOutlined,
  LoadingOutlined,
  SearchOutlined,
  FilterOutlined,
  ClusterOutlined,
  ThunderboltOutlined,
  InboxOutlined,
} from '@ant-design/icons';
import { Input, Select } from 'antd';
import { useTheme } from '../../hooks/useTheme';
import { useDataStores } from '../../hooks/useDataStores';
import { T, D, dk } from '../../theme';
import type { DataStoreSummary } from '../../types/';

// ── Helpers ───────────────────────────────────────────────────────────────────

const STORE_TYPE_ICONS: Record<string, React.ReactNode> = {
  database:     <DatabaseOutlined />,
  cache:        <ThunderboltOutlined />,
  blob_storage: <CloudOutlined />,
  queue:        <ClusterOutlined />,
  file_system:  <InboxOutlined />,
  other:        <DatabaseOutlined />,
};

const STORE_TYPE_LABELS: Record<string, string> = {
  database:     'Database',
  cache:        'Cache',
  blob_storage: 'Blob Storage',
  queue:        'Queue',
  file_system:  'File System',
  other:        'Other',
};

const CLASSIFICATION_COLORS: Record<string, { color: string; bg: string }> = {
  restricted:   { color: T.red,    bg: T.redLight },
  confidential: { color: '#7C3AED', bg: '#F5F3FF' },
  internal:     { color: T.amber,   bg: T.amberLight },
  public:       { color: T.green,   bg: T.greenLight },
};

function ClassificationPill({ value, isDark }: { value?: string; isDark: boolean }) {
  if (!value) return <span style={{ color: dk(isDark, T.stone400, D.textFaint), fontSize: 12 }}>—</span>;
  const cfg = CLASSIFICATION_COLORS[value] ?? { color: T.stone500, bg: T.stone100 };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 99,
      fontSize: 11, fontWeight: 600,
      color: cfg.color, background: cfg.bg,
    }}>
      {value.charAt(0).toUpperCase() + value.slice(1)}
    </span>
  );
}

function EncryptionIcon({ atRest, inTransit, isDark }: { atRest?: boolean; inTransit?: boolean; isDark: boolean }) {
  if (atRest && inTransit) return <LockOutlined style={{ color: T.green, fontSize: 14 }} title="Encrypted at rest & in transit" />;
  if (atRest || inTransit) return <LockOutlined style={{ color: T.amber, fontSize: 14 }} title="Partially encrypted" />;
  return <UnlockOutlined style={{ color: dk(isDark, T.stone300, D.textFaint), fontSize: 14 }} title="Not encrypted" />;
}

function StoreTypeBadge({ storeType, isDark }: { storeType: string; isDark: boolean }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '2px 8px', borderRadius: 6,
      fontSize: 11, fontWeight: 500,
      color: dk(isDark, T.stone600, D.textMuted),
      background: dk(isDark, T.stone100, D.bgSub),
    }}>
      <span style={{ fontSize: 10 }}>{STORE_TYPE_ICONS[storeType] ?? <DatabaseOutlined />}</span>
      {STORE_TYPE_LABELS[storeType] ?? storeType}
    </span>
  );
}

function CountBadge({ count, label, isDark }: { count: number; label: string; isDark: boolean }) {
  return (
    <span
      title={label}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        minWidth: 22, height: 20, borderRadius: 99,
        fontSize: 10, fontWeight: 700,
        color: count > 0 ? T.orange : dk(isDark, T.stone400, D.textFaint),
        background: count > 0 ? T.orangeLight : dk(isDark, T.stone100, D.bgCard),
        padding: '0 6px',
      }}
    >
      {count}
    </span>
  );
}

function EmptyDataStores({ isDark }: { isDark: boolean }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 16, padding: '80px 0',
    }}>
      <DatabaseOutlined style={{ fontSize: 40, color: dk(isDark, T.stone300, D.textFaint) }} />
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: dk(isDark, T.stone800, D.text), marginBottom: 6 }}>No data stores indexed yet</div>
        <div style={{ fontSize: 13, color: dk(isDark, T.stone400, D.textMuted), maxWidth: 360, lineHeight: 1.6 }}>
          Run a scan to discover and index your organisation&apos;s databases, caches, blob storage, queues, and file systems.
        </div>
      </div>
    </div>
  );
}

// ── Table ─────────────────────────────────────────────────────────────────────

function DataStoresTable({ stores, isDark, onSelect }: {
  stores: DataStoreSummary[];
  isDark: boolean;
  onSelect: (id: string) => void;
}) {
  const rowHoverBg = isDark ? D.bgHover : T.stone50;

  if (stores.length === 0) {
    return (
      <div style={{ padding: '48px 0', textAlign: 'center', fontSize: 13, color: dk(isDark, T.stone300, D.textFaint) }}>
        No data stores match your filters.
      </div>
    );
  }

  return (
    <div style={{
      background: dk(isDark, T.white, D.bgCard),
      border: `1px solid ${dk(isDark, T.stone200, D.border)}`,
      borderRadius: 16, overflow: 'hidden',
      boxShadow: isDark ? 'none' : '0 1px 3px rgba(28,25,23,0.04)',
    }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${dk(isDark, T.stone100, D.border)}` }}>
            {['Name', 'Type', 'Technology', 'Classification', 'Encrypted', 'Services', 'Features', 'Cloud Resource'].map((col, i) => (
              <th key={i} style={{
                padding: '10px 14px', textAlign: 'left',
                fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase',
                color: dk(isDark, T.stone400, D.textFaint), whiteSpace: 'nowrap',
              }}>
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {stores.map(store => (
            <tr
              key={store.id}
              onClick={() => onSelect(store.id)}
              style={{ borderBottom: `1px solid ${dk(isDark, T.stone50, D.border)}`, cursor: 'pointer', transition: 'background 0.1s' }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = rowHoverBg}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}
            >
              <td style={{ padding: '12px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: T.orange, fontSize: 15 }}>
                    {STORE_TYPE_ICONS[store.storeType] ?? <DatabaseOutlined />}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: dk(isDark, T.stone800, D.text) }}>{store.name}</span>
                </div>
                {store.responsibility && (
                  <div style={{
                    fontSize: 11, color: dk(isDark, T.stone400, D.textFaint),
                    marginTop: 2, maxWidth: 260,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {store.responsibility}
                  </div>
                )}
              </td>
              <td style={{ padding: '12px 14px' }}>
                <StoreTypeBadge storeType={store.storeType} isDark={isDark} />
              </td>
              <td style={{ padding: '12px 14px' }}>
                {store.technology ? (
                  <span style={{
                    fontSize: 11, fontFamily: 'monospace', fontWeight: 500,
                    color: dk(isDark, T.stone600, D.textMuted),
                    background: dk(isDark, T.stone100, D.bgSub),
                    padding: '2px 6px', borderRadius: 4,
                  }}>
                    {store.technology}
                  </span>
                ) : <span style={{ color: dk(isDark, T.stone300, D.textFaint), fontSize: 12 }}>—</span>}
              </td>
              <td style={{ padding: '12px 14px' }}>
                <ClassificationPill value={store.dataClassification} isDark={isDark} />
              </td>
              <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                <EncryptionIcon atRest={store.encryptionAtRest} isDark={isDark} />
              </td>
              <td style={{ padding: '12px 14px' }}>
                <CountBadge count={store.serviceCount} label={`${store.serviceCount} services`} isDark={isDark} />
              </td>
              <td style={{ padding: '12px 14px' }}>
                <CountBadge count={store.featureCount} label={`${store.featureCount} features`} isDark={isDark} />
              </td>
              <td style={{ padding: '12px 14px' }}>
                {store.cloudResourceName ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: dk(isDark, T.stone600, D.textMuted) }}>
                    <CloudOutlined style={{ color: T.blue, fontSize: 12 }} />
                    {store.cloudResourceName}
                  </span>
                ) : <span style={{ color: dk(isDark, T.stone300, D.textFaint), fontSize: 12 }}>—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function DataStoreListView({ onSelect }: { onSelect: (id: string) => void }) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const { stores: allStores, loading, error, fetchStores } = useDataStores();

  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<string>('');
  const [filterClass, setFilterClass] = useState<string>('');

  useEffect(() => {
    fetchStores().catch(() => {});
  }, []);

  const filtered = allStores.filter(s => {
    if (search && !s.name.toLowerCase().includes(search.toLowerCase()) && !(s.technology ?? '').toLowerCase().includes(search.toLowerCase())) return false;
    if (filterType && s.storeType !== filterType) return false;
    if (filterClass && s.dataClassification !== filterClass) return false;
    return true;
  });

  const types = [...new Set(allStores.map(s => s.storeType))];
  const classes = [...new Set(allStores.filter(s => s.dataClassification).map(s => s.dataClassification!))];

  const border = dk(isDark, T.stone100, D.border);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Filters bar */}
      {allStores.length > 0 && (
        <div style={{
          padding: '10px 0 12px',
          borderBottom: `1px solid ${border}`,
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          marginBottom: 16,
        }}>
          <Input
            prefix={<SearchOutlined style={{ color: dk(isDark, T.stone400, D.textFaint) }} />}
            placeholder="Search by name or technology…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: 240, borderRadius: 8 }}
            allowClear
          />
          <Select
            placeholder={<><FilterOutlined /> Type</>}
            value={filterType || undefined}
            onChange={v => setFilterType(v ?? '')}
            allowClear
            style={{ width: 140 }}
            options={types.map(t => ({ value: t, label: STORE_TYPE_LABELS[t] ?? t }))}
          />
          <Select
            placeholder={<><FilterOutlined /> Classification</>}
            value={filterClass || undefined}
            onChange={v => setFilterClass(v ?? '')}
            allowClear
            style={{ width: 170 }}
            options={classes.map(c => ({ value: c, label: c.charAt(0).toUpperCase() + c.slice(1) }))}
          />
          <span style={{ marginLeft: 'auto', fontSize: 12, color: dk(isDark, T.stone500, D.textMuted) }}>
            {filtered.length} of {allStores.length} stores
          </span>
        </div>
      )}

      {/* Content */}
      <div style={{ flex: 1 }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
            <LoadingOutlined style={{ fontSize: 28, color: T.orange }} />
          </div>
        ) : error ? (
          <div style={{ color: T.red, padding: 24 }}>{error}</div>
        ) : allStores.length === 0 ? (
          <EmptyDataStores isDark={isDark} />
        ) : (
          <DataStoresTable stores={filtered} isDark={isDark} onSelect={onSelect} />
        )}
      </div>
    </div>
  );
}
