import { useState, useEffect, useRef, useMemo } from 'react';
import { Card, Space, Typography, Spin, Button, Tooltip, theme } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, RightOutlined, DownOutlined, ExpandOutlined, CompressOutlined, LikeOutlined, DislikeOutlined, LikeFilled, DislikeFilled } from '@ant-design/icons';
import { useTheme } from '../../hooks';
import type { Thought } from '../../types';

const { Text } = Typography;

// Hierarchical node structure for grouped thoughts
interface ThoughtNode {
  thought: Thought;
  children: ThoughtNode[];
  isCollapsed?: boolean;
  depth: number;
}

interface Props {
  chainOfThoughts: Thought[];
  isExecuting?: boolean;
  onOpenFeedback?: (type?: 'up' | 'down') => void;
  currentFeedback?: 'like' | 'dislike' | undefined;
}

// Helper: Build a hierarchical tree structure from flat chain of thoughts
const buildThoughtHierarchy = (thoughts: Thought[]): ThoughtNode[] => {
  const result: ThoughtNode[] = [];
  const stack: { node: ThoughtNode; taskCompleteCount: number }[] = [];

  for (const thought of thoughts) {
    const currentDepth = stack.length;

    // Check if this is a delegate_task
    if (thought.name === 'delegate_task' && (thought.status !== 'failed' || thought.childEventCount! > 0)) {
      const newNode: ThoughtNode = {
        thought,
        children: [],
        isCollapsed: false, // Default to expanded, we'll handle collapse logic separately
        depth: currentDepth,
      };

      if (stack.length > 0) {
        // Add as child to the current parent
        stack[stack.length - 1].node.children.push(newNode);
      } else {
        // Top-level node
        result.push(newNode);
      }

      // Push to stack with taskCompleteCount = 0
      stack.push({ node: newNode, taskCompleteCount: 0 });
      continue;
    }

    // Check if this is a task_complete
    if ((thought.type === 'toolUse' && thought.name === 'task_complete' && !thought.error) || 
        thought.name === 'delegate_task' && thought.status === 'failed' && thought.childEventCount === 0) {
      if (stack.length > 0) {
        // Add as child to the current parent
        const parentContext = stack[stack.length - 1];
        parentContext.node.children.push({
          thought,
          children: [],
          depth: currentDepth,
        });

        // Increment task_complete counter
        parentContext.taskCompleteCount++;

        // If we've seen 1 or more task_complete events, pop the stack (delegate task is done)
        if (parentContext.taskCompleteCount >= 1) {
          stack.pop();
        }
      } else {
        // Orphan task_complete at top level (shouldn't happen but handle gracefully)
        result.push({
          thought,
          children: [],
          depth: 0,
        });
      }
      continue;
    }

    // Regular thought
    const newNode: ThoughtNode = {
      thought,
      children: [],
      depth: currentDepth,
    };

    if (stack.length > 0) {
      // Add as child to the current parent
      stack[stack.length - 1].node.children.push(newNode);
    } else {
      // Top-level node
      result.push(newNode);
    }
  }

  return result;
};

// Helper: Find the currently active delegate task (if any) during execution
const findActiveDelegateTask = (nodes: ThoughtNode[], isExecuting: boolean): ThoughtNode | null => {
  if (!isExecuting) return null;

  for (const node of nodes) {
    // Check if this is a delegate_task that's still in progress
    if (node.thought.type === 'toolUse' && 
        node.thought.name === 'delegate_task' && 
        (node.thought.status === 'pending' || node.thought.status === 'running')) {
      
      // Recursively check children first (nested delegates take priority)
      const activeChild = findActiveDelegateTask(node.children, isExecuting);
      if (activeChild) return activeChild;
      
      return node;
    }

    // Recursively check children
    const activeChild = findActiveDelegateTask(node.children, isExecuting);
    if (activeChild) return activeChild;
  }

  return null;
};

// Helper: Check if a node is an ancestor of the target node
const isAncestorOfActive = (node: ThoughtNode, activeNode: ThoughtNode | null): boolean => {
  if (!activeNode) return false;
  
  // Recursively check if activeNode is in this node's children
  for (const child of node.children) {
    if (child === activeNode) return true;
    if (isAncestorOfActive(child, activeNode)) return true;
  }
  
  return false;
};

