import type { Request, Response } from 'express';
import type { IFeedbackRepository } from '@ai-agent/shared';
import type { CreateFeedbackRequest } from '../types';
import type { TaskService } from '../services/taskService';
import { v4 as uuidv4 } from 'uuid';

export class FeedbackController {
  constructor(
    private feedbackRepository: IFeedbackRepository,
    private taskService: TaskService
  ) {}

  async createFeedback(req: Request, res: Response): Promise<void> {
    try {
      const { taskId, taskRunId, content, rating } = req.body as CreateFeedbackRequest & { rating?: 'like' | 'dislike' };
      const tenantId = req.auth!.tenantId;

      if (!taskId || !content) {
        res.status(400).json({ error: 'taskId and content are required' });
        return;
      }

      // If taskRunId provided, ensure there is at most one feedback for that run
      if (taskRunId) {
        const existing = await this.feedbackRepository.getByTaskRunId(taskRunId, tenantId);
        if (existing && existing.length > 0) {
          res.status(409).json({ error: 'Feedback already exists for this task run' });
          return;
        }
      }

      const feedback = await this.feedbackRepository.create({
        id: uuidv4(),
        taskId,
        taskRunId,
        tenantId,
        role: 'user',
        content,
        rating,
        createdAt: new Date().toISOString(),
      });

      // If feedback is provided with a rating on a task run, store step-level memories for learning
      if (rating && taskRunId) {
        // Store step memories asynchronously (don't block response)
        const feedbackContent = `${rating}: ${content}`;
        await this.taskService.storeStepMemoriesForTaskRun(taskRunId, tenantId, feedbackContent)
        .then(() => {
          console.log(`${rating === 'like' ? '👍' : '👎'} ${rating === 'like' ? 'Positive' : 'Negative'} feedback received for run ${taskRunId}, storing step memories for learning`);
        }).catch(error => {
          console.error('Failed to store step memories for feedback:', error);
        });
      }

      res.status(201).json(feedback);
    } catch (error) {
      console.error('Error creating feedback:', error);
      res.status(500).json({ error: 'Failed to create feedback' });
    }
  }

  async getFeedbacksByTaskId(req: Request, res: Response): Promise<void> {
    try {
      const { taskId } = req.params;
      const tenantId = req.auth!.tenantId;
      const feedbacks = await this.feedbackRepository.getByTaskId(taskId, tenantId);
      res.json(feedbacks);
    } catch (error) {
      console.error('Error getting feedbacks:', error);
      res.status(500).json({ error: 'Failed to get feedbacks' });
    }
  }

  async getFeedbacksByTaskRunId(req: Request, res: Response): Promise<void> {
    try {
      const { taskRunId } = req.params;
      const tenantId = req.auth!.tenantId;
      const feedbacks = await this.feedbackRepository.getByTaskRunId(taskRunId, tenantId);
      res.json(feedbacks);
    } catch (error) {
      console.error('Error getting feedbacks:', error);
      res.status(500).json({ error: 'Failed to get feedbacks' });
    }
  }

  async deleteFeedback(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const tenantId = req.auth!.tenantId;
      await this.feedbackRepository.delete(id, tenantId);
      res.status(204).send();
    } catch (error) {
      console.error('Error deleting feedback:', error);
      res.status(500).json({ error: 'Failed to delete feedback' });
    }
  }

  async updateFeedback(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const tenantId = req.auth!.tenantId;
      const { content, rating } = req.body as { content?: string; rating?: 'like' | 'dislike' };

      if (!id) {
        res.status(400).json({ error: 'id is required' });
        return;
      }

      if (!content && typeof rating === 'undefined') {
        res.status(400).json({ error: 'content or rating is required' });
        return;
      }

      const existing = await this.feedbackRepository.getById(id, tenantId);
      if (!existing) {
        res.status(404).json({ error: 'Feedback not found' });
        return;
      }

      const updated = await this.feedbackRepository.update(id, tenantId, {
        content: content ?? existing.content,
        rating: typeof rating === 'undefined' ? existing.rating : rating,
      });

      // If rating changed and this feedback is for a task run, store step memories
      if (rating && rating !== existing.rating && existing.taskRunId) {
        // Store step memories asynchronously (don't block response)
        const feedbackContent = `${rating}: ${content ?? existing.content}`;
        this.taskService.storeStepMemoriesForTaskRun(existing.taskRunId, tenantId, feedbackContent).catch(error => {
          console.error('Failed to store step memories for updated feedback:', error);
        });
        console.log(`${rating === 'like' ? '👍' : '👎'} Feedback updated to ${rating} for run ${existing.taskRunId}, storing step memories for learning`);
      }

      res.json(updated);
    } catch (error) {
      console.error('Error updating feedback:', error);
      res.status(500).json({ error: 'Failed to update feedback' });
    }
  }
}
