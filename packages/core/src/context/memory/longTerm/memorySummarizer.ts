import { ILLMApiHandler } from '../../../api';
import { Message } from '../../../task/types';
import { MemorySummaryResult } from '../types';

const SUMMARIZATION_PROMPT = `You are a memory curator for an AI assistant. Your job is to evaluate conversations and determine if they contain valuable learnings worth remembering for future interactions.

Analyze the conversation and determine:
1. Did the conversation reach a meaningful conclusion?
2. Was there a clear problem that was solved or a question that was answered?
3. Would remembering this help in similar future situations?

IMPORTANT: Be selective! Only mark as valuable if the conversation contains:
- A specific problem/issue that was resolved
- A solution or recommendation that worked
- Information that would genuinely help in similar future cases

Do NOT store:
- Incomplete conversations
- Simple greetings or small talk
- Conversations that didn't reach a conclusion
- Generic or obvious information
- Failed attempts without resolution

If valuable, create a concise summary in this exact format:
"Issue: [specific problem]. Solution: [what was done/recommended]. Outcome: [result]."

Respond in JSON format:
{
  "isValuable": boolean,
  "summary": "string or null if not valuable",
  "metadata": {
    "issue": "string or null",
    "solution": "string or null", 
    "outcome": "string or null",
    "tags": ["relevant", "tags"]
  },
  "reason": "brief explanation of your decision"
}`;

export class MemorySummarizer {
  constructor(private api: ILLMApiHandler) {}

  /**
   * Evaluate a conversation and determine if it should be stored in long-term memory.
   * Returns a structured summary if valuable, or null if not worth storing.
   */
  async evaluateConversation(messages: Message[]): Promise<MemorySummaryResult> {
    if (messages.length < 2) {
      return {
        isValuable: false,
        reason: 'Conversation too short to contain valuable information'
      };
    }

    try {
      const conversationText = this.formatConversationForEvaluation(messages);
      
      const evaluationMessages: Message[] = [
        { role: 'system', content: SUMMARIZATION_PROMPT },
        { role: 'user', content: `Please evaluate this conversation:\n\n${conversationText}` }
      ];

      const response = await this.api.createCompletion(evaluationMessages);
      const result = this.parseEvaluationResponse(response.content);
      
      return result;
    } catch (error) {
      console.error('MemorySummarizer: Failed to evaluate conversation', error);
      return {
        isValuable: false,
        reason: 'Evaluation failed due to an error'
      };
    }
  }

  private formatConversationForEvaluation(messages: Message[]): string {
    return messages
      .slice(1) // remove system prompt
      .map(m => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n\n');
  }

  private parseEvaluationResponse(content: string): MemorySummaryResult {
    try {
      // Extract JSON from the response (handle potential markdown code blocks)
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return {
          isValuable: false,
          reason: 'Could not parse evaluation response'
        };
      }

      const parsed = JSON.parse(jsonMatch[0]);
      
      return {
        isValuable: Boolean(parsed.isValuable),
        summary: parsed.summary || undefined,
        metadata: parsed.metadata || undefined,
        reason: parsed.reason || 'No reason provided'
      };
    } catch (error) {
      console.error('MemorySummarizer: Failed to parse response', error);
      return {
        isValuable: false,
        reason: 'Failed to parse evaluation response'
      };
    }
  }
}
