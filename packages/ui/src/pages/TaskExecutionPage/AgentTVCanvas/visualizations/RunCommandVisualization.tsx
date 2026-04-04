import { useState, useEffect, memo, useRef } from 'react';
import { Card, Typography } from 'antd';
import { VisualizationComponentProps } from '../types';
import { getParameters, getResult, getReason } from './utils';

const { Text } = Typography;

function RunCommandVisualizationComponent({ event }: VisualizationComponentProps) {
  const [visible, setVisible] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Extract data using utility functions
  const parameters = getParameters(event.data);
  const reason = getReason(event.data);
  const resultData = getResult(event.data) || {};
  
  const command = parameters.command || (event.data as any)?.command || event.objectName || 'Task';
  
  // Extract result - handle both stdout/stderr structure and plain result
  const stdout = resultData.stdout || '';
  const stderr = resultData.stderr || '';
  const error = (event.data as any)?.error;

  useEffect(() => {
    setTimeout(() => setVisible(true), 100);
    
    // Show result when completed
    if (event.status === 'completed') {
      setTimeout(() => setShowResult(true), 300);
    }
  }, [event.status]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [showResult]);

  return (
    <div style={{ 
      opacity: visible ? 1 : 0, 
      transition: 'opacity 0.5s ease-in',
      marginBottom: 16,
    }}>
      <Card 
        size="small"
        style={{ 
          backgroundColor: '#1e1e1e',
          border: '1px solid #333',
          borderRadius: 8,
          boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
          overflow: 'hidden'
        }}
        bodyStyle={{ padding: 0 }}
      >
        {/* Terminal Window Header */}
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          padding: '8px 12px',
          backgroundColor: '#2d2d2d',
          borderBottom: '1px solid #333'
        }}>
          <div style={{ display: 'flex', gap: 6, marginRight: 16 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: '#ff5f56' }} />
            <div style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: '#ffbd2e' }} />
            <div style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: '#27c93f' }} />
          </div>
          <div style={{ 
            flex: 1, 
            textAlign: 'center', 
            marginRight: 40,
            fontSize: 13,
            fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
            color: '#999'
          }}>
            zsh — agent-worker
          </div>
        </div>

        {/* Terminal Content */}
        <div 
          ref={scrollRef}
          style={{ 
            minHeight: 200,
            maxHeight: '60vh',
            overflowY: 'auto',
            padding: '14px 16px',
            fontFamily: "'Menlo', 'Monaco', 'Courier New', monospace",
            fontSize: 13,
            lineHeight: '1.7',
            color: '#f0f0f0',
          }}
        >
          {/* Command Prompt */}
          <div style={{ marginBottom: 8 }}>
            <span style={{ color: '#27c93f' }}>user@agent-machine</span>
            <span style={{ color: '#fff' }}>:</span>
            <span style={{ color: '#569cd6' }}>~/project</span>
            <span style={{ color: '#fff' }}> $ </span>
            <span style={{ color: '#f0f0f0' }}>{command}</span>
          </div>
          
          {/* Result or Loading */}
          {event.status === 'in_progress' ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <div style={{ display: 'inline-block', width: 8, height: 14, backgroundColor: '#999', animation: 'blink 1s step-end infinite' }}></div>
            </div>
          ) : showResult && (
            <div style={{ 
              marginTop: 4, 
              opacity: showResult ? 1 : 0,
              transition: 'opacity 0.3s ease-in'
            }}>
              {error ? (
                <div style={{ color: '#ff5f56', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {error}
                </div>
              ) : (
                <>
                  {/* stdout */}
                  {stdout && stdout.split('\n').map((line: string, idx: number) => (
                    <div key={`out-${idx}`} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#f0f0f0' }}>
                      {line || ' '}
                    </div>
                  ))}
                  
                  {/* stderr - in a different color */}
                  {stderr && stderr.split('\n').map((line: string, idx: number) => (
                    <div key={`err-${idx}`} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#ffbd2e' }}>
                      {line || ' '}
                    </div>
                  ))}
                  
                  {/* If no output at all */}
                  {!stdout && !stderr && (
                    <div style={{ color: '#27c93f' }}>Command executed successfully.</div>
                  )}
                </>
              )}
              
              {/* Prompt after result */}
              <div style={{ marginTop: 8 }}>
                <span style={{ color: '#27c93f' }}>user@agent-machine</span>
                <span style={{ color: '#fff' }}>:</span>
                <span style={{ color: '#569cd6' }}>~/project</span>
                <span style={{ color: '#fff' }}> $ </span>
                <div style={{ display: 'inline-block', width: 8, height: 14, backgroundColor: '#f0f0f0', marginLeft: 2 }}></div>
              </div>
            </div>
          )}
        </div>
      </Card>
      
      {reason && (
        <div style={{ marginTop: 8, padding: '0 4px' }}>
          <Text type="secondary" style={{ fontSize: 11, fontStyle: 'italic' }}>
            Goal: {reason}
          </Text>
        </div>
      )}

      <style>{`
        @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
      `}</style>
    </div>
  );
}

export default memo(RunCommandVisualizationComponent);
