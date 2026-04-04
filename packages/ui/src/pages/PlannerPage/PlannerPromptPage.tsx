import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Typography, theme } from 'antd';
import HeroInputCard from './components/HeroInputCard';
import { useAgents, useIntegrations, useTasks } from '../../hooks';
import type { Agent, Integration } from '../../types';

const { Title, Paragraph } = Typography;

export default function PlannerPromptPage() {
  const navigate = useNavigate();
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>(undefined);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [selectedIntegrationIds, setSelectedIntegrationIds] = useState<string[]>([]);
  const { createTaskStream } = useTasks();
  const { getAllIntegrations } = useIntegrations();
  const { getAllAgents } = useAgents();
  const inputRef = useRef<any>(null);
  const { token } = theme.useToken();

  useEffect(() => {
    (async () => {
      try {
        const data = await getAllAgents();
        setAgents(data);
        if (data.length > 0) setSelectedAgentId((id) => id ?? data[0].id);
      } catch (e) { console.error(e); }
    })();

    (async () => {
      try {
        const data = await getAllIntegrations();
        setIntegrations(data);
        const intData = data as Integration[];
        setSelectedIntegrationIds(intData.filter(i => i.enabled).map(i => i.id));
      } catch (e) { console.error(e); }
    })();
    inputRef.current?.focus();
  }, []);

  const handleSend = async () => {
    if (!input.trim() || loading) return;
    setLoading(true);

    try {
      const task = await createTaskStream(
        {
          description: input.trim(),
          agentId: selectedAgentId,
          tools: selectedIntegrationIds,
          chatHistory: [],
        },
        () => {
          // streaming events ignored on prompt page
        }
      );

      if (task?.id) {
        navigate(`/planner/${task.id}`);
      } else {
        console.error('Failed to create task');
      }
    } catch (err) {
      console.error('create task error', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 'calc(100vh - 30px)',
        padding: '40px 24px',
        backgroundColor: token.colorBgLayout,
      }}
    >
      <div style={{ maxWidth: 800, width: '100%' }}>
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <Title level={2} style={{ marginBottom: 12, fontSize: 32, fontWeight: 600 }}>
            What's on your agenda?
          </Title>
          <Paragraph
            type="secondary"
            style={{ fontSize: 16, marginBottom: 0, maxWidth: 600, margin: '0 auto' }}
          >
            Describe your security automation task, and our AI will generate an intelligent execution plan with visual step-by-step breakdown.
          </Paragraph>
        </div>

          <HeroInputCard
             input={input}
             setInput={setInput}
             loading={loading}
             agents={agents}
             selectedAgentId={selectedAgentId}
             setSelectedAgentId={setSelectedAgentId}
             integrations={integrations}
             selectedIntegrationIds={selectedIntegrationIds}
             setSelectedIntegrationIds={setSelectedIntegrationIds}
             onSend={handleSend}
             onKeyPress={(e: React.KeyboardEvent) => {
               if (e.key === 'Enter' && !e.shiftKey) {
                 e.preventDefault();
                 handleSend();
               }
             }}
             inputRef={inputRef}
           />
       </div>
     </div>
   );
 }
