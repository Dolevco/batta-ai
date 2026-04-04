import { useState, useEffect, useRef, useMemo } from 'react';
import { Card, theme, Typography } from 'antd';
import { 
  FileTextOutlined, 
  CodeOutlined, 
  SearchOutlined, 
  FolderOpenOutlined,
  BranchesOutlined,
  CloudServerOutlined,
  ToolOutlined,
  RobotOutlined,
  SafetyOutlined,
  MessageOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined
} from '@ant-design/icons';
import type { Thought } from '../../types';
import { useTheme } from '../../hooks';
import { AgentTVCanvas } from './AgentTVCanvas';
import { convertThoughtsToVisualizationEvents } from './AgentTVCanvas/thoughtConverter';

const { Text } = Typography;

interface Props {
  chainOfThoughts: Thought[];
  isExecuting?: boolean;
  executionStatus?: 'idle' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
}

interface VisualizationState {
  currentTool: string | null;
  currentAction: string | null;
  toolIcon: React.ReactNode;
  toolColor: string;
  animationPhase: 'idle' | 'working' | 'success' | 'error';
  progress: number;
  details: string;
}

// Map tool names to visual representations
const getToolVisualization = (toolName: string): { icon: React.ReactNode; label: string; color: string } => {
  const name = toolName.toLowerCase();
  
  // File operations
  if (name.includes('read_file') || name.includes('readfile')) {
    return { icon: <FileTextOutlined />, label: 'Reading file', color: '#1890ff' };
  }
  if (name.includes('write_file') || name.includes('writefile') || name.includes('create_file')) {
    return { icon: <FileTextOutlined />, label: 'Writing file', color: '#52c41a' };
  }
  if (name.includes('search') && name.includes('file')) {
    return { icon: <SearchOutlined />, label: 'Searching files', color: '#722ed1' };
  }
  if (name.includes('list_files') || name.includes('list_dir') || name.includes('listdir')) {
    return { icon: <FolderOpenOutlined />, label: 'Listing directory', color: '#faad14' };
  }
  if (name.includes('insert') || name.includes('replace') || name.includes('edit') || name.includes('modify')) {
    return { icon: <CodeOutlined />, label: 'Editing code', color: '#13c2c2' };
  }
  if (name.includes('delete') || name.includes('remove')) {
    return { icon: <FileTextOutlined />, label: 'Deleting file', color: '#ff4d4f' };
  }
  
  // Git operations
  if (name.includes('git_commit')) {
    return { icon: <BranchesOutlined />, label: 'Committing changes', color: '#52c41a' };
  }
  if (name.includes('git_push')) {
    return { icon: <BranchesOutlined />, label: 'Pushing to remote', color: '#1890ff' };
  }
  if (name.includes('git_status') || name.includes('git_diff')) {
    return { icon: <BranchesOutlined />, label: 'Checking status', color: '#faad14' };
  }
  if (name.includes('git')) {
    return { icon: <BranchesOutlined />, label: 'Git operation', color: '#f5222d' };
  }
  
  // Command execution
  if (name.includes('execute') || name.includes('command') || name.includes('run')) {
    return { icon: <CloudServerOutlined />, label: 'Running command', color: '#2f54eb' };
  }
  
  // Delegation
  if (name.includes('delegate')) {
    return { icon: <RobotOutlined />, label: 'Delegating subtask', color: '#eb2f96' };
  }
  
  // Security tools
  if (name.includes('security') || name.includes('vulnerability') || name.includes('threat')) {
    return { icon: <SafetyOutlined />, label: 'Security analysis', color: '#fa541c' };
  }
  
  // Communication
  if (name.includes('chat') || name.includes('message') || name.includes('slack') || name.includes('notify')) {
    return { icon: <MessageOutlined />, label: 'Sending message', color: '#a0d911' };
  }
  
  // Task completion
  if (name.includes('task_complete') || name.includes('completion')) {
    return { icon: <CheckCircleOutlined />, label: 'Task complete', color: '#52c41a' };
  }
  
  // Planning
  if (name.includes('plan') || name.includes('analyze')) {
    return { icon: <ToolOutlined />, label: 'Planning', color: '#9254de' };
  }
  
  // Generic tool
  return { icon: <ToolOutlined />, label: 'Processing', color: '#8c8c8c' };
};

