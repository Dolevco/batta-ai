-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── ENTITY / DOCUMENT TABLES ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS entities (
  id          TEXT        NOT NULL,
  tenant_id   TEXT        NOT NULL,
  entity_type TEXT        NOT NULL,
  payload     JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS entities_tenant_type_idx ON entities (tenant_id, entity_type);
CREATE INDEX IF NOT EXISTS entities_payload_idx ON entities USING GIN (payload);

CREATE TABLE IF NOT EXISTS evidence (
  id            TEXT        NOT NULL,
  tenant_id     TEXT        NOT NULL,
  evidence_type TEXT        NOT NULL,
  subject_id    TEXT        NOT NULL,
  payload       JSONB       NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS evidence_tenant_subject_idx ON evidence (tenant_id, subject_id);
CREATE INDEX IF NOT EXISTS evidence_payload_idx ON evidence USING GIN (payload);

CREATE TABLE IF NOT EXISTS semantic_documents (
  id            TEXT        NOT NULL,
  tenant_id     TEXT        NOT NULL,
  artifact_id   TEXT        NOT NULL,
  document_type TEXT,
  input_hash    TEXT        NOT NULL DEFAULT '',
  responsibility TEXT,
  payload       JSONB       NOT NULL DEFAULT '{}',
  embedding     vector(1536),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS sem_docs_tenant_artifact_idx ON semantic_documents (tenant_id, artifact_id);
CREATE INDEX IF NOT EXISTS sem_docs_tenant_type_idx     ON semantic_documents (tenant_id, document_type);
-- ivfflat index for cosine similarity search (created separately after data load for best performance)
-- CREATE INDEX IF NOT EXISTS sem_docs_embedding_idx ON semantic_documents USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ─── OPERATIONAL TABLES ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS chat_messages (
  id              TEXT        NOT NULL,
  tenant_id       TEXT        NOT NULL,
  conversation_id TEXT        NOT NULL,
  task_id         TEXT,
  role            TEXT        NOT NULL DEFAULT '',
  payload         JSONB       NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS chat_messages_conversation_idx ON chat_messages (tenant_id, conversation_id, created_at);
CREATE INDEX IF NOT EXISTS chat_messages_task_idx         ON chat_messages (tenant_id, task_id);

CREATE TABLE IF NOT EXISTS security_reviews (
  id         TEXT        NOT NULL,
  tenant_id  TEXT        NOT NULL,
  status     TEXT        NOT NULL DEFAULT '',
  payload    JSONB       NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS security_reviews_tenant_status_idx ON security_reviews (tenant_id, status);

CREATE TABLE IF NOT EXISTS indexing_runs (
  id         TEXT        NOT NULL,
  tenant_id  TEXT        NOT NULL,
  status     TEXT        NOT NULL DEFAULT '',
  payload    JSONB       NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS indexing_runs_tenant_status_idx  ON indexing_runs (tenant_id, status);
CREATE INDEX IF NOT EXISTS indexing_runs_tenant_created_idx ON indexing_runs (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS custom_integrations (
  id         TEXT        NOT NULL,
  tenant_id  TEXT        NOT NULL,
  enabled    BOOLEAN     NOT NULL DEFAULT true,
  payload    JSONB       NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS mcp_integrations (
  id         TEXT        NOT NULL,
  tenant_id  TEXT        NOT NULL,
  enabled    BOOLEAN     NOT NULL DEFAULT true,
  payload    JSONB       NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS policy_templates (
  id            TEXT        NOT NULL,
  tenant_id     TEXT        NOT NULL,
  template_type TEXT        NOT NULL DEFAULT '',
  active        BOOLEAN     NOT NULL DEFAULT true,
  payload       JSONB       NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS policy_templates_tenant_type_idx ON policy_templates (tenant_id, template_type);

-- ─── LONG-TERM MEMORY TABLE ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS long_term_memory (
  id          TEXT        NOT NULL,
  tenant_id   TEXT        NOT NULL,
  memory_type TEXT        NOT NULL DEFAULT 'general',
  session_id  TEXT,
  payload     JSONB       NOT NULL DEFAULT '{}',
  embedding   vector(1536),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS long_term_memory_tenant_type_idx    ON long_term_memory (tenant_id, memory_type);
-- migration: add session_id if the table was created before this column existed
ALTER TABLE IF EXISTS long_term_memory ADD COLUMN IF NOT EXISTS session_id TEXT;
CREATE INDEX IF NOT EXISTS long_term_memory_tenant_session_idx ON long_term_memory (tenant_id, session_id);

-- ─── GRAPH TABLES ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS graph_nodes (
  id          TEXT        NOT NULL,
  tenant_id   TEXT        NOT NULL,
  entity_type TEXT        NOT NULL,
  payload     JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS graph_nodes_tenant_type_idx ON graph_nodes (tenant_id, entity_type);

CREATE TABLE IF NOT EXISTS graph_edges (
  id         TEXT        NOT NULL,
  tenant_id  TEXT        NOT NULL,
  source_id  TEXT        NOT NULL,
  target_id  TEXT        NOT NULL,
  rel_type   TEXT        NOT NULL,
  valid_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_to   TIMESTAMPTZ,
  confidence TEXT,
  metadata   JSONB       NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS graph_edges_source_idx ON graph_edges (tenant_id, source_id, rel_type);
CREATE INDEX IF NOT EXISTS graph_edges_target_idx ON graph_edges (tenant_id, target_id, rel_type);
CREATE INDEX IF NOT EXISTS graph_edges_valid_idx  ON graph_edges (tenant_id, valid_to) WHERE valid_to IS NOT NULL;

-- Cloud graph (separate tables — different schema from canonical entities)
CREATE TABLE IF NOT EXISTS cloud_nodes (
  id                   TEXT        NOT NULL,
  tenant_id            TEXT        NOT NULL,
  node_type            TEXT        NOT NULL,
  cloud_provider       TEXT,
  provider_resource_id TEXT,
  display_name         TEXT,
  region               TEXT,
  internet_exposed     BOOLEAN,
  data_classification  TEXT,
  tags                 JSONB       NOT NULL DEFAULT '{}',
  properties           JSONB       NOT NULL DEFAULT '{}',
  indexed_at           TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS cloud_nodes_tenant_type_idx ON cloud_nodes (tenant_id, node_type);

CREATE TABLE IF NOT EXISTS cloud_edges (
  id        TEXT  NOT NULL,
  tenant_id TEXT  NOT NULL,
  source_id TEXT  NOT NULL,
  target_id TEXT  NOT NULL,
  rel_type  TEXT  NOT NULL,
  metadata  JSONB NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS cloud_edges_source_idx ON cloud_edges (tenant_id, source_id);
CREATE INDEX IF NOT EXISTS cloud_edges_target_idx ON cloud_edges (tenant_id, target_id);
