import { useState, useEffect, memo } from 'react';
import { Card, Typography, theme } from 'antd';
import { BranchesOutlined, PlusCircleOutlined, MinusCircleOutlined, CheckCircleOutlined, LoadingOutlined } from '@ant-design/icons';
import { VisualizationComponentProps } from '../types';
import { getParameters, getResult, getReason } from './utils';

const { Text } = Typography;

type Phase = 'creating-branch' | 'committing' | 'pushing' | 'completed';

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
            padding: '8px 12px',
            backgroundColor: 'rgba(255, 255, 255, 0.04)',
            borderRadius: 4,
            border: '1px solid rgba(255, 255, 255, 0.08)',
            fontFamily: '"SF Mono", Monaco, Consolas, "Courier New", monospace',
            fontSize: 13,
            color: antToken.colorTextDescription,
            wordBreak: 'break-word',
            position: 'relative',
            lineHeight: 1.6,
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

function GitCommitVisualizationComponent({ event }: VisualizationComponentProps) {
  const { token: antToken } = theme.useToken();
  const [visible, setVisible] = useState(false);
  const [currentPhase, setCurrentPhase] = useState<Phase>('creating-branch');
  const [messageProgress, setMessageProgress] = useState(0);

  // Extract data using utility functions
  const parameters = getParameters(event.data);
  const reason = getReason(event.data);
  const resultData = getResult(event.data) || {};
  
  const commitMessage = parameters.message || (event.data as any)?.message || 'Update files';
  const branch = resultData.branch || 'main';
  const commitHash = resultData.commit || '';
  const summary = resultData.summary || {};
  const changes = summary.changes || (event.data as any)?.filesChanged || 1;
  const insertions = summary.insertions || resultData.additions || (event.data as any)?.additions || 0;
  const deletions = summary.deletions || resultData.deletions || (event.data as any)?.deletions || 0;

  useEffect(() => {
    setTimeout(() => setVisible(true), 100);
    
    // Phase 1: Creating branch (600ms)
    setTimeout(() => setCurrentPhase('creating-branch'), 200);
    
    // Phase 2: Committing (start after 800ms, animate message)
    setTimeout(() => {
      setCurrentPhase('committing');
      
      // Animate commit message typing
      const messageDuration = Math.max(1000, commitMessage.length * 30);
      const steps = 50;
      const stepDuration = messageDuration / steps;
      
      let currentStep = 0;
      const interval = setInterval(() => {
        currentStep++;
        setMessageProgress((currentStep / steps) * 100);
        
        if (currentStep >= steps) {
          clearInterval(interval);
          // Phase 3: Pushing (after message is complete)
          setTimeout(() => {
            setCurrentPhase('pushing');
            // Phase 4: Completed (after push simulation)
            setTimeout(() => {
              setCurrentPhase('completed');
            }, 800);
          }, 300);
        }
      }, stepDuration);
    }, 800);
    
  }, [commitMessage.length]);

  const visibleMessageLength = Math.floor((commitMessage.length * messageProgress) / 100);
  const visibleMessage = commitMessage.substring(0, visibleMessageLength);
  
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
            backgroundColor: 'rgba(82, 196, 26, 0.15)',
            borderRadius: 6,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <BranchesOutlined style={{ color: antToken.colorSuccess, fontSize: 20 }} />
          </div>
          
          <div style={{ flex: 1 }}>
            <Text strong style={{ fontSize: 15, color: '#fff', display: 'block' }}>
              Git Operations
            </Text>
            {reason && (
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
                {reason}
              </Text>
            )}
          </div>
        </div>

        {/* Phase Progress */}
        <div style={{ marginBottom: 16 }}>
          {/* Phase 1: Create Branch */}
          <PhaseItem 
            label="Creating branch"
            sublabel={branch}
            status={
              currentPhase === 'creating-branch' ? 'in-progress' :
              ['committing', 'pushing', 'completed'].includes(currentPhase) ? 'completed' :
              'pending'
            }
          />
          
          {/* Phase 2: Commit */}
          <PhaseItem 
            label="Committing changes"
            sublabel={
              currentPhase === 'committing' && messageProgress < 100 
                ? visibleMessage 
                : currentPhase === 'committing' || ['pushing', 'completed'].includes(currentPhase)
                ? commitMessage
                : undefined
            }
            status={
              currentPhase === 'committing' ? 'in-progress' :
              ['pushing', 'completed'].includes(currentPhase) ? 'completed' :
              'pending'
            }
            showCursor={currentPhase === 'committing' && messageProgress < 100}
          />
          
          {/* Phase 3: Push */}
          <PhaseItem 
            label="Pushing to remote"
            sublabel={commitHash ? commitHash.substring(0, 7) : undefined}
            status={
              currentPhase === 'pushing' ? 'in-progress' :
              currentPhase === 'completed' ? 'completed' :
              'pending'
            }
            isLast
          />
        </div>

        {/* Summary Stats */}
        {isCompleted && (
          <div style={{
            display: 'flex',
            gap: 16,
            padding: '12px 14px',
            backgroundColor: 'rgba(82, 196, 26, 0.08)',
            borderRadius: 6,
            border: '1px solid rgba(82, 196, 26, 0.2)',
            animation: 'fadeInUp 0.4s ease-out',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Text style={{ fontSize: 13, color: antToken.colorTextSecondary, fontWeight: 500 }}>
                {changes} {changes === 1 ? 'file' : 'files'}
              </Text>
            </div>
            
            {insertions > 0 && (
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: 6,
              }}>
                <PlusCircleOutlined style={{ color: antToken.colorSuccess, fontSize: 14 }} />
                <Text style={{ fontSize: 13, color: antToken.colorSuccess, fontWeight: 600 }}>
                  {insertions}
                </Text>
              </div>
            )}
            
            {deletions > 0 && (
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: 6,
              }}>
                <MinusCircleOutlined style={{ color: antToken.colorError, fontSize: 14 }} />
                <Text style={{ fontSize: 13, color: antToken.colorError, fontWeight: 600 }}>
                  {deletions}
                </Text>
              </div>
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

export default memo(GitCommitVisualizationComponent);
