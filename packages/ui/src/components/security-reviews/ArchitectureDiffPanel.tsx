/**
 * ArchitectureDiffPanel
 *
 * Renders the architecture diff (data flow + data classification) for one or
 * more linked features.  Changes are clearly flagged with colour-coded badges
 * and a summary banner so security reviewers can immediately see what the
 * feature added, removed, or modified in the threat model's architecture sections.
 */
import { theme as antdTheme, Tag, Space, Typography, Table, Tooltip, Alert, Badge, Empty, Tabs } from 'antd';
import {
  PlusCircleOutlined,
  MinusCircleOutlined,
  EditOutlined,
  CheckCircleOutlined,
  LockOutlined,
  UnlockOutlined,
  SafetyCertificateOutlined,
  WarningOutlined,
  MessageOutlined,
  ApartmentOutlined,
  TableOutlined,
} from '@ant-design/icons';
import type {
  ArchitectureDiff,
  DataFlowDiffEntry,
  DataClassificationDiffEntry,
} from '../../types/';
import { DfdDiffGraph } from './DfdDiffGraph';

const { Text } = Typography;

// ── Change type config ────────────────────────────────────────────────────────

type ChangeType = 'added' | 'removed' | 'changed' | 'unchanged';

const CHANGE_CONFIG: Record<ChangeType, {
  color: string;
  bgVar: string;
  bgVarDark: string;
  label: string;
  icon: React.ReactNode;
  antColor: string;
}> = {
  added:     { color: '#52c41a', bgVar: '#f6ffed', bgVarDark: 'rgba(82,196,26,0.1)',   label: 'Added',     icon: <PlusCircleOutlined />,   antColor: 'success' },
  removed:   { color: '#ff4d4f', bgVar: '#fff2f0', bgVarDark: 'rgba(255,77,79,0.1)',   label: 'Removed',   icon: <MinusCircleOutlined />,  antColor: 'error'   },
  changed:   { color: '#fa8c16', bgVar: '#fff7e6', bgVarDark: 'rgba(250,140,22,0.1)',  label: 'Changed',   icon: <EditOutlined />,         antColor: 'warning' },
  unchanged: { color: '#8c8c8c', bgVar: 'transparent', bgVarDark: 'transparent',       label: 'Unchanged', icon: <CheckCircleOutlined />, antColor: 'default' },
};

function ChangeTypeBadge({ changeType }: { changeType: ChangeType }) {
  const cfg = CHANGE_CONFIG[changeType];
  return (
    <Tag icon={cfg.icon} color={cfg.antColor} style={{ fontSize: 11 }}>
      {cfg.label}
    </Tag>
  );
}

// ── Data Flow diff table ──────────────────────────────────────────────────────

function renderDataTypes(dataTypes: string[]) {
  return (
    <Space size={4} wrap>
      {dataTypes.map(dt => (
        <Tag key={dt} style={{ fontSize: 11, marginBottom: 2 }}>{dt}</Tag>
      ))}
    </Space>
  );
}

function EncryptedBadge({ encrypted }: { encrypted: boolean }) {
  return encrypted
    ? <Tag icon={<LockOutlined />} color="green" style={{ fontSize: 11 }}>Encrypted</Tag>
    : <Tag icon={<UnlockOutlined />} color="red" style={{ fontSize: 11 }}>Unencrypted</Tag>;
}

function AuthBadge({ required }: { required: boolean }) {
  return required
    ? <Tag icon={<SafetyCertificateOutlined />} color="blue" style={{ fontSize: 11 }}>Auth Required</Tag>
    : <Tag color="default" style={{ fontSize: 11 }}>No Auth</Tag>;
}

