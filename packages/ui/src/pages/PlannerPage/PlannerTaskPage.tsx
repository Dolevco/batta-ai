import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate, useParams, useSearchParams, useLocation } from 'react-router-dom';
import { Button, Card, Typography, Space, Select, Checkbox, Divider, theme } from 'antd';
import { ThunderboltOutlined, SettingOutlined, ArrowLeftOutlined, PlayCircleOutlined } from '@ant-design/icons';
import { TaskGraph } from '../../components/TaskGraph';
import StepDetailsDrawer from '../TaskExecutionPage/StepDetailsDrawer';
import ChatPanel from './components/ChatPanel';
import { useTasks, useIntegrations, useAgents } from '../../hooks';
import { useTheme } from '../../hooks';
import type { Integration } from '../../types';
import type { TaskResponse, StoredPlan, Agent } from '../../types';

const { Title, Text } = Typography;

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  isThinking?: boolean;
}

export default function PlannerTaskPage() {
  const navigate = useNavigate();
  const { taskId } = useParams<{ taskId?: string }>();
  const [searchParams] = useSearchParams();
  const { getAllAgents } = useAgents();
  const { getAllIntegrations } = useIntegrations();
  const { getTask, updateTask, sendTaskMessageStream, createTaskStream } = useTasks();
  const location = useLocation();
  // Determine where to go when the user clicks Back. Prefer location.state.from, then ?from= query param,
  // then browser history, and finally fall back to the home page.
  const fromState = (location.state as any)?.from;
  const fromParam = searchParams.get('from');
  const handleBack = useCallback(() => {
    if (fromState) {
      navigate(fromState);
      return;
    }
    if (fromParam) {
      navigate(fromParam);
      return;
    }
    try {
      if (window.history.length > 1) {
        navigate(-1);
        return;
      }
    } catch (e) {
      // ignore and fall through
    }
    navigate('/');
  }, [fromState, fromParam, navigate]);

  const [currentTaskId, setCurrentTaskId] = useState<string | null>(taskId || null);
  const [currentTask, setCurrentTask] = useState<TaskResponse | null>(null);
  const [currentPlan, setCurrentPlan] = useState<StoredPlan | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [selectedIntegrationIds, setSelectedIntegrationIds] = useState<string[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>(undefined);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [drawerVisible, setDrawerVisible] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<any>(null);
  const { token } = theme.useToken();
  const { theme: appTheme } = useTheme();

  // Load conversation for the current task
  useEffect(() => {
    if (taskId) {
      getTask(taskId).then(task => {
        if (task) {
          const uiMessages: Message[] = (task.chatMessages || []).map(chatMsg => ({
            id: chatMsg.id,
            role: chatMsg.role,
            content: chatMsg.content,
            timestamp: new Date(chatMsg.createdAt),
          }));

          setMessages(uiMessages);
          setCurrentTaskId(taskId);
          setCurrentTask(task);
          setCurrentPlan(task.plan || null);
          // Set agent and integrations based on loaded task when available
          setSelectedAgentId((task as any).agentId || undefined);
          if ((task as any).tools && Array.isArray((task as any).tools)) {
            setSelectedIntegrationIds((task as any).tools);
          }
        } else {
          navigate('/', { replace: true });
        }
      }).catch(error => {
        console.error('Failed to load task:', error);
        setMessages([]);
        setCurrentPlan(null);
        setCurrentTask(null);
        navigate('/', { replace: true });
      });
    } else {
      setMessages([]);
      setCurrentTaskId(null);
      setCurrentTask(null);
      setCurrentPlan(null);
    }
  }, [taskId, navigate]);

  useEffect(() => {
    (async () => {
      try {
        const data = await getAllIntegrations();
        setIntegrations(data);
        const intData = data as Integration[];
        setSelectedIntegrationIds(intData.filter(i => i.enabled).map(i => i.id));
      } catch (error) {
        console.error('Failed to load integrations:', error);
      }
    })();

    (async () => {
      try {
        const data = await getAllAgents();
        setAgents(data);
        if (!selectedAgentId && data.length > 0) {
          setSelectedAgentId(data[0].id);
        }
      } catch (error) {
        console.error('Failed to load agents:', error);
      }
    })();
  }, []);

  const handleCloseSettings = async () => {
    // Save settings to server only if something changed (agent or tools)
    try {
      if (currentTaskId && currentTask) {
        const currentAgentId = (currentTask as any).agentId || undefined;
        const currentTools: string[] = (currentTask as any).tools || [];

        const agentChanged = currentAgentId !== selectedAgentId;
        const toolsChanged = JSON.stringify(currentTools) !== JSON.stringify(selectedIntegrationIds || []);

        if (agentChanged || toolsChanged) {
          const updates: Partial<TaskResponse> = {};
          if (agentChanged) updates.agentId = selectedAgentId;
          if (toolsChanged) updates.tools = selectedIntegrationIds;

          const updated = await updateTask(currentTaskId, updates);
          setCurrentTask(updated);
          setCurrentPlan(updated.plan || null);
        }
      }
    } catch (err) {
      console.error('Failed to save task settings:', err);
    } finally {
      setIsSettingsOpen(false);
    }
  };

  // helper to scroll chat to bottom (used via ref elsewhere)
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };
  // ensure linter doesn't warn about unused function (it's used indirectly via ref)
  void scrollToBottom;

  const handleIntegrationToggle = (id: string) => {
    setSelectedIntegrationIds(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id);
      return [...prev, id];
    });
  };

  const handleAgentChange = (value: string) => {
    setSelectedAgentId(value);
  };

  const handleNodeClick = useCallback((stepId: string) => {
    setSelectedStepId(stepId);
    setDrawerVisible(true);
  }, []);

  const handleSend = async () => {
    if (!input.trim() || loading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      let task: TaskResponse;

      if (currentTaskId) {
        task = await sendTaskMessageStream(
          currentTaskId,
          userMessage.content,
          (eventName, data) => {
            if (eventName === 'toolUse') {
              const thinkingMsg: Message = {
                id: `thinking-${Date.now()}-${Math.random()}`,
                role: 'system',
                content: `🔧 ${data.name}\n${data.reason}`,
                timestamp: new Date(),
                isThinking: true,
              };
              setMessages((prev) => [...prev, thinkingMsg]);
            } else if (eventName === 'toolResult') {
              const resultMsg: Message = {
                id: `result-${Date.now()}-${Math.random()}`,
                role: 'system',
                content: data.success 
                  ? `✅ Completed` 
                  : `❌ Failed: ${data.error || 'Unknown error'}`,
                timestamp: new Date(),
                isThinking: true,
              };
              setMessages((prev) => [...prev, resultMsg]);
            }
          }
        );
      } else {
        const chatHistory = messages
          .filter(m => (m.role === 'user' || m.role === 'assistant') && !m.isThinking)
          .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

        task = await createTaskStream(
          { 
            description: userMessage.content,
            agentId: selectedAgentId,
            tools: selectedIntegrationIds,
            chatHistory,
          },
          (eventName, data) => {
            if (eventName === 'toolUse') {
              const thinkingMsg: Message = {
                id: `thinking-${Date.now()}-${Math.random()}`,
                role: 'system',
                content: `🔧 ${data.name}\n${data.reason}`,
                timestamp: new Date(),
                isThinking: true,
              };
              setMessages((prev) => [...prev, thinkingMsg]);
            } else if (eventName === 'toolResult') {
              const resultMsg: Message = {
                id: `result-${Date.now()}-${Math.random()}`,
                role: 'system',
                content: data.success 
                  ? `✅ Completed` 
                  : `❌ Failed: ${data.error || 'Unknown error'}`,
                timestamp: new Date(),
                isThinking: true,
              };
              setMessages((prev) => [...prev, resultMsg]);
            }
          }
        );
      }

      setMessages((prev) => {
        const filtered = prev.filter(m => !m.isThinking);

        const latestChatMessage = task.chatMessages?.[task.chatMessages.length - 1];
        const assistantContent = latestChatMessage?.role === 'assistant' 
          ? latestChatMessage.content 
          : 'Response received.';

        const assistantMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: assistantContent,
          timestamp: new Date(),
        };

        return [...filtered, assistantMessage];
      });

      setCurrentPlan(task.plan || null);
      setCurrentTask(task);
      
      if (!currentTaskId && task.id) {
        setCurrentTaskId(task.id);
        navigate(`/planner/${task.id}`, { replace: true });
      }
    } catch (error) {
      setMessages((prev) => prev.filter(m => !m.isThinking));
      
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'Sorry, I encountered an error creating the task plan. Please try again.',
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setLoading(false);
    }
  };

  // Full-screen chat view (no graph)
  const renderFullScreenChat = () => (
    <div style={{ height: 'calc(100vh - 30px)', display: 'flex', flexDirection: 'column', backgroundColor: token.colorBgLayout, minHeight: 0 }}>
      {/* Header */}
      <div style={{ padding: '16px 24px', borderBottom: `1px solid ${token.colorBorder}`, backgroundColor: token.colorBgContainer }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Space size={12}>
            <div style={{ width: 36, height: 36, borderRadius: 8, backgroundColor: '#f0f7ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ThunderboltOutlined style={{ fontSize: 18, color: '#1890ff' }} />
            </div>
            <div>
              <Title level={5} style={{ margin: 0, fontSize: 16 }}>Task Planner</Title>
            </div>
          </Space>
          <Space>
            {currentTaskId && (<Button type="text" icon={<ArrowLeftOutlined />} onClick={handleBack}>Back</Button>)}
            <Button icon={<SettingOutlined />} onClick={() => setIsSettingsOpen(true)} />
          </Space>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
        <ChatPanel
          messages={messages}
          loading={loading}
          messagesEndRef={messagesEndRef}
          input={input}
          setInput={setInput}
          inputRef={inputRef}
          onSend={handleSend}
          compact={false}
        />
      </div>

      {/* Settings overlay when open */}
      {isSettingsOpen && (
        <>
          <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.45)', zIndex: 999 }} onClick={handleCloseSettings} />
          <div style={{ position: 'fixed', right: 0, top: 0, bottom: 0, width: 420, backgroundColor: token.colorBgContainer, boxShadow: '-4px 0 24px rgba(0,0,0,0.15)', zIndex: 1000, display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '16px 20px', borderBottom: `1px solid ${token.colorBorder}` }}>
              <Space size={8}>
                <Button type="text" icon={<ArrowLeftOutlined />} onClick={handleCloseSettings} />
                <Text strong style={{ fontSize: 14 }}>Settings</Text>
              </Space>
            </div>
            <div style={{ padding: 20, overflow: 'auto', flex: 1, color: token.colorText }}>
              <div style={{ marginBottom: 20 }}>
                <Text strong>Agent</Text>
                <div style={{ marginTop: 8 }}>
                  <Select style={{ width: '100%' }} value={selectedAgentId} onChange={handleAgentChange} placeholder="Select agent" dropdownStyle={{ background: token.colorBgElevated, border: `1px solid ${token.colorBorder}` }}>
                    {agents.map(a => (<Select.Option key={a.id} value={a.id}>{a.name}</Select.Option>))}
                  </Select>
                </div>
              </div>
              <Divider />
              <div>
                <Text strong>Integrations</Text>
                <div style={{ marginTop: 8 }}>
                  {integrations.map(intg => (
                    <div key={intg.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', color: token.colorText }}>
                      <div>
                        <Text style={{ color: token.colorText }}>{intg.name}</Text>
                        <div style={{ fontSize: 12, color: token.colorTextSecondary }}>{intg.type}</div>
                      </div>
                      <Checkbox checked={selectedIntegrationIds.includes(intg.id)} onChange={() => handleIntegrationToggle(intg.id)} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );

  // Render split view with graph and chat when plan exists
  const renderSplitView = () => (
    <div
      style={{
        display: 'flex',
        height: 'calc(100vh - 30px)',
        backgroundColor: token.colorBgLayout,
      }}
    >
      {/* Main Content - Graph View */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div 
          style={{ 
            padding: '16px 24px', 
            borderBottom: `1px solid ${token.colorBorder}`, 
            backgroundColor: token.colorBgContainer,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Space size={12}>
              <div 
                style={{ 
                  width: 36,
                  height: 36,
                  borderRadius: 8,
                  backgroundColor: '#f0f7ff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <ThunderboltOutlined style={{ fontSize: 18, color: '#1890ff' }} />
              </div>
              <div>
                <Title level={5} style={{ margin: 0, fontSize: 16 }}>
                  Execution Plan
                </Title>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {currentPlan!.subTasks.length} steps
                </Text>
              </div>
            </Space>
            <Space>
              <Button
                type="text"
                icon={<ArrowLeftOutlined />}
                onClick={handleBack}
              >
                Back
              </Button>
              <Button 
                type="primary"
                icon={<PlayCircleOutlined />}
                onClick={() => navigate(`/execution/${currentTask!.id}`)}
              >
                Try it now
              </Button>
              <Button
                icon={<SettingOutlined />}
                onClick={() => setIsSettingsOpen(true)}
              />
            </Space>
          </div>
        </div>
        
        {/* Graph Content */}
        <div
          style={{
            flex: 1,
            padding: '24px',
            overflow: 'auto',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
          }}
        >
          <div style={{ width: '100%', maxWidth: 1200 }}>
            <Card
              bordered={false}
              style={{
                borderRadius: 12,
                boxShadow: appTheme === 'dark' ? '0 8px 24px rgba(0,0,0,0.6)' : '0 2px 12px rgba(0, 0, 0, 0.06)',
                background: token.colorBgContainer,
              }}
            >
              <TaskGraph plan={currentPlan!} onNodeClick={handleNodeClick} />
            </Card>
          </div>
        </div>
      </div>

      {/* Right Side Panel - Chat or Settings */}
      <div style={{ width: 420, display: 'flex', flexDirection: 'column', backgroundColor: token.colorBgLayout, borderLeft: `1px solid ${token.colorBorder}`, overflow: 'hidden', minHeight: 0 }}>
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${token.colorBorder}`, backgroundColor: token.colorBgElevated, flexShrink: 0 }}>
          <Space size={8}>
            {isSettingsOpen ? (
              <>
                <Button type="text" icon={<ArrowLeftOutlined />} onClick={handleCloseSettings} />
                <Text strong style={{ fontSize: 14 }}>Settings</Text>
              </>
            ) : (
              <>
                <Text strong style={{ fontSize: 14 }}>Conversation</Text>
              </>
            )}
          </Space>
        </div>

        {!isSettingsOpen ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
            <ChatPanel
              messages={messages}
              loading={loading}
              messagesEndRef={messagesEndRef}
              input={input}
              setInput={setInput}
              inputRef={inputRef}
              onSend={handleSend}
              compact={true}
            />
          </div>
        ) : (
          <div style={{ padding: 16, overflow: 'auto', color: token.colorText, flex: 1, minHeight: 0 }}>
            <div style={{ marginBottom: 12 }}>
              <Text strong>Agent</Text>
              <div style={{ marginTop: 8 }}>
                <Select style={{ width: '100%' }} value={selectedAgentId} onChange={handleAgentChange} placeholder="Select agent" dropdownStyle={{ background: token.colorBgElevated, border: `1px solid ${token.colorBorder}` }}>
                  {agents.map(a => (<Select.Option key={a.id} value={a.id}>{a.name}</Select.Option>))}
                </Select>
              </div>
            </div>

            <Divider />

            <div>
              <Text strong>Integrations</Text>
              <div style={{ marginTop: 8 }}>
                {integrations.map(intg => (
                  <div key={intg.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', color: token.colorText }}>
                    <div>
                      <Text style={{ color: token.colorText }}>{intg.name}</Text>
                      <div style={{ fontSize: 12, color: token.colorTextSecondary }}>{intg.type}</div>
                    </div>
                    <Checkbox checked={selectedIntegrationIds.includes(intg.id)} onChange={() => handleIntegrationToggle(intg.id)} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Step Details Drawer */}
      <StepDetailsDrawer
        selectedStep={currentPlan?.subTasks.find(st => st.id === selectedStepId) || null}
        visible={drawerVisible}
        onClose={() => setDrawerVisible(false)}
      />
    </div>
  );

  return currentPlan?.subTasks?.length ? renderSplitView() : renderFullScreenChat();
}
