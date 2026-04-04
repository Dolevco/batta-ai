import { ILLMApiHandler } from '../../../api';
import { Message, MemoryConfig } from '../../../task/types';

// Re-export MemoryConfig so it's accessible from this module
export type { MemoryConfig };

/**
 * Structured 9-section compact summary prompt.
 *
 * The <analysis> scratchpad block is instructed to be stripped from the output
 * so the LLM can think before writing but only the structured sections remain.
 *
 * Security note: The LLM output (summary) is treated as internal content only;
 * it is injected back into context as a system message and never returned to clients.
 */
export const DEFAULT_COMPACT_PROMPT = `Create a detailed technical summary of the conversation below.
Before writing the summary, use an <analysis> scratchpad block to organise your thinking — this block will be stripped from the final output.

<analysis>
[Work through key points, decisions, errors, current state before writing the summary]
</analysis>

Your summary MUST include ALL of these sections (omit the <analysis> block from your response):

## 1. Primary Request and Intent
Capture ALL user requests and goals in full detail. Be exhaustive — list every explicit request made.

## 2. Key Technical Concepts
List all important technologies, frameworks, design patterns, and architectural decisions discussed.

## 3. Files and Code Sections
Enumerate specific files examined or modified. Include:
- Full file paths
- Code snippets for important changes (verbatim where applicable)
- Why each file is relevant

## 4. Errors and Fixes
List every error encountered with:
- Exact error messages (verbatim)
- How each was resolved
- Any user corrections or feedback

## 5. Problem Solving
Document problems solved and ongoing troubleshooting. Include dead ends and failed approaches.

## 6. All User Messages
List EVERY user message verbatim (not tool results). Critical for intent continuity.

## 7. Pending Tasks
List tasks explicitly requested but not yet completed with their exact requirements.

## 8. Current Work
Describe in precise detail what was happening immediately before this summary.
Include file names, function names, and code snippets.

## 9. Next Step
State the single next action to take, directly in line with the most recent explicit request.
Include direct quotes from the last exchange to anchor the context.

CRITICAL RULES:
- Include technical specifics: file paths, function signatures, error messages verbatim
- Do NOT include these instructions in the summary
- Strip the <analysis> block from your response — output only the numbered sections
- Be exhaustive on sections 1, 3, 6, and 8`;

/**
 * ShortTermMemory with token-aware compaction and structured summary.
 */
export class ShortTermMemory {
  private messages: Message[] = [];
  private summaryMessage?: Message;
  private onSummary?: (summary: Message) => void;
  private onCompacted?: (stats: { before: number; after: number; summaryLength: number }) => void;
 
  constructor(
    private api: ILLMApiHandler,
    private cfg: MemoryConfig = {},
    onSummary?: (summary: Message) => void,
    onCompacted?: (stats: { before: number; after: number; summaryLength: number }) => void
  ) {
    this.onSummary = onSummary;
    this.onCompacted = onCompacted;
  }

  public addMessage(msg: Message) {
    this.messages.push(msg);
  }

  /**
   * Estimate the total token count of all messages using character-based heuristic.
   */
  public estimateTokenCount(): number {
    const charsPerToken = this.cfg.tokenEstimateCharsPerToken ?? 4;
    return this.messages.reduce(
      (sum, m) => sum + Math.ceil(m.content.length / charsPerToken),
      0
    );
  }

  /**
   * Return context messages and, if compaction conditions are met (by message count OR token count),
   * perform summarization synchronously so the returned messages reflect the new summary.
   *
   * Token-aware trigger in addition to message count.
   */
  public async getContextMessagesWithPossibleSummarization(): Promise<Message[]> {
    if (this.cfg.summarizationDisabled) {
      return this.getContextMessages();
    }

    const max = this.cfg.maxMessages ?? 20;
    const maxTokens = this.cfg.maxTokens;

    const shouldSummarizeByCount = this.messages.length >= max;
    const shouldSummarizeByTokens = maxTokens != null && this.estimateTokenCount() >= maxTokens;

    if (shouldSummarizeByCount || shouldSummarizeByTokens) {
      await this.summarizeOlderMessages();
    }
    return this.getContextMessages();
  }

  /**
   * Summarize older messages, keeping the most recent ones intact.
   * Uses structured 9-section prompt for comprehensive summaries.
   */
  private async summarizeOlderMessages(): Promise<void> {
    try {
      // Always preserve the first 2 messages (system prompt + original ask).
      const preserved = 2;
      if (this.messages.length <= preserved) return;

      // Preserve the N most recent messages (configurable, default 4)
      const preserveRecent = this.cfg.preserveLastNMessages ?? 4;
      const summarizable = this.messages.slice(preserved);
      // Keep the most recent 'preserveRecent' messages intact; summarize the older ones
      const cutoff = Math.max(0, summarizable.length - preserveRecent);
      if (cutoff === 0) return; // Nothing to summarize
      const toSummarize = summarizable.slice(0, cutoff);
      if (!toSummarize.length) return;

      const summaryPrompt = this.cfg.summarizationPrompt ?? DEFAULT_COMPACT_PROMPT;

      const messagesForSummarization: Message[] = [
        { role: 'system', content: summaryPrompt },
        ...toSummarize.map(m => ({ role: m.role, content: m.content }))
      ];

      const tokensBefore = this.estimateTokenCount();
      const resp = await this.api.createCompletion(messagesForSummarization as any);
      let summaryText: string = (resp && (resp as any).content) ? (resp as any).content.trim() : '';

      // Strip <analysis> block if the model included it
      summaryText = summaryText.replace(/<analysis>[\s\S]*?<\/analysis>/gi, '').trim();

      if (summaryText) {
        // Keep the first 2 messages intact; replace summarized messages with the summary.
        const recentMessages = summarizable.slice(cutoff);
        this.messages = [...this.messages.slice(0, preserved), ...recentMessages];
        this.summaryMessage = { role: 'system', content: `## Conversation Summary\n\n${summaryText}` };

        const tokensAfter = this.estimateTokenCount();
        const stats = { before: tokensBefore, after: tokensAfter, summaryLength: summaryText.length };

        try {
          this.onSummary?.(this.summaryMessage);
          this.onCompacted?.(stats);
        } catch (err) {
          // swallow callback errors
        }
      }
    } catch (err) {
      // Fail-safe: do not modify buffer on error
      console.error('ShortTermMemory summarization failed', err);
    }
  }

  private async getContextMessages(): Promise<Message[]> {
    // Always keep the first 2 messages (system prompt + original ask).
    // If we have a summary, insert it as the 3rd message, followed by the rest.
    if (this.summaryMessage) {
      const preserved = this.messages.slice(0, 2);
      const rest = this.messages.slice(2);
      return [...preserved, this.summaryMessage, ...rest];
    }
    return [...this.messages];
  }

  public clear() {
    this.messages = [];
    this.summaryMessage = undefined;
  }
}