/** Show inline diff for a single flow field that changed */
function FlowFieldDiff({
  label,
  baseline,
  updated,
}: {
  label: string;
  baseline: React.ReactNode;
  updated: React.ReactNode;
}) {
  const { token } = antdTheme.useToken();
  return (
    <div style={{ marginBottom: 4 }}>
      <Text type="secondary" style={{ fontSize: 11, marginRight: 4 }}>{label}:</Text>
      <span style={{ background: token.colorErrorBg, borderRadius: 3, padding: '1px 4px', marginRight: 4, textDecoration: 'line-through', opacity: 0.8 }}>
        {baseline}
      </span>
      <span style={{ fontSize: 11, marginRight: 4 }}>→</span>
      <span style={{ background: token.colorSuccessBg, borderRadius: 3, padding: '1px 4px' }}>
        {updated}
      </span>
    </div>
  );
}

function DataFlowDiffTable({ entries, isDarkMode }: { entries: DataFlowDiffEntry[]; isDarkMode: boolean }) {
  const { token } = antdTheme.useToken();
  const columns = [
    {
      title: 'Change',
      dataIndex: 'changeType',
      width: 100,
      render: (ct: ChangeType) => <ChangeTypeBadge changeType={ct} />,
      filters: [
        { text: 'Added', value: 'added' },
        { text: 'Removed', value: 'removed' },
        { text: 'Changed', value: 'changed' },
        { text: 'Unchanged', value: 'unchanged' },
      ],
      onFilter: (value: boolean | React.Key, record: DataFlowDiffEntry) => record.changeType === value,
      defaultFilteredValue: ['added', 'removed', 'changed'],
    },
    {
      title: 'From → To',
      key: 'route',
      width: '22%',
      render: (_: unknown, record: DataFlowDiffEntry) => {
        const entry = record.updated ?? record.baseline!;
        return (
          <Space direction="vertical" size={2}>
            <Text strong style={{ fontSize: 12 }}>{entry.from}</Text>
            <Text type="secondary" style={{ fontSize: 11 }}>→ {entry.to}</Text>
          </Space>
        );
      },
    },
    {
      title: 'Protocol',
      key: 'protocol',
      width: 100,
      render: (_: unknown, record: DataFlowDiffEntry) => {
        const entry = record.updated ?? record.baseline!;
        const changed = record.changeType === 'changed' &&
          record.baseline?.protocol !== record.updated?.protocol;
        if (changed) {
          return (
            <Space direction="vertical" size={2}>
              <Text delete style={{ fontSize: 11, color: token.colorError }}>{record.baseline!.protocol}</Text>
              <Tag color="success" style={{ fontSize: 11 }}>{record.updated!.protocol}</Tag>
            </Space>
          );
        }
        return <Tag style={{ fontSize: 11 }}>{entry.protocol}</Tag>;
      },
    },
    {
      title: 'Data Types',
      key: 'dataTypes',
      render: (_: unknown, record: DataFlowDiffEntry) => {
        if (record.changeType === 'changed') {
          const bTypes = new Set(record.baseline?.dataTypes ?? []);
          const uTypes = new Set(record.updated?.dataTypes ?? []);
          const allTypes = new Set([...bTypes, ...uTypes]);
          return (
            <Space size={4} wrap>
              {[...allTypes].map(dt => {
                const wasHere = bTypes.has(dt);
                const isHere = uTypes.has(dt);
                if (wasHere && isHere) return <Tag key={dt} style={{ fontSize: 11 }}>{dt}</Tag>;
                if (!wasHere && isHere) return <Tag key={dt} color="success" icon={<PlusCircleOutlined />} style={{ fontSize: 11 }}>{dt}</Tag>;
                return <Tag key={dt} color="error" icon={<MinusCircleOutlined />} style={{ fontSize: 11, textDecoration: 'line-through' }}>{dt}</Tag>;
              })}
            </Space>
          );
        }
        const entry = record.updated ?? record.baseline!;
        return renderDataTypes(entry.dataTypes);
      },
    },
    {
      title: 'Security',
      key: 'security',
      width: 200,
      render: (_: unknown, record: DataFlowDiffEntry) => {
        const entry = record.updated ?? record.baseline!;
        const encChanged = record.changeType === 'changed' &&
          record.baseline?.encrypted !== record.updated?.encrypted;
        const authChanged = record.changeType === 'changed' &&
          record.baseline?.authRequired !== record.updated?.authRequired;

        return (
          <Space direction="vertical" size={4}>
            {encChanged ? (
              <FlowFieldDiff
                label="Encryption"
                baseline={<EncryptedBadge encrypted={record.baseline!.encrypted} />}
                updated={<EncryptedBadge encrypted={record.updated!.encrypted} />}
              />
            ) : (
              <EncryptedBadge encrypted={entry.encrypted} />
            )}
            {authChanged ? (
              <FlowFieldDiff
                label="Auth"
                baseline={<AuthBadge required={record.baseline!.authRequired} />}
                updated={<AuthBadge required={record.updated!.authRequired} />}
              />
            ) : (
              <AuthBadge required={entry.authRequired} />
            )}
          </Space>
        );
      },
    },
  ];

  return (
    <Table
      columns={columns}
      dataSource={entries}
      rowKey={(r) => {
        const e = r.updated ?? r.baseline!;
        return `${e.from}|${e.to}|${e.protocol}`;
      }}
      pagination={false}
      size="small"
      bordered
      rowClassName={(record: DataFlowDiffEntry) => {
        if (record.changeType === 'unchanged') return '';
        return `arch-diff-row-${record.changeType}`;
      }}
      onRow={(record: DataFlowDiffEntry) => ({
        style: {
          background: record.changeType !== 'unchanged'
            ? (isDarkMode ? CHANGE_CONFIG[record.changeType].bgVarDark : CHANGE_CONFIG[record.changeType].bgVar)
            : undefined,
        },
      })}
    />
  );
}

