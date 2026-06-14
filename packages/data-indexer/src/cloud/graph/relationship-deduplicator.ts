/**
 * Relationship Deduplicator
 *
 * Deduplicates graph relationships before they are written to the graph store.
 * When duplicate edges exist (same sourceId + targetId + type), the copy with
 * higher confidence is kept.  When confidence is equal, the first occurrence
 * wins (stable sort).
 *
 * Confidence ordering:  deterministic > heuristic
 */

import { GraphRelationship } from '@batta/shared';

const CONFIDENCE_RANK: Record<GraphRelationship['confidence'], number> = {
  deterministic: 1,
  heuristic: 0,
};

/**
 * Deduplicate a list of relationships.
 *
 * Key = `${type}|${sourceId}|${targetId}`
 * When two entries share the same key, the one with higher confidence wins.
 * Tie-break: first occurrence wins.
 */
export function deduplicateRelationships(
  relationships: GraphRelationship[],
): GraphRelationship[] {
  const seen = new Map<string, GraphRelationship>();

  for (const rel of relationships) {
    const key = `${rel.type}|${rel.sourceId}|${rel.targetId}`;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, rel);
    } else {
      const incomingRank = CONFIDENCE_RANK[rel.confidence] ?? 0;
      const existingRank = CONFIDENCE_RANK[existing.confidence] ?? 0;
      if (incomingRank > existingRank) {
        seen.set(key, rel);
      }
      // equal or lower confidence → keep existing (first-wins)
    }
  }

  return Array.from(seen.values());
}
