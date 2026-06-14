-- Migration 002: add session_id to long_term_memory (idempotent)
ALTER TABLE IF EXISTS long_term_memory ADD COLUMN IF NOT EXISTS session_id TEXT;
