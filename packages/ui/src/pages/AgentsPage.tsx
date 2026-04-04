import { useState, useEffect } from 'react';
import { Button, Table, Modal, Form, Input, Space, message, Popconfirm, Card, Typography } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import type { Agent, CreateAgentRequest, UpdateAgentRequest } from '../types';
import { useAgents } from '../hooks';
import { T } from '../theme';

const { Title, Text } = Typography;

export function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [form] = Form.useForm();
  const navigate = useNavigate();
  const { getAllAgents, deleteAgent, updateAgent, createAgent } = useAgents();

  const loadAgents = async () => {
    setLoading(true);
    try {
      const data = await getAllAgents();
      setAgents(data);
    } catch (error) {
      message.error('Failed to load agents');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAgents();
  }, []);

  const handleCreate = () => {
    setEditingAgent(null);
    form.resetFields();
    setModalVisible(true);
  };

  const handleEdit = (agent: Agent) => {
    setEditingAgent(agent);
    form.setFieldsValue({
      name: agent.name,
      role: agent.role,
    });
    setModalVisible(true);
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteAgent(id);
      message.success('Agent deleted successfully');
      loadAgents();
    } catch (error) {
      message.error('Failed to delete agent');
      console.error(error);
    }
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      
      if (editingAgent) {
        const request: UpdateAgentRequest = {
          name: values.name,
          role: values.role,
        };
        await updateAgent(editingAgent.id, request);
        message.success('Agent updated successfully');
      } else {
        const request: CreateAgentRequest = {
          name: values.name,
          role: values.role,
        };
        await createAgent(request);
        message.success('Agent created successfully');
      }
      
      setModalVisible(false);
      form.resetFields();
      loadAgents();
    } catch (error) {
      message.error('Failed to save agent');
      console.error(error);
    }
  };

  const handleViewTasks = (agentId: string) => {
    navigate(`/agents/tasks?agentId=${agentId}`);
  };

  const columns = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: 'Role',
      dataIndex: 'role',
      key: 'role',
    },
    {
      title: 'Created At',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (text: string) => new Date(text).toLocaleString(),
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_: any, record: Agent) => (
        <Space>
          <Button
            type="link"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
          >
            Edit
          </Button>
          <Button
            type="link"
            onClick={() => handleViewTasks(record.id)}
          >
            View Tasks
          </Button>
          <Popconfirm
            title="Are you sure you want to delete this agent?"
            onConfirm={() => handleDelete(record.id)}
            okText="Yes"
            cancelText="No"
          >
            <Button
              type="link"
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
    <div>
      <Card bordered={false}>
        <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <Title level={3} style={{ margin: 0, color: T.stone900 }}>Agents</Title>
            <Text type="secondary">Manage agents and their roles</Text>
          </div>

          <div>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={handleCreate}
            >
              Create Agent
            </Button>
          </div>
        </div>

        <Table
          columns={columns}
          dataSource={agents}
          rowKey="id"
          loading={loading}
        />

        <Modal
          title={editingAgent ? 'Edit Agent' : 'Create Agent'}
          open={modalVisible}
          onOk={handleSubmit}
          onCancel={() => {
            setModalVisible(false);
            form.resetFields();
          }}
          okText={editingAgent ? 'Update' : 'Create'}
        >
          <Form
            form={form}
            layout="vertical"
          >
            <Form.Item
              name="name"
              label="Name"
              rules={[{ required: true, message: 'Please enter agent name' }]}
            >
              <Input placeholder="e.g., John Doe" />
            </Form.Item>
            <Form.Item
              name="role"
              label="Role Description"
              rules={[{ required: true, message: 'Please enter role description' }]}
            >
              <Input.TextArea
                rows={4}
                placeholder="Describe the agent's role and responsibilities..."
              />
            </Form.Item>
          </Form>
        </Modal>
      </Card>
    </div>
  );
}
