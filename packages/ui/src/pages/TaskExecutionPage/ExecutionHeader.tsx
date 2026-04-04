import { Button, Typography, Space, theme } from 'antd';
import { PlayCircleOutlined, StopOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import type { TaskResponse, TaskExecution } from '../../types';

const { Title } = Typography;

interface Props {
  task: TaskResponse;
  execution: TaskExecution | null;
  isExecuting: boolean;
  selectedRunId: string | null;
  onStart: () => void;
  onPause: () => void;
  onStop: () => void;
  onBack: () => void;
}

export default function ExecutionHeader({ task, execution, isExecuting, onStart, onStop, onBack }: Props) {
  const { token } = theme.useToken();

  return (
    <div style={{ margin: '0 24px 16px', display: 'flex', flexDirection: 'column', maxWidth: '83vw' }}>
      <div style={{ padding: '12px 24px', borderBottom: `1px solid ${token.colorBorder}`, display: 'flex', alignItems: 'center', backgroundColor: token.colorBgContainer, borderRadius: 6 }}>

      <Title level={4} style={{ margin: 0, flex: 1, color: token.colorText }}>
        Task Execution: {task.description.length < 200 ? task.description : task.description.substring(0, 200) + '...'}
      </Title>

      <Space>
        <Button
            type="text"
            icon={<ArrowLeftOutlined />}
            onClick={onBack}
        >
            Back
        </Button>
        {(execution?.status === 'idle' || execution?.status === 'paused' || execution?.status === 'failed') && (
          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            onClick={onStart}
            loading={isExecuting}
            size="large"
          >
            {execution?.status === 'paused' ? 'Resume' : 
             execution?.status === 'failed' ? 'Retry' : 'Start'} Execution
          </Button>
        )}
        {execution?.status === 'running' && (
          <Button
            danger
            icon={<StopOutlined />}
            onClick={onStop}
            size="large"
          >
            Stop
          </Button>
        )}
        {execution?.status === 'completed' && (
          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            onClick={onStart}
            loading={isExecuting}
            size="large"
          >
            Run Again
          </Button>
        )}
      </Space>
    </div>
    </div>
  );
}
