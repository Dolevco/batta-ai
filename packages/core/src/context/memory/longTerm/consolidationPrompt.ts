/**
 * Memory consolidation prompt for the "Dream" pattern.
 *
 * Background Memory Consolidation (Dream Pattern).
 *
 * 4 Phases:
 *   Phase 1 — Orient: understand current memory state
 *   Phase 2 — Gather: identify new signal worth persisting
 *   Phase 3 — Consolidate: merge, deduplicate, update
 *   Phase 4 — Prune and Index: remove stale/superseded entries
 */

export interface ConsolidationAction {
  action: 'delete' | 'update' | 'merge';
  id?: string;
  ids?: string[];
  newSummary?: string;
  reason: string;
}

export interface ConsolidationResult {
  removed: number;
  merged: number;
  updated: number;
  actions: ConsolidationAction[];
}

export interface StoredMemorySummary {
  id: string;
  summary: string;
  tags?: string[];
  createdAt?: string | Date;
}

/**
 * Build the prompt that guides the LLM to consolidate stored memories.
*
 * Security note: The memory list may contain task context that was previously stored.
 * This is classified as "confidential" internal data (ref: featureSecurityContext Memory Management).
 * The consolidation result is applied directly to postgres — no user-facing output is generated.
 */
export function buildConsolidationPrompt(memories: StoredMemorySummary[]): string {
  const memoryList = memories
    .map(m => {
      const tags = m.tags?.length ? `\nTags: ${m.tags.join(', ')}` : '';
      const date = m.createdAt
        ? `\nCreated: ${new Date(m.createdAt).toISOString().split('T')[0]}`
        : '';
      return `ID: ${m.id}\nSummary: ${m.summary}${tags}${date}`;
    })
    .join('\n---\n');

  return `# Memory Consolidation

You are a memory curator performing a reflective pass over stored memories. Synthesize what has been learned into durable, well-organized records.

## Phase 1 — Orient
Review all ${memories.length} stored memories below to understand the current knowledge state.

## Phase 2 — Gather
Identify which memories are still accurate and relevant vs. which are stale, duplicated, or superseded.

## Phase 3 — Consolidate
For each issue found, produce an action:
- **Duplicates**: memories saying the same thing → keep the more detailed one, delete the other
- **Contradictions**: memories that disagree → keep the most recent accurate one, delete the old one
- **Stale entries**: memories about old code, resolved bugs, or completed tasks → delete them
- **Generalisable patterns**: clusters of specific memories that can be merged into one general rule → merge them
- Convert relative dates ("yesterday", "last week") to absolute dates for future interpretability

## Phase 4 — Prune
Remove pointers to stale or superseded entries to keep the memory index lean.

Return a JSON array of actions with this exact structure:
[
  { "action": "delete", "id": "memory-id", "reason": "why this memory is stale or duplicated" },
  { "action": "update", "id": "memory-id", "newSummary": "improved summary", "reason": "why updated" },
  { "action": "merge", "ids": ["id1", "id2"], "newSummary": "combined memory", "reason": "why merged" }
]

Return ONLY valid JSON. No explanations outside the JSON array.
If no consolidation is needed, return an empty array: []

## Memories to consolidate:

${memoryList}`;
}

/**
 * Parse the JSON array of consolidation actions from LLM response.
 * Validates structure and sanitizes string lengths to prevent oversized updates.
 *
 * Security note: Input validation is applied to LLM output before writing to postgres.
 * Max summary length is capped at 2000 chars to prevent DoS on storage.
 */
export function parseConsolidationResponse(response: string): ConsolidationAction[] {
  try {
    // Extract JSON array from the response
    const match = response.match(/\[[\s\S]*\]/);
    if (!match) return [];

    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return [];

    const actions: ConsolidationAction[] = [];
    const MAX_SUMMARY_LENGTH = 2000;

    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      if (!['delete', 'update', 'merge'].includes(item.action)) continue;
      if (!item.reason || typeof item.reason !== 'string') continue;

      const action: ConsolidationAction = {
        action: item.action,
        reason: String(item.reason).substring(0, 500)
      };

      if (item.action === 'delete' && item.id && typeof item.id === 'string') {
        action.id = item.id;
        actions.push(action);
      } else if (item.action === 'update' && item.id && item.newSummary) {
        action.id = String(item.id);
        action.newSummary = String(item.newSummary).substring(0, MAX_SUMMARY_LENGTH);
        actions.push(action);
      } else if (item.action === 'merge' && Array.isArray(item.ids) && item.newSummary) {
        const mergeIds = item.ids.filter((id: any) => typeof id === 'string').map(String);
        action.ids = mergeIds;
        action.newSummary = String(item.newSummary).substring(0, MAX_SUMMARY_LENGTH);
        if (mergeIds.length >= 2) {
          actions.push(action);
        }
      }
    }

    return actions;
  } catch (err) {
    console.error('consolidationPrompt: Failed to parse consolidation response', err instanceof Error ? err.message : 'unknown');
    return [];
  }
}
