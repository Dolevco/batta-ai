import { useState, useEffect } from 'react';
import { Card, Typography, theme } from 'antd';
import { FileTextOutlined, InfoCircleOutlined } from '@ant-design/icons';
import { VisualizationComponentProps } from '../types';
import { getParameters, getResult, getReason, getMessage } from './utils';

const { Text } = Typography;

export default function ReadFileVisualization({ event }: VisualizationComponentProps) {
  const { token: antToken } = theme.useToken();
  const [visible, setVisible] = useState(false);
  const [showContent, setShowContent] = useState(false);

  // Extract data using utility functions
  const parameters = getParameters(event.data);
  const fileName = parameters.path || parameters.file || event.objectName || 'file';
  
  // Extract content and metadata from result
  const result = getResult(event.data);
  const message = getMessage(event.data);
  
  // Check if file is truncated - look in both toolResult and toolUse
  const toolUseData = event.data?.toolUse;
  const toolResultData = event.data?.toolResult;
  
  // Try to get metadata from multiple sources
  const metadata = 
    (toolResultData as any)?.metadata || 
    (toolUseData as any)?.metadata || 
    (result as any)?.metadata;
  
  const isTruncated = metadata?.truncated || (message && message.includes('too long'));
  const totalLines = metadata?.lines;
  
  // Try to get preview from multiple sources
  const preview = 
    (toolResultData as any)?.preview || 
    (toolUseData as any)?.preview || 
    metadata?.preview || 
    (result as any)?.preview ||
    (typeof result === 'string' ? result : '');
  
  // Use preview if available and truncated, otherwise fall back to result
  const content = isTruncated && preview ? preview : (typeof result === 'string' ? result : ((event.data as any)?.content || ''));
  const reason = getReason(event.data); 

  useEffect(() => {
    // Fade in
    setTimeout(() => setVisible(true), 100);
    
    // Show content when completed
    if (event.status === 'completed') {
      setTimeout(() => setShowContent(true), 300);
    }
  }, [event.status]);

  const lines = content.split('\n');
  // Determine language for some basic highlighting colors (very simple)
  const isTs = fileName.endsWith('.ts') || fileName.endsWith('.tsx') || fileName.endsWith('.js');
  const isJson = fileName.endsWith('.json');

  return (
    <div style={{ 
      opacity: visible ? 1 : 0, 
      transition: 'opacity 0.4s ease-in',
    }}>
      <Card 
        size="small"
        style={{ 
          backgroundColor: antToken.colorBgElevated,
          border: `1px solid ${antToken.colorBorder}`,
          boxShadow: antToken.boxShadowSecondary,
        }}
        bodyStyle={{ padding: 0 }}
      >
        {/* Editor Tab Header */}
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: 10, 
          padding: '0',
          backgroundColor: antToken.colorBgContainer,
          borderBottom: `1px solid ${antToken.colorBorder}`,
          overflow: 'hidden'
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 16px',
            backgroundColor: antToken.colorBgElevated,
            borderRight: `1px solid ${antToken.colorBorder}`,
            borderTop: `2px solid ${antToken.colorPrimary}`
          }}>
             <FileTextOutlined style={{ color: antToken.colorPrimary, fontSize: 13 }} />
             <Text style={{ fontSize: 13, color: antToken.colorText }}>{fileName}</Text>
          </div>
        </div>
        
        {/* Truncation Notice */}
        {isTruncated && totalLines && (
          <div style={{ 
            padding: '8px 16px',
            backgroundColor: antToken.colorInfoBg,
            borderBottom: `1px solid ${antToken.colorBorder}`,
            display: 'flex',
            alignItems: 'center',
            gap: 8
          }}>
            <InfoCircleOutlined style={{ color: antToken.colorInfo }} />
            <Text style={{ fontSize: 12, color: antToken.colorInfoText }}>
              Showing preview of first ~100 lines (file has {totalLines} lines total)
            </Text>
          </div>
        )}
        
        {/* Editor Content with Line Numbers */}
        <div style={{ 
           display: 'flex', 
           fontFamily: "'Menlo', 'Monaco', 'Courier New', monospace",
           fontSize: 13,
           lineHeight: 1.6,
           height: 'auto',
           maxHeight: '60vh',
           overflow: 'auto',
           backgroundColor: antToken.colorBgElevated
        }}>
           {/* Line Numbers */}
           <div style={{ 
             padding: '6px 0', 
             backgroundColor: antToken.colorBgContainer,
             color: antToken.colorTextTertiary,
             textAlign: 'right',
             minWidth: 48,
             userSelect: 'none',
             borderRight: `1px solid ${antToken.colorBorder}`,
             marginRight: 12
           }}>
             {lines.map((_: string, i: number) => (
               <div key={i} style={{ padding: '0 12px' }}>{i + 1}</div>
             ))}
           </div>
           
           {/* Code Content */}
           <div style={{ padding: '6px 0', color: antToken.colorText, flex: 1, overflowX: 'auto' }}>
              {event.status === 'in_progress' ? (
                 <div style={{ padding: '0 12px', color: antToken.colorTextSecondary, fontStyle: 'italic' }}>
                   Reading file content...
                   <div style={{ display: 'inline-block', width: 8, height: 12, backgroundColor: antToken.colorTextSecondary, marginLeft: 4, animation: 'blink 1s step-end infinite' }}></div>
                 </div>
              ) : (
                lines.map((line: string, i: number) => (
                  <div key={i} style={{ padding: '0 12px', whiteSpace: 'pre', opacity: showContent ? 1 : 0.3, transition: 'opacity 0.3s ease-in' }}>
                    {line || ' '}
                  </div>
                ))
              )}
           </div>
        </div>
        
        {/* Status Bar */}
        <div style={{ 
           backgroundColor: antToken.colorPrimary,
           color: '#fff', 
           padding: '2px 8px', 
           fontSize: 11, 
           display: 'flex', 
           justifyContent: 'space-between' 
        }}>
           <span>{isTs ? 'TypeScript' : isJson ? 'JSON' : 'PlainText'}</span>
           <span>Ln {lines.length}, Col 1</span>
        </div>
      </Card>
      
      {reason && (
        <div style={{ marginTop: 6, marginLeft: 4 }}>
          <Text type="secondary" style={{ fontSize: 11 }}>
            Read required for: {reason}
          </Text>
        </div>
      )}
      
      <style>{`
        @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
      `}</style>
    </div>
  );
}
