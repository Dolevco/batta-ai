import { useState, useEffect } from 'react';
import { Card, Typography } from 'antd';
import { EditOutlined, SaveOutlined, CheckCircleOutlined } from '@ant-design/icons';
import { VisualizationComponentProps } from '../types';
import { getParameters, getResult, getReason } from './utils';
import { T } from '../../../../theme';

const { Text } = Typography;

export default function WriteFileVisualization({ event }: VisualizationComponentProps) {
  const [visible, setVisible] = useState(false);
  const [showComplete, setShowComplete] = useState(false);
  const [showContent, setShowContent] = useState(false);

  // Extract data using utility functions
  const parameters = getParameters(event.data);
  const reason = getReason(event.data);
  const result = getResult(event.data) || {};
  
  const fileName = parameters.path || parameters.file || event.objectName || 'document.txt';
  
  // Extract content from parameters (the content to write)
  let content = parameters.content || '';
  
  // Fallback to result for content
  if (!content && typeof result === 'string') {
    content = result;
  } else if (!content && result.content) {
    content = result.content;
  }
  
  // Additional fallback to top-level data
  if (!content && (event.data as any)?.content) {
    content = (event.data as any).content;
  }
  
  const lines = content.split('\n');

  useEffect(() => {
    setTimeout(() => setVisible(true), 100);
    
    // Show content first, then completion
    if (event.status === 'completed') {
      setTimeout(() => setShowContent(true), 200);
      setTimeout(() => setShowComplete(true), 400);
    } else {
      // Show content immediately for in-progress
      setShowContent(true);
    }
  }, [event.status]);
  
  const isTs = fileName.endsWith('.ts') || fileName.endsWith('.tsx') || fileName.endsWith('.js');

  return (
    <div style={{ 
      opacity: visible ? 1 : 0, 
      transition: 'opacity 0.4s ease-in',
    }}>
      <Card 
        size="small"
        style={{ 
          backgroundColor: '#1e1e1e',
          border: '1px solid #333',
          boxShadow: '0 4px 6px rgba(0,0,0,0.3)',
        }}
        bodyStyle={{ padding: 0 }}
      >
        {/* Editor Tab Header */}
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: 10, 
          padding: '0',
          backgroundColor: '#252526',
          borderBottom: '1px solid #1e1e1e',
          overflow: 'hidden'
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 16px',
            backgroundColor: '#1e1e1e',
            borderRight: '1px solid #1e1e1e',
            borderTop: '1px solid #4ec9b0' // Different color for write
          }}>
             <EditOutlined style={{ color: '#dcb67a', fontSize: 13 }} />
             <Text style={{ fontSize: 13, color: T.white }}>{fileName} <span style={{opacity: 0.5}}>— Modified</span></Text>
             <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: T.white, marginLeft: 6 }}></div>
          </div>
        </div>
        
        {/* Editor Content */}
        <div style={{ 
           display: 'flex', 
           fontFamily: "'Menlo', 'Monaco', 'Courier New', monospace",
           fontSize: 13,
           lineHeight: 1.6,
           maxHeight: '60vh',
           overflow: 'auto',
           backgroundColor: '#1e1e1e' 
        }}>
           {/* Line Numbers */}
           <div style={{ 
             padding: '6px 0', 
             backgroundColor: '#1e1e1e', 
             color: '#858585', 
             textAlign: 'right',
             minWidth: 48,
             userSelect: 'none',
             borderRight: '1px solid #333',
             marginRight: 12
           }}>
             {lines.map((_: string, i: number) => (
               <div key={i} style={{ padding: '0 12px' }}>{i + 1}</div>
             ))}
           </div>
           
           {/* Code Content */}
           <div style={{ padding: '6px 0', color: '#d4d4d4', flex: 1 }}>
              {lines.map((line: string, i: number) => (
                <div key={i} style={{ 
                  padding: '0 12px', 
                  whiteSpace: 'pre', 
                  backgroundColor: 'rgba(78, 201, 176, 0.1)',
                  opacity: showContent ? 1 : 0.3,
                  transition: 'opacity 0.3s ease-in'
                }}>
                  {line || ' '}
                </div>
              ))}
           </div>
        </div>
        
         {/* Status Bar */}
         <div style={{ 
           backgroundColor: event.status === 'completed' && showComplete ? '#28a745' : '#007acc', 
           color: '#fff', 
           padding: '2px 8px', 
           fontSize: 11, 
           display: 'flex', 
           justifyContent: 'space-between',
           alignItems: 'center',
           transition: 'background-color 0.3s ease'
        }}>
           <div style={{ display: 'flex', gap: 10 }}>
              {event.status === 'completed' && showComplete ? (
                <>
                  <CheckCircleOutlined />
                  <span>Saved successfully</span>
                </>
              ) : (
                <>
                  <SaveOutlined />
                  <span>Writing...</span>
                </>
              )}
           </div>
           <span>{isTs ? 'TypeScript' : 'PlainText'}</span>
        </div>
      </Card>
      
      {reason && (
        <div style={{ marginTop: 6, marginLeft: 4 }}>
           <Text type="secondary" style={{ fontSize: 11 }}>
             {reason}
           </Text>
        </div>
      )}
    </div>
  );
}
