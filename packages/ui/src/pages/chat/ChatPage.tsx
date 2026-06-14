import { useState, useRef, useEffect } from 'react';
import { Input, Button, Spin } from 'antd';
import {
  SendOutlined, UserOutlined,
  AuditOutlined, WarningOutlined, ApartmentOutlined,
  BugOutlined, CheckSquareOutlined, ShareAltOutlined,
} from '@ant-design/icons';
import { useChat } from '../../hooks';
import { useTheme } from '../../hooks/useTheme';
import { T, D } from '../../theme';
import { useChatHistory } from '../../hooks/useChatHistory';
import { useCapabilities } from '../../hooks/useCapabilities';
import { AssetRelationshipGraph } from '../../components/diagram/AssetRelationshipGraph';
import { FeatureDiagram } from '../../components/diagram/FeatureDiagram';
import { ChatEntityTable } from '../../components/chat/ChatEntityTable';
import type { BusinessFeature } from '../../types';
import type { TableProjection } from '../../components/chat/ChatEntityTable';
import type { GraphProjection, ChatMessage as Message, DfdPayload } from '../../hooks/useChatHistory';

// ── Suggestion cards ──────────────────────────────────────────────────────────

const SUGGESTIONS = [
  {
    category: 'Reviews',
    categoryColor: T.indigo,
    Icon: AuditOutlined,
    title: 'Recent security reviews',
    text: 'List my recent security reviews and their status',
  },
  {
    category: 'Risk',
    categoryColor: T.red,
    Icon: WarningOutlined,
    title: 'High risk features',
    text: 'Show business features with high risk scores',
  },
  {
    category: 'Diagrams',
    categoryColor: T.teal,
    Icon: ApartmentOutlined,
    title: 'Data flow diagram',
    text: 'Show the data flow diagram for the authentication feature',
  },
  {
    category: 'Threats',
    categoryColor: T.amber,
    Icon: BugOutlined,
    title: 'STRIDE analysis',
    text: 'What STRIDE threats are identified in our payment feature?',
  },
  {
    category: 'Tasks',
    categoryColor: T.emerald,
    Icon: CheckSquareOutlined,
    title: 'Critical open tasks',
    text: 'Which security reviews have unresolved critical tasks?',
  },
  {
    category: 'Graph',
    categoryColor: T.purple,
    Icon: ShareAltOutlined,
    title: 'Shared services',
    text: 'Show which features share the same source services',
  },
];

// ── Logo icon ─────────────────────────────────────────────────────────────────

function LogoIcon({ size = 20 }: { size?: number }) {
  return (
    <img
      src="/images/logo.svg"
      alt="logo"
      style={{
        width: size,
        height: size,
        filter:
          'brightness(0) saturate(100%) invert(55%) sepia(90%) saturate(500%) hue-rotate(345deg) brightness(1.05)',
      }}
    />
  );
}

// ── DFD payload → BusinessFeature adapter ─────────────────────────────────────

function dfdToFeature(dfd: DfdPayload): BusinessFeature {
  return {
    id: 'chat-dfd',
    tenantId: '',
    entityType: 'feature_analysis',
    name: dfd.featureName,
    description: '',
    businessValue: '',
    userStories: [],
    technicalSummary: '',
    correlationTags: [],
    sourceServiceIds: [],
    dataFlowDiagram: {
      actors:          dfd.actors,
      processes:       dfd.processes,
      dataStores:      dfd.dataStores,
      flows:           dfd.flows,
      trustBoundaries: dfd.trustBoundaries,
    } as any,
    threatModel: {} as any,
    confidence: 'heuristic',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    metadata: {},
  };
}

// ── Markdown renderer ─────────────────────────────────────────────────────────

/**
 * Renders a small subset of markdown used by the LLM:
 *   **bold**, bullet lists (- item), and standalone bold lines as headings.
 */
function renderInline(text: string, isDark: boolean): React.ReactNode[] {
  // Split on **...**
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      const inner = part.slice(2, -2);
      return <strong key={i} style={{ color: isDark ? D.text : T.stone900 }}>{inner}</strong>;
    }
    return <span key={i}>{part}</span>;
  });
}

