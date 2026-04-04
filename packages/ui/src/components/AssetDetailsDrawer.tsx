import { useState, useEffect } from 'react';
import { Drawer, Tabs, Descriptions, Tag, Space, Typography, Spin, Alert, Empty } from 'antd';
import { 
  SafetyOutlined, 
  ApartmentOutlined, 
  InfoCircleOutlined,
  WarningOutlined,
  LockOutlined,
  CloudOutlined,
  DatabaseOutlined,
  GlobalOutlined
} from '@ant-design/icons';
import { useAssets } from '../hooks';
import type { AssetDetail, RelationshipGraph } from '../types';
import { T } from '../theme';
import { RelationshipGraph as RelationshipGraphComponent } from './RelationshipGraph.tsx';

const { Title, Text } = Typography;

interface AssetDetailsDrawerProps {
  assetId: string | null;
  open: boolean;
  onClose: () => void;
}

export function AssetDetailsDrawer({ assetId, open, onClose }: AssetDetailsDrawerProps) {
  const [asset, setAsset] = useState<AssetDetail | null>(null);
  const [relationships, setRelationships] = useState<RelationshipGraph | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { getAssetById, getAssetRelationships } = useAssets();

  useEffect(() => {
    if (assetId && open) {
      loadAssetDetails();
      loadRelationships();
    }
  }, [assetId, open]);

  const loadAssetDetails = async () => {
    if (!assetId) return;
    
    setLoading(true);
    setError(null);
    try {
      const data = await getAssetById(assetId);
      setAsset(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load asset details');
    } finally {
      setLoading(false);
    }
  };

  const loadRelationships = async () => {
    if (!assetId) return;
    
    try {
      const data = await getAssetRelationships(assetId);
      setRelationships(data);
    } catch (err) {
      console.error('Failed to load relationships:', err);
      // Don't set error for relationships - it's optional
    }
  };

  const renderThreatModel = () => {
    if (!asset?.threatModel) {
      return <Empty description="No threat model available" />;
    }

    const tm = asset.threatModel;

    return (
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        {/* Exposure Information */}
        <div>
          <Title level={5}>
            <GlobalOutlined style={{ marginRight: 8 }} />
            Exposure
          </Title>
          <Descriptions bordered size="small" column={1}>
            <Descriptions.Item label="Internet Exposed">
              {tm.internetExposed ? (
                <Tag color="red">Yes</Tag>
              ) : (
                <Tag color="green">No</Tag>
              )}
            </Descriptions.Item>
            {tm.publicEndpoint && (
              <Descriptions.Item label="Public Endpoint">
                {tm.publicEndpoint}
              </Descriptions.Item>
            )}
            {tm.trustBoundaries && tm.trustBoundaries.length > 0 && (
              <Descriptions.Item label="Trust Boundaries">
                {tm.trustBoundaries.map((tb: any, idx: number) => {
                  const typeName: string = typeof tb === 'string' ? tb : (tb.name ?? tb.type ?? '');
                  const typeKey = typeName.toUpperCase();
                  const colorMap: Record<string, string> = {
                    INTERNET: 'default',
                    IDENTITY: 'purple',
                    SERVICE:  'geekblue',
                    DATA:     'green',
                    EXTERNAL: 'orange',
                  };
                  return (
                    <Tag key={idx} color={colorMap[typeKey] ?? 'default'}>
                      {typeName}
                    </Tag>
                  );
                })}
              </Descriptions.Item>
            )}
          </Descriptions>
        </div>

        {/* Data Classification */}
        <div>
          <Title level={5}>
            <DatabaseOutlined style={{ marginRight: 8 }} />
            Data Protection
          </Title>
          <Descriptions bordered size="small" column={1}>
            {tm.dataClassification && (
              <Descriptions.Item label="Data Classification">
                <Tag color={
                  tm.dataClassification === 'restricted' ? 'red' :
                  tm.dataClassification === 'confidential' ? 'orange' :
                  tm.dataClassification === 'internal' ? 'blue' : 'green'
                }>
                  {tm.dataClassification.toUpperCase()}
                </Tag>
              </Descriptions.Item>
            )}
            {tm.dataAtRest && (
              <Descriptions.Item label="Encryption at Rest">
                {tm.dataAtRest.enabled ? (
                  <Space>
                    <Tag color="green">Enabled</Tag>
                    {tm.dataAtRest.method && <Text type="secondary">{tm.dataAtRest.method}</Text>}
                  </Space>
                ) : (
                  <Tag color="red">Disabled</Tag>
                )}
              </Descriptions.Item>
            )}
            {tm.dataInTransit && (
              <Descriptions.Item label="Encryption in Transit">
                {tm.dataInTransit.enabled ? (
                  <Space>
                    <Tag color="green">Enabled</Tag>
                    {tm.dataInTransit.method && <Text type="secondary">{tm.dataInTransit.method}</Text>}
                  </Space>
                ) : (
                  <Tag color="red">Disabled</Tag>
                )}
              </Descriptions.Item>
            )}
            {tm.sensitiveDataTypes && tm.sensitiveDataTypes.length > 0 && (
              <Descriptions.Item label="Sensitive Data Types">
                {tm.sensitiveDataTypes.map((type: string, idx: number) => (
                  <Tag key={idx} color="orange">{type}</Tag>
                ))}
              </Descriptions.Item>
            )}
          </Descriptions>
        </div>

        {/* Authentication & Authorization */}
        <div>
          <Title level={5}>
            <LockOutlined style={{ marginRight: 8 }} />
            Security Controls
          </Title>
          <Descriptions bordered size="small" column={1}>
            {tm.authenticationMethod && (
              <Descriptions.Item label="Authentication">
                {tm.authenticationMethod}
              </Descriptions.Item>
            )}
            {tm.authorizationModel && (
              <Descriptions.Item label="Authorization">
                {tm.authorizationModel}
              </Descriptions.Item>
            )}
            {tm.privilegeLevel && (
              <Descriptions.Item label="Privilege Level">
                <Tag color={
                  tm.privilegeLevel === 'admin' ? 'red' :
                  tm.privilegeLevel === 'elevated' ? 'orange' : 'blue'
                }>
                  {tm.privilegeLevel.toUpperCase()}
                </Tag>
              </Descriptions.Item>
            )}
          </Descriptions>
        </div>

        {/* Threats */}
        {tm.identifiedThreats && tm.identifiedThreats.length > 0 && (
          <div>
            <Title level={5}>
              <WarningOutlined style={{ marginRight: 8 }} />
              Identified Threats
            </Title>
            <Space direction="vertical" style={{ width: '100%' }}>
              {tm.identifiedThreats.map((threat: any, idx: number) => (
                <Alert
                  key={idx}
                  message={
                    <Space>
                      <Tag color={
                        threat.severity === 'critical' ? 'red' :
                        threat.severity === 'high' ? 'orange' :
                        threat.severity === 'medium' ? 'gold' : 'blue'
                      }>
                        {threat.severity?.toUpperCase()}
                      </Tag>
                      <Text strong>{threat.category}</Text>
                    </Space>
                  }
                  description={threat.description}
                  type={
                    threat.severity === 'critical' || threat.severity === 'high' ? 'error' :
                    threat.severity === 'medium' ? 'warning' : 'info'
                  }
                  showIcon
                />
              ))}
            </Space>
          </div>
        )}

        {/* Risk Score */}
        {tm.riskScore !== undefined && (
          <div>
            <Title level={5}>
              <SafetyOutlined style={{ marginRight: 8 }} />
              Risk Assessment
            </Title>
            <Descriptions bordered size="small" column={1}>
              <Descriptions.Item label="Risk Score">
                <Space>
                  <Tag color={
                    tm.riskScore > 70 ? 'red' :
                    tm.riskScore > 40 ? 'orange' : 'green'
                  } style={{ fontSize: 16, padding: '4px 12px' }}>
                    {tm.riskScore}/100
                  </Tag>
                  <Text type="secondary">
                    {tm.riskScore > 70 ? 'High Risk' :
                     tm.riskScore > 40 ? 'Medium Risk' : 'Low Risk'}
                  </Text>
                </Space>
              </Descriptions.Item>
              {tm.complianceRequirements && tm.complianceRequirements.length > 0 && (
                <Descriptions.Item label="Compliance">
                  {tm.complianceRequirements.map((req: string, idx: number) => (
                    <Tag key={idx}>{req}</Tag>
                  ))}
                </Descriptions.Item>
              )}
            </Descriptions>
          </div>
        )}
      </Space>
    );
  };

  const renderOverview = () => {
    if (!asset) return null;

    return (
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        {/* Basic Information */}
        <div>
          <Title level={5}>
            <InfoCircleOutlined style={{ marginRight: 8 }} />
            Basic Information
          </Title>
          <Descriptions bordered size="small" column={1}>
            <Descriptions.Item label="Name">{asset.name}</Descriptions.Item>
            <Descriptions.Item label="Type">
              <Tag>{asset.type.replace(/_/g, ' ').toUpperCase()}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="ID">
              <Text code copyable>{asset.id}</Text>
            </Descriptions.Item>
            {asset.owner && (
              <Descriptions.Item label="Owner">{asset.owner}</Descriptions.Item>
            )}
            {asset.businessCriticality && (
              <Descriptions.Item label="Business Criticality">
                <Tag color={
                  asset.businessCriticality === 'critical' ? 'red' :
                  asset.businessCriticality === 'high' ? 'orange' :
                  asset.businessCriticality === 'medium' ? 'gold' : 'green'
                }>
                  {asset.businessCriticality.toUpperCase()}
                </Tag>
              </Descriptions.Item>
            )}
            {asset.riskScore !== undefined && (
              <Descriptions.Item label="Risk Score">
                <Tag color={
                  asset.riskScore > 70 ? 'red' :
                  asset.riskScore > 40 ? 'orange' : 'green'
                }>
                  {asset.riskScore}/100
                </Tag>
              </Descriptions.Item>
            )}
          </Descriptions>
        </div>

        {/* Responsibility */}
        {asset.responsibility && (
          <div>
            <Title level={5}>Responsibility</Title>
            <div style={{
              background: T.stone100,
              padding: 16,
              borderRadius: 4,
              border: '1px solid #d9d9d9'
            }}>
              <Text>{asset.responsibility}</Text>
            </div>
          </div>
        )}

        {/* Additional Metadata */}
        {Object.keys(asset.metadata).length > 0 && (
          <div>
            <Title level={5}>Additional Information</Title>
            <Descriptions bordered size="small" column={1}>
              {Object.entries(asset.metadata)
                .filter(([key]) => !['responsibility', 'owner'].includes(key))
                .map(([key, value]) => (
                  <Descriptions.Item key={key} label={key}>
                    {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                  </Descriptions.Item>
                ))}
            </Descriptions>
          </div>
        )}
      </Space>
    );
  };

  const tabItems = [
    {
      key: 'overview',
      label: (
        <span>
          <InfoCircleOutlined />
          Overview
        </span>
      ),
      children: renderOverview(),
    },
    {
      key: 'security',
      label: (
        <span>
          <SafetyOutlined />
          Security & Threats
        </span>
      ),
      children: renderThreatModel(),
    },
    {
      key: 'relationships',
      label: (
        <span>
          <ApartmentOutlined />
          Relationships
        </span>
      ),
      children: relationships && relationships.nodes.length > 0 ? (
        <RelationshipGraphComponent 
          data={relationships} 
          centerNodeId={assetId || undefined}
        />
      ) : (
        <Empty description="No relationships available" />
      ),
    },
  ];

  return (
    <Drawer
      title={
        <Space>
          <CloudOutlined />
          Asset Details
        </Space>
      }
      placement="right"
      width="60%"
      onClose={onClose}
      open={open}
      styles={{
        body: { paddingTop: 24 }
      }}
    >
      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px 0' }}>
          <Spin size="large" />
        </div>
      ) : error ? (
        <Alert
          message="Error Loading Asset"
          description={error}
          type="error"
          showIcon
        />
      ) : asset ? (
        <Tabs items={tabItems} defaultActiveKey="overview" />
      ) : null}
    </Drawer>
  );
}
