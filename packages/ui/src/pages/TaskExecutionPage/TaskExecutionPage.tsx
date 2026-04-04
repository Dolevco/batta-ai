import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { Card, Alert, Spin, Select, Button, Tabs } from 'antd';
import { EditOutlined, EyeOutlined, UnorderedListOutlined } from '@ant-design/icons';
import 'reactflow/dist/style.css';
import type { Node, Edge } from 'reactflow';
import { useNodesState, useEdgesState } from 'reactflow';
import type { TaskResponse, TaskExecution, TaskRun, Feedback, Thought } from '../../types';
import { useTasks, useTaskExecution, useTaskRuns } from '../../hooks';
import ExecutionNode from './ExecutionNode';
import ExecutionProgress from './ExecutionProgress';
import ChainOfThoughts from './ChainOfThoughts';
import AgentVisualization from './AgentVisualization';
import ExecutionGraph from './ExecutionGraph';
import StepDetailsDrawer from './StepDetailsDrawer';
import ExecutionHeader from './ExecutionHeader';
import ExecutionFeedback from './ExecutionFeedback';
import { styles } from './styles';

const nodeTypes = {
  execution: ExecutionNode,
};

export function TaskExecutionPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const { getTaskRuns, getTaskRun, streamTaskRunEvents } = useTaskRuns();
  const { executeTaskStream } = useTaskExecution();
  const { getTask, cancelTask, refinePlanFromRun } = useTasks();

  // Determine where to go when the user clicks Back. Prefer location.state.from, then ?from= query param,
  // then browser history, and finally fall back to the planner view for this task.
  const fromState = (location.state as any)?.from;
  const fromParam = searchParams.get('from');
  const handleBack = useCallback(() => {
    if (fromState) {
      navigate(fromState);
      return;
    }
    if (fromParam) {
      navigate(fromParam);
      return;
    }
    // If there's a history entry, go back; otherwise fall back to planner for this task
    try {
      if (window.history.length > 1) {
        navigate(-1);
        return;
      }
    } catch (e) {
      // ignore and fall through to fallback
    }
    navigate(`/planner/${taskId}`);
  }, [fromState, fromParam, navigate, taskId]);

  const [task, setTask] = useState<TaskResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [execution, setExecution] = useState<TaskExecution | null>(null);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  

  const [chainOfThoughts, setChainOfThoughts] = useState<Thought[]>([]);
  const [taskResults, setTaskResults] = useState<any>(null);
  // Flag to indicate user-requested cancellation so we can ignore server errors/events
  const cancelRequestedRef = useRef(false);
  // A monotonically increasing id for each execution run. Events include the run id via closure
  // and are ignored if they don't match the latest run. This prevents mixing events from
  // a previous (cancelled) run with a newly started run.
  const executionRunIdRef = useRef(0);
  // serverRunIdRef holds the actual run id returned/emitted by the server for the current run
  // so we can update the URL when we learn it.
  const serverRunIdRef = useRef<string | null>(null);
  // Track whether the selected run is from a live execution (vs user selecting from dropdown)
  // This prevents the loadSelectedRun effect from overwriting live execution data
  const isLiveExecutionRef = useRef(false);
  // ref to allow graph generator to reference latest click handler without circular deps
  const handleNodeClickRef = useRef<(stepId: string) => void>(() => {});
  
  // Ref to track a temporary "creating environment" thought added when starting execution.
  const creatingEnvThoughtIdRef = useRef<string | null>(null);
  // Ref used to know we're still waiting for the first streamed event for the current run
  const waitingForFirstStreamEventRef = useRef(false);
  
  // Task runs state
  const [taskRuns, setTaskRuns] = useState<TaskRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedRunStatus, setSelectedRunStatus] = useState<string | null>(null);
  const [loadingRuns, setLoadingRuns] = useState(false);

  // Feedback UI state
  const [feedbacks, setFeedbacks] = useState<Feedback[]>([]);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackPrefill, setFeedbackPrefill] = useState<'' | 'up' | 'down' | 'report'>(''); // New state for prefill text
  // State to request opening feedback panel in edit mode for a specific feedback id
  const [feedbackEditTarget, setFeedbackEditTarget] = useState<{ id: string; rating?: 'like' | 'dislike' } | null>(null);

  // Helper: build a Thought from an event
  const buildThoughtFromEvent = (eventName: string, data: any, timestamp?: string | Date): Thought | undefined => {
    const ts = timestamp ? new Date(timestamp) : new Date();

    if (eventName === 'toolUse' && data.name !== 'task_completed') {
      return {
        id: `thought-${Date.now()}-${Math.random()}`,
        type: 'toolUse',
        name: data?.name,
        reason: data?.reason,
        parameters: data?.parameters,
        result: data?.parameters || data, // Store parameters in result field for later extraction
        status: data?.status || 'pending',
        timestamp: ts,
      } as Thought;
    }

    if (eventName === 'stepMemoryRetrieved') {
      return {
        id: `thought-${Date.now()}-${Math.random()}`,
        type: 'stepMemoryRetrieved',
        message: 'Retrieved relevant memories from past executions',
        insights: data?.insights,
        timestamp: ts,
      } as Thought;
    }

    if (eventName === 'planStepStart') {
      return {
        id: `thought-${Date.now()}-${Math.random()}`,
        content: `▶️ Starting step: ${data?.name || data?.id || ''}`,
        type: 'step',
        timestamp: ts,
      } as Thought;
    }

    if (eventName === 'planStepResult') {
      const success = data?.result?.success ?? data?.success ?? false;
      return {
        id: `thought-${Date.now()}-${Math.random()}`,
        content: success ? `🏁 Step completed: ${data?.name || data?.id || ''}` : `❌ Step failed: ${data?.name || data?.id || ''}`,
        type: success ? 'other' : 'error',
        timestamp: ts,
      } as Thought;
    }

    if (eventName === 'toolResult') {
      // For results we prefer to attach to an existing toolUse thought, but also provide a fallback
      // Store the full result data including metadata and preview if available
      const resultData = data?.metadata || data?.preview 
        ? { 
            result: data?.result,
            metadata: data?.metadata,
            preview: data?.preview,
          }
        : data?.result;
      
      return {
        id: `thought-${Date.now()}-${Math.random()}`,
        type: 'toolUse',
        name: data?.name,
        message: data?.message,
        error: data?.error,
        result: resultData,
        status: data?.success ? 'success' : 'failed',
        timestamp: ts,
      } as Thought;
    }

    // Generic fallback
    return undefined;
  };

  // Helper: apply a toolResult to an array of thoughts (pure)
  const applyToolResultToThoughtsArray = (thoughts: Thought[], data: any, timestamp?: string | Date) => {
    const ts = timestamp ? new Date(timestamp) : new Date();
    const reversed = [...thoughts].reverse();
    let idxFromEnd = reversed.findIndex(t => t.type === 'toolUse' && t.status === 'pending' && (!t.name || t.name === data?.name));
    if (idxFromEnd === -1) {
      idxFromEnd = reversed.findIndex(t => t.type === 'toolUse' && t.status === 'pending');
    }

    if (idxFromEnd === -1) {
      // no pending toolUse - append new result thought
      return [
        ...thoughts,
        buildThoughtFromEvent('toolResult', data, ts)!,
      ];
    }

    const idx = thoughts.length - 1 - idxFromEnd;
    
    // Calculate the number of events between the toolUse and this toolResult
    // This indicates the depth of the hierarchy (how many child events occurred)
    const childEventCount = thoughts.length - 1 - idx;
    
    // Store the full result data including metadata and preview if available
    const resultData = data?.metadata || data?.preview 
      ? { 
          result: data?.result,
          metadata: data?.metadata,
          preview: data?.preview,
        }
      : data?.result;
    
    const updated = thoughts.slice();
    updated[idx] = {
      ...updated[idx],
      message: data?.message,
      error: data?.error,
      result: resultData,
      status: data?.success ? 'success' : 'failed',
      childEventCount,
      timestamp: ts,
    } as Thought;
    return updated;
  };

  // Helper: apply an event to an execution object (pure)
  const applyEventToExecutionObject = (exec: TaskExecution, eventName: string, data: any, timestamp?: string | Date): TaskExecution => {
    const tsIso = timestamp ? new Date(timestamp).toISOString() : new Date().toISOString();
    if (!exec) return exec;

    if (eventName === 'planStepStart') {
      const stepId = data?.id || data?.stepId;
      return {
        ...exec,
        currentStepId: stepId,
        executedSteps: exec.executedSteps.map(s => s.stepId === stepId ? ({
          ...s,
          status: 'running',
          startedAt: tsIso,
          logs: [
            ...s.logs,
            { timestamp: tsIso, level: 'info', message: '▶️ Starting execution' }
          ],
        }) : s),
      } as TaskExecution;
    }

    if (eventName === 'planStepResult') {
      const stepId = data?.id || data?.stepId;
      const result = data?.result ?? data;
      const success = result?.success ?? data?.success ?? false;
      return {
        ...exec,
        executedSteps: exec.executedSteps.map(s => s.stepId === stepId ? ({
          ...s,
          status: success ? 'completed' : 'failed',
          completedAt: tsIso,
          result: success ? (typeof result?.result === 'string' ? result.result : JSON.stringify(result?.result)) : undefined,
          error: success ? undefined : (result?.error || data?.error || 'Unknown error'),
          logs: [
            ...s.logs,
            { timestamp: tsIso, level: success ? 'info' : 'error', message: success ? '✅ Completed successfully' : `❌ Failed: ${result?.error || data?.error}` }
          ],
        }) : s),
        currentStepId: undefined,
      } as TaskExecution;
    }

    // Other events do not change execution object
    return exec;
  };

  // Fetch task data on mount
  useEffect(() => {
    const fetchTask = async () => {
      if (!taskId) {
        navigate('/');
        return;
      }
      
      try {
        setLoading(true);
        const taskData = await getTask(taskId);
        setTask(taskData);
        setFeedbacks(taskData?.feedbacks || []);
      } catch (error) {
        console.error('Failed to fetch task:', error);
        navigate('/');
      } finally {
        setLoading(false);
      }
    };

    fetchTask();
  }, [taskId, navigate]);

  // Fetch task runs when task is loaded
  useEffect(() => {
    const fetchTaskRuns = async () => {
      if (!taskId) return;
      
      try {
        setLoadingRuns(true);
        const runs = await getTaskRuns(taskId);
        setTaskRuns(runs);
      } catch (error) {
        console.error('Failed to fetch task runs:', error);
      } finally {
        setLoadingRuns(false);
      }
    };

    if (task) {
      fetchTaskRuns();
    }
  }, [taskId, task]);

  // Auto-load run from URL query parameter
  useEffect(() => {
    const runId = searchParams.get('runId');
    // Only auto-load if:
    // 1. There's a runId in the URL
    // 2. We have task runs loaded
    // 3. No run is currently selected
    // 4. We're not currently executing (to avoid interfering with fresh runs)
    if (runId && taskRuns.length > 0 && !selectedRunId && !isExecuting) {
      isLiveExecutionRef.current = false; // This is a historical run from URL
      setSelectedRunId(runId);
    }
  }, [searchParams, taskRuns, selectedRunId, isExecuting]);

  // Helper to generate nodes/edges from a task plan and an execution object (pure)
  const generateExecutionGraph = (taskParam: TaskResponse | null, executionParam: TaskExecution | null) => {
    if (!taskParam?.plan) return { nodes: [] as Node[], edges: [] as Edge[] };

    const nodes: Node[] = taskParam.plan.subTasks.map((subTask, index) => {
      // Derive the execution object for this node. If the selected run was cancelled and
      // this step was the currentStepId, present it with a 'cancelled' status so the node
      // can render a cancelled state while keeping other steps dimmed.
      const origExec = executionParam?.executedSteps.find(e => e.stepId === subTask.id);
      let nodeExec = origExec;
      if (selectedRunStatus === 'cancelled' && executionParam?.currentStepId === subTask.id) {
        nodeExec = origExec ? { ...origExec, status: 'cancelled' } as any : { stepId: subTask.id, status: 'cancelled', logs: [] } as any;
      }

      return {
        id: subTask.id,
        type: 'execution',
        position: { x: 400, y: index * 200 },
        data: {
          step: subTask,
          execution: nodeExec,
          onClick: handleNodeClickRef.current,
        },
        style: styles.node,
      } as Node;
    });

    const edges: Edge[] = [];
    taskParam.plan.subTasks.forEach((subTask) => {
      subTask.dependsOn?.forEach((depIndex) => {
        if (depIndex < taskParam.plan!.subTasks.length) {
          const depId = taskParam.plan!.subTasks[depIndex].id;
          const depExecution = executionParam?.executedSteps.find(e => e.stepId === depId);
          const stepExecutionOrig = executionParam?.executedSteps.find(e => e.stepId === subTask.id);
          const stepExecution = (selectedRunStatus === 'cancelled' && executionParam?.currentStepId === subTask.id)
            ? { ...(stepExecutionOrig || { stepId: subTask.id, status: 'cancelled' }), status: 'cancelled' }
            : stepExecutionOrig;

          edges.push({
            id: `${depId}-${subTask.id}`,
            source: depId,
            sourceHandle: 's',
            target: subTask.id,
            targetHandle: 't',
            // If the run was cancelled, never animate edges. Otherwise animate when the step is running.
            animated: selectedRunStatus === 'cancelled' ? false : !!(stepExecution?.status === 'running'),
            type: 'smoothstep',
            style: {
              stroke: depExecution?.status === 'completed' ? '#52c41a' : '#d9d9d9',
              strokeWidth: 3,
            },
            markerEnd: {
              type: 'arrowclosed',
              color: depExecution?.status === 'completed' ? '#52c41a' : '#d9d9d9',
            } as any,
            labelStyle: {
              fontSize: 14,
              fontWeight: 600,
              color: '#333',
              background: 'rgba(255,255,255,0.95)',
              padding: '4px 8px',
              borderRadius: 6,
              border: '1px solid rgba(0,0,0,0.06)'
            },
            labelBgPadding: [6, 4],
          });
        }
      });
    });

    return { nodes, edges };
  };

  // Load selected run data
  useEffect(() => {
    const abortController = new AbortController();
    
    const loadSelectedRun = async () => {
      if (!selectedRunId) return;
      
      // CRITICAL: Don't load previous run data if this runId is from a live execution
      // The live execution is already building state in real-time via the stream callback
      if (isLiveExecutionRef.current) return;
      
      try {
        const run = await getTaskRun(selectedRunId);
        setSelectedRunStatus(run.status);
        
        // Start from an initial execution state derived from the task plan
        let replayExecution: TaskExecution | null = null;
        if (task?.plan) {
          // Map TaskRun status to a TaskExecution status. For cancelled runs map to 'idle'
          // so the UI will not show progress indicators (we still add a cancellation thought below).
          const mappedStatus = run.status === 'running'
            ? 'running'
            : run.status === 'completed'
              ? 'completed'
              : 'idle';

          replayExecution = {
            taskId: task.id,
            status: mappedStatus as any,
            executedSteps: task.plan.subTasks.map(subTask => ({ stepId: subTask.id, status: 'pending', logs: [] })),
            startedAt: run.startedAt,
            completedAt: run.completedAt,
          } as TaskExecution;
        }

        // Replay events sequentially to build thoughts and execution state
        let thoughtsAcc: Thought[] = [];
        for (const event of run.chainOfThoughts) {
          const eventName = event.type as string;
          const data = event.data ?? event;

          if (eventName === 'toolResult') {
            thoughtsAcc = applyToolResultToThoughtsArray(thoughtsAcc, data, event.timestamp);
          } else {
            const currentThought = buildThoughtFromEvent(eventName, data, event.timestamp);
            if (currentThought) {
              thoughtsAcc.push(currentThought);
            }
          }

          if (replayExecution) {
            replayExecution = applyEventToExecutionObject(replayExecution, eventName, data, event.timestamp);
          }
        }

        // If the run was cancelled, add a final cancellation thought and ensure the UI is not
        // showing it as an active running execution.
        if (run.status === 'cancelled') {
          thoughtsAcc.push({
            id: `thought-${Date.now()}-${Math.random()}`,
            content: `🚫 Execution cancelled`,
            type: 'other',
            timestamp: new Date(run.completedAt || Date.now()),
          });

          if (replayExecution) {
            // Keep execution status typed to allowed values; use 'idle' so no progress is shown.
            // Keep currentStepId if present so we can mark that node as cancelled in the graph.
            replayExecution = { ...replayExecution, status: 'idle' } as TaskExecution;

            // Normalize step statuses: any step that is 'running' should not show as in-progress.
            // Map running -> pending so graph/edges are not animated. We keep completed/failed as-is.
            replayExecution = {
              ...replayExecution,
              executedSteps: replayExecution.executedSteps.map(s => ({
                ...s,
                status: s.status === 'running' ? 'pending' : s.status,
              })),
            } as TaskExecution;
          }

          // Also update chain of thoughts: any toolUse thoughts left in 'pending' or 'running'
          // should be marked as failed/cancelled so the sidebar doesn't show an in-progress spinner.
          thoughtsAcc = thoughtsAcc.map(t => {
            if (t.type === 'toolUse' && (t.status === 'pending' || t.status === 'running')) {
              return {
                ...t,
                status: 'failed',
                error: t.error || 'Cancelled',
                message: t.message || 'Cancelled',
              } as Thought;
            }
            return t;
          });
        }

        setChainOfThoughts(thoughtsAcc);
        setTaskResults(run.result);
        setExecution(replayExecution);
        setSelectedRunStatus(run.status);
        // reflect running/completed state in the UI
        setIsExecuting(run.status === 'running');
        // update flow nodes/edges to reflect the replayed execution immediately
        const { nodes: replayNodes, edges: replayEdges } = generateExecutionGraph(task, replayExecution);
        setFlowNodes(replayNodes);
        setFlowEdges(replayEdges);
        // show feedbacks relevant to this run (or all feedbacks if none specific)
        setFeedbacks((task?.feedbacks || []).filter(f => !selectedRunId || f.taskRunId === selectedRunId));

        // If the run is still running, stream live events
        if (run.status === 'running') {
          console.log('🔴 Task run is still running, connecting to live stream...');
          
          try {
            await streamTaskRunEvents(selectedRunId, (eventName, data) => {
              console.log('📡 Streamed event:', eventName, data);
              
              // Apply events using the same logic as live execution
              if (eventName === 'toolUse') {
                const thought = buildThoughtFromEvent(eventName, data, data?.timestamp);
                if (thought) {
                  setChainOfThoughts(prev => [...prev, thought]);
                }
              } else if (eventName === 'stepMemoryRetrieved') {
                const thought = buildThoughtFromEvent(eventName, data, data?.timestamp);
                if (thought) {
                  setChainOfThoughts(prev => [...prev, thought]);
                }
              } else if (eventName === 'toolResult') {
                setChainOfThoughts(prev => applyToolResultToThoughtsArray(prev, data, data?.timestamp));
              } else if (eventName === 'planStepStart' || eventName === 'planStepResult') {
                const thought = buildThoughtFromEvent(eventName, data, data?.timestamp);
                if (thought) {
                  setChainOfThoughts(prev => [...prev, thought]);
                }
                setExecution(prev => prev ? applyEventToExecutionObject(prev, eventName, data, data?.timestamp) : prev);
              } else if (eventName === 'done') {
                console.log('✅ Task run completed');
                setIsExecuting(false);
                setExecution(prev => prev ? { 
                  ...prev, 
                  status: 'completed', 
                  completedAt: new Date().toISOString(),
                  currentStepId: undefined 
                } : null);
                if (data && typeof data === 'object' && (data as any).result) {
                  setTaskResults((data as any).result);
                }
                // Refresh task runs list
                if (taskId) {
                  getTaskRuns(taskId).then(runs => setTaskRuns(runs)).catch(console.error);
                }
              } else {
                // Fallback: record generic event
                const thought = buildThoughtFromEvent(eventName, data, data?.timestamp);
                if (thought) {
                  setChainOfThoughts(prev => [...prev, thought]);
                }
              }
            }, abortController.signal);
          } catch (error: any) {
            // Ignore abort errors
            if (error?.name === 'AbortError') {
              console.log('🔴 Stream aborted (user navigated away or selected different run)');
            } else {
              console.error('Failed to stream task run events:', error);
            }
          }
        }
      } catch (error) {
        console.error('Failed to load task run:', error);
      }
    };

    loadSelectedRun();
    
    // Cleanup: abort the stream when component unmounts or selectedRunId changes
    return () => {
      abortController.abort();
    };
  }, [selectedRunId, task, getTaskRun, streamTaskRunEvents, taskId, getTaskRuns]);

  const handleNodeClick = useCallback((stepId: string) => {
    setSelectedStepId(stepId);
    setDrawerVisible(true);
  }, []);

  // keep ref synced with latest handler so graph generator can use it without deps
  useEffect(() => {
    handleNodeClickRef.current = handleNodeClick;
  }, [handleNodeClick]);

  const [flowNodes, setFlowNodes] = useNodesState([]);
  const [flowEdges, setFlowEdges] = useEdgesState([]);

  // Initialize execution state
  useEffect(() => {
    if (!task?.plan) return;
    
    setExecution({
      taskId: task.id,
      status: 'idle',
      executedSteps: task.plan.subTasks.map(subTask => ({
        stepId: subTask.id,
        status: 'pending',
        logs: [],
      })),
    });
  }, [task]);

  // Update nodes and edges when task or execution state changes
  useEffect(() => {
    if (!task) return;
    const { nodes: updatedNodes, edges: updatedEdges } = generateExecutionGraph(task, execution);
    setFlowNodes(updatedNodes);
    setFlowEdges(updatedEdges);
  }, [task, execution, selectedRunStatus, setFlowNodes, setFlowEdges]);

  // Mock execution functions (replace with real API calls)
  const startExecution = async () => {
    if (!task) return;

    // Generate a runId upfront so we can use it for cancellation and URL tracking
    const newRunId = crypto.randomUUID();

    // CRITICAL: Mark a new execution run FIRST before any state resets
    // This ensures any pending callbacks from the previous run are immediately invalidated
    const runId = ++executionRunIdRef.current;
    cancelRequestedRef.current = false;
    isLiveExecutionRef.current = true; // Mark this as a live execution
    
    // Set the server run ID to the generated one and update URL immediately
    serverRunIdRef.current = newRunId;
    setSelectedRunId(newRunId);
    try { 
      const newUrl = `${location.pathname}?runId=${newRunId}`;
      window.history.pushState({}, '', newUrl); 
    } catch (e) { /* ignore */ }

    // Now reset all execution state to start fresh
    // Any pending state updates from previous runs will be ignored due to the runId increment above
    setSelectedRunStatus(null);
    setChainOfThoughts([]);
    setTaskResults(null);
    setFeedbacks(task?.feedbacks || []); // Reset feedbacks to task's base feedbacks
    
    // Create fresh execution state from task plan
    const freshExecution: TaskExecution = {
      taskId: task.id,
      status: 'running',
      startedAt: new Date().toISOString(),
      executedSteps: task.plan?.subTasks.map(subTask => ({ 
        stepId: subTask.id, 
        status: 'pending', 
        logs: [] 
      })) || [],
    } as any;
    
    setExecution(freshExecution);
    
    // Reset graph nodes and edges to fresh state
    const { nodes: freshNodes, edges: freshEdges } = generateExecutionGraph(task, freshExecution);
    setFlowNodes(freshNodes);
    setFlowEdges(freshEdges);

    setIsExecuting(true);
    
    // Insert a temporary Chain-of-Thought entry indicating we're creating the environment
    // This will be removed as soon as the first streamed event is received for this run.
    const envThoughtId = `thought-creating-env-${Date.now()}-${Math.random()}`;
    creatingEnvThoughtIdRef.current = envThoughtId;
    waitingForFirstStreamEventRef.current = true;
    setChainOfThoughts(prev => [...prev, {
      id: envThoughtId,
      content: '▶️ Creating environment to run the task...',
      type: 'other',
      timestamp: new Date(),
    }]);
     
    try {
      const taskResult = await executeTaskStream(
        task.id,
        (eventName, data) => {
          // No need to extract runId from events anymore since we generated it upfront
          // Just keep the handler for removing the "creating environment" thought
          
          // Remove the temporary "creating environment" thought when the first streamed event arrives
          if (waitingForFirstStreamEventRef.current && runId === executionRunIdRef.current) {
            const idToRemove = creatingEnvThoughtIdRef.current;
            if (idToRemove) {
              setChainOfThoughts(prev => prev.filter(t => t.id !== idToRemove));
              creatingEnvThoughtIdRef.current = null;
            }
            waitingForFirstStreamEventRef.current = false;
          }

          // Ignore events if user requested cancellation or if this event belongs to
          // an older run (we compare the captured runId against the current run id).
          if (cancelRequestedRef.current || runId !== executionRunIdRef.current) return;

          // Build thought or update execution based on event
          if (eventName === 'toolUse') {
            const thought = buildThoughtFromEvent(eventName, data);
            if (thought) {
              setChainOfThoughts(prev => {
                // Double-check runId hasn't changed since callback was created
                if (runId !== executionRunIdRef.current || cancelRequestedRef.current) return prev;
                return [...prev, thought];
              });
            }
          } else if (eventName === 'stepMemoryRetrieved') {
            const thought = buildThoughtFromEvent(eventName, data);
            if (thought) {
              setChainOfThoughts(prev => {
                if (runId !== executionRunIdRef.current || cancelRequestedRef.current) return prev;
                return [...prev, thought];
              });
            }
          } else if (eventName === 'toolResult') {
            setChainOfThoughts(prev => {
              if (runId !== executionRunIdRef.current || cancelRequestedRef.current) return prev;
              return applyToolResultToThoughtsArray(prev, data);
            });
          } else if (eventName === 'planStepStart' || eventName === 'planStepResult') {
            // Update chain of thoughts
            const thought = buildThoughtFromEvent(eventName, data);
            if (thought) {
              setChainOfThoughts(prev => {
                if (runId !== executionRunIdRef.current || cancelRequestedRef.current) return prev;
                return [...prev, thought];
              });
            }

            // Update execution object
            setExecution(prev => {
              if (runId !== executionRunIdRef.current || cancelRequestedRef.current) return prev;
              return prev ? applyEventToExecutionObject(prev, eventName, data) : prev;
            });
          } else {
            // Fallback: record generic event
            const thought = buildThoughtFromEvent(eventName, data);
            if (thought) {
              setChainOfThoughts(prev => {
                if (runId !== executionRunIdRef.current || cancelRequestedRef.current) return prev;
                return [...prev, thought];
              });
            }
          }
        },
        newRunId // Pass the generated runId to the API
      );

      // Store the task results from the API response
      if (taskResult) {
        // Only process the result if it belongs to the current run
        if (runId !== executionRunIdRef.current) {
          // ignore results from previous runs
        } else if (!cancelRequestedRef.current) {
          setTaskResults(taskResult);
          
          // runId is already set in the URL from the start, no need to update it here
          
          setChainOfThoughts(prev => {
            // Final check before adding completion thought
            if (runId !== executionRunIdRef.current || cancelRequestedRef.current) return prev;
            return [...prev, {
              id: `thought-${Date.now()}-${Math.random()}`,
              content: `🏁 Task execution completed ${taskResult.success ? 'successfully' : 'with errors'}`,
              timestamp: new Date(),
            }];
          });

          // Execution completed
          setExecution(prev => {
            if (runId !== executionRunIdRef.current || cancelRequestedRef.current) return prev;
            return prev ? { 
              ...prev, 
              status: 'completed', 
              completedAt: new Date().toISOString(),
              currentStepId: undefined 
            } : null;
          });
          
          // Refresh task runs list after execution completes
          if (taskId) {
            getTaskRuns(taskId).then(runs => setTaskRuns(runs)).catch(console.error);
          }
        } else {
          // If user cancelled, ignore server-provided result and keep UI idle
          setExecution(prev => prev ? { ...prev, status: 'idle', currentStepId: undefined } : null);
        }
      }
    } catch (error: any) {
      console.error('Execution error:', error);
      // Ignore errors from older runs or user-requested cancellations
      if (cancelRequestedRef.current || runId !== executionRunIdRef.current) {
        // For user-requested cancellation or stale run, mark execution idle quietly
        setExecution(prev => {
          if (runId !== executionRunIdRef.current) return prev;
          return prev ? { ...prev, status: 'idle', currentStepId: undefined } : null;
        });
      } else {
        // Only show failure UI for the current run
        setExecution(prev => {
          if (runId !== executionRunIdRef.current || cancelRequestedRef.current) return prev;
          return prev ? { 
            ...prev, 
            status: 'failed',
            completedAt: new Date().toISOString(),
            error: error.message || 'Execution failed'
          } : null;
        });
        setChainOfThoughts(prev => {
          if (runId !== executionRunIdRef.current || cancelRequestedRef.current) return prev;
          return [...prev, {
            id: `thought-${Date.now()}-${Math.random()}`,
            content: `❌ Execution failed: ${error.message}`,
            timestamp: new Date(),
          }];
        });
      }
     } finally {
       setIsExecuting(false);
      // Only clear the cancel flag for the run that owns this promise. If a newer run
      // started (executionRunIdRef changed) or cancel was requested for a newer run,
      // we must not clear the flag here.

      // Ensure the temporary "creating environment" thought is removed if still present
      if (runId === executionRunIdRef.current) {
        if (creatingEnvThoughtIdRef.current) {
          setChainOfThoughts(prev => prev.filter(t => t.id !== creatingEnvThoughtIdRef.current));
          creatingEnvThoughtIdRef.current = null;
        }
        waitingForFirstStreamEventRef.current = false;

        cancelRequestedRef.current = false;
        // Clear the live execution flag so user can now load this run from history if desired
        isLiveExecutionRef.current = false;
      }
     }
   };

  const pauseExecution = () => {
    setIsExecuting(false);
    setExecution(prev => prev ? { ...prev, status: 'paused' } : null);
  };

  const stopExecution = () => {
    // Ask server to cancel the running execution stream, then reset UI state
    // mark cancel requested so we ignore subsequent server events
    cancelRequestedRef.current = true;
    // Immediately invalidate any existing run so late events from the server are ignored
    executionRunIdRef.current++;
     (async () => {
       try {
         // Cancel the specific task run if we have a run ID
         if (serverRunIdRef.current) {
           await cancelTask(serverRunIdRef.current);
         }
       } catch (err) {
         console.warn('Failed to cancel execution on server:', err);
       } finally {
         setIsExecuting(false);
         // Reset execution to a clean idle state derived from the task plan so subsequent runs start fresh
         if (task?.plan) {
           const resetExecution: TaskExecution = {
             taskId: task.id,
             status: 'idle',
             executedSteps: task.plan.subTasks.map(subTask => ({ stepId: subTask.id, status: 'pending', logs: [] })),
           } as any;
           setExecution(resetExecution);
         } else {
           setExecution(null);
         }
         setTaskResults(null);
         setChainOfThoughts([]);
       }
     })();
   };

  const getExecutionProgress = () => {
    if (!execution) return 0;
    const completedSteps = execution.executedSteps.filter(s => s.status === 'completed').length;
    const totalSteps = execution.executedSteps.length;
    if (totalSteps === 0) return 0;
    return Math.round((completedSteps / totalSteps) * 100);
  };

  const handleRefinePlan = useCallback(async () => {
    if (!taskId || !selectedRunId) return;
    
    try {
      setLoading(true);
      await refinePlanFromRun(taskId, selectedRunId, (eventName: string, data: any) => {
        // Handle streaming events if needed (similar to execution streaming)
        console.log('Refine plan event:', eventName, data);
      });
      
      // Navigate to the planner page to show the refined plan
      navigate(`/planner/${taskId}`);
    } catch (error) {
      console.error('Failed to refine plan:', error);
      // Could show an error notification here
    } finally {
      setLoading(false);
    }
  }, [taskId, selectedRunId, refinePlanFromRun, navigate]);

  const selectedStep = selectedStepId ? task?.plan?.subTasks.find(s => s.id === selectedStepId) || null : null;
  const selectedExecution = selectedStepId ? execution?.executedSteps.find(e => e.stepId === selectedStepId) : null;

  // Show loading state while fetching task
  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '400px' }}>
        <Spin size="large" />
      </div>
    );
  }

  // Show error if task not found
  if (!task) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '400px' }}>
        <Alert
          message="Task not found"
          description="The task you're looking for doesn't exist or couldn't be loaded."
          type="error"
          showIcon
        />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '96vh' }}>
      {/* Header */}
      <ExecutionHeader
        task={task}
        execution={execution}
        isExecuting={isExecuting}
        selectedRunId={selectedRunId}
        onStart={startExecution}
        onPause={pauseExecution}
        onStop={stopExecution}
        onBack={handleBack}
      />

      {/* Task Runs Dropdown */}
      {taskRuns.length > 0 && (
        <div style={{ padding: '0 24px 16px 24px', display: 'flex', gap: 12, alignItems: 'center' }}>
          <Select
            style={{ width: 300 }}
            placeholder="View previous run"
            value={selectedRunId}
            onChange={(value) => {
              isLiveExecutionRef.current = false; // User is selecting a historical run
              setSelectedRunId(value);
              try {
                if (value) {
                  const newUrl = `${location.pathname}?runId=${encodeURIComponent(value)}`;
                  window.history.pushState({}, '', newUrl);
                } else {
                  window.history.pushState({}, '', location.pathname);
                }
              } catch (e) { /* ignore */ }
            }}
            allowClear
            onClear={() => {
              isLiveExecutionRef.current = false; // User is clearing selection
              setSelectedRunId(null);
              setSelectedRunStatus(null);
              setChainOfThoughts([]);
              setTaskResults(null);
              setIsExecuting(false);
              // reset execution to initial plan-derived idle state
              if (task?.plan) {
                const resetExecution: TaskExecution = {
                  taskId: task.id,
                  status: 'idle',
                  executedSteps: task.plan.subTasks.map(subTask => ({ stepId: subTask.id, status: 'pending', logs: [] })),
                } as any;
                setExecution(resetExecution);
                const { nodes: resetNodes, edges: resetEdges } = generateExecutionGraph(task, resetExecution);
                setFlowNodes(resetNodes);
                setFlowEdges(resetEdges);
              } else {
                setExecution(null);
                const { nodes: resetNodes, edges: resetEdges } = generateExecutionGraph(task, null);
                setFlowNodes(resetNodes);
                setFlowEdges(resetEdges);
              }

              try { window.history.pushState({}, '', location.pathname); } catch (e) { /* ignore */ }
            }}
            loading={loadingRuns}
          >
            {taskRuns.map((run) => (
              <Select.Option key={run.id} value={run.id}>
                {new Date(run.startedAt).toLocaleString()} - {run.status}
              </Select.Option>
            ))}
          </Select>
          
          {selectedRunId && (
            <Button
              type="default"
              icon={<EditOutlined />}
              onClick={handleRefinePlan}
            >
              Refine plan using current run
            </Button>
          )}
        </div>
      )}

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Main execution area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
          {/* Progress Bar */}
          <ExecutionProgress
            execution={execution}
            task={task!}
            taskResults={taskResults}
            getExecutionProgress={getExecutionProgress}
            selectedRunStatus={selectedRunStatus}
          />

          {/* Execution Graph */}
          <Card  style={{ margin: '0 24px 16px 24px', display: 'flex', flexDirection: 'column', maxWidth: '83vw' }}>
            <div style={styles.graphContainer}>
              <ExecutionGraph nodes={flowNodes} edges={flowEdges} nodeTypes={nodeTypes} />
            </div>
          </Card>
        </div>

        {/* Right Sidebar: Tabbed view with TV Visualization and Chain of Thoughts, or Feedback panel */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {showFeedback ? (
            <ExecutionFeedback
                task={task}
                selectedRunId={selectedRunId}
                feedbacks={feedbacks}
                prefill={(() => {
                  if (feedbackPrefill === 'up') return "👍 I liked this result. Do more of this.";
                  if (feedbackPrefill === 'down') return "👎 I didn't like this. Next time, please do ...";
                  if (feedbackPrefill === 'report') return "⚠️ Report: " ;
                  return '';
                })()}
               initialEditFeedbackId={feedbackEditTarget?.id}
               initialEditRating={feedbackEditTarget?.rating || feedbackPrefill === 'up' ? 'like' : 'dislike'}
               onCreate={(fb) => setFeedbacks(prev => {
                  // If feedback is associated with a run, ensure only one feedback exists per run
                  if (fb.taskRunId) {
                    const others = prev.filter(p => p.taskRunId !== fb.taskRunId);
                    return [...others, fb];
                  }
                  // Otherwise replace by id if exists, or append
                  const exists = prev.some(p => p.id === fb.id);
                  if (exists) return prev.map(p => p.id === fb.id ? fb : p);
                  return [...prev, fb];
                })}
                onDelete={(id) => setFeedbacks(prev => prev.filter(f => f.id !== id))}
                onClose={() => { setShowFeedback(false); setFeedbackEditTarget(null); setFeedbackPrefill(''); }}
              />
            ) : (
            <Tabs
              defaultActiveKey="tv"
              items={[
                {
                  key: 'tv',
                  label: (
                    <span>
                      <EyeOutlined style={{ marginRight: 8 }} />
                      Co-Work Visualization
                    </span>
                  ),
                  children: (
                    <AgentVisualization
                      chainOfThoughts={chainOfThoughts}
                      isExecuting={isExecuting}
                      executionStatus={execution?.status}
                    />
                  ),
                },
                {
                  key: 'chain',
                  label: (
                    <span>
                      <UnorderedListOutlined style={{ marginRight: 8 }} />
                      Chain of Thoughts
                    </span>
                  ),
                  children: (
                    <ChainOfThoughts
                      chainOfThoughts={chainOfThoughts}
                      isExecuting={isExecuting}
                      currentFeedback={(() => {
                        if (!selectedRunId) return undefined;
                        const fb = feedbacks.find(f => f.taskRunId === selectedRunId);
                        return fb?.rating as 'like' | 'dislike' | undefined;
                      })()}
                      onOpenFeedback={(type) => {
                        // When clicking a thumb in the trace, if there's an existing user feedback for the selected run
                        // and the clicked type differs from the current rating, open the feedback panel in edit mode for that feedback
                        const clicked = type === 'up' ? 'like' : 'dislike';
                        if (selectedRunId) {
                          const existing = feedbacks.find(f => f.taskRunId === selectedRunId);
                          if (existing && existing.rating && existing.rating !== clicked) {
                            setFeedbackEditTarget({ id: existing.id, rating: clicked });
                            setShowFeedback(true);
                            return;
                          }
                        }
                        setFeedbackPrefill(type || '');
                        setShowFeedback(true);
                      }}
                    />
                  ),
                },
              ]}
            />
            )}
        </div>
      </div>

      {/* Step Details Drawer */}
      <StepDetailsDrawer
        selectedStep={selectedStep}
        selectedExecution={selectedExecution}
        visible={drawerVisible}
        onClose={() => setDrawerVisible(false)}
      />
    </div>
  );
}
