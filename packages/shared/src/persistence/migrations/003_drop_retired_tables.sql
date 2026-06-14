-- Migration 003: drop tables retired in the OSS cut (agents/tasks/runs/feedback)
DROP TABLE IF EXISTS feedback     CASCADE;
DROP TABLE IF EXISTS task_runs    CASCADE;
DROP TABLE IF EXISTS agent_tasks  CASCADE;
DROP TABLE IF EXISTS agents       CASCADE;