// Helper: Get the last active child of a delegate task
const getLastActiveChild = (node: ThoughtNode): Thought | null => {
  if (node.children.length === 0) return null;

  // Find the last child that's a toolUse with pending/running status
  for (let i = node.children.length - 1; i >= 0; i--) {
    const child = node.children[i];
    if (child.thought.type === 'toolUse' && 
        (child.thought.status === 'pending' || child.thought.status === 'running')) {
      return child.thought;
    }
  }

  // If no active child, return the last child
  return node.children[node.children.length - 1].thought;
};

export default function ChainOfThoughts({ chainOfThoughts, isExecuting, onOpenFeedback, ...props }: Props) {
  const { token } = theme.useToken();
  const { theme: appTheme } = useTheme();

  // Build hierarchical structure from flat thoughts array
  const thoughtHierarchy = useMemo(() => buildThoughtHierarchy(chainOfThoughts), [chainOfThoughts]);
  const activeDelegateTask = useMemo(() => findActiveDelegateTask(thoughtHierarchy, isExecuting || false), [thoughtHierarchy, isExecuting]);

  const getStatusIndicator = (thought: Thought) => {
    // Prefer structured status when available
    if (thought.status === 'success') {
      return <CheckCircleOutlined style={{ color: token.colorSuccess, fontSize: 14 }} />;
    }
    if (thought.status === 'failed') {
      return <CloseCircleOutlined style={{ color: token.colorError, fontSize: 14 }} />;
    }
    if (thought.status === 'pending' || thought.status === 'running' || thought.type === 'toolUse') {
      // show spinner for in-flight tool uses and running steps
      return <Spin size="small" />;
    }
    if (thought.type === 'stepMemoryRetrieved') {
      return <Text style={{ fontSize: 14 }}>📚</Text>;
    }
    if (thought.type === 'step' || thought.type === 'task') {
      return <Text style={{ color: token.colorPrimary, fontSize: 12, fontWeight: 500 }}>→</Text>;
    }

    // Fallback: if legacy content starts with known markers, preserve old behavior
    const content = thought.content || '';
    if (content.startsWith('✅')) return <CheckCircleOutlined style={{ color: token.colorSuccess, fontSize: 14 }} />;
    if (content.startsWith('❌')) return <CloseCircleOutlined style={{ color: token.colorError, fontSize: 14 }} />;
    if (content.startsWith('🔧')) return <Spin size="small" />;
    if (content.startsWith('▶️') ) return <Text style={{ color: token.colorPrimary, fontSize: 12, fontWeight: 500 }}>→</Text>;
    if (content.startsWith('🏁')) return <Text style={{ color: token.colorPrimary, fontSize: 12, fontWeight: 500 }}>🏁</Text>;

    return null;
  };

  const cleanContent = (thought: Thought) => {
    // Prefer structured fields for display
    let content = '';
    if (thought.name && thought.reason) content = `${thought.reason}`;
    else if (thought.name && thought.message) content = `${thought.message}`;
    else if (thought.message) content = thought.message;
    else if (thought.content) {
      // strip legacy leading emoji markers
      content = thought.content.replace(/^[^\w\s]*\s*/, '');
    }
    
    // Remove "to" or "To" at the beginning and capitalize the following word
    if (content) {
      content = content.replace(/^[Tt]o\s+(\w)/, (_match, firstChar) => firstChar.toUpperCase());
    }
    
    return content;
  };

  // Hook initializations must always run in the same order
  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>({});
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // allow widening the Execution Trace panel
  const [isWide, setIsWide] = useState(false);
  // Track the last chain length to detect when a new execution starts
  const lastChainLengthRef = useRef(chainOfThoughts.length);

  // Reset expanded state when chain of thoughts is cleared (new execution starts)
  useEffect(() => {
    if (chainOfThoughts.length === 0 && lastChainLengthRef.current > 0) {
      // Chain was cleared - reset expanded state
      setExpandedMap({});
    }
    lastChainLengthRef.current = chainOfThoughts.length;
  }, [chainOfThoughts.length]);

  // Auto-scroll to latest when thoughts change or execution state changes (but not on expand/collapse)
  useEffect(() => {
    if (sentinelRef.current) {
      sentinelRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [chainOfThoughts, isExecuting]);

  // If there are no thoughts, render nothing (after hooks have been initialized)
  if (!chainOfThoughts || chainOfThoughts.length === 0) return null;

  const toggleExpanded = (id: string) => {
    setExpandedMap(prev => ({ ...prev, [id]: !prev[id] }));
  };

  // Recursive component to render a thought node and its children
  const renderThoughtNode = (node: ThoughtNode, index: number, totalNodes: number): JSX.Element => {
    const thought = node.thought;
    const isDelegateTask = thought.type === 'toolUse' && thought.name === 'delegate_task';
    const isTaskComplete = thought.type === 'toolUse' && thought.name === 'task_complete';
    
    // Check if this node is manually expanded/collapsed
    const isManuallyExpanded = expandedMap[thought.id];
    
    // Delegate tasks are collapsed by default unless manually expanded
    // For running delegate tasks, we show only the active child
    const isCollapsed = isDelegateTask && isManuallyExpanded !== true;
    
    // Count all children (including task_complete)
    const childStepCount = node.children.length;

    if (isDelegateTask) {
      // Render delegate task with its children
      const hasChildren = childStepCount > 0;
      const activeChild = isExecuting && (node === activeDelegateTask || isAncestorOfActive(node, activeDelegateTask)) 
        ? getLastActiveChild(node) 
        : null;
      const isRunning = thought.status === 'pending' || thought.status === 'running';
      
      return (
        <div key={thought.id}>
          {/* Delegate task header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              padding: '8px 12px',
              paddingLeft: `${12 + node.depth * 16}px`,
              borderBottom: index < totalNodes - 1 ? `1px solid ${token.colorBorder}` : 'none',
              backgroundColor: token.colorFillQuaternary,
              transition: 'background-color 0.2s',
              cursor: hasChildren ? 'pointer' : 'default',
            }}
            onClick={() => hasChildren && toggleExpanded(thought.id)}
            onKeyDown={(e) => {
              if (!hasChildren) return;
              if (e.key === 'Enter' || e.key === ' ') toggleExpanded(thought.id);
            }}
            tabIndex={hasChildren ? 0 : -1}
            onMouseEnter={(e) => hasChildren && (e.currentTarget.style.backgroundColor = token.colorFillSecondary)}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = token.colorFillQuaternary)}
          >
            <div style={{ marginRight: '10px', marginTop: '2px', minWidth: '16px' }}>
              {getStatusIndicator(thought)}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: token.colorText, lineHeight: 1.5, wordBreak: 'break-word', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0, fontWeight: 500 }}>
                  {cleanContent(thought)}
                </div>
                <div style={{ marginLeft: 8, color: token.colorTextSecondary, alignSelf: 'flex-start' }}>
                  {hasChildren && (isCollapsed ? <RightOutlined /> : <DownOutlined />)}
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2px' }}>
                <Text type="secondary" style={{ fontSize: 10, color: token.colorTextSecondary }}>
                  {thought.timestamp.toLocaleTimeString()}
                </Text>
              </div>

              {/* Show "See all X steps" and active child when collapsed */}
              {isCollapsed && hasChildren && (
                <div style={{ marginTop: 8 }}>
                  {/* "See all X steps" button */}
                  <div
                    style={{
                      fontSize: 11,
                      color: token.colorPrimary,
                      cursor: 'pointer',
                      marginBottom: activeChild && isRunning ? 6 : 0,
                      padding: '2px 0',
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleExpanded(thought.id);
                    }}
                  >
                    ↓ See all {childStepCount} {childStepCount === 1 ? 'step' : 'steps'}
                  </div>

                  {/* Show only active child when running */}
                  {activeChild && isRunning && (
                    <div style={{ 
                      paddingLeft: 12, 
                      borderLeft: `2px solid ${token.colorPrimary}`,
                      marginTop: 4,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', padding: '4px 0' }}>
                        <div style={{ marginRight: '8px', marginTop: '2px', minWidth: '14px' }}>
                          {getStatusIndicator(activeChild)}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 11, color: token.colorText, lineHeight: 1.4, fontWeight: 500 }}>
                            {cleanContent(activeChild)}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Render children when expanded */}
          {!isCollapsed && node.children.map((childNode, childIndex) => (
            <div key={childNode.thought.id} style={{ borderLeft: `2px solid ${token.colorBorder}`, marginLeft: `${12 + node.depth * 16}px` }}>
              {renderThoughtNode(childNode, childIndex, node.children.length)}
            </div>
          ))}
        </div>
      );
    }

    // Regular thought rendering (including task_complete)
    const isExpandable = (thought.type === 'toolUse' && (thought.status === 'success' || thought.status === 'failed')) || 
                         (thought.type === 'stepMemoryRetrieved' && thought.insights) ||
                         isTaskComplete;
    const isExpanded = !!expandedMap[thought.id];

    // Special styling for task_complete
    const isTaskCompleteStyle = isTaskComplete ? {
      backgroundColor: token.colorFillQuaternary,
    } : {};

    return (
      <div
        key={thought.id}
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          padding: '8px 12px',
          paddingLeft: `${12 + node.depth * 16}px`,
          borderBottom: index < totalNodes - 1 ? `1px solid ${token.colorBorder}` : 'none',
          transition: 'background-color 0.2s',
          cursor: isExpandable ? 'pointer' : 'default',
          ...isTaskCompleteStyle,
        }}
        onClick={() => isExpandable && toggleExpanded(thought.id)}
        onKeyDown={(e) => {
          if (!isExpandable) return;
          if (e.key === 'Enter' || e.key === ' ') toggleExpanded(thought.id);
        }}
        tabIndex={isExpandable ? 0 : -1}
        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = token.colorFillSecondary}
        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = isTaskComplete ? token.colorFillQuaternary : 'transparent'}
      >
        <div style={{ marginRight: '10px', marginTop: '2px', minWidth: '16px' }}>
          {getStatusIndicator(thought)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, color: token.colorText, lineHeight: 1.5, wordBreak: 'break-word', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0, fontWeight: isTaskComplete ? 500 : 'normal' }}>
              {cleanContent(thought)}
            </div>
            <div style={{ marginLeft: 8, color: token.colorTextSecondary, alignSelf: 'flex-start' }}>
              {isExpandable ? (isExpanded ? <DownOutlined /> : <RightOutlined />) : null}
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text type="secondary" style={{ fontSize: 10, marginTop: '2px', display: 'block', color: token.colorTextSecondary }}>
              {thought.timestamp.toLocaleTimeString()}
            </Text>
          </div>

          {isExpanded && (
            <div style={{ marginTop: 8, padding: '8px', background: token.colorBgElevated, borderRadius: 6, border: `1px solid ${token.colorBorder}` }}>
              {thought.insights && (
                <div style={{ marginBottom: thought.parameters || thought.message || thought.error || typeof thought.result !== 'undefined' ? 6 : 0 }}>
                  <Text strong>Insights: </Text>
                  <pre style={{ marginTop: 6, whiteSpace: 'pre-wrap', fontSize: 12, background: token.colorBgContainer, padding: 8, borderRadius: 4, border: `1px solid ${token.colorBorder}` }}>
                    {thought.insights}
                  </pre>
                </div>
              )}
              {thought.parameters && (
                <div style={{ marginBottom: thought.message || thought.error || typeof thought.result !== 'undefined' ? 6 : 0 }}>
                  <Text strong>Parameters: </Text>
                  <pre style={{ marginTop: 6, whiteSpace: 'pre-wrap', fontSize: 12, background: token.colorBgContainer, padding: 8, borderRadius: 4, border: `1px solid ${token.colorBorder}` }}>
                    {typeof thought.parameters === 'string' ? thought.parameters : JSON.stringify(thought.parameters, null, 2)}
                  </pre>
                </div>
              )}
              {thought.message && (
                <div style={{ marginBottom: thought.error || typeof thought.result !== 'undefined' ? 6 : 0 }}>
                  <Text strong>Message: </Text>
                  <Text>{thought.message}</Text>
                </div>
              )}
              {thought.error && (
                <div style={{ marginBottom: typeof thought.result !== 'undefined' ? 6 : 0 }}>
                  <Text strong type="danger">Error: </Text>
                  <Text type="danger">{thought.error}</Text>
                </div>
              )}
              {typeof thought.result !== 'undefined' && (
                <div>
                  <Text strong>Result:</Text>
                  <pre style={{ marginTop: 6, whiteSpace: 'pre-wrap', fontSize: 12, background: token.colorBgContainer, padding: 8, borderRadius: 4, border: `1px solid ${token.colorBorder}` }}>
                    {typeof thought.result === 'string' ? thought.result : JSON.stringify(thought.result, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}

          {/* Render nested children if any */}
          {node.children.length > 0 && node.children.map((childNode, childIndex) => (
            <div key={childNode.thought.id} style={{ marginTop: 8 }}>
              {renderThoughtNode(childNode, childIndex, node.children.length)}
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <Card 
      title="Execution Trace"
      extra={(
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Tooltip title="Thumbs up">
            <Button
              size="small"
              type="text"
              icon={props?.currentFeedback === 'like' ? <LikeFilled style={{ color: token.colorSuccess }} /> : <LikeOutlined style={{ color: token.colorText }} />}
              onClick={(e) => { e.stopPropagation(); onOpenFeedback?.('up'); }}
              aria-label="Thumbs up feedback"
            />
          </Tooltip>
          <Tooltip title="Thumbs down">
            <Button
              size="small"
              type="text"
              icon={props?.currentFeedback === 'dislike' ? <DislikeFilled style={{ color: token.colorError }} /> : <DislikeOutlined style={{ color: token.colorText }} />}
              onClick={(e) => { e.stopPropagation(); onOpenFeedback?.('down'); }}
              aria-label="Thumbs down feedback"
            />
          </Tooltip>
          <Button
            size="small"
            type="text"
            onClick={(e) => { e.stopPropagation(); setIsWide(w => !w); }}
            aria-label={isWide ? 'Collapse execution trace' : 'Expand execution trace'}
            icon={isWide ? <CompressOutlined /> : <ExpandOutlined />}
          />
        </div>
      )}
       style={{ 
         width: isWide ? 'calc(100% - 64px)' : '50vw',
         margin: isWide ? '16px 32px 24px 32px' : '0px 24px 20px 0',
         transition: 'width 200ms ease, margin 200ms ease',
         zIndex: isWide ? 1000 : undefined,
          display: 'flex',
          flexDirection: 'column',
          maxHeight: 'calc(98vh - 166px)',
          boxShadow: appTheme === 'dark' ? '0 1px 2px rgba(0,0,0,0.6)' : token.boxShadow,
          background: token.colorBgElevated,
        }}
        bodyStyle={{ 
          flex: 1, 
          overflow: 'auto',
          padding: '8px 0',
        }}
        headStyle={{
         borderBottom: `1px solid ${token.colorBorder}`,
         padding: '12px 16px',
       }}
    >
      <Space direction="vertical" style={{ width: '100%' }} size={0}>
        {thoughtHierarchy.map((node, index) => renderThoughtNode(node, index, thoughtHierarchy.length))}

        {/* Working line: show when execution active but no pending tool uses */}
        {isExecuting && !chainOfThoughts.some(t => t.type === 'toolUse' && t.status === 'pending') && (
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              padding: '8px 12px',
              borderBottom: 'none',
              transition: 'background-color 0.2s',
            }}
          >
            <div style={{ marginRight: '10px', marginTop: '-2px', minWidth: '16px' }}>
              <Spin size="small" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: token.colorText, lineHeight: 1.5 }}>Working...</div>
            </div>
          </div>
        )}

        { /* sentinel element for auto-scroll */ }
        <div ref={sentinelRef} />
      </Space>
    </Card>
  );
}
