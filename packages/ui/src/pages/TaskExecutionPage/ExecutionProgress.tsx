import { Card, Space, Tag, Progress, Alert, Collapse, Typography, theme } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';
import type { TaskResponse, TaskExecution } from '../../types';

const { Text } = Typography;

interface Props {
  execution: TaskExecution | null;
  task: TaskResponse;
  taskResults: any;
  getExecutionProgress: () => number;
  selectedRunStatus?: string | null;
}

export default function ExecutionProgress({ execution, task, taskResults, getExecutionProgress, selectedRunStatus }: Props) {
  const { token } = theme.useToken();

  if (!execution) return null;

  const displayStatusTag = selectedRunStatus === 'cancelled' ? 'CANCELLED' : execution.status.toUpperCase();
  const displayTagColor = selectedRunStatus === 'cancelled' ? 'default' : (
    execution.status === 'completed' ? 'success' :
    execution.status === 'running' ? 'processing' :
    execution.status === 'failed' ? 'error' : 'default'
  );

  return (
    <Card style={{ margin: '0px 24px 16px', maxWidth: '83vw', background: token.colorBgContainer }} bodyStyle={{ padding: '16px' }}>
      <Space direction="vertical" style={{ width: '100%' }} size="small">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text strong style={{ color: token.colorText }}>Execution Progress</Text>
          <Tag color={displayTagColor}>
            {displayStatusTag}
          </Tag>
        </div>

        <Progress 
          percent={getExecutionProgress()} 
          status={execution.status === 'running' ? 'active' : 'normal'}
        />

        {execution.currentStepId && (
          <Text type="secondary" style={{ color: token.colorTextSecondary }}>
            Currently executing: {task.plan?.subTasks.find(s => s.id === execution.currentStepId)?.name}
          </Text>
        )}
        {/* Task Results Display */}
        {taskResults && (
          <Card 
            size="small" 
            title={
              <Space size="small">
                {taskResults.success ? <CheckCircleOutlined style={{ color: token.colorSuccess, fontSize: 16 }} /> : <CloseCircleOutlined style={{ color: token.colorError, fontSize: 16 }} />}
                <Text strong style={{ fontSize: 13, color: token.colorText }}>Task Execution Summary</Text>
                <Tag color={taskResults.success ? 'success' : 'error'} style={{ marginLeft: 4 }}>
                  {taskResults.success ? 'SUCCESS' : (selectedRunStatus === 'cancelled' ? 'CANCELLED' : 'FAILED')}
                </Tag>
              </Space>
            }
            style={{ marginTop: 12, border: `1px solid ${taskResults.success ? token.colorSuccess : token.colorError}`, background: token.colorBgElevated }}
            bodyStyle={{ padding: '12px' }}
          >
            <Space direction="vertical" style={{ width: '100%' }} size="small">
              {/* Overall Task Result */}
              {taskResults.summary && (
                <div>
                  <Text type="secondary" style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Task Result
                  </Text>
                  <div style={{ 
                    backgroundColor: token.colorBgElevated, 
                    border: `1px solid ${taskResults.success ? token.colorSuccess : token.colorError}`,
                    borderRadius: '6px',
                    padding: '12px',
                    marginTop: '6px',
                    maxHeight: '150px',
                    overflowY: 'auto',
                    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace',
                    fontSize: '13px',
                    lineHeight: '1.6',
                    whiteSpace: 'pre-wrap',
                    color: token.colorText
                  }}>
                    {taskResults.summary}
                  </div>
                </div>
              )}
              {selectedRunStatus === 'cancelled' && (
                <Alert type="warning" showIcon message="This run was cancelled. Progress is partial and may be incomplete." style={{ marginTop: 8 }} />
              )}

              {/* Step-by-Step Results */}
              {taskResults.results && taskResults.results.length > 0 && (
                <div>
                  <Text type="secondary" style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 8, color: token.colorTextSecondary }}>
                    Step Details ({taskResults.results.filter((r: any) => r.success).length}/{taskResults.results.length} Successful)
                  </Text>
                  <Collapse
                    size="small"
                    style={{ backgroundColor: token.colorBgElevated, border: `1px solid ${token.colorBorder}` }}
                    items={taskResults.results.map((result: any, index: number) => {
                      const stepName = task.plan?.subTasks[result.index]?.name || `Step ${result.index + 1}`;
                      return {
                        key: index.toString(),
                        label: (
                          <Space>
                            {result.success ? 
                              <CheckCircleOutlined style={{ color: token.colorSuccess }} /> : 
                              <CloseCircleOutlined style={{ color: token.colorError }} />
                            }
                            <Text strong style={{ fontSize: 13, color: token.colorText }}>
                              Step {result.index + 1}: {stepName}
                            </Text>
                            <Tag 
                              color={result.success ? 'success' : 'error'}
                              style={{ marginLeft: 'auto', fontSize: 11 }}
                            >
                              {result.success ? 'SUCCESS' : 'FAILED'}
                            </Tag>
                          </Space>
                        ),
                        children: (
                          <div>
                            {result.success && result.result && (
                              <div style={{ 
                                backgroundColor: token.colorBgContainer, 
                                border: `1px solid ${token.colorBorder}`,
                                borderRadius: '4px',
                                padding: '12px',
                                maxHeight: '400px',
                                overflowY: 'auto',
                                fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace',
                                fontSize: '12px',
                                lineHeight: '1.5',
                                whiteSpace: 'pre-wrap',
                                color: token.colorText
                              }}>
                                {result.result}
                              </div>
                            )}
                            {!result.success && result.error && (
                              <Alert 
                                message="Execution Error" 
                                description={
                                  <div style={{ 
                                    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace',
                                    fontSize: '12px',
                                    marginTop: '8px',
                                    color: token.colorText
                                  }}>
                                    {result.error}
                                  </div>
                                }
                                type="error" 
                                showIcon
                              />
                            )}
                          </div>
                        ),
                      };
                    })}
                  />
                </div>
              )}
            </Space>
          </Card>
        )}
      </Space>
    </Card>
  );
}
