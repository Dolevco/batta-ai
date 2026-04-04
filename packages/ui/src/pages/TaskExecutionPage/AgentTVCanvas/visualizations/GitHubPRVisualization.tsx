import { useState, useEffect, memo } from 'react';
import { Card, Typography, theme, Tag } from 'antd';
import { GithubOutlined, CheckCircleOutlined, LoadingOutlined, FileTextOutlined } from '@ant-design/icons';
import { VisualizationComponentProps } from '../types';
import { getParameters, getResult } from './utils';

const { Text } = Typography;

type Phase = 'preparing' | 'creating' | 'completed';

interface PhaseItemProps {
  label: string;
  sublabel?: string;
  status: 'pending' | 'in-progress' | 'completed';
  showCursor?: boolean;
  isLast?: boolean;
}

function PhaseItem({ label, sublabel, status, showCursor, isLast }: PhaseItemProps) {
  const { token: antToken } = theme.useToken();
  
  return (
    <div style={{ 
      display: 'flex', 
      alignItems: 'flex-start', 
      gap: 12,
      marginBottom: isLast ? 0 : 12,
      opacity: status === 'pending' ? 0.4 : 1,
      transition: 'opacity 0.3s ease',
    }}>
      {/* Icon/Status Indicator */}
      <div style={{
        width: 32,
        height: 32,
        borderRadius: 6,
        backgroundColor: 
          status === 'completed' ? 'rgba(82, 196, 26, 0.15)' :
          status === 'in-progress' ? 'rgba(24, 144, 255, 0.15)' :
          'rgba(255, 255, 255, 0.05)',
        border: `1.5px solid ${
          status === 'completed' ? antToken.colorSuccess :
          status === 'in-progress' ? antToken.colorPrimary :
          'rgba(255, 255, 255, 0.1)'
        }`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}>
        {status === 'completed' ? (
          <CheckCircleOutlined style={{ 
            color: antToken.colorSuccess, 
            fontSize: 16 
          }} />
        ) : status === 'in-progress' ? (
          <LoadingOutlined style={{ 
            color: antToken.colorPrimary, 
            fontSize: 16,
            animation: 'spin 1s linear infinite',
          }} />
        ) : (
          <div style={{ 
            width: 8, 
            height: 8, 
            borderRadius: '50%', 
            backgroundColor: 'rgba(255, 255, 255, 0.2)' 
          }} />
        )}
      </div>
      
      {/* Content */}
      <div style={{ flex: 1, paddingTop: 2 }}>
        <Text strong style={{ 
          fontSize: 14, 
          color: status === 'pending' ? antToken.colorTextSecondary : '#fff',
          display: 'block',
          marginBottom: sublabel ? 6 : 0,
        }}>
          {label}
        </Text>
        
        {sublabel && (
          <div style={{
            padding: '6px 10px',
            backgroundColor: 'rgba(255, 255, 255, 0.04)',
            borderRadius: 4,
            border: '1px solid rgba(255, 255, 255, 0.08)',
            fontFamily: '"SF Mono", Monaco, Consolas, "Courier New", monospace',
            fontSize: 12,
            color: antToken.colorTextDescription,
            wordBreak: 'break-word',
            position: 'relative',
          }}>
            {sublabel}
            {showCursor && (
              <span style={{
                display: 'inline-block',
                width: 2,
                height: 14,
                backgroundColor: antToken.colorPrimary,
                animation: 'blink 1s infinite',
                marginLeft: 2,
                verticalAlign: 'middle',
              }} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function GitHubPRVisualizationComponent({ event }: VisualizationComponentProps) {
  const { token: antToken } = theme.useToken();
  const [visible, setVisible] = useState(false);
  const [currentPhase, setCurrentPhase] = useState<Phase>('preparing');
  const [titleProgress, setTitleProgress] = useState(0);
  const [bodyProgress, setBodyProgress] = useState(0);

  // Extract data using utility functions
  const parameters = getParameters(event.data);
  const resultData = getResult(event.data) || {};
  
  const prTitle = parameters.title || 'Pull Request';
  const prBody = parameters.body || '';
  const prNumber = resultData.number;
  const prUrl = resultData.url;
  const prState = resultData.state || 'open';
  const isDraft = parameters.draft || false;

  useEffect(() => {
    setTimeout(() => setVisible(true), 100);
    
    // Phase 1: Preparing (animating title)
    setTimeout(() => {
      setCurrentPhase('preparing');
      
      // Animate PR title typing
      const titleDuration = Math.max(800, prTitle.length * 25);
      const steps = 50;
      const stepDuration = titleDuration / steps;
      
      let currentStep = 0;
      const titleInterval = setInterval(() => {
        currentStep++;
        setTitleProgress((currentStep / steps) * 100);
        
        if (currentStep >= steps) {
          clearInterval(titleInterval);
          
          // Phase 2: Creating (animating body if present)
          setTimeout(() => {
            setCurrentPhase('creating');
            
            if (prBody) {
              const bodyDuration = Math.max(600, Math.min(prBody.length * 10, 1200));
              const bodySteps = 50;
              const bodyStepDuration = bodyDuration / bodySteps;
              
              let bodyCurrentStep = 0;
              const bodyInterval = setInterval(() => {
                bodyCurrentStep++;
                setBodyProgress((bodyCurrentStep / bodySteps) * 100);
                
                if (bodyCurrentStep >= bodySteps) {
                  clearInterval(bodyInterval);
                  // Phase 3: Completed
                  setTimeout(() => {
                    setCurrentPhase('completed');
                  }, 500);
                }
              }, bodyStepDuration);
            } else {
              // No body, go straight to completed
              setTimeout(() => {
                setCurrentPhase('completed');
              }, 600);
            }
          }, 300);
        }
      }, stepDuration);
    }, 200);
    
  }, [prTitle.length, prBody.length]);

  const visibleTitleLength = Math.floor((prTitle.length * titleProgress) / 100);
  const visibleTitle = prTitle.substring(0, visibleTitleLength);
  
  const visibleBodyLength = Math.floor((prBody.length * bodyProgress) / 100);
  const visibleBody = prBody.substring(0, visibleBodyLength);
  
  const isCompleted = currentPhase === 'completed' || event.status === 'completed';

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
          borderRadius: 8,
        }}
      >
        {/* Header */}
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: 12, 
          marginBottom: 16,
        }}>
          <div style={{
            padding: 8,
            backgroundColor: 'rgba(88, 166, 255, 0.15)',
            borderRadius: 6,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <GithubOutlined style={{ color: '#58a6ff', fontSize: 20 }} />
          </div>
          
          <div style={{ flex: 1 }}>
            <Text strong style={{ fontSize: 15, color: '#fff', display: 'block' }}>
              Create Pull Request
            </Text>
            {isDraft && (
              <Tag color="default" style={{ fontSize: 11, marginTop: 4 }}>
                Draft
              </Tag>
            )}
          </div>
        </div>

        {/* Phase Progress */}
        <div style={{ marginBottom: 16 }}>
          {/* Phase 1: Preparing title */}
          <PhaseItem 
            label="Writing title"
            sublabel={
              currentPhase === 'preparing' && titleProgress < 100 
                ? visibleTitle 
                : currentPhase === 'preparing' || ['creating', 'completed'].includes(currentPhase)
                ? prTitle
                : undefined
            }
            status={
              currentPhase === 'preparing' ? 'in-progress' :
              ['creating', 'completed'].includes(currentPhase) ? 'completed' :
              'pending'
            }
            showCursor={currentPhase === 'preparing' && titleProgress < 100}
          />
          
          {/* Phase 2: Creating body */}
          {prBody && (
            <PhaseItem 
              label="Writing description"
              sublabel={
                currentPhase === 'creating' && bodyProgress < 100 
                  ? (visibleBody.length > 100 ? visibleBody.substring(0, 100) + '...' : visibleBody)
                  : currentPhase === 'creating' || currentPhase === 'completed'
                  ? (prBody.length > 100 ? prBody.substring(0, 100) + '...' : prBody)
                  : undefined
              }
              status={
                currentPhase === 'creating' ? 'in-progress' :
                currentPhase === 'completed' ? 'completed' :
                'pending'
              }
              showCursor={currentPhase === 'creating' && bodyProgress < 100}
            />
          )}
          
          {/* Phase 3: Creating PR */}
          <PhaseItem 
            label="Creating pull request"
            status={
              currentPhase === 'completed' ? 'completed' :
              currentPhase === 'creating' && (!prBody || bodyProgress >= 100) ? 'in-progress' :
              'pending'
            }
            isLast
          />
        </div>

        {/* Success Summary */}
        {isCompleted && prNumber && (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            padding: '12px 14px',
            backgroundColor: 'rgba(88, 166, 255, 0.08)',
            borderRadius: 6,
            border: '1px solid rgba(88, 166, 255, 0.2)',
            animation: 'fadeInUp 0.4s ease-out',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <FileTextOutlined style={{ color: '#58a6ff', fontSize: 14 }} />
                <Text style={{ fontSize: 13, color: antToken.colorTextSecondary, fontWeight: 500 }}>
                  PR #{prNumber}
                </Text>
              </div>
              
              <Tag color={prState === 'open' ? 'success' : 'default'} style={{ fontSize: 11, margin: 0 }}>
                {prState}
              </Tag>
            </div>
            
            {prUrl && (
              <a 
                href={prUrl} 
                target="_blank" 
                rel="noopener noreferrer"
                style={{ 
                  fontSize: 12, 
                  color: '#58a6ff',
                  textDecoration: 'none',
                  wordBreak: 'break-all',
                }}
              >
                {prUrl}
              </a>
            )}
          </div>
        )}
      </Card>

      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        
        @keyframes blink {
          0%, 49% { opacity: 1; }
          50%, 100% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}

export default memo(GitHubPRVisualizationComponent);
