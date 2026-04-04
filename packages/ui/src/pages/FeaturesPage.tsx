import { useNavigate } from 'react-router-dom';
import { Card, Typography, Space, Breadcrumb } from 'antd';
import { ThunderboltOutlined, HomeOutlined } from '@ant-design/icons';
import { FeatureListView } from '../components/FeatureListView';
import { useTheme } from '../hooks/useTheme';
import { T } from '../theme';

const { Title } = Typography;

export function FeaturesPage() {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const iconColor = isDark ? T.orange : T.blue;

  return (
    <div style={{ padding: '0 24px' }}>
      <Breadcrumb
        style={{ marginBottom: 16 }}
        items={[
          {
            title: (
              <a onClick={() => navigate('/knowledge-base/assets')}>
                <HomeOutlined /> Assets
              </a>
            ),
          },
          { title: 'Features' },
        ]}
      />

      <Card
        bordered={false}
        title={
          <Space>
            <ThunderboltOutlined style={{ fontSize: 20, color: iconColor }} />
            <div>
              <Title level={3} style={{ margin: 0 }}>Business Features</Title>
              <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                AI-extracted features with STRIDE threat models and data flow diagrams
              </Typography.Text>
            </div>
          </Space>
        }
      >
        <FeatureListView
          onSelect={(id) => navigate(`/knowledge-base/features/${encodeURIComponent(id)}`)}
        />
      </Card>
    </div>
  );
}
