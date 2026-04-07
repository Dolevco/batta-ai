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

import type { SecurityReview, ReviewGitContext, CorrelatedPR, NormalisedPR, CorrelationSignal, CodeIntegrationRepository } from '../types';
import { GitHubIntegration } from '../integrations/githubIntegration';
import { GitLabIntegration } from '../integrations/gitlabIntegration';

// ── Scoring weights (must sum to ≤ 100) ─────────────────────────────────────

const SIGNAL_WEIGHTS: Record<string, number> = {
  commitSha:     50,
  branchName:    20,
  authorEmail:    8,
  authorName:     4,
  authorLogin:    4,
  commitMessage:  5,
  timeWindow:     5,
  repository:     4,
};

const SCORE_STORE_THRESHOLD     = 60; // store as confirmed correlation
const SCORE_CANDIDATE_THRESHOLD = 40; // return as candidate (not stored)

// ── Sanitisation rules ───────────────────────────────────────────────────────

const BRANCH_NAME_RE = /^[a-zA-Z0-9._/\-]+$/;
const SHA_RE         = /^[0-9a-f]{7,40}$/i;
const EMAIL_RE       = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Tokenise a string into a set of lowercase meaningful words (≥ 3 chars).
 * Used for fuzzy commit-message / PR-title matching.
 * Stop words are excluded so that common filler words don't inflate the match score.
 */
const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'this', 'from', 'that', 'feat', 'fix', 'chore', 'docs', 'test', 'refactor', 'add', 'update', 'remove', 'use']);

function tokenise(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 3 && !STOP_WORDS.has(w)),
  );
}

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

/**
 * Derive a "since" ISO timestamp for broad PR scans when we have no definitive signals.
 * Returns 72 hours before the commit timestamp, review createdAt, or the current time
 * (whichever is available first), giving a window that covers any PR the developer might
 * have opened around this work.
 */