function MarkdownContent({ text, isDark }: { text: string; isDark: boolean }) {
  const lines = text.split('\n');
  const nodes: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Blank line → spacer
    if (line.trim() === '') {
      nodes.push(<div key={i} style={{ height: 8 }} />);
      i++;
      continue;
    }

    // Bullet list item
    if (/^(\s*[-*])\s/.test(line)) {
      // Collect consecutive bullet lines
      const bulletLines: string[] = [];
      while (i < lines.length && /^(\s*[-*])\s/.test(lines[i])) {
        bulletLines.push(lines[i].replace(/^\s*[-*]\s/, ''));
        i++;
      }
      nodes.push(
        <ul key={`ul-${i}`} style={{ margin: '4px 0', paddingLeft: 20, listStyle: 'disc' }}>
          {bulletLines.map((bl, j) => (
            <li key={j} style={{ marginBottom: 4 }}>
              {renderInline(bl, isDark)}
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // Standalone bold-only line → treat as a section heading
    const trimmed = line.trim();
    if (/^\*\*[^*]+\*\*$/.test(trimmed)) {
      const headingText = trimmed.slice(2, -2);
      nodes.push(
        <div key={i} style={{
          fontWeight: 700,
          fontSize: 14,
          color: isDark ? D.text : T.stone900,
          marginTop: 14,
          marginBottom: 4,
        }}>
          {headingText}
        </div>
      );
      i++;
      continue;
    }

    // Regular paragraph line
    nodes.push(
      <div key={i} style={{ marginBottom: 2 }}>
        {renderInline(line, isDark)}
      </div>
    );
    i++;
  }

  return <>{nodes}</>;
}

// ── Chat page ─────────────────────────────────────────────────────────────────

export function ChatPage() {
  const { sendChat } = useChat();
  const { byId, loading: capabilitiesLoading } = useCapabilities();
  const { messages, setMessages } = useChatHistory();
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [chainOfThought, setChainOfThought] = useState('');
  const [currentGraph, setCurrentGraph] = useState<GraphProjection | null>(null);
  const [currentTable, setCurrentTable] = useState<TableProjection | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { theme: appTheme } = useTheme();
  const isDark = appTheme === 'dark';
  const portalChat = byId.get('portalChat');

  const formatChainOfThought = (text: string) => {
    if (!text) return '';
    const trimmed = text.trim();
    if (/^to\s+/i.test(trimmed)) {
      const rest = trimmed.replace(/^to\s+/i, '');
      return rest.length > 0 ? rest.charAt(0).toUpperCase() + rest.slice(1) : rest;
    }
    return trimmed;
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent, chainOfThought]);

  const handleSend = async () => {
    if (!input.trim() || loading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: new Date().toISOString(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);
    setStreamingContent('');
    setChainOfThought('');
    setCurrentGraph(null);
    setCurrentTable(null);

    try {
      const assistantMessageId = Date.now().toString();
      let capturedGraph: GraphProjection | null = null;
      let capturedTable: TableProjection | null = null;

      await sendChat(
        input,
        messages.map(m => ({ role: m.role, content: m.content })),
        (eventName, parsed) => {
          if (eventName === 'done') {
            setMessages(prev => [...prev, {
              id: assistantMessageId,
              role: 'assistant',
              content: parsed.content || streamingContent,
              timestamp: new Date().toISOString(),
              graph: capturedGraph || undefined,
              table: capturedTable || undefined,
            }]);
            setStreamingContent('');
            setChainOfThought('');
            setCurrentGraph(null);
            setCurrentTable(null);
          } else if (eventName === 'graph') {
            capturedGraph = parsed;
            capturedTable = null; // mutually exclusive
            setCurrentGraph(parsed);
            setCurrentTable(null);
          } else if (eventName === 'table') {
            capturedTable = parsed;
            capturedGraph = null; // mutually exclusive
            setCurrentTable(parsed);
            setCurrentGraph(null);
          } else if (eventName === 'tool_use') {
            setChainOfThought(parsed.reason || `Using ${parsed.name}...`);
            setStreamingContent('');
          } else if (eventName === 'stream_chunk') {
            setChainOfThought('');
            setStreamingContent(prev => prev + parsed.content);
          } else if (eventName === 'message') {
            if (parsed.content) {
              setChainOfThought('');
              setStreamingContent(parsed.content);
            }
          } else if (eventName === 'error') {
            throw new Error(parsed.message || 'Unknown error');
          }
        }
      );
    } catch (error) {
      console.error('Chat error:', error);
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.',
        timestamp: new Date().toISOString(),
      }]);
    } finally {
      setLoading(false);
      setStreamingContent('');
      setChainOfThought('');
      setCurrentGraph(null);
      setCurrentTable(null);
    }
  };

  // The chat page needs to escape the parent's padding and fill the whole content area.
  // We use negative margins to cancel the MainLayout padding (16px).
  const BLEED = 16;
  const MAX_W = 790;

  if (capabilitiesLoading && !portalChat) {
    return (
      <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spin />
      </div>
    );
  }

  if (portalChat?.available === false) {
    return (
      <div style={{ maxWidth: 760, margin: '48px auto', padding: 24 }}>
        <div style={{ border: `1px solid ${isDark ? D.border : T.stone200}`, borderRadius: 8, background: isDark ? D.bgCard : T.white, padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <LogoIcon size={22} />
            <h1 style={{ margin: 0, fontSize: 20, color: isDark ? D.text : T.stone900 }}>Enable portal chat</h1>
          </div>
          <p style={{ margin: '0 0 16px', color: isDark ? D.textMuted : T.stone500, lineHeight: 1.6 }}>
            Chat uses the indexed knowledge base with an LLM and embeddings. Local MCP indexing and deterministic browsing still work without these providers.
          </p>
          <div style={{ display: 'grid', gap: 8, marginBottom: 18 }}>
            {portalChat.reasons.map(reason => (
              <div key={reason} style={{ fontSize: 13, color: isDark ? D.textMuted : T.stone600 }}>
                {reason}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {portalChat.setupActions.map(action => (
              <Button key={`${action.kind}-${action.label}`} type={action.href ? 'primary' : 'default'} href={action.href}>
                {action.label}
              </Button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <style>{`
        @keyframes app-blink { 0%,100%{opacity:1} 50%{opacity:0.2} }
        @keyframes app-pulse {
          0%,100% { opacity:1; transform:scale(1); }
          50%      { opacity:0.6; transform:scale(1.15); }
        }

        .app-msg-enter { animation: app-msg-in 0.25s ease-out both; }
        @keyframes app-msg-in {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        .app-input-wrap { transition: box-shadow 0.15s, border-color 0.15s; }
        .app-input-wrap:focus-within {
          border-color: ${T.orange} !important;
          box-shadow: 0 0 0 3px rgba(249,115,22,0.1) !important;
        }

        .app-chip { transition: border-color 0.15s, background 0.15s, color 0.15s; }
        .app-chip:hover {
          border-color: ${T.orange} !important;
          background: ${isDark ? 'rgba(249,115,22,0.1)' : T.orangeLight} !important;
          color: ${T.orange} !important;
        }

        .app-messages::-webkit-scrollbar { width: 5px; }
        .app-messages::-webkit-scrollbar-track { background: transparent; }
        .app-messages::-webkit-scrollbar-thumb {
          background: ${isDark ? D.border : T.stone200};
          border-radius: 99px;
        }
      `}</style>

      {/*
        Full-bleed container: cancel the 16px MainLayout padding on all sides,
        then use flexbox to fill the remaining viewport height.
      */}
      <div style={{
        margin: -BLEED,
        height: `calc(100vh - 0px)`,
        display: 'flex',
        flexDirection: 'column',
        background: isDark ? '#141210' : T.stone100,
        overflow: 'hidden',
        position: 'relative',
      }}>

        {/* ── Landing (no messages yet) ─────────────────────────────── */}
        {messages.length === 0 && (
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 24px 48px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 }}>
              <div style={{
                width: 40, height: 40, borderRadius: 12, flexShrink: 0,
                background: isDark
                  ? 'linear-gradient(135deg, #1f1a16 0%, #2d1f0e 100%)'
                  : 'linear-gradient(135deg, #fff7ed 0%, #ffedd5 100%)',
                border: `1.5px solid ${isDark ? 'rgba(249,115,22,0.25)' : 'rgba(249,115,22,0.3)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: isDark
                  ? '0 4px 16px rgba(249,115,22,0.2)'
                  : '0 4px 16px rgba(249,115,22,0.15)',
              }}>
                <LogoIcon size={22} />
              </div>
              <h2 style={{
                margin: 0, fontSize: 26, fontWeight: 700,
                color: isDark ? D.text : T.stone900,
                letterSpacing: '-0.4px', lineHeight: 1.2,
              }}>
                How can I help you today?
              </h2>
            </div>

            {/* Centered input */}
            <div
              className="app-input-wrap"
              style={{
                width: '100%', maxWidth: MAX_W,
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '14px 14px 14px 20px',
                background: isDark ? D.bg : T.white,
                border: `1px solid ${isDark ? D.border : T.stone200}`,
                borderRadius: 18,
                boxShadow: isDark
                  ? '0 4px 32px rgba(0,0,0,0.5)'
                  : '0 4px 32px rgba(28,25,23,0.08)',
              }}
            >
              <Input.TextArea
                placeholder="Ask about security reviews, features, threats, or data flows…"
                value={input}
                onChange={e => setInput(e.target.value)}
                onPressEnter={e => {
                  if (!e.shiftKey) { e.preventDefault(); handleSend(); }
                }}
                autoSize={{ minRows: 2, maxRows: 6 }}
                style={{
                  border: 'none', outline: 'none', boxShadow: 'none',
                  resize: 'none', fontSize: 16, lineHeight: '26px', padding: 0,
                  backgroundColor: 'transparent',
                  color: isDark ? T.stone300 : T.stone800,
                }}
                styles={{ textarea: { backgroundColor: 'transparent' } }}
              />
              <Button
                icon={<SendOutlined style={{ fontSize: 14 }} />}
                onClick={handleSend}
                disabled={loading || !input.trim()}
                style={{
                  height: 38, width: 38, borderRadius: 10, flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  padding: 0, border: 'none', alignSelf: 'flex-end', marginBottom: 1,
                  background: input.trim() && !loading ? T.orange : (isDark ? D.border : T.stone100),
                  color: input.trim() && !loading ? T.white : T.stone400,
                  cursor: input.trim() && !loading ? 'pointer' : 'not-allowed',
                  transition: 'background 0.15s, box-shadow 0.15s',
                  boxShadow: input.trim() && !loading ? '0 2px 10px rgba(249,115,22,0.3)' : 'none',
                }}
              />
            </div>

            {/* Suggestion chips */}
            <div style={{
              display: 'flex', flexWrap: 'wrap', gap: 8,
              justifyContent: 'center', marginTop: 16,
              maxWidth: MAX_W, width: '100%',
            }}>
              {SUGGESTIONS.map((s, i) => (
                <button
                  key={i}
                  className="app-chip"
                  onClick={() => setInput(s.text)}
                  style={{
                    padding: '6px 13px',
                    borderRadius: 99,
                    border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : T.stone200}`,
                    background: isDark ? 'rgba(255,255,255,0.04)' : T.white,
                    color: isDark ? T.stone400 : T.stone500,
                    fontSize: 13, cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}
                >
                  <s.Icon style={{ fontSize: 13 }} />
                  {s.title}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Scrollable messages ──────────────────────────────────────── */}
        {messages.length > 0 && (
        <div
          className="app-messages"
          style={{
            flex: 1,
            overflowY: 'auto',
            // Extra bottom padding so last message clears the floating input bar
            paddingBottom: 160,
          }}
        >
          <div style={{ maxWidth: MAX_W, margin: '0 auto', padding: '48px 24px 0' }}>

            {/* ── Conversation ─────────────────────────────────────────── */}
            {messages.map((message) => (
              <div
                key={message.id}
                className="app-msg-enter"
                style={{
                  display: 'flex', gap: 16, alignItems: 'flex-start',
                  marginBottom: 32,
                }}
              >
                {/* Avatar */}
                <div style={{ flexShrink: 0, paddingTop: 2 }}>
                  {message.role === 'assistant' ? (
                    <div style={{
                      width: 28, height: 28, borderRadius: 8,
                      background: T.orangeLight,
                      border: `1px solid rgba(249,115,22,0.2)`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <LogoIcon size={15} />
                    </div>
                  ) : (
                    <div style={{
                      width: 28, height: 28, borderRadius: '50%',
                      background: T.blue,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <UserOutlined style={{ fontSize: 13, color: '#fff' }} />
                    </div>
                  )}
                </div>

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{
                    fontSize: 13, fontWeight: 600,
                    color: isDark ? D.text : T.stone900,
                    display: 'block', marginBottom: 6,
                  }}>
                    {message.role === 'user' ? 'You' : 'batta-ai'}
                  </span>
                  <div style={{
                    fontSize: 15, lineHeight: '1.75',
                    color: isDark ? T.stone300 : T.stone800,
                    wordBreak: 'break-word',
                  }}>
                    <MarkdownContent text={message.content} isDark={isDark} />
                  </div>

                  {/* Graph */}
                  {message.graph && (
                    <div style={{
                      marginTop: 16,
                      border: `1px solid ${isDark ? D.border : T.stone200}`,
                      borderRadius: 12, overflow: 'hidden',
                    }}>
                      {message.graph.explanation && (
                        <div style={{
                          padding: '8px 14px',
                          borderBottom: `1px solid ${isDark ? D.border : T.stone100}`,
                          background: isDark ? D.bg : T.stone50,
                          fontSize: 12, color: T.stone500, fontStyle: 'italic',
                        }}>
                          {message.graph.explanation}
                        </div>
                      )}
                      <div style={{ height: 480, position: 'relative' }}>
                        {message.graph.graphType === 'dfd' && message.graph.dfd ? (
                          <FeatureDiagram feature={dfdToFeature(message.graph.dfd)} />
                        ) : (
                          <AssetRelationshipGraph graph={message.graph} />
                        )}
                      </div>
                    </div>
                  )}

                  {/* Table (mutually exclusive with graph) */}
                  {!message.graph && message.table && (
                    <div style={{ marginTop: 16 }}>
                      <ChatEntityTable table={message.table} />
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* ── Loading / streaming ──────────────────────────────────── */}
            {(loading || streamingContent || chainOfThought) && (
              <div className="app-msg-enter" style={{
                display: 'flex', gap: 16, alignItems: 'flex-start',
                marginBottom: 32,
              }}>
                <div style={{ flexShrink: 0, paddingTop: 2 }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: 8,
                    background: T.orangeLight,
                    border: `1px solid rgba(249,115,22,0.2)`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <LogoIcon size={15} />
                  </div>
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{
                    fontSize: 13, fontWeight: 600,
                    color: isDark ? D.text : T.stone900,
                    display: 'block', marginBottom: 6,
                  }}>
                    batta-ai
                  </span>

                  {/* Chain of thought pill */}
                  {chainOfThought && (
                    <div style={{
                      display: 'inline-flex', alignItems: 'center', gap: 7,
                      marginBottom: streamingContent ? 10 : 0,
                      padding: '5px 11px', borderRadius: 99,
                      background: isDark ? 'rgba(249,115,22,0.08)' : 'rgba(249,115,22,0.07)',
                      border: `1px solid rgba(249,115,22,0.15)`,
                    }}>
                      <Spin size="small" />
                      <span style={{ color: T.stone500, fontSize: 12, fontStyle: 'italic' }}>
                        {formatChainOfThought(chainOfThought)}
                      </span>
                    </div>
                  )}

                  {/* Streaming text */}
                  {streamingContent && (
                    <div style={{
                      fontSize: 15, lineHeight: '1.75',
                      color: isDark ? T.stone300 : T.stone800,
                      wordBreak: 'break-word',
                    }}>
                      <MarkdownContent text={streamingContent} isDark={isDark} />
                      <span style={{
                        display: 'inline-block', width: 2, height: 17,
                        background: T.orange, marginLeft: 2,
                        verticalAlign: 'text-bottom',
                        animation: 'app-blink 0.9s infinite',
                      }} />
                    </div>
                  )}

                  {/* Pure thinking state (no CoT, no stream yet) */}
                  {!streamingContent && !chainOfThought && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Spin size="small" />
                      <span style={{ color: T.stone400, fontSize: 14 }}>Thinking…</span>
                    </div>
                  )}

                  {/* Live graph during streaming */}
                  {currentGraph && (
                    <div style={{
                      marginTop: 16,
                      border: `1px solid ${isDark ? D.border : T.stone200}`,
                      borderRadius: 12, overflow: 'hidden',
                    }}>
                      {currentGraph.explanation && (
                        <div style={{
                          padding: '8px 14px',
                          borderBottom: `1px solid ${isDark ? D.border : T.stone100}`,
                          background: isDark ? D.bg : T.stone50,
                          fontSize: 12, color: T.stone500, fontStyle: 'italic',
                        }}>
                          {currentGraph.explanation}
                        </div>
                      )}
                      <div style={{ height: 480, position: 'relative' }}>
                        {currentGraph.graphType === 'dfd' && currentGraph.dfd ? (
                          <FeatureDiagram feature={dfdToFeature(currentGraph.dfd)} />
                        ) : (
                          <AssetRelationshipGraph graph={currentGraph} />
                        )}
                      </div>
                    </div>
                  )}

                  {/* Live table during streaming (mutually exclusive with graph) */}
                  {!currentGraph && currentTable && (
                    <div style={{ marginTop: 16 }}>
                      <ChatEntityTable table={currentTable} />
                    </div>
                  )}
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>
        )}

        {/* ── Floating input bar (only when chatting) ──────────────────── */}
        {messages.length > 0 && <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          // Fade the background upward so messages don't hard-cut behind the bar
          background: isDark
            ? 'linear-gradient(to bottom, transparent, #141210 28%)'
            : `linear-gradient(to bottom, transparent, ${T.stone100} 28%)`,
          paddingTop: 32,
          paddingBottom: 20,
          pointerEvents: 'none',
        }}>
          <div style={{
            maxWidth: MAX_W, margin: '0 auto', padding: '0 24px',
            pointerEvents: 'all',
          }}>
            {/* Input pill */}
            <div
              className="app-input-wrap"
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '12px 12px 12px 18px',
                background: isDark ? D.bg : T.white,
                border: `1px solid ${isDark ? D.border : T.stone200}`,
                borderRadius: 16,
                boxShadow: isDark
                  ? '0 4px 24px rgba(0,0,0,0.5)'
                  : '0 4px 24px rgba(28,25,23,0.08)',
              }}
            >
              <Input.TextArea
                placeholder="Ask about security reviews, features, threats, or data flows…"
                value={input}
                onChange={e => setInput(e.target.value)}
                onPressEnter={e => {
                  if (!e.shiftKey) { e.preventDefault(); handleSend(); }
                }}
                disabled={loading}
                autoSize={{ minRows: 1, maxRows: 6 }}
                style={{
                  border: 'none', outline: 'none', boxShadow: 'none',
                  resize: 'none', fontSize: 15, lineHeight: '24px', padding: 0,
                  backgroundColor: 'transparent',
                  color: isDark ? T.stone300 : T.stone800,
                }}
                styles={{ textarea: { backgroundColor: 'transparent' } }}
              />
              <Button
                icon={<SendOutlined style={{ fontSize: 14 }} />}
                onClick={handleSend}
                disabled={loading || !input.trim()}
                style={{
                  height: 36, width: 36, borderRadius: 10, flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  padding: 0, border: 'none', marginBottom: 1,
                  background: input.trim() && !loading ? T.orange : (isDark ? D.border : T.stone100),
                  color: input.trim() && !loading ? T.white : T.stone400,
                  cursor: input.trim() && !loading ? 'pointer' : 'not-allowed',
                  transition: 'background 0.15s, box-shadow 0.15s',
                  boxShadow: input.trim() && !loading ? '0 2px 10px rgba(249,115,22,0.3)' : 'none',
                }}
              />
            </div>

            {/* Hint */}
            <p style={{
              margin: '8px 0 0', fontSize: 11,
              color: T.stone400, textAlign: 'center',
            }}>
              Enter to send · Shift + Enter for new line
            </p>
          </div>
        </div>}
      </div>
    </>
  );
}
