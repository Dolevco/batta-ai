import { useState, useEffect } from 'react';
import { Card, Typography, theme } from 'antd';
import { SaveOutlined, CheckCircleOutlined, LoadingOutlined } from '@ant-design/icons';
import { VisualizationComponentProps } from '../types';
import { getParameters, getResult } from './utils';

const { Text } = Typography;

export default function MemoryVisualization({ event }: VisualizationComponentProps) {
  const { token: antToken } = theme.useToken();
  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(0);

  // Extract data using utility functions
  const parameters = getParameters(event.data);
  const result = getResult(event.data);
  
  const memoryType = event.objectName || 'Insight';
  // Handle both old format (parameters.memory) and new stepMemoryRetrieved format (insights)
  const content = (event.data as any)?.insights || 
                  parameters.memory || 
                  (event.data as any)?.memory || 
                  (event.data as any)?.content || 
                  result || 
                  '';

  useEffect(() => {
    setTimeout(() => setVisible(true), 100);
    
    if (event.status === 'in_progress' || event.status === 'completed') {
      const duration = 1200;
      const steps = 50;
      const stepDuration = duration / steps;
      
      let currentStep = 0;
      const interval = setInterval(() => {
        currentStep++;
        setProgress((currentStep / steps) * 100);
        
        if (currentStep >= steps) {
          clearInterval(interval);
        }
      }, stepDuration);
      
      return () => clearInterval(interval);
    }
  }, [event.status]);

  return (
    <div style={{ 
      opacity: visible ? 1 : 0, 
      transition: 'opacity 0.5s ease-in',
      marginBottom: 16,
    }}>
      <Card 
        size="small"
        style={{ 
          backgroundColor: '#0a0a0a',
          border: `1px solid ${antToken.colorBorder}`,
          borderRadius: 6,
        }}
      >
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: 10, 
          marginBottom: 12,
        }}>
          <div style={{
            padding: 6,
            backgroundColor: 'rgba(114, 46, 209, 0.1)',
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <SaveOutlined style={{ color: '#722ed1', fontSize: 18 }} />
          </div>
          
          <div style={{ flex: 1 }}>
            <Text strong style={{ fontSize: 14, color: '#fff', display: 'block' }}>
              Save Memory
            </Text>
            <Text type="secondary" style={{ fontSize: 11 }}>
              {memoryType}
            </Text>
          </div>
          
          {event.status === 'in_progress' && progress < 100 && (
            <LoadingOutlined style={{ color: antToken.colorPrimary, fontSize: 14 }} />
          )}
          {(event.status === 'completed' || progress >= 100) && (
            <CheckCircleOutlined style={{ color: antToken.colorSuccess, fontSize: 14 }} />
          )}
        </div>

        {content && (
          <div style={{
            padding: 12,
            backgroundColor: 'rgba(114, 46, 209, 0.05)',
            border: '1px solid rgba(114, 46, 209, 0.2)',
            borderRadius: 4,
            opacity: Math.min(1, progress / 50),
            transition: 'opacity 0.3s ease',
          }}>
            <Text style={{ fontSize: 12, color: antToken.colorTextSecondary }}>
              {content.length > 150 ? content.substring(0, 150) + '...' : content}
            </Text>
          </div>
        )}
      </Card>
    </div>
  );
}
