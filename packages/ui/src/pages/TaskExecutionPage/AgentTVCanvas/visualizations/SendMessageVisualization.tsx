import { useState, useEffect } from 'react';
import { Card, Typography, theme, Avatar } from 'antd';
import { SendOutlined, CheckCircleOutlined, SlackOutlined, LoadingOutlined } from '@ant-design/icons';
import { VisualizationComponentProps } from '../types';
import { getParameters, getResult, getReason, getToolName, isSuccess } from './utils';

const { Text } = Typography;

export default function SendMessageVisualization({ event }: VisualizationComponentProps) {
  const { token: antToken } = theme.useToken();
  const [visible, setVisible] = useState(false);
  const [typing, setTyping] = useState(true);
  const [sent, setSent] = useState(false);
  const [displayedText, setDisplayedText] = useState('');

  // Extract data using utility functions
  const parameters = getParameters(event.data);
  const reason = getReason(event.data);
  const toolName = getToolName(event.data);
  const result = getResult(event.data) || {};
  const success = isSuccess(event.data);
  
  const channel = parameters.channel || (event.data as any)?.channel || '';
  const text = parameters.text || parameters.message || (event.data as any)?.text || '';
  
  const isSlack = toolName?.toLowerCase().includes('slack') || 
                  (event.data?.name as string)?.toLowerCase().includes('slack') ||
                  event.objectName?.toLowerCase().includes('slack');
  
  // Extract result data
  const botName = (result as any).message?.bot_profile?.name || 'Security Agent';

  useEffect(() => {
    setTimeout(() => setVisible(true), 100);
    
    // Simulate typing animation
    const typingSpeed = 30; // ms per character
    const totalTypingTime = Math.min(text.length * typingSpeed, 2000); // Cap at 2s
    
    let currentIndex = 0;
    const charInterval = totalTypingTime / text.length;
    
    const typingInterval = setInterval(() => {
      currentIndex++;
      setDisplayedText(text.slice(0, currentIndex));
      
      if (currentIndex >= text.length) {
        clearInterval(typingInterval);
        setTyping(false);
        
        // Show sent confirmation
        setTimeout(() => {
          setSent(true);
        }, 300);
      }
    }, charInterval);
    
    return () => clearInterval(typingInterval);
  }, [text]);

  return (
    <div style={{ 
      opacity: visible ? 1 : 0, 
      transition: 'opacity 0.4s ease-in',
    }}>
      <Card 
        size="small"
        style={{ 
          backgroundColor: antToken.colorBgContainer,
          border: `1px solid ${antToken.colorBorder}`,
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
        }}
        bodyStyle={{ padding: 0 }}
      >
        {/* Header */}
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: 10, 
          padding: '12px 16px',
          borderBottom: `1px solid ${antToken.colorBorderSecondary}`,
          backgroundColor: antToken.colorBgLayout,
        }}>
          {isSlack ? (
            <SlackOutlined style={{ color: '#4A154B', fontSize: 16 }} />
          ) : (
            <SendOutlined style={{ color: antToken.colorPrimary, fontSize: 16 }} />
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <Text strong style={{ fontSize: 13 }}>
              {isSlack ? 'Send Slack Message' : 'Send Message'}
            </Text>
            {reason && (
              <div style={{ marginTop: 4 }}>
                <Text type="secondary" style={{ fontSize: 11, fontStyle: 'italic' }}>
                  {reason}
                </Text>
              </div>
            )}
            <div style={{ marginTop: 2 }}>
              <Text type="secondary" style={{ fontSize: 11, fontFamily: 'monospace' }}>
                to: {channel}
              </Text>
            </div>
          </div>
          {typing ? (
            <div style={{ 
              fontSize: 11, 
              color: antToken.colorPrimary,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}>
              <LoadingOutlined />
              Typing...
            </div>
          ) : sent ? (
            <div style={{ 
              fontSize: 11, 
              color: antToken.colorSuccess,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}>
              <CheckCircleOutlined />
              Sent
            </div>
          ) : null}
        </div>

        {/* Message Content */}
        <div style={{
          backgroundColor: '#0d1117',
          padding: '16px',
          minHeight: 100,
          maxHeight: 300,
          overflow: 'auto',
        }}>
          {/* Message bubble */}
          <div style={{
            display: 'flex',
            gap: 12,
            alignItems: 'flex-start',
          }}>
            {/* Bot Avatar */}
            <Avatar 
              size={32} 
              style={{ 
                backgroundColor: isSlack ? '#4A154B' : antToken.colorPrimary,
                flexShrink: 0,
              }}
              icon={isSlack ? <SlackOutlined /> : <SendOutlined />}
            />
            
            {/* Message */}
            <div style={{ flex: 1 }}>
              <div style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: 8,
                marginBottom: 4,
              }}>
                <Text strong style={{ color: '#e6edf3', fontSize: 13 }}>
                  {botName}
                </Text>
                <Text style={{ color: '#8b949e', fontSize: 11 }}>
                  {typing ? 'typing...' : 'just now'}
                </Text>
              </div>
              
              <div style={{
                backgroundColor: isSlack ? 'rgba(74, 21, 75, 0.1)' : 'rgba(56, 139, 253, 0.1)',
                borderLeft: isSlack ? '3px solid #4A154B' : `3px solid ${antToken.colorPrimary}`,
                padding: '10px 12px',
                borderRadius: '4px',
                position: 'relative',
              }}>
                <Text style={{ 
                  color: '#e6edf3',
                  fontSize: 13,
                  lineHeight: 1.6,
                  display: 'block',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}>
                  {displayedText}
                  {typing && (
                    <span style={{
                      display: 'inline-block',
                      width: 8,
                      height: 16,
                      backgroundColor: '#e6edf3',
                      marginLeft: 2,
                      animation: 'blink 1s infinite',
                    }} />
                  )}
                </Text>
                
                {/* Sent checkmark */}
                {sent && success && (
                  <div style={{
                    position: 'absolute',
                    bottom: 4,
                    right: 8,
                    color: antToken.colorSuccess,
                    fontSize: 12,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}>
                    <CheckCircleOutlined style={{ fontSize: 14 }} />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </Card>

      <style>{`
        @keyframes blink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}