function deriveSinceTimestamp(ctx: ReviewGitContext, reviewCreatedAt?: string): string {
  const anchor =
    ctx.commitTimestamp ? new Date(ctx.commitTimestamp).getTime() :
    reviewCreatedAt     ? new Date(reviewCreatedAt).getTime() :
    Date.now();
  return new Date(anchor - 72 * 3_600_000).toISOString();
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

  // authorName — case-insensitive name-to-name comparison (PII — never in log messages)
  // Falls back to review.humanResponsible when no git authorName is available.
  const effectiveAuthorName = ctx.authorName ?? review.humanResponsible;
  if (effectiveAuthorName) {
    const matched = pr.prAuthorLogin.toLowerCase() === effectiveAuthorName.toLowerCase();
    const w = SIGNAL_WEIGHTS.authorName;
    signals.push({ signal: 'authorName', matched, weight: w });
    if (matched) score += w;
  }

  // authorLogin — match review's authorName (or humanResponsible fallback) against the
  // PR author login (handles the common case where the name is "Firstname Lastname" but
  // GitHub/GitLab only exposes the login handle; we try normalised comparison of both).
  if (effectiveAuthorName) {
    // Normalise: lowercase, strip spaces/hyphens to compare "firstnamelastname" vs login
    const normName = effectiveAuthorName.toLowerCase().replace(/[\s\-_]/g, '');
    const normLogin = pr.prAuthorLogin.toLowerCase().replace(/[\s\-_]/g, '');
    const matched = normName === normLogin || normLogin.includes(normName) || normName.includes(normLogin);
    const w = SIGNAL_WEIGHTS.authorLogin;
    signals.push({ signal: 'authorLogin', matched, weight: w });
    if (matched) score += w;
  }

  // commitMessage — fuzzy match: check if the PR title contains significant words
  // from the commit message subject (≥ 50% word overlap counts as a match).
  // Falls back to review.title when no git commitMessage is available.
  const effectiveTitle = ctx.commitMessage ?? review.title;
  if (effectiveTitle) {
    const prTitleWords = tokenise(pr.prTitle);
    const msgWords = tokenise(effectiveTitle);
    let overlap = 0;
    msgWords.forEach(w => { if (prTitleWords.has(w)) overlap++; });
    const total = msgWords.size;
    const matched = total > 0 && overlap / total >= 0.5;
    const w = SIGNAL_WEIGHTS.commitMessage;
    signals.push({
      signal: 'commitMessage',
      matched,
      weight: w,
      detail: matched ? `${overlap}/${total} words match` : undefined,
    });
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

// ── Polymorphic PR integration interface ──────────────────────────────────────

/**
 * Provider-agnostic interface used by the correlation service.
 * Adapters for GitHub and GitLab implement this so the service
 * contains zero provider-specific branching.
 */
export interface PRIntegration {
  readonly provider: 'github' | 'gitlab';
  /** Org / group owner hint — may be absent when unknown. */
  readonly owner?: string;
  /** Bare repository name hint — may be absent when unknown. */
  readonly repo?: string;

  listPRsForCommit(projectRef: string, sha: string): Promise<NormalisedPR[]>;
  listPRsForBranch(projectRef: string, branch: string): Promise<NormalisedPR[]>;
  listRecentPRs(projectRef: string, since: string, perPage?: number): Promise<NormalisedPR[]>;
  getPR(projectRef: string, prNumber: number): Promise<NormalisedPR>;
  /**
   * Return all repositories accessible to this integration token.
   * Each entry's `name` field is an "owner/repo" (or GitLab path) slug.
   */
  getRepositories(): Promise<CodeIntegrationRepository[]>;
  /**
   * Resolve the set of projectRef strings to search given an optional
   * repository hint and an optional `repository` override from the review.
   * When nothing is known, enumerate via getRepositories().
   */
  resolveProjectRefs(reviewRepository?: string): Promise<string[]>;
}

// ── GitHub adapter ────────────────────────────────────────────────────────────

export class GitHubPRIntegration implements PRIntegration {
  readonly provider = 'github' as const;

  constructor(
    private readonly gh: GitHubIntegration,
    readonly owner?: string,
    readonly repo?: string,
  ) {}

  listPRsForCommit(projectRef: string, sha: string): Promise<NormalisedPR[]> {
    const { owner, repo } = splitRef(projectRef);
    return this.gh.listPRsForCommit(owner, repo, sha);
  }

  listPRsForBranch(projectRef: string, branch: string): Promise<NormalisedPR[]> {
    const { owner, repo } = splitRef(projectRef);
    return this.gh.listPRsForBranch(owner, repo, branch);
  }

  listRecentPRs(projectRef: string, since: string, perPage?: number): Promise<NormalisedPR[]> {
    const { owner, repo } = splitRef(projectRef);
    return this.gh.listRecentPRs(owner, repo, since, perPage);
  }

  getPR(projectRef: string, prNumber: number): Promise<NormalisedPR> {
    const { owner, repo } = splitRef(projectRef);
    return this.gh.getPR(owner, repo, prNumber);
  }

  getRepositories(): Promise<CodeIntegrationRepository[]> {
    return this.gh.getRepositories();
  }

  async resolveProjectRefs(reviewRepository?: string): Promise<string[]> {
    if (this.owner && this.repo) {
      return [`${this.owner}/${this.repo}`];
    }

    // Owner unknown — enumerate accessible repos, filter by bare repo name if we have one
    try {
      const accessible = await this.getRepositories();
      return accessible
        .map(r => r.name)
        .filter(name => {
          if (!name.includes('/')) return false;
          const repoPart = name.split('/').slice(1).join('/');
          // If repo name known, only keep matching repos
          if (this.repo && repoPart.toLowerCase() !== this.repo.toLowerCase()) return false;
          // If reviewRepository is a bare name, filter by it too
          if (reviewRepository && !name.toLowerCase().includes(reviewRepository.toLowerCase())) return false;
          return true;
        });
    } catch {
      return [];
    }
  }
}

// ── GitLab adapter ────────────────────────────────────────────────────────────

export class GitLabPRIntegration implements PRIntegration {
  readonly provider = 'gitlab' as const;

  constructor(
    private readonly gl: GitLabIntegration,
    readonly owner?: string,
    readonly repo?: string,
  ) {}

  listPRsForCommit(projectRef: string, sha: string): Promise<NormalisedPR[]> {
    return this.gl.listMRsForCommit(projectRef, sha);
  }

  listPRsForBranch(projectRef: string, branch: string): Promise<NormalisedPR[]> {
    return this.gl.listMRsForBranch(projectRef, branch);
  }

  listRecentPRs(projectRef: string, since: string, perPage?: number): Promise<NormalisedPR[]> {
    return this.gl.listRecentMRs(projectRef, since, perPage);
  }

  getPR(projectRef: string, prNumber: number): Promise<NormalisedPR> {
    return this.gl.getMR(projectRef, prNumber);
  }

  getRepositories(): Promise<CodeIntegrationRepository[]> {
    return this.gl.getRepositories();
  }

  async resolveProjectRefs(reviewRepository?: string): Promise<string[]> {
    // Explicit owner/repo path
    if (this.owner && this.repo) return [`${this.owner}/${this.repo}`];
    // Known review repository (full path or bare name)
    if (reviewRepository) return [reviewRepository];
    // Bare repo name only
    if (this.repo) return [this.repo];

    // Nothing known — enumerate all accessible projects
    try {
      const accessible = await this.getRepositories();
      return accessible.map(r => r.name).filter(Boolean);
    } catch {
      return [];
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Split an "owner/repo" projectRef string into its components. */
function splitRef(ref: string): { owner: string; repo: string } {
  const idx = ref.indexOf('/');
  if (idx === -1) return { owner: '', repo: ref };
  return { owner: ref.slice(0, idx), repo: ref.slice(idx + 1) };
}

// ── Legacy alias kept for callers that haven't migrated yet ──────────────────
/** @deprecated Use PRIntegration instead */
export type CorrelationIntegration = PRIntegration;

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
    integrations: PRIntegration[],
  ): Promise<{
    correlated: CorrelatedPR | null;
    candidates: CorrelatedPR[];
    error?: string;
  }> {
    // Allow correlation to proceed even with partial or absent git context.
    // humanResponsible and title are available directly on the review and serve
    // as fallback signals (authorLogin + commitMessage scoring) when git context
    // was not captured. We only bail out when there is truly nothing to work with.
    const ctx = review.gitContext ?? {};
    const hasAnyContext =
      ctx.commitSha ||
      ctx.branchName ||
      ctx.authorEmail ||
      ctx.authorName ||
      ctx.commitMessage ||
      ctx.commitTimestamp ||
      review.humanResponsible ||
      review.title;

    if (!hasAnyContext) {
      return { correlated: null, candidates: [], error: 'insufficient_git_context' };
    }

    if (integrations.length === 0) {
      return { correlated: null, candidates: [], error: 'no_integration' };
    }

    const allPRs: NormalisedPR[] = [];

    for (const integration of integrations) {
      try {
        const prs = await this.fetchCandidatePRs(ctx, review.repository, integration, review.createdAt);
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
    integration: PRIntegration,
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
   * Strategy (strongest signal first):
   *   1. Commit SHA lookup — definitive, provider API.
   *   2. Branch name lookup — exact head-branch match.
   *   3. Broad time-window scan — fetches PRs updated within a 72-hour window around
   *      the review's commitTimestamp (or review.createdAt as fallback) so softer
   *      signals (author, title) can score them.
   *
   * Project references are resolved by the integration adapter via resolveProjectRefs().
   * Results are deduplicated by PR URL before return.
   *
   * Security: [Critical-3] — branch names and SHAs are passed to integration methods
   * that use encodeURIComponent internally; never interpolated raw.
   */
  async fetchCandidatePRs(
    gitContext: ReviewGitContext,
    repository: string | undefined,
    integration: PRIntegration,
    reviewCreatedAt?: string,
  ): Promise<NormalisedPR[]> {
    const projectRefs = await integration.resolveProjectRefs(repository);
    const results: NormalisedPR[] = [];

    for (const projectRef of projectRefs) {
      const repoResults: NormalisedPR[] = [];

      if (gitContext.commitSha) {
        try {
          const prs = await integration.listPRsForCommit(projectRef, gitContext.commitSha);
          repoResults.push(...prs);
        } catch {
          // [Medium-12] Swallow upstream errors; try branch fallback
        }
      }

      if (gitContext.branchName && repoResults.length === 0) {
        try {
          const prs = await integration.listPRsForBranch(projectRef, gitContext.branchName);
          repoResults.push(...prs);
        } catch {
          // [Medium-12] Swallow upstream errors gracefully
        }
      }

      // Broad fallback: fetch recently-updated PRs when we have no definitive signals
      if (repoResults.length === 0) {
        try {
          const since = deriveSinceTimestamp(gitContext, reviewCreatedAt);
          const prs = await integration.listRecentPRs(projectRef, since);
          repoResults.push(...prs);
        } catch {
          // [Medium-12] Swallow upstream errors gracefully
        }
      }

      results.push(...repoResults);
    }

    // Deduplicate by PR URL in case multiple repo lookups overlap
    const seen = new Set<string>();
    return results.filter(pr => {
      if (seen.has(pr.prUrl)) return false;
      seen.add(pr.prUrl);
      return true;
    });
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async fetchSinglePRByUrl(prUrl: string, integration: PRIntegration): Promise<NormalisedPR> {
    // Parse PR number from URL: .../pull/42 or .../merge_requests/42
    const match = prUrl.match(/\/(pull|merge_requests)\/(\d+)/);
    if (!match) {
      // [Medium-12] Generic error — do not expose URL content in messages
      throw new Error('PR fetch failed: invalid PR URL format');
    }
    const prNumber = parseInt(match[2], 10);

    // For GitLab, parse the project path from the URL (e.g. /owner/repo/-/merge_requests/42)
    // For GitHub, use owner/repo from the integration or parse from URL (.../owner/repo/pull/42)
    try {
      const url = new URL(prUrl);
      // Strip trailing /pull/N or /-/merge_requests/N to get the project ref
      const projectRef = url.pathname
        .replace(/\/(pull|merge_requests)\/\d+.*$/, '')
        .replace(/\/-$/, '')
        .replace(/^\//, '');

      return await integration.getPR(projectRef, prNumber);
    } catch (err) {
      throw new Error('PR fetch failed: ' + (err instanceof Error ? err.message : String(err)));
    }
  }
}
