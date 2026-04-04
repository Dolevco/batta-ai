import { useState, useEffect } from 'react';
import { Card, Typography, theme, Steps } from 'antd';
import { 
  BulbOutlined, 
  CheckCircleOutlined, 
  LoadingOutlined,
  UnorderedListOutlined 
} from '@ant-design/icons';
import { VisualizationComponentProps } from '../types';
import { getParameters, getResult } from './utils';

const { Text } = Typography;

export default function PlanningVisualization({ event }: VisualizationComponentProps) {
  const { token: antToken } = theme.useToken();
  const [visible, setVisible] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);

  // Extract data using utility functions
  const parameters = getParameters(event.data);
  const result = getResult(event.data) || {};
  
  const planName = event.objectName || 'Task Planning';
  const steps = parameters.steps || 
                (event.data as any)?.steps || 
                (event.data as any)?.plan?.steps || 
                result?.steps || 
                [];
  const totalSteps = steps.length || 3;

  useEffect(() => {
    setTimeout(() => setVisible(true), 100);
    
    if (event.status === 'in_progress' || event.status === 'completed') {
      const interval = setInterval(() => {
        setCurrentStep(prev => {
          if (prev < totalSteps - 1) {
            return prev + 1;
          }
          clearInterval(interval);
          return prev;
        });
      }, 600);
      
      return () => clearInterval(interval);
    }
  }, [event.status, totalSteps]);

  const getStepStatus = (index: number) => {
    if (event.status === 'completed') return 'finish';
    if (index < currentStep) return 'finish';
    if (index === currentStep) return 'process';
    return 'wait';
  };

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
          marginBottom: 16,
          paddingBottom: 12,
          borderBottom: `2px solid ${antToken.colorBorderSecondary}`,
        }}>
          <div style={{
            padding: 6,
            backgroundColor: 'rgba(250, 173, 20, 0.1)',
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <BulbOutlined style={{ color: antToken.colorWarning, fontSize: 18 }} />
          </div>
          
          <div style={{ flex: 1 }}>
            <Text strong style={{ fontSize: 14, color: '#fff', display: 'block' }}>
              {planName}
            </Text>
            <Text type="secondary" style={{ fontSize: 11 }}>
              {totalSteps} step{totalSteps !== 1 ? 's' : ''} planned
            </Text>
          </div>
          
          {event.status === 'in_progress' && (
            <LoadingOutlined style={{ color: antToken.colorPrimary, fontSize: 14 }} />
          )}
          {event.status === 'completed' && (
            <CheckCircleOutlined style={{ color: antToken.colorSuccess, fontSize: 14 }} />
          )}
        </div>

        {steps.length > 0 ? (
          <Steps
            direction="vertical"
            size="small"
            current={currentStep}
            items={steps.map((step: any, index: number) => ({
              title: (
                <Text style={{ fontSize: 12, color: '#fff' }}>
                  {step.description || step.title || step.name || `Step ${index + 1}`}
                </Text>
              ),
              status: getStepStatus(index),
            }))}
          />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 12 }}>
            <UnorderedListOutlined style={{ color: antToken.colorTextSecondary }} />
            <Text type="secondary" style={{ fontSize: 12 }}>
              Generating execution plan...
            </Text>
          </div>
        )}
      </Card>
    </div>
  );
}
