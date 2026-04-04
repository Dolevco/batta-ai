import { useState, useEffect } from 'react';
import { Card, Table, Button, Modal, Form, Input, Select, Tag, Space, message, Typography, Drawer, Popconfirm } from 'antd';
import { PlusOutlined, EyeOutlined, ThunderboltOutlined, DeleteOutlined, EditOutlined, PlayCircleOutlined } from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTasks, useAgents } from '../hooks';
import { TaskGraph } from '../components/TaskGraph';
import type { TaskResponse, CreateTaskRequest, Agent } from '../types';

const { TextArea } = Input;
const { Paragraph } = Typography;

export function TasksPage() {
  const [tasks, setTasks] = useState<TaskResponse[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [selectedTask, setSelectedTask] = useState<TaskResponse | null>(null);
  const [form] = Form.useForm();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const { getAllTasks, deleteTask, createTask } = useTasks();
  const { getAllAgents } = useAgents();

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const data = await getAllTasks();
        setTasks(data);
      } catch (error) {
        message.error('Failed to load tasks');
      } finally {
        setLoading(false);
      }
    })();

    (async () => {
      try {
        const data = await getAllAgents();
        setAgents(data);
      } catch (error) {
        console.error('Failed to load agents:', error);
      }
    })();
  }, [getAllTasks, getAllAgents]);

  const handleCreate = () => {
    form.resetFields();
    setModalVisible(true);
  };

  const handleViewPlan = async (task: TaskResponse) => {
    if (!task.plan) {
      message.warning('This task does not have a plan yet');
      return;
    }
    setSelectedTask(task);
    setDrawerVisible(true);
  };

  const handleDelete = async (taskId: string) => {
    try {
      await deleteTask(taskId);
      message.success('Task deleted successfully');
      // refresh tasks
      try {
        const updated = await getAllTasks();
        setTasks(updated);
      } catch {}
    } catch (error) {
      message.error('Failed to delete task');
    }
  };

  const handleEdit = () => {
    if (selectedTask) {
      navigate(`/planner/${selectedTask.id}`);
    }
  };

  const handleExecute = () => {
    if (selectedTask) {
      navigate(`/execution/${selectedTask.id}`);
    }
  };

  const handleSubmit = async (values: CreateTaskRequest & { agentId?: string }) => {
    try {
      await createTask({
        description: values.description,
        agentId: values.agentId,
        tools: values.tools,
      });
      message.success('Task created successfully');
      setModalVisible(false);
      // refresh tasks
      try {
        const updated = await getAllTasks();
        setTasks(updated);
      } catch {}
    } catch (error) {
      message.error('Failed to create task');
    }
  };

  const getAgentName = (agentId?: string) => {
    if (!agentId) return null;
    const agent = agents.find(a => a.id === agentId);
    return agent?.name;
  };

  const filterAgentId = searchParams.get('agentId');
  const filteredTasks = filterAgentId ? tasks.filter(t => t.agentId === filterAgentId) : tasks;

  // Build agent filters for the agent column from loaded agents
  const agentFilters = agents.map(a => ({ text: a.name, value: a.id }));
  const statusOptions = [
    { text: 'Pending', value: 'pending' },
    { text: 'Planning', value: 'planning' },
    { text: 'Completed', value: 'completed' },
    { text: 'Failed', value: 'failed' },
  ];

  const columns = [
    {
      title: 'Description',
      dataIndex: 'description',
      key: 'description',
      width: '55%',
      ellipsis: true,
    },
    {
      title: 'Agent',
      dataIndex: 'agentId',
      key: 'agentId',
      width: '10%',
      filters: agentFilters,
      onFilter: (value: any, record: TaskResponse) => record.agentId === String(value),
      render: (agentId: string) => {
        const agentName = getAgentName(agentId);
        return agentName ? <Tag color="cyan">{agentName}</Tag> : <Tag>Unassigned</Tag>;
      },
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: '10%',
      filters: statusOptions,
      onFilter: (value: any, record: TaskResponse) => record.status === String(value),
      render: (status: string) => {
        const color = {
          pending: 'default',
          planning: 'processing',
          completed: 'success',
          failed: 'error',
        }[status];
        return <Tag color={color}>{status}</Tag>;
      },
    },
    {
      title: 'Created',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: '10%',
      render: (date: string) => new Date(date).toLocaleDateString(),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: '15%',
      render: (_: any, record: TaskResponse) => (
        <Space size="small">
          <Button
            type="link"
            size="small"
            icon={<EyeOutlined />}
            onClick={() => handleViewPlan(record)}
            disabled={!record.plan}
          >
            View
          </Button>
          <Popconfirm
            title="Delete Task"
            description="Are you sure you want to delete this task?"
            onConfirm={() => handleDelete(record.id)}
            okText="Yes"
            cancelText="No"
          >
            <Button
              type="link"
              size="small"
              danger
              icon={<DeleteOutlined />}
            >
              Delete
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <Card
        title={filterAgentId ? `Tasks for ${getAgentName(filterAgentId) || 'Agent'}` : 'Planned Tasks'}
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
            Create Task
          </Button>
        }
      >
        <Paragraph type="secondary">
          Manage planned tasks with AI-generated execution plans. Each task contains instructions that generate a graph-like visualization of steps.
        </Paragraph>
        <Table
          dataSource={filteredTasks}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10 }}
         
        />
      </Card>

      <Modal
        title="Create New Task"
        open={modalVisible}
        onCancel={() => setModalVisible(false)}
        footer={null}
        width={600}
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item
            name="description"
            label="Task Description"
            rules={[{ required: true, message: 'Please enter task description' }]}
          >
            <TextArea
              rows={4}
              placeholder="Describe your security automation task in natural language..."
            />
          </Form.Item>

          <Form.Item name="agentId" label="Assign to Agent">
            <Select
              placeholder="Select an agent (optional)"
              allowClear
            >
              {agents.map(agent => (
                <Select.Option key={agent.id} value={agent.id}>
                  {agent.name}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
          
          <Form.Item name="tools" label="Available Tools">
            <Select
              mode="tags"
              placeholder="e.g., file_reader, command_executor"
              tokenSeparators={[',']}
            />
          </Form.Item>

          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit" icon={<ThunderboltOutlined />}>
                Create & Generate Plan
              </Button>
              <Button onClick={() => setModalVisible(false)}>Cancel</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title="Task Execution Plan"
        placement="right"
        width={720}
        open={drawerVisible}
        onClose={() => setDrawerVisible(false)}
        extra={
          selectedTask && (
            <Space>
              <Button
                icon={<EditOutlined />}
                onClick={handleEdit}
              >
                Edit
              </Button>
              <Button
                type="primary"
                icon={<PlayCircleOutlined />}
                onClick={handleExecute}
              >
                Execute
              </Button>
            </Space>
          )
        }
      >
        {selectedTask && selectedTask.plan && (
          <div>
            <Card size="small" style={{ marginBottom: 16 }}>
              <Paragraph strong>Description:</Paragraph>
              <Paragraph>{selectedTask.description}</Paragraph>
              <Space>
                <Tag color="blue">Task ID: {selectedTask.id.slice(0, 8)}</Tag>
                <Tag color={selectedTask.status === 'completed' ? 'success' : 'processing'}>
                  {selectedTask.status}
                </Tag>
                <Tag color="purple">{selectedTask.plan.subTasks.length} steps</Tag>
              </Space>
            </Card>
            <Card title="Plan Visualization" size="small">
              <TaskGraph plan={selectedTask.plan} />
            </Card>
          </div>
        )}
      </Drawer>
    </>
  );
}