// ── Data Classification diff table ───────────────────────────────────────────

const CLASSIFICATION_COLOR: Record<string, string> = {
  public: 'green',
  internal: 'blue',
  confidential: 'orange',
  restricted: 'red',
};

function ClassificationTag({ classification }: { classification: string }) {
  return (
    <Tag color={CLASSIFICATION_COLOR[classification.toLowerCase()] ?? 'default'} style={{ fontSize: 11 }}>
      {classification.toUpperCase()}
    </Tag>
  );
}

function DataClassificationDiffTable({ entries, isDarkMode }: { entries: DataClassificationDiffEntry[]; isDarkMode: boolean }) {
  const { token } = antdTheme.useToken();

  const columns = [
    {
      title: 'Change',
      dataIndex: 'changeType',
      width: 100,
      render: (ct: ChangeType) => <ChangeTypeBadge changeType={ct} />,
      filters: [
        { text: 'Added', value: 'added' },
        { text: 'Removed', value: 'removed' },
        { text: 'Changed', value: 'changed' },
        { text: 'Unchanged', value: 'unchanged' },
      ],
      onFilter: (value: boolean | React.Key, record: DataClassificationDiffEntry) => record.changeType === value,
      defaultFilteredValue: ['added', 'removed', 'changed'],
    },
    {
      title: 'Classification',
      key: 'classification',
      width: 140,
      render: (_: unknown, record: DataClassificationDiffEntry) => {
        const entry = record.updated ?? record.baseline!;
        return <ClassificationTag classification={entry.classification} />;
      },
    },
    {
      title: 'Data Types',
      key: 'dataTypes',
      render: (_: unknown, record: DataClassificationDiffEntry) => {
        if (record.changeType === 'changed') {
          const bTypes = new Set(record.baseline?.dataTypes ?? []);
          const uTypes = new Set(record.updated?.dataTypes ?? []);
          const allTypes = new Set([...bTypes, ...uTypes]);
          return (
            <Space size={4} wrap>
              {[...allTypes].map(dt => {
                const wasHere = bTypes.has(dt);
                const isHere = uTypes.has(dt);
                if (wasHere && isHere) return <Tag key={dt} style={{ fontSize: 11 }}>{dt}</Tag>;
                if (!wasHere && isHere) return <Tag key={dt} color="success" icon={<PlusCircleOutlined />} style={{ fontSize: 11 }}>{dt}</Tag>;
                return <Tag key={dt} color="error" icon={<MinusCircleOutlined />} style={{ fontSize: 11, textDecoration: 'line-through' }}>{dt}</Tag>;
              })}
            </Space>
          );
        }
        const entry = record.updated ?? record.baseline!;
        return renderDataTypes(entry.dataTypes);
      },
    },
    {
      title: 'Protection Mechanisms',
      key: 'mechanisms',
      render: (_: unknown, record: DataClassificationDiffEntry) => {
        if (record.changeType === 'changed') {
          const bMechs = new Set(record.baseline?.protectionMechanisms ?? []);
          const uMechs = new Set(record.updated?.protectionMechanisms ?? []);
          const all = new Set([...bMechs, ...uMechs]);
          return (
            <Space direction="vertical" size={2}>
              {[...all].map(m => {
                const wasHere = bMechs.has(m);
                const isHere = uMechs.has(m);
                if (wasHere && isHere) return <Text key={m} style={{ fontSize: 12 }}>• {m}</Text>;
                if (!wasHere && isHere) return (
                  <Text key={m} style={{ fontSize: 12, color: token.colorSuccess }}>
                    <PlusCircleOutlined style={{ marginRight: 4 }} />+ {m}
                  </Text>
                );
                return (
                  <Text key={m} delete style={{ fontSize: 12, color: token.colorError }}>
                    • {m}
                  </Text>
                );
              })}
            </Space>
          );
        }
        const entry = record.updated ?? record.baseline!;
        return (
          <Space direction="vertical" size={2}>
            {entry.protectionMechanisms.map(m => (
              <Text key={m} style={{ fontSize: 12 }}>• {m}</Text>
            ))}
          </Space>
        );
      },
    },
  ];

  return (
    <Table
      columns={columns}
      dataSource={entries}
      rowKey={(r) => (r.updated ?? r.baseline!).classification}
      pagination={false}
      size="small"
      bordered
      onRow={(record: DataClassificationDiffEntry) => ({
        style: {
          background: record.changeType !== 'unchanged'
            ? (isDarkMode ? CHANGE_CONFIG[record.changeType].bgVarDark : CHANGE_CONFIG[record.changeType].bgVar)
            : undefined,
        },
      })}
    />
  );
}

