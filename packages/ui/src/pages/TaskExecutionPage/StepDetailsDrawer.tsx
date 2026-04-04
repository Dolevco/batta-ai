import { Drawer, Card, Space, Tag, Alert, List, theme } from 'antd';
import { ExclamationCircleOutlined, InfoCircleOutlined } from '@ant-design/icons';
import type { StepExecution, LogEntry, PlannedSubTask } from '../../types';

interface Props {
  selectedStep: PlannedSubTask | null;
  selectedExecution?: StepExecution | null;
  visible: boolean;
  onClose: () => void;
}

export default function StepDetailsDrawer({ selectedStep, selectedExecution, visible, onClose }: Props) {
  const { token } = theme.useToken();

  const labelStyle = {
    fontSize: 14,
    color: token.colorTextSecondary,
    fontWeight: 800,
    textTransform: 'uppercase' as const,
    marginBottom: 6,
    letterSpacing: '0.6px',
  };

  const valueStyle = {
    marginBottom: 20,
    fontSize: 12,
    color: token.colorText,
  };

  return (
    <Drawer
      title="Step Execution Details"
      placement="right"
      width={600}
      open={visible}
      onClose={onClose}
      bodyStyle={{ background: token.colorBgContainer }}
    >
      {selectedStep && (
        <Space direction="vertical" style={{ width: '100%' }}>
          <Card size="small" style={{ background: token.colorBgElevated, borderColor: token.colorBorder }}>
            {/* Step Information rendered as stacked label + value rows */}
            <div>
              {/* improved label style: smaller, lighter and clearly separate from values */}
              <div style={labelStyle}>Name</div>
              <div style={valueStyle}>{selectedStep.name}</div>

              <div style={labelStyle}>Intent</div>
              <div style={valueStyle}>{selectedStep.intent}</div>

              <div style={labelStyle}>Expected Output</div>
              <div style={valueStyle}>{selectedStep.expectedOutput}</div>

              {selectedStep.executionPlan && (
                <>
                  <div style={labelStyle}>Execution Plan</div>
                  <div style={valueStyle}>{selectedStep.executionPlan}</div>
                </>
              )}

              {selectedStep.codeIntegrationId && (
                <>
                  <div style={labelStyle}>Code Repository</div>
                  <div style={valueStyle}>
                    {(() => {
                      // Extract repo name from pattern like "github(repoName)"
                      const match = selectedStep.codeIntegrationId.match(/\(([^)]+)\)/);
                      if (match) {
                        return match[1];
                      }
                      return selectedStep.codeIntegrationId;
                    })()}
                  </div>
                </>
              )}

              {selectedStep.tools && selectedStep.tools.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <div style={labelStyle}>Tools</div>
                  <div style={{ marginBottom: 4 }}>
                    {selectedStep.tools.map((tool: string) => (
                      <Tag key={tool} style={{ background: token.colorBgContainer, color: token.colorText, border: `1px solid ${token.colorBorder}` }}>{tool}</Tag>
                    ))}
                  </div>
                </div>
              )}

              {selectedStep.toolsCategories && selectedStep.toolsCategories.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <div style={labelStyle}>Integrations</div>
                  <div style={{ marginBottom: 4 }}>
                    {selectedStep.toolsCategories.map((cat: string) => (
                      <Tag key={cat} style={{ background: token.colorBgContainer, color: token.colorText, border: `1px solid ${token.colorBorder}` }}>{cat}</Tag>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <div style={labelStyle}>Dependencies</div>
                <div style={{ fontSize: 12, color: token.colorText }}>
                  {selectedStep.dependsOn?.length ? selectedStep.dependsOn.map((depIndex: number) => (
                    <Tag key={depIndex} style={{ background: token.colorBgContainer, color: token.colorText, border: `1px solid ${token.colorBorder}` }}>Step {depIndex + 1}</Tag>
                  )) : 'None'}
                </div>
              </div>
            </div>
          </Card>

          {selectedExecution && (
            <>
              <Card size="small" title="Execution Status" style={{ background: token.colorBgElevated, borderColor: token.colorBorder }}>
                {/* Execution status rendered as stacked label + value rows */}
                <div>
                  <div style={labelStyle}>Status</div>
                  <div style={{ marginBottom: 20 }}>
                    <Tag style={{ background: token.colorBgContainer, color: token.colorText, border: `1px solid ${token.colorBorder}` }}>
                      {selectedExecution.status.toUpperCase()}
                    </Tag>
                  </div>

                  {selectedExecution.startedAt && (
                    <div style={{ marginBottom: 20 }}>
                      <div style={labelStyle}>Started At</div>
                      <div style={{ fontSize: 12, color: token.colorText }}>{new Date(selectedExecution.startedAt).toLocaleString()}</div>
                    </div>
                  )}

                  {selectedExecution.completedAt && (
                    <div style={{ marginBottom: 20 }}>
                      <div style={labelStyle}>Completed At</div>
                      <div style={{ fontSize: 12, color: token.colorText }}>{new Date(selectedExecution.completedAt).toLocaleString()}</div>
                    </div>
                  )}

                  {selectedExecution.duration && (
                    <div style={{ marginBottom: 20 }}>
                      <div style={labelStyle}>Duration</div>
                      <div style={{ fontSize: 12, color: token.colorText }}>{selectedExecution.duration}ms</div>
                    </div>
                  )}
                </div>

                {selectedExecution.result && (
                  <Alert 
                    message="Execution Result" 
                    description={selectedExecution.result}
                    type="success" 
                    style={{ marginTop: 16, background: token.colorBgContainer, borderColor: token.colorBorder }}
                  />
                )}

                {selectedExecution.error && (
                  <Alert 
                    message="Execution Error" 
                    description={selectedExecution.error}
                    type="error" 
                    style={{ marginTop: 16, background: token.colorBgContainer, borderColor: token.colorBorder }}
                  />
                )}
              </Card>

              {selectedExecution.logs.length > 0 && (
                <Card size="small" title="Execution Logs" style={{ background: token.colorBgElevated, borderColor: token.colorBorder }}>
                  <List
                    size="small"
                    dataSource={selectedExecution.logs}
                    renderItem={(log: LogEntry) => (
                      <List.Item>
                        <List.Item.Meta
                          avatar={
                            log.level === 'error' ? <ExclamationCircleOutlined style={{ color: token.colorError }} /> :
                            log.level === 'warn' ? <ExclamationCircleOutlined style={{ color: token.colorWarning }} /> :
                            <InfoCircleOutlined style={{ color: token.colorPrimary }} />
                          }
                          title={
                            <Space>
                              <span style={{ color: token.colorTextDisabled, fontSize: 12 }}>{new Date(log.timestamp).toLocaleTimeString()}</span>
                              <Tag style={{ background: token.colorBgContainer, color: token.colorText, border: `1px solid ${token.colorBorder}` }}>
                                {log.level.toUpperCase()}
                              </Tag>
                            </Space>
                          }
                          description={<span style={{ color: token.colorText }}>{log.message}</span>}
                        />
                      </List.Item>
                    )}
                  />
                </Card>
              )}
            </>
          )}
        </Space>
      )}
    </Drawer>
  );
}
