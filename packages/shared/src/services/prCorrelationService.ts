/**
 * PR Correlation Service
 *
 * Correlates security reviews with pull requests (GitHub) / merge requests (GitLab)
 * using multiple signals: branch name, commit SHA, author identity, repository, time window.
 *
 * Security tasks addressed:
 *   [Critical-1]  All methods are tenant-scoped — never cross tenant boundaries.
 *   [Critical-2]  sanitiseGitContext() validates all incoming git fields before any use.
 *   [Critical-3]  All URL parameters are built with encodeURIComponent via GitHubIntegration /
 *                 GitLabIntegration; raw user input is never concatenated into query strings.
 *   [Critical-4]  authorEmail / authorName are never logged; QDRANT_URL TLS enforced externally.
 *   [High-5]      Only branchName, commitSha, authorEmail, authorName are stored — no diffs.
 *   [High-7]      gitContext is INTERNAL; authorEmail/authorName are PII — annotated below.
 *   [High-8]      No new secrets; GitHub/GitLab tokens loaded from environment by their integrations.
 *   [Medium-12]   Upstream API errors are caught and surfaced as generic messages.
 *
 * Data classification: INTERNAL
 * PII fields: authorEmail, authorName — stored but never logged.
 */

import type { SecurityReview, ReviewGitContext, CorrelatedPR, NormalisedPR, CorrelationSignal } from '../types';
import type { GitHubIntegration } from '../integrations/githubIntegration';
import type { GitLabIntegration } from '../integrations/gitlabIntegration';

// ── Scoring weights (must sum to ≤ 100) ─────────────────────────────────────

const SIGNAL_WEIGHTS: Record<string, number> = {
  commitSha:   50,
  branchName:  25,
  authorEmail: 10,
  authorName:   5,
  timeWindow:   5,
  repository:   5,
};

const SCORE_STORE_THRESHOLD     = 60; // store as confirmed correlation
const SCORE_CANDIDATE_THRESHOLD = 40; // return as candidate (not stored)

// ── Sanitisation rules ───────────────────────────────────────────────────────

const BRANCH_NAME_RE = /^[a-zA-Z0-9._/\-]+$/;
const SHA_RE         = /^[0-9a-f]{7,40}$/i;
const EMAIL_RE       = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validate and sanitise all fields in a raw git context object.
 * Returns a cleaned copy; invalid fields are omitted entirely.
 * Control characters are stripped from all string fields.
 *
 * Security: addresses [Critical-2] — untrusted agent input is never persisted raw.
 */
export function sanitiseGitContext(raw: Record<string, unknown>): ReviewGitContext {
  const clean: ReviewGitContext = {};

  function strip(s: string): string {
    // eslint-disable-next-line no-control-regex
    return s.replace(/[\x00-\x1F\x7F]/g, '').trim();
  }

  // branchName: allow safe git-branch chars only, max 255
  if (typeof raw.branchName === 'string') {
    const v = strip(raw.branchName).slice(0, 255);
    if (v && BRANCH_NAME_RE.test(v)) clean.branchName = v;
  }

  // commitSha: must match hex SHA pattern
  if (typeof raw.commitSha === 'string') {
    const v = strip(raw.commitSha).slice(0, 40);
    if (SHA_RE.test(v)) {
      clean.commitSha = v.toLowerCase();
      clean.commitShortSha = v.slice(0, 7).toLowerCase();
    }
  }

  // authorEmail: must pass email regex, max 254 — PII, never logged
  if (typeof raw.authorEmail === 'string') {
    const v = strip(raw.authorEmail).slice(0, 254).toLowerCase();
    if (v && EMAIL_RE.test(v)) clean.authorEmail = v;
  }

  // authorName: strip control chars, max 200 — PII, never logged
  if (typeof raw.authorName === 'string') {
    const v = strip(raw.authorName).slice(0, 200);
    if (v) clean.authorName = v;
  }

  // commitMessage: subject line only, strip control chars, max 500
  if (typeof raw.commitMessage === 'string') {
    const firstLine = strip(raw.commitMessage).split('\n')[0].slice(0, 500);
    if (firstLine) clean.commitMessage = firstLine;
  }

  // commitTimestamp: must be valid ISO 8601, reject future dates > 5 min
  if (typeof raw.commitTimestamp === 'string') {
    const v = strip(raw.commitTimestamp).slice(0, 64);
    const d = new Date(v);
    const fiveMinutes = 5 * 60 * 1000;
    if (!isNaN(d.getTime()) && d.getTime() <= Date.now() + fiveMinutes) {
      clean.commitTimestamp = d.toISOString();
    }
  }

  // baseBranch: same rules as branchName
  if (typeof raw.baseBranch === 'string') {
    const v = strip(raw.baseBranch).slice(0, 255);
    if (v && BRANCH_NAME_RE.test(v)) clean.baseBranch = v;
  }

  // remoteUrl: must start with https:// or git@; max 500
  if (typeof raw.remoteUrl === 'string') {
    const v = strip(raw.remoteUrl).slice(0, 500);
    if (v.startsWith('https://') || v.startsWith('git@')) clean.remoteUrl = v;
  }

  return clean;
}

