Index this repository using the batta MCP server for security context.

1. Call `get_indexing_status` — check current indexing state and coverage.
2. If status is "completed" and $ARGUMENTS does not include "refresh", report the existing
   coverage summary and stop.
3. Otherwise call `index_repository` without arguments to get stage instructions.
4. For each stage:
   a. Read every file listed in `inspect`.
   b. Answer every question in `questions` using evidence from the repository.
   c. Build the submission payload exactly matching `requiredOutputSchema`.
   d. Call `index_repository` with the `sessionId` and your `submission`.
   e. On validation errors, fix only the reported paths and resubmit with the same `sessionId`.
5. Repeat until `get_indexing_status` returns `status: "completed"`.
6. Report the final coverage summary including indexed service count, feature count,
   overall coverage percentage, and any remaining gaps.
7. Remind the user to keep the batta security review requirement in their agent
   instruction file so every new feature/change runs `/batta-review <description>`
   before implementation.

Do not invent or fabricate evidence. Every evidence ref must point to a real file path
relative to the repository root. Do not include secret values, passwords, or raw tokens
in any field — use paths, symbol names, config key names, and short rationale only.
