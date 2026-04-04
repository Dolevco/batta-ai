import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Table, Card, Tag, Button, Space, Alert } from 'antd';
import { EyeOutlined, ReloadOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { TaskRun } from '../types';
import { useTaskRuns } from '../hooks';

export function TaskRunHistoryPage() {
  const navigate = useNavigate();
  const [taskRuns, setTaskRuns] = useState<TaskRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { getAllTaskRuns } = useTaskRuns();

  const fetchTaskRuns = async () => {
    try {
      setLoading(true);
      setError(null);
      const runs = await getAllTaskRuns();
      setTaskRuns(runs);
    } catch (err: any) {
      console.error('Failed to fetch task runs:', err);
      setError(err.message || 'Failed to load task runs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTaskRuns();
  }, []);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'success';
      case 'running':
        return 'processing';
      case 'failed':
        return 'error';
      case 'cancelled':
        return 'default';
      default:
        return 'default';
    }
  };

  // Resizable header cell implemented with native mouse events (no extra dependency)
  const ResizableTitle = (props: any) => {
    const { onResize, width, ...restProps } = props;
    const startXRef = useRef(0);
    const startWidthRef = useRef(0);

    if (!width) {
      return <th {...restProps} />;
    }

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - startXRef.current;
      const newWidth = Math.max(60, startWidthRef.current + delta);
      onResize && onResize(null, { size: { width: newWidth } });
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    const onMouseDown = (e: React.MouseEvent) => {
      e.preventDefault();
      startXRef.current = e.clientX;
      startWidthRef.current = width;
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    };

    return (
      <th {...restProps}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>{(restProps as any).children}</div>
          <div
            onMouseDown={onMouseDown}
            style={{ width: 8, cursor: 'col-resize', padding: '4px 0' }}
          />
        </div>
      </th>
    );
  };

  // columns state so widths can be updated
  const [columns, setColumns] = useState<ColumnsType<TaskRun>>([
    {
      title: 'Started At',
      dataIndex: 'startedAt',
      key: 'startedAt',
      width: '20%',
      render: (startedAt: string) => new Date(startedAt).toLocaleString(),
      sorter: (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
      defaultSortOrder: 'ascend',
    },
    {
      title: 'Task',
      dataIndex: 'taskName',
      key: 'taskName',
      width: '50%',
      ellipsis: true,
      render: (_: any, record: TaskRun) => (
        <span style={{ fontSize: '14px' }}>
          {record.taskName ? record.taskName : `${record.taskId.substring(0, 8)}...`}
        </span>
      ),
      //filters: taskRuns.map(r => ({ text: r.taskName || r.taskId.substring(0,8), value: r.taskId })),
      //onFilter: (value: any, record) => record.taskId === String(value),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: '10%',
      render: (status: string) => (
        <Tag color={getStatusColor(status)}>{status.toUpperCase()}</Tag>
      ),
      filters: [
        { text: 'Completed', value: 'completed' },
        { text: 'Running', value: 'running' },
        { text: 'Failed', value: 'failed' },
        { text: 'Cancelled', value: 'cancelled' },
      ],
      onFilter: (value: any, record) => record.status === String(value),
    },
    {
      title: 'Duration',
      key: 'duration',
      width: '10%',
      render: (_, record) => {
        if (!record.completedAt) return '-';
        const duration = new Date(record.completedAt).getTime() - new Date(record.startedAt).getTime();
        const seconds = Math.floor(duration / 1000);
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        return minutes > 0 ? `${minutes}m ${remainingSeconds}s` : `${seconds}s`;
      },
    },
    {
      title: 'Actions',
      key: 'actions',
      width: '10%',
      render: (_, record) => (
        <Space>
          <Button
            type="primary"
            size="small"
            icon={<EyeOutlined />}
            onClick={() => navigate(`/execution/${record.taskId}?runId=${record.id}`)}
          >
            View
          </Button>
        </Space>
      ),
    },
  ]);

  const handleResize = (index: number) => (_e: any, { size }: any) => {
    const next = [...columns];
    const col = { ...(next[index] as any), width: size.width };
    next[index] = col as any;
    setColumns(next);
  };

  if (error) {
    return (
      <div style={{ padding: '24px' }}>
        <Alert
          message="Error"
          description={error}
          type="error"
          showIcon
          action={
            <Button size="small" onClick={fetchTaskRuns}>
              Retry
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div style={{ padding: '24px' }}>
      <Card
        title="Task Run History"
        extra={
          <Button
            icon={<ReloadOutlined />}
            onClick={fetchTaskRuns}
            loading={loading}
          >
            Refresh
          </Button>
        }
      >
        <Table
          components={{
            header: {
              cell: ResizableTitle,
            },
          }}
          columns={columns.map((col, idx) => ({
            ...col,
            onHeaderCell: (column: any) => ({
              width: column.width,
              onResize: handleResize(idx),
            }),
          }))}
          dataSource={taskRuns}
          rowKey="id"
          loading={loading}
          pagination={{
            pageSize: 20,
            showSizeChanger: true,
            showTotal: (total) => `Total ${total} runs`,
          }}
        />
      </Card>
    </div>
  );
}
