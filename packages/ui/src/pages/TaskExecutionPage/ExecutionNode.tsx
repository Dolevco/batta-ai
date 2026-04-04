import { Handle, Position, NodeProps } from 'reactflow';
import { ClockCircleOutlined, CheckCircleOutlined, LoadingOutlined, CloseCircleOutlined, PauseCircleOutlined, ForwardOutlined } from '@ant-design/icons';
import type { StepExecution } from '../../types';
import { theme } from 'antd';
import { useTheme } from '../../hooks';

interface ExecutionNodeData {
  step: any;
  execution?: StepExecution;
  onClick: (stepId: string) => void;
}

export default function ExecutionNode({ data }: NodeProps<ExecutionNodeData>) {
  const { step, execution, onClick } = data;
  const { token } = theme.useToken();
  const { theme: appTheme } = useTheme();

  const getStatusMeta = (status?: string) => {
    // returns primary color and subtle background for the status indicator (use theme tokens)
    switch (status) {
      case 'completed':
        return { color: token.colorSuccess, bg: token.colorBgElevated, label: 'Completed' };
      case 'running':
        return { color: token.colorPrimary, bg: token.colorBgElevated, label: 'Running' };
      case 'cancelled':
        return { color: token.colorError, bg: token.colorBgElevated, label: 'Cancelled' };
      case 'failed':
        return { color: token.colorError, bg: token.colorBgElevated, label: 'Failed' };
      case 'pending':
        return { color: token.colorWarning, bg: token.colorBgElevated, label: 'Pending' };
      case 'skipped':
        return { color: token.colorTextDisabled || '#8c8c8c', bg: token.colorBgElevated, label: 'Skipped' };
      default:
        return { color: token.colorBorder, bg: token.colorBgElevated, label: 'Unknown' };
    }
  };

  const getStatusIcon = () => {
    if (!execution) return <PauseCircleOutlined style={{ color: token.colorBorder, fontSize: 16 }} />;
    switch (execution.status) {
      case 'completed':
        return <CheckCircleOutlined style={{ color: getStatusMeta(execution.status).color, fontSize: 16 }} />;
      case 'running':
        return <LoadingOutlined spin style={{ color: getStatusMeta(execution.status).color, fontSize: 16 }} />;
      case 'cancelled':
        return <CloseCircleOutlined style={{ color: getStatusMeta(execution.status).color, fontSize: 16 }} />;
      case 'failed':
        return <CloseCircleOutlined style={{ color: getStatusMeta(execution.status).color, fontSize: 16 }} />;
      case 'pending':
        return <ClockCircleOutlined style={{ color: getStatusMeta(execution.status).color, fontSize: 16 }} />;
      case 'skipped':
        return <ForwardOutlined style={{ color: getStatusMeta(execution.status).color, fontSize: 16 }} />;
      default:
        return <PauseCircleOutlined style={{ color: token.colorBorder, fontSize: 16 }} />;
    }
  };

  const statusMeta = getStatusMeta(execution?.status as string);

  const styles = {
    executionNode: {
      background: token.colorBgContainer,
      border: '2px solid',
      borderRadius: '8px',
      padding: '0',
      width: '280px',
      boxShadow: appTheme === 'dark' ? '0 2px 8px rgba(0, 0, 0, 0.6)' : '0 2px 8px rgba(0, 0, 0, 0.15)',
      overflow: 'hidden',
      position: 'relative' as const,
      cursor: 'pointer',
    },
    nodeHeader: {
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      padding: '12px 16px',
      backgroundColor: token.colorBgContainer,
      borderBottom: `1px solid ${token.colorBorder}`,
    },
    nodeIndex: {
      width: '12px',
      height: '12px',
      borderRadius: '50%',
      color: 'white',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontWeight: '700' as const,
      fontSize: '14px',
      flexShrink: 0,
      backgroundColor: statusMeta.color,
    },
    nodeTitle: {
      fontWeight: '600' as const,
      fontSize: '15px',
      color: token.colorText,
      lineHeight: '1.4',
    },
    durationBadge: {
      position: 'absolute' as const,
      top: '8px',
      right: '8px',
      backgroundColor: token.colorTextSecondary,
      color: token.colorText,
      padding: '4px 8px',
      borderRadius: '4px',
      fontSize: '11px',
      display: 'flex',
      alignItems: 'center',
    },
  };

  return (
    <div
      style={{
        ...styles.executionNode,
        borderColor: statusMeta.color,
      }}
      onClick={() => onClick(step.id)}
    >
      <Handle type="target" id="t" position={Position.Top} style={{ background: 'transparent', border: 'none' }} />

      <div style={styles.nodeHeader}>
        <div style={{ ...styles.nodeIndex, backgroundColor: statusMeta.bg, color: statusMeta.color }}>{getStatusIcon()}</div>
        <div style={styles.nodeTitle}>{step.name}</div>
      </div>

      {execution && execution.duration && (
        <div style={styles.durationBadge}>
          <ClockCircleOutlined style={{ marginRight: 4 }} />
          {execution.duration}ms
        </div>
      )}

      <Handle type="source" id="s" position={Position.Bottom} style={{ background: 'transparent', border: 'none' }} />
    </div>
  );
}