// ── Provider inference ────────────────────────────────────────────────────────

export interface ParsedRemote {
  provider: 'github' | 'gitlab' | 'unknown';
  owner: string;
  repo: string;
  slug: string; // "owner/repo"
}

/**
 * Parse a GitHub/GitLab remote URL (https or git@) into provider + org/repo slug.
 * Returns provider='unknown' when the URL cannot be parsed.
 */
export function parseRemoteUrl(remoteUrl: string): ParsedRemote {
  let provider: 'github' | 'gitlab' | 'unknown' = 'unknown';
  let owner = '';
  let repo = '';

  try {
    // Normalise git@ URLs to https:// for uniform URL parsing
    const normalised = remoteUrl
      .replace(/^git@github\.com:/, 'https://github.com/')
      .replace(/^git@gitlab\.com:/, 'https://gitlab.com/')
      .replace(/\.git$/, '');

    const url = new URL(normalised);
    if (url.hostname === 'github.com') provider = 'github';
    else if (url.hostname === 'gitlab.com' || url.hostname.includes('gitlab')) provider = 'gitlab';

    const parts = url.pathname.replace(/^\//, '').split('/');
    if (parts.length >= 2) {
      owner = parts[0];
      repo = parts.slice(1).join('/') || parts[1];
    }
  } catch {
    // Malformed URL — return defaults
  }

  return { provider, owner, repo, slug: owner && repo ? `${owner}/${repo}` : '' };
}

// ── Scoring ───────────────────────────────────────────────────────────────────

/**
 * Compute a correlation score and signal breakdown for a single PR against a review.
 * Returns a score (0-100) plus the signal array.
 *
 * Security: [Critical-3] — no user input is interpolated into strings here; scoring
 * is pure in-memory comparison against already-normalised API responses.
 */
export function scorePR(
  pr: NormalisedPR,
  review: SecurityReview,
): { score: number; signals: CorrelationSignal[] } {
  const ctx = review.gitContext ?? {};
  const signals: CorrelationSignal[] = [];
  let score = 0;

  // commitSha — exact match (definitive)
  if (ctx.commitSha) {
    const matched = pr.headSha.toLowerCase() === ctx.commitSha.toLowerCase();
    const w = SIGNAL_WEIGHTS.commitSha;
    signals.push({ signal: 'commitSha', matched, weight: w, detail: matched ? pr.headSha.slice(0, 7) : undefined });
    if (matched) score += w;
  }

  // branchName — exact match on head.ref
  if (ctx.branchName) {
    const matched = pr.headBranch.toLowerCase() === ctx.branchName.toLowerCase();
    const w = SIGNAL_WEIGHTS.branchName;
    signals.push({ signal: 'branchName', matched, weight: w, detail: matched ? pr.headBranch : undefined });
    if (matched) score += w;
  }

  // authorEmail — case-insensitive (PII — never in log messages below)
  if (ctx.authorEmail && pr.prAuthorEmail) {
    const matched = pr.prAuthorEmail.toLowerCase() === ctx.authorEmail.toLowerCase();
    const w = SIGNAL_WEIGHTS.authorEmail;
    signals.push({ signal: 'authorEmail', matched, weight: w });
    if (matched) score += w;
  }

  // authorName — case-insensitive (PII — never in log messages below)
  if (ctx.authorName) {
    const matched = pr.prAuthorLogin.toLowerCase() === ctx.authorName.toLowerCase();
    const w = SIGNAL_WEIGHTS.authorName;
    signals.push({ signal: 'authorName', matched, weight: w });
    if (matched) score += w;
  }

  // timeWindow — PR opened within 72h of review createdAt
  {
    const prOpenedMs = new Date(pr.openedAt).getTime();
    const reviewCreatedMs = new Date(review.createdAt).getTime();
    const diffHours = Math.abs(prOpenedMs - reviewCreatedMs) / 3_600_000;
    const matched = diffHours <= 72;
    const w = SIGNAL_WEIGHTS.timeWindow;
    signals.push({ signal: 'timeWindow', matched, weight: w, detail: `${Math.round(diffHours)}h apart` });
    if (matched) score += w;
  }

  // repository — slug match
  if (review.repository) {
    const matched = pr.repository.toLowerCase() === review.repository.toLowerCase();
    const w = SIGNAL_WEIGHTS.repository;
    signals.push({ signal: 'repository', matched, weight: w });
    if (matched) score += w;
  }

  return { score: Math.min(100, score), signals };
}

// ── Integration wrapper types ─────────────────────────────────────────────────

export interface CorrelationIntegration {
  type: 'github' | 'gitlab';
  github?: GitHubIntegration;
  gitlab?: GitLabIntegration;
  owner?: string;
  repo?: string;
}

// ── PRCorrelationService ──────────────────────────────────────────────────────

export class PRCorrelationService {

  /**
   * Attempt to correlate a review with a PR/MR via the given integrations.
   * Returns:
   *   - `correlated` — the best match with score ≥ 60 (stored on the review)
   *   - `candidates` — matches with score 40–59 (returned but not stored)
   *   - `error` — set when no integration was found
   *
   * Security: [Critical-1] — integrations are passed in scoped to the requesting tenant;
   * the caller (SecurityReviewService) is responsible for tenant-scoping.
   */
  async correlatePR(
    review: SecurityReview,
    integrations: CorrelationIntegration[],
  ): Promise<{
    correlated: CorrelatedPR | null;
    candidates: CorrelatedPR[];
    error?: string;
  }> {
    if (!review.gitContext?.branchName && !review.gitContext?.commitSha) {
      return { correlated: null, candidates: [], error: 'insufficient_git_context' };
    }

    if (integrations.length === 0) {
      return { correlated: null, candidates: [], error: 'no_integration' };
    }

    const allPRs: NormalisedPR[] = [];

    for (const integration of integrations) {
      try {
        const prs = await this.fetchCandidatePRs(review.gitContext, review.repository, integration);
        allPRs.push(...prs);
      } catch {
        // [Medium-12] Non-fatal — continue with other integrations; error surfaced generically
      }
    }

    const scored: Array<{ pr: NormalisedPR; score: number; signals: CorrelationSignal[] }> = allPRs.map(pr => {
      const { score, signals } = scorePR(pr, review);
      return { pr, score, signals };
    });

    scored.sort((a, b) => b.score - a.score);

    const toCorrelatedPR = (item: { pr: NormalisedPR; score: number; signals: CorrelationSignal[] }): CorrelatedPR => ({
      provider: item.pr.provider,
      repository: item.pr.repository,
      prNumber: item.pr.prNumber,
      prUrl: item.pr.prUrl,
      prTitle: item.pr.prTitle,
      prState: item.pr.prState,
      prAuthorLogin: item.pr.prAuthorLogin,
      headSha: item.pr.headSha,
      headBranch: item.pr.headBranch,
      baseBranch: item.pr.baseBranch,
      openedAt: item.pr.openedAt,
      ...(item.pr.mergedAt && { mergedAt: item.pr.mergedAt }),
      ...(item.pr.closedAt && { closedAt: item.pr.closedAt }),
      correlationScore: item.score,
      correlationSignals: item.signals,
    });

    const correlated = scored.find(s => s.score >= SCORE_STORE_THRESHOLD)
      ? toCorrelatedPR(scored.find(s => s.score >= SCORE_STORE_THRESHOLD)!)
      : null;

    const candidates = scored
      .filter(s => s.score >= SCORE_CANDIDATE_THRESHOLD && s.score < SCORE_STORE_THRESHOLD)
      .map(toCorrelatedPR);

    return { correlated, candidates };
  }

  /**
   * Fetch a single PR by its URL, normalise, and return as a CorrelatedPR with score 100.
   * Used for the manual link path.
   *
   * Security: [Critical-3] — PR number is parsed as integer; owner/repo are URL-decoded safely.
   */
  async fetchPRByUrl(
    prUrl: string,
    integration: CorrelationIntegration,
  ): Promise<CorrelatedPR> {
    const pr = await this.fetchSinglePRByUrl(prUrl, integration);
    return {
      provider: pr.provider,
      repository: pr.repository,
      prNumber: pr.prNumber,
      prUrl: pr.prUrl,
      prTitle: pr.prTitle,
      prState: pr.prState,
      prAuthorLogin: pr.prAuthorLogin,
      headSha: pr.headSha,
      headBranch: pr.headBranch,
      baseBranch: pr.baseBranch,
      openedAt: pr.openedAt,
      ...(pr.mergedAt && { mergedAt: pr.mergedAt }),
      ...(pr.closedAt && { closedAt: pr.closedAt }),
      correlationScore: 100,
      correlationSignals: [{ signal: 'manual', matched: true, weight: 100 }],
    };
  }

  /**
   * Fetch candidate PRs for a git context from a single integration.
   *
   * Security: [Critical-3] — branch names and SHAs are passed to integration methods
   * that use encodeURIComponent internally; never interpolated raw.
   */
  async fetchCandidatePRs(
    gitContext: ReviewGitContext,
    repository: string | undefined,
    integration: CorrelationIntegration,
  ): Promise<NormalisedPR[]> {
    const results: NormalisedPR[] = [];

    if (integration.type === 'github' && integration.github && integration.owner && integration.repo) {
      // Prefer commit SHA lookup (strongest signal) then branch lookup
      if (gitContext.commitSha) {
        try {
          const prs = await integration.github.listPRsForCommit(integration.owner, integration.repo, gitContext.commitSha);
          results.push(...prs);
        } catch {
          // [Medium-12] Swallow upstream errors; try branch fallback
        }
      }
      if (gitContext.branchName && results.length === 0) {
        try {
          const prs = await integration.github.listPRsForBranch(integration.owner, integration.repo, gitContext.branchName);
          results.push(...prs);
        } catch {
          // [Medium-12] Swallow upstream errors gracefully
        }
      }
    }

    if (integration.type === 'gitlab' && integration.gitlab) {
      const projectRef = repository ?? (integration.owner && integration.repo ? `${integration.owner}/${integration.repo}` : '');
      if (!projectRef) return results;

      if (gitContext.commitSha) {
        try {
          const prs = await integration.gitlab.listMRsForCommit(projectRef, gitContext.commitSha);
          results.push(...prs);
        } catch {
          // [Medium-12] Swallow upstream errors; try branch fallback
        }
      }
      if (gitContext.branchName && results.length === 0) {
        try {
          const prs = await integration.gitlab.listMRsForBranch(projectRef, gitContext.branchName);
          results.push(...prs);
        } catch {
          // [Medium-12] Swallow upstream errors gracefully
        }
      }
    }

    return results;
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async fetchSinglePRByUrl(prUrl: string, integration: CorrelationIntegration): Promise<NormalisedPR> {
    // Parse pr number from URL: .../pull/42 or .../merge_requests/42
    const match = prUrl.match(/\/(pull|merge_requests)\/(\d+)/);
    if (!match) {
      // [Medium-12] Generic error — do not expose URL content in messages
      throw new Error('PR fetch failed: invalid PR URL format');
    }
    const prNumber = parseInt(match[2], 10);

    if (integration.type === 'github' && integration.github && integration.owner && integration.repo) {
      try {
        return await integration.github.getPR(integration.owner, integration.repo, prNumber);
      } catch {
        throw new Error('PR fetch failed');
      }
    }

    if (integration.type === 'gitlab' && integration.gitlab) {
      // Parse project path from URL
      let projectRef: string;
      try {
        const url = new URL(prUrl);
        // path: /owner/repo/-/merge_requests/42
        const pathParts = url.pathname.split('/-/')[0].replace(/^\//, '');
        projectRef = pathParts;
      } catch {
        throw new Error('PR fetch failed: cannot parse project path');
      }
      try {
        return await integration.gitlab.getMR(projectRef, prNumber);
      } catch {
        throw new Error('PR fetch failed');
      }
    }

    throw new Error('PR fetch failed: no matching integration');
  }
}
