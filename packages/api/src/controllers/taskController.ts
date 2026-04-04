import { Request, Response } from 'express';
import { TaskService } from '../services/taskService';
import type { CreateTaskRequest, TaskMessageRequest } from '../types';

export class TaskController {
  private taskService: TaskService;

  constructor(taskService: TaskService) {
    this.taskService = taskService;
  }

  getTaskService(): TaskService {
    return this.taskService;
  }

  private wantsSSE(req: Request): boolean {
    return ((req.headers.accept || '').includes('text/event-stream') || req.query.stream === '1');
  }

  private setupSSE(res: Response) {
    // Setup SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    // Prevent proxies from buffering
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const sendEvent = (event: string, data: unknown) => {
      try {
        const payload = JSON.stringify(data);
        res.write(`event: ${event}\n`);
        res.write(`data: ${payload}\n\n`);
      } catch (e) {
        // ignore serialization errors but keep logging
        // eslint-disable-next-line no-console
        console.error('SSE send error', e);
      }
    };

    return { sendEvent, end: () => res.end() };
  }

  async createTask(req: Request, res: Response): Promise<void> {
    try {
      const request: CreateTaskRequest = req.body;
      const tenantId = req.auth!.tenantId;

      if (this.wantsSSE(req)) {
        const { sendEvent, end } = this.setupSSE(res);

        // Call service with onProgress to stream events
        try {
          const task = await this.taskService.createTask(request, tenantId, (eventName: string, payload: unknown) => {
            sendEvent(eventName, payload);
          });

          sendEvent('done', task);
          end();
        } catch (err: any) {
          sendEvent('error', { message: err?.message ?? 'Unknown error' });
          end();
        }

        return;
      }

      // Non-streaming: behave as before
      const task = await this.taskService.createTask(request, tenantId);
      res.status(201).json(task);
    } catch (error) {
      console.error('Error creating task:', error);
      res.status(500).json({ error: 'Failed to create task' });
    }
  }

