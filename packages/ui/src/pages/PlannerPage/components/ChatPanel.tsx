import React, { useEffect, useRef } from 'react';
import { Input, Button, Typography, Spin, theme } from 'antd';
import { SendOutlined, RobotOutlined, UserOutlined } from '@ant-design/icons';
import { useTheme } from '../../../hooks';

const { Text } = Typography;

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date | string;
  isThinking?: boolean;
}

interface Props {
  messages: Message[];
  loading: boolean;
  messagesEndRef?: React.RefObject<HTMLDivElement>;
  input: string;
  setInput: (s: string) => void;
  inputRef?: any;
  onSend: () => void;
  compact?: boolean; // renders slightly different layout for sidebar
}

export default function ChatPanel({ messages = [], loading = false, messagesEndRef, input, setInput, inputRef, onSend, compact = false }: Props) {
  const { token } = theme.useToken();
  const { theme: appTheme } = useTheme();

  // Use provided messagesEndRef or create a local one. Auto-scroll when messages or loading change.
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const localEndRef = (messagesEndRef as React.RefObject<HTMLDivElement>) || useRef<HTMLDivElement>(null);
  const prevLenRef = useRef<number>(messages.length);

  useEffect(() => {
    const container = messagesContainerRef.current;
    const endEl = (localEndRef as React.RefObject<HTMLDivElement>)?.current;
    const isNearBottom = container ? (container.scrollHeight - container.scrollTop - container.clientHeight) < 150 : true;
    const lenIncreased = messages.length > (prevLenRef.current || 0);

    if (lenIncreased || isNearBottom) {
      try {
        endEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } catch (e) {
        // ignore
      }
    }

    prevLenRef.current = messages.length;
  }, [messages, loading]);

  const formatTime = (t: Date | string) => {
    try {
      const d = typeof t === 'string' ? new Date(t) : t;
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return '';
    }
  };

  return (
    <>
      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes slideIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes blink { 0%,100% { opacity: 1 } 50% { opacity: 0.3 } }

        .planner-chat-messages::-webkit-scrollbar { width: 6px; }
        .planner-chat-messages::-webkit-scrollbar-track { background: transparent; }
        .planner-chat-messages::-webkit-scrollbar-thumb { background: ${appTheme === 'dark' ? '#2f2f2f' : '#d9d9d9'}; border-radius: 3px; }
        .planner-chat-messages::-webkit-scrollbar-thumb:hover { background: ${appTheme === 'dark' ? '#444' : '#bfbfbf'}; }

        .chat-input-container:focus-within { box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.06); }
        .send-button { transition: all 0.18s cubic-bezier(0.4,0,0.2,1); }
        .send-button:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(16,185,129,0.12); }
      `}</style>

      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: token.colorBgLayout,
          minHeight: 0,
        }}
      >
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            maxWidth: compact ? '100%' : '800px',
            width: '100%',
            margin: compact ? undefined : '0 auto',
            position: 'relative',
            minHeight: 0,
          }}
        >
          <div
            ref={messagesContainerRef}
            className="planner-chat-messages"
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: compact ? '16px' : '32px 24px 24px',
              display: 'flex',
              flexDirection: 'column',
              gap: '20px',
            }}
          >
          {messages.length === 0 && !loading && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '40vh', animation: 'fadeIn 0.4s ease-out' }}>
              <div style={{ width: 64, height: 64, borderRadius: 16, backgroundColor: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20, boxShadow: '0 6px 20px rgba(16,185,129,0.12)' }}>
                <RobotOutlined style={{ fontSize: 28, color: '#fff' }} />
              </div>
              <h2 style={{ margin: 0, color: token.colorText, fontSize: 24, fontWeight: 600, textAlign: 'center' }}>Create an execution plan</h2>
              <Text style={{ color: token.colorTextSecondary, marginTop: 8 }}>Describe what you want to accomplish and the AI will create a step-by-step plan.</Text>
            </div>
          )}

          {messages.filter(m => !m.isThinking).map((message) => (
            <div key={message.id} style={{ display: 'flex', gap: '14px', alignItems: 'flex-start', animation: 'fadeIn 0.3s ease-out', width: '100%' }}>
              <div style={{ flexShrink: 0 }}>
                {message.role === 'assistant' ? (
                  <div style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <RobotOutlined style={{ fontSize: 14, color: '#ffffff' }} />
                  </div>
                ) : (
                  <div style={{ width: 32, height: 32, borderRadius: '50%', backgroundColor: '#3b82f6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <UserOutlined style={{ fontSize: 14, color: '#ffffff' }} />
                  </div>
                )}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <Text strong style={{ fontSize: 13, color: token.colorText, display: 'block', marginBottom: 6 }}>{message.role === 'user' ? 'You' : message.role === 'system' ? 'System' : 'AI Planner'}</Text>
                <div style={{ color: token.colorText, fontSize: 15, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{message.content}</div>
                <div style={{ marginTop: 6 }}><Text type="secondary" style={{ fontSize: 11 }}>{formatTime(message.timestamp)}</Text></div>
              </div>
            </div>
          ))}

          {loading && (
            <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start', animation: 'fadeIn 0.3s ease-out' }}>
              <div style={{ flexShrink: 0 }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <RobotOutlined style={{ fontSize: 14, color: '#ffffff' }} />
                </div>
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <Text strong style={{ fontSize: 13, color: token.colorText, display: 'block', marginBottom: 6 }}>AI Planner</Text>
                <div style={{ color: token.colorText, fontSize: 14, lineHeight: 1.6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Spin size="small" />
                    <Text style={{ color: token.colorTextSecondary, fontSize: 13 }}>Creating your execution plan...</Text>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div ref={localEndRef} />
        </div>

        {/* Input */}
        <div style={{ 
          padding: compact ? 12 : '16px 24px 24px', 
          borderTop: compact ? `1px solid ${token.colorBorder}` : appTheme === 'dark' ? `1px solid ${token.colorBorder}` : '1px solid #f3f4f6',
          backgroundColor: token.colorBgLayout,
          position: 'sticky',
          bottom: 0,
          zIndex: 10,
        }}>
          <div className="chat-input-container" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', backgroundColor: token.colorBgContainer, border: `1px solid ${token.colorBorder}`, borderRadius: 24, transition: 'all 0.15s ease', boxShadow: appTheme === 'dark' ? '0 2px 8px rgba(0,0,0,0.6)' : '0 2px 8px rgba(0,0,0,0.04)' }}>
            <Input.TextArea
              ref={inputRef}
              placeholder={compact ? 'Refine the plan...' : 'Describe your task...'}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPressEnter={(e: any) => {
                if (!e.shiftKey) {
                  e.preventDefault();
                  onSend();
                }
              }}
              disabled={loading}
              autoSize={{ minRows: 1, maxRows: 6 }}
              style={{ border: 'none', outline: 'none', boxShadow: 'none', resize: 'none', fontSize: 15, lineHeight: '22px', padding: 0, backgroundColor: 'transparent', color: token.colorText }}
            />

            <Button
              className="send-button"
              type="primary"
              icon={<SendOutlined style={{ fontSize: 16 }} />}
              onClick={onSend}
              disabled={loading || !input.trim()}
              style={{ height: 40, width: 40, borderRadius: '50%', padding: 0, border: 'none', backgroundColor: input.trim() && !loading ? '#10b981' : token.colorFillSecondary, color: input.trim() && !loading ? '#ffffff' : token.colorTextSecondary, cursor: input.trim() && !loading ? 'pointer' : 'not-allowed' }}
            />
          </div>
          <Text style={{ fontSize: 12, color: token.colorTextSecondary, display: 'block', textAlign: 'center', marginTop: 10 }}>Press Enter to send, Shift + Enter for new line</Text>
        </div>
        </div>
      </div>
    </>
  );
}