// ── Single feature diff block (table view only) ───────────────────────────────

function FeatureDiffBlock({ diff }: { diff: ArchitectureDiff }) {
  const { token } = antdTheme.useToken();
  const isDarkMode = token.colorBgBase === '#000' || token.colorBgContainer === '#141414';

  const flowChanges = diff.dataFlowDiff.filter(d => d.changeType !== 'unchanged');
  const classChanges = diff.dataClassificationDiff.filter(d => d.changeType !== 'unchanged');
  const totalChanges = flowChanges.length + classChanges.length;

  const addedCount = diff.dataFlowDiff.filter(d => d.changeType === 'added').length +
    diff.dataClassificationDiff.filter(d => d.changeType === 'added').length;
  const removedCount = diff.dataFlowDiff.filter(d => d.changeType === 'removed').length +
    diff.dataClassificationDiff.filter(d => d.changeType === 'removed').length;
  const changedCount = diff.dataFlowDiff.filter(d => d.changeType === 'changed').length +
    diff.dataClassificationDiff.filter(d => d.changeType === 'changed').length;

  return (
    <div style={{
      border: `1px solid ${diff.hasChanges ? token.colorWarningBorder : token.colorBorderSecondary}`,
      borderRadius: 8,
      overflow: 'hidden',
      marginBottom: 16,
    }}>
      {/* Feature header */}
      <div style={{
        background: diff.hasChanges ? token.colorWarningBg : token.colorBgContainerDisabled,
        padding: '10px 16px',
        borderBottom: `1px solid ${diff.hasChanges ? token.colorWarningBorder : token.colorBorderSecondary}`,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 8,
      }}>
        <Space size={8}>
          {diff.hasChanges
            ? <WarningOutlined style={{ color: token.colorWarning }} />
            : <CheckCircleOutlined style={{ color: token.colorSuccess }} />}
          <Text strong style={{ fontSize: 14 }}>{diff.featureName}</Text>
        </Space>
        <Space size={6} wrap>
          {addedCount > 0 && <Tag icon={<PlusCircleOutlined />} color="success" style={{ fontSize: 11 }}>{addedCount} added</Tag>}
          {removedCount > 0 && <Tag icon={<MinusCircleOutlined />} color="error" style={{ fontSize: 11 }}>{removedCount} removed</Tag>}
          {changedCount > 0 && <Tag icon={<EditOutlined />} color="warning" style={{ fontSize: 11 }}>{changedCount} changed</Tag>}
          {totalChanges === 0 && <Tag icon={<CheckCircleOutlined />} color="default" style={{ fontSize: 11 }}>No architecture changes</Tag>}
        </Space>
      </div>

      <div style={{ padding: 16 }}>
        {diff.dfdChangeRationale && (
          <Alert
            icon={<MessageOutlined />}
            showIcon
            type="info"
            style={{ marginBottom: 16, fontSize: 13 }}
            message={<Text strong style={{ fontSize: 13 }}>Agent Rationale</Text>}
            description={<Text style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{diff.dfdChangeRationale}</Text>}
          />
        )}

        {/* Data Flow */}
        <div style={{ marginBottom: 20 }}>
          <Space style={{ marginBottom: 8 }}>
            <Text strong style={{ fontSize: 13 }}>Data Flow Summary</Text>
            <Badge count={flowChanges.length} style={{ backgroundColor: flowChanges.length > 0 ? token.colorWarning : token.colorSuccess }} />
          </Space>
          {diff.dataFlowDiff.length > 0
            ? <DataFlowDiffTable entries={diff.dataFlowDiff} isDarkMode={isDarkMode} />
            : <Empty description="No data flow entries" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
        </div>

        {/* Data Classification */}
        <div>
          <Space style={{ marginBottom: 8 }}>
            <Text strong style={{ fontSize: 13 }}>Data Classification</Text>
            <Badge count={classChanges.length} style={{ backgroundColor: classChanges.length > 0 ? token.colorWarning : token.colorSuccess }} />
          </Space>
          {diff.dataClassificationDiff.length > 0
            ? <DataClassificationDiffTable entries={diff.dataClassificationDiff} isDarkMode={isDarkMode} />
            : <Empty description="No data classification entries" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
        </div>
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

interface ArchitectureDiffPanelProps {
  diffs: ArchitectureDiff[];
  /** Optional baseline content rendered at the top of the Table tab */
  baseline?: React.ReactNode;
}

export function ArchitectureDiffPanel({ diffs, baseline }: ArchitectureDiffPanelProps) {
  const { token } = antdTheme.useToken();

  if (!diffs || diffs.length === 0) {
    return (
      <Empty
        description="No architecture diff available"
        image={Empty.PRESENTED_IMAGE_SIMPLE}
      />
    );
  }

  const anyChanges = diffs.some(d => d.hasChanges);
  const totalFlowChanges = diffs.reduce(
    (sum, d) => sum + d.dataFlowDiff.filter(f => f.changeType !== 'unchanged').length, 0
  );
  const totalClassChanges = diffs.reduce(
    (sum, d) => sum + d.dataClassificationDiff.filter(c => c.changeType !== 'unchanged').length, 0
  );

  // Security-impacting changes: encryption removed or auth removed
  const securityRegressions: string[] = [];
  for (const diff of diffs) {
    for (const entry of diff.dataFlowDiff) {
      if (entry.changeType === 'changed') {
        if (entry.baseline?.encrypted && !entry.updated?.encrypted) {
          securityRegressions.push(`${diff.featureName}: ${entry.updated?.from} → ${entry.updated?.to} lost encryption`);
        }
        if (entry.baseline?.authRequired && !entry.updated?.authRequired) {
          securityRegressions.push(`${diff.featureName}: ${entry.updated?.from} → ${entry.updated?.to} lost auth requirement`);
        }
      }
      if (entry.changeType === 'removed') {
        // A removed flow that was encrypted/auth-required should be noted
      }
    }
  }

  const summaryBanner = anyChanges ? (
    <Alert
      type="warning"
      icon={<WarningOutlined />}
      showIcon
      message={
        <Space size={8} wrap>
          <Text strong>Architecture changes detected</Text>
          {totalFlowChanges > 0 && <Tag color="warning">{totalFlowChanges} data flow change{totalFlowChanges !== 1 ? 's' : ''}</Tag>}
          {totalClassChanges > 0 && <Tag color="orange">{totalClassChanges} classification change{totalClassChanges !== 1 ? 's' : ''}</Tag>}
        </Space>
      }
      description={
        securityRegressions.length > 0 ? (
          <Space direction="vertical" size={4} style={{ marginTop: 4 }}>
            <Text strong style={{ color: token.colorError }}>⚠ Security regressions found:</Text>
            {securityRegressions.map((r, i) => (
              <Text key={i} style={{ fontSize: 12, color: token.colorError }}>• {r}</Text>
            ))}
          </Space>
        ) : 'Review the highlighted changes below to assess impact on the threat model.'
      }
    />
  ) : (
    <Alert
      type="success"
      icon={<CheckCircleOutlined />}
      showIcon
      message="No architecture changes"
      description="The agent reported that this feature did not change data flows or data classification."
    />
  );

  const tableLegend = (
    <Space size={12} wrap style={{ paddingLeft: 2 }}>
      <Text type="secondary" style={{ fontSize: 12 }}>Legend:</Text>
      {(Object.entries(CHANGE_CONFIG) as [ChangeType, typeof CHANGE_CONFIG[ChangeType]][])
        .filter(([ct]) => ct !== 'unchanged')
        .map(([ct, cfg]) => (
          <Tag key={ct} icon={cfg.icon} color={cfg.antColor} style={{ fontSize: 11 }}>{cfg.label}</Tag>
        ))}
      <Tooltip title="Unchanged entries are hidden by default. Use the column filter to show them.">
        <Tag color="default" style={{ fontSize: 11, cursor: 'help' }}>
          <CheckCircleOutlined /> Unchanged (filtered)
        </Tag>
      </Tooltip>
    </Space>
  );

  return (
    <Tabs
      size="small"
      items={[
        {
          key: 'table',
          label: <span><TableOutlined style={{ marginRight: 4 }} />Table</span>,
          children: (
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
              {summaryBanner}
              {tableLegend}
              {/* Architecture baseline */}
              {baseline}
              {/* Per-feature diff blocks */}
              {diffs.map(diff => (
                <FeatureDiffBlock key={diff.featureId} diff={diff} />
              ))}
            </Space>
          ),
        },
        {
          key: 'graph',
          label: <span><ApartmentOutlined style={{ marginRight: 4 }} />Graph</span>,
          children: (
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
              {summaryBanner}
              {diffs.map(diff => (
                <div key={diff.featureId}>
                  {diffs.length > 1 && (
                    <Text strong style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>{diff.featureName}</Text>
                  )}
                  {diff.dfdChangeRationale && (
                    <Alert
                      icon={<MessageOutlined />}
                      showIcon
                      type="info"
                      style={{ marginBottom: 12, fontSize: 13 }}
                      message={<Text strong style={{ fontSize: 13 }}>Agent Rationale</Text>}
                      description={<Text style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{diff.dfdChangeRationale}</Text>}
                    />
                  )}
                  <DfdDiffGraph diff={diff} height={460} />
                </div>
              ))}
            </Space>
          ),
        },
      ]}
    />
  );
}