  async getTask(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const tenantId = req.auth!.tenantId;
      const task = await this.taskService.getTask(id, tenantId);
      
      if (!task) {
        res.status(404).json({ error: 'Task not found' });
        return;
      }
      
      res.json(task);
    } catch (error) {
      console.error('Error getting task:', error);
      res.status(500).json({ error: 'Failed to get task' });
    }
  }

  async getAllTasks(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = req.auth!.tenantId;
      const tasks = await this.taskService.getAllTasks(tenantId);
      res.json(tasks);
    } catch (error) {
      console.error('Error getting tasks:', error);
      res.status(500).json({ error: 'Failed to get tasks' });
    }
  }

  async deleteTask(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const tenantId = req.auth!.tenantId;
      const deleted = await this.taskService.deleteTask(id, tenantId);
      
      if (!deleted) {
        res.status(404).json({ error: 'Task not found' });
        return;
      }
      
      res.status(204).send();
    } catch (error) {
      console.error('Error deleting task:', error);
      res.status(500).json({ error: 'Failed to delete task' });
    }
  }

  // New: update task with partial fields
  async updateTask(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const tenantId = req.auth!.tenantId;
      const updates = req.body as Partial<any>;

      const updated = await this.taskService.updateTask(id, updates, tenantId);
      res.status(200).json(updated);
    } catch (error: any) {
      console.error('Error updating task:', error);
      if (error?.message === 'Task not found') {
        res.status(404).json({ error: 'Task not found' });
      } else {
        res.status(500).json({ error: 'Failed to update task' });
      }
    }
  }

  async sendTaskMessage(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const tenantId = req.auth!.tenantId;
      const { message }: TaskMessageRequest = req.body;

      if (!message) {
        res.status(400).json({ error: 'Message is required' });
        return;
      }

      if (this.wantsSSE(req)) {
        const { sendEvent, end } = this.setupSSE(res);

        try {
          const task = await this.taskService.sendTaskMessage(id, message, tenantId, (eventName: string, payload: unknown) => {
            sendEvent(eventName, payload);
          });

          sendEvent('done', task);
          end();
        } catch (err: any) {
          sendEvent('error', { message: err?.message ?? 'Unknown error' });
          end();
        }

        return;
      }

      // Non-streaming
      const task = await this.taskService.sendTaskMessage(id, message, tenantId);
      res.status(200).json(task);
    } catch (error) {
      console.error('Error sending task message:', error);
      res.status(500).json({ error: 'Failed to send task message' });
    }
  }

  async executeTask(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const tenantId = req.auth!.tenantId;
      const { runId } = req.body || {};
      const task = await this.taskService.getTask(id, tenantId);
      
      if (!task) {
        res.status(404).json({ error: 'Task not found' });
        return;
      }

      if (!task.plan) {
        res.status(400).json({ error: 'Task has no plan to execute' });
        return;
      }

      if (this.wantsSSE(req)) {
        const { sendEvent, end } = this.setupSSE(res);

        // Execute the task plan with streaming
        try {
          const result = await this.taskService.executeTaskPlan(
            task,
            (eventName: string, payload: unknown) => {
              console.log(`${eventName}: ${JSON.stringify(payload)}`);
              sendEvent(eventName, payload);
            },
            runId
          );

          sendEvent('done', result);
          end();
        } catch (err: any) {
          sendEvent('error', { message: err?.message ?? 'Unknown error' });
          end();
        }

        return;
      }

      // Non-streaming: execute and return result
      const result = await this.taskService.executeTaskPlan(task, undefined, runId);
      res.status(200).json(result);
    } catch (error) {
      console.error('Error executing task:', error);
      res.status(500).json({ error: 'Failed to execute task' });
    }
  }

  // Cancel a specific task run
  async cancelTaskRun(req: Request, res: Response): Promise<void> {
    try {
      const { runId } = req.params;
      const tenantId = req.auth!.tenantId;
      const cancelled = await this.taskService.cancelTaskRun(runId, tenantId);
      if (!cancelled) {
        res.status(404).json({ error: 'Task run not found or not running' });
        return;
      }

      res.status(200).json({ cancelled: true });
    } catch (error) {
      console.error('Error cancelling task run:', error);
      res.status(500).json({ error: 'Failed to cancel task run' });
    }
  }

  // Get all runs for a specific task
  async getTaskRuns(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const tenantId = req.auth!.tenantId;
      const runs = await this.taskService.getTaskRuns(id, tenantId);
      res.json(runs);
    } catch (error) {
      console.error('Error getting task runs:', error);
      res.status(500).json({ error: 'Failed to get task runs' });
    }
  }

  // Get all task runs across all tasks
  async getAllTaskRuns(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = req.auth!.tenantId;
      const runs = await this.taskService.getAllTaskRuns(tenantId);
      res.json(runs);
    } catch (error) {
      console.error('Error getting all task runs:', error);
      res.status(500).json({ error: 'Failed to get all task runs' });
    }
  }

  // Get a specific task run by ID
  async getTaskRun(req: Request, res: Response): Promise<void> {
    try {
      const { runId } = req.params;
      const tenantId = req.auth!.tenantId;
      const run = await this.taskService.getTaskRun(runId, tenantId);
      
      if (!run) {
        res.status(404).json({ error: 'Task run not found' });
        return;
      }
      
      res.json(run);
    } catch (error) {
      console.error('Error getting task run:', error);
      res.status(500).json({ error: 'Failed to get task run' });
    }
  }

  async refinePlanFromRun(req: Request, res: Response): Promise<void> {
    try {
      const { id, runId } = req.params;
      const tenantId = req.auth!.tenantId;

      if (this.wantsSSE(req)) {
        const { sendEvent, end } = this.setupSSE(res);

        try {
          const task = await this.taskService.refinePlanFromRun(id, runId, tenantId, (eventName: string, payload: unknown) => {
            sendEvent(eventName, payload);
          });

          sendEvent('done', task);
          end();
        } catch (err: any) {
          sendEvent('error', { message: err?.message ?? 'Unknown error' });
          end();
        }

        return;
      }

      // Non-streaming
      const task = await this.taskService.refinePlanFromRun(id, runId, tenantId);
      res.status(200).json(task);
    } catch (error: any) {
      console.error('Error refining plan from run:', error);
      if (error?.message === 'Task not found' || error?.message === 'Task run not found') {
        res.status(404).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Failed to refine plan from run' });
      }
    }
  }

  async streamTaskRunEvents(req: Request, res: Response): Promise<void> {
    try {
      const { runId } = req.params;
      const tenantId = req.auth!.tenantId;
      
      // Get the task run to check status
      const taskRun = await this.taskService.getTaskRun(runId, tenantId);
      
      if (!taskRun) {
        res.status(404).json({ error: 'Task run not found' });
        return;
      }
      
      const { sendEvent, end } = this.setupSSE(res);
      
      // If the run is not running, replay events from chainOfThoughts and close
      if (taskRun.status !== 'running') {
        // Send all historical events
        for (const event of taskRun.chainOfThoughts) {
          sendEvent(event.type, { ...event.data, timestamp: event.timestamp });
        }
        sendEvent('done', { status: taskRun.status, result: taskRun.result });
        end();
        return;
      }
      
      // If the run is running, stream live events from Redis
      const cleanup = await this.taskService.streamTaskRunEvents(runId, tenantId, (eventName: string, payload: unknown) => {
        sendEvent(eventName, payload);
      });
      
      if (!cleanup) {
        sendEvent('error', { message: 'Failed to stream task run events' });
        end();
        return;
      }
      
      // Handle client disconnect
      req.on('close', () => {
        console.log('🔌 Client disconnected from stream');
        cleanup();
      });
      
    } catch (error) {
      console.error('Error streaming task run events:', error);
      res.status(500).json({ error: 'Failed to stream task run events' });
    }
  }

}