export default function AgentVisualization({ chainOfThoughts, isExecuting, executionStatus }: Props) {
  const { token } = theme.useToken();
  const { theme: appTheme } = useTheme();
  
  // Convert thoughts to visualization events
  const visualizationEvents = useMemo(() => 
    convertThoughtsToVisualizationEvents(chainOfThoughts),
    [chainOfThoughts]
  );
  
  // Track current activity for the header
  const [vizState, setVizState] = useState<VisualizationState>({
    currentTool: null,
    currentAction: null,
    toolIcon: <RobotOutlined />,
    toolColor: '#1890ff',
    animationPhase: 'idle',
    progress: 0,
    details: 'Waiting to start...',
  });

  const lastThoughtIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!chainOfThoughts || chainOfThoughts.length === 0) {
      setVizState({
        currentTool: null,
        currentAction: null,
        toolIcon: <RobotOutlined />,
        toolColor: '#1890ff',
        animationPhase: 'idle',
        progress: 0,
        details: 'Waiting to start...',
      });
      lastThoughtIdRef.current = null;
      return;
    }

    // Get the last thought that represents current activity
    const lastThought = chainOfThoughts[chainOfThoughts.length - 1];
    
    // Only update if this is a new thought
    if (lastThought.id === lastThoughtIdRef.current) {
      return;
    }
    lastThoughtIdRef.current = lastThought.id;

    // Determine visualization based on thought type and status
    if (lastThought.type === 'toolUse') {
      const toolName = lastThought.name || 'unknown';
      const viz = getToolVisualization(toolName);
      
      let animationPhase: 'idle' | 'working' | 'success' | 'error' = 'working';
      let progress = 50;
      
      if (lastThought.status === 'success') {
        animationPhase = 'success';
        progress = 100;
      } else if (lastThought.status === 'failed') {
        animationPhase = 'error';
        progress = 100;
      } else if (lastThought.status === 'pending' || lastThought.status === 'running') {
        animationPhase = 'working';
        progress = 50;
      }

      const details = lastThought.reason || lastThought.message || `Using ${toolName}`;

      setVizState({
        currentTool: toolName,
        currentAction: viz.label,
        toolIcon: viz.icon,
        toolColor: viz.color,
        animationPhase,
        progress,
        details,
      });
    } else if (lastThought.type === 'step' || lastThought.type === 'task') {
      setVizState({
        currentTool: 'step',
        currentAction: 'Executing step',
        toolIcon: <LoadingOutlined />,
        toolColor: '#1890ff',
        animationPhase: 'working',
        progress: 30,
        details: lastThought.content || 'Processing...',
      });
    } else if (lastThought.type === 'stepMemoryRetrieved') {
      setVizState({
        currentTool: 'memory',
        currentAction: 'Retrieving memory',
        toolIcon: <FileTextOutlined />,
        toolColor: '#722ed1',
        animationPhase: 'working',
        progress: 70,
        details: lastThought.message || 'Loading past executions...',
      });
    } else if (lastThought.type === 'error') {
      setVizState({
        currentTool: 'error',
        currentAction: 'Error occurred',
        toolIcon: <CloseCircleOutlined />,
        toolColor: '#ff4d4f',
        animationPhase: 'error',
        progress: 100,
        details: lastThought.content || lastThought.message || 'An error occurred',
      });
    }
  }, [chainOfThoughts]);

  // Update details based on execution status
  useEffect(() => {
    if (executionStatus === 'completed') {
      setVizState(prev => ({
        ...prev,
        details: 'Task completed successfully',
        animationPhase: 'success',
      }));
    } else if (executionStatus === 'failed') {
      setVizState(prev => ({
        ...prev,
        details: 'Task execution failed',
        animationPhase: 'error',
      }));
    } else if (executionStatus === 'cancelled') {
      setVizState(prev => ({
        ...prev,
        details: 'Task execution cancelled',
        animationPhase: 'error',
      }));
    } else if (executionStatus === 'paused') {
      setVizState(prev => ({
        ...prev,
        details: 'Task execution paused',
        animationPhase: 'idle',
      }));
    }
  }, [executionStatus]);

  // Animate progress for working state
  useEffect(() => {
    if (vizState.animationPhase === 'working' && isExecuting) {
      const interval = setInterval(() => {
        setVizState(prev => ({
          ...prev,
          progress: prev.progress >= 90 ? 50 : prev.progress + 1,
        }));
      }, 200);
      return () => clearInterval(interval);
    }
  }, [vizState.animationPhase, isExecuting]);

  return (
    <>
      <style>
        {`
          @keyframes pulse {
            0%, 100% {
              box-shadow: 0 0 20px ${vizState.toolColor || token.colorPrimary}40;
            }
            50% {
              box-shadow: 0 0 30px ${vizState.toolColor || token.colorPrimary}60;
            }
          }
          
          @keyframes float {
            0%, 100% {
              transform: translateY(0px);
            }
            50% {
              transform: translateY(-10px);
            }
          }
          
          .agent-icon {
            animation: float 3s ease-in-out infinite;
          }
        `}
      </style>
      
      <div style={{ 
        display: 'flex', 
        flexDirection: 'column', 
        width: '50vw',
        height: 'calc(98vh - 196px)',
      }}>
        {/* Compact Status Header */}
        <Card 
          size="small"
          style={{ 
            width: '100%',
            backgroundColor: appTheme === 'dark' ? '#1f1f1f' : '#f5f5f5',
            marginBottom: 8,
            flexShrink: 0,
          }}
          bodyStyle={{ padding: '12px 16px' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {/* Status indicator - spinner / check / x */}
            <div style={{ 
              fontSize: 14, 
              color: executionStatus === 'completed' ? token.colorSuccess : 
                     executionStatus === 'failed' || executionStatus === 'cancelled' ? token.colorError :
                     token.colorPrimary,
              minWidth: 16,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              {executionStatus === 'completed' ? (
                <CheckCircleOutlined />
              ) : executionStatus === 'failed' || executionStatus === 'cancelled' ? (
                <CloseCircleOutlined />
              ) : isExecuting ? (
                <LoadingOutlined spin />
              ) : null}
            </div>
            
            <div style={{ flex: 1 }}>
              {/* Show reasoning without "To" prefix */}
              <Text style={{ fontSize: 13, color: token.colorText }}>
                {vizState.details.replace(/^To\s+/i, '')}
              </Text>
            </div>

            {chainOfThoughts.length > 0 && (
              <Text type="secondary" style={{ fontSize: 10 }}>
                {chainOfThoughts.length} ops
              </Text>
            )}
          </div>
        </Card>

        {/* Agent TV Canvas - Shows work artifacts */}
        <AgentTVCanvas events={visualizationEvents} />
      </div>
    </>
  );
}
