Run the batta security review protocol for: $ARGUMENTS

Do not write any implementation code until step 4 (acknowledge_security_tasks) is complete.

1. Call `get_indexing_status`.
   - If status is not "completed" and this is first setup for the repository, recommend
     running `/batta-index` first.
   - If the user continues without indexing, proceed with the review and note that indexed
     context was unavailable.

2. Explore the codebase — identify affected services/packages, entry points, data flows,
   auth patterns, and data stores involved in this change.

3. Call `start_security_review` with:
   - `featureDescription`: one sentence describing the change ($ARGUMENTS)
   - `title`: short PR-style title (e.g. "feat: $ARGUMENTS")
   - `agentName`: "Claude Code"
   - `services`: list of affected package names found in step 1
   - `gitContext`: collect `branchName`, `commitSha`, and `baseBranch` from git

4. Call `submit_security_answers` — answer every question in the returned questionnaire.
   Start each answer with "Yes" or "No", then cite the specific file, function, route,
   or explicit absence of the concern.

5. Call `acknowledge_security_tasks`. Read every task in the response.

6. Present the security tasks as a numbered checklist before writing any code.
   Mark each task's severity: critical / high / medium / low.

7. Implement the feature, addressing each security task as you go.

8. After implementation, call `submit_security_attestations` with:
   - One attestation per task: `taskId`, `handled` (true/false), `notes`
     (explain the file/function used, or why the task could not be addressed and the residual risk)
   - `architectureUpdates`: for each entry in `featureSecurityContext`, provide:
     - `featureId`: copied from featureSecurityContext
     - `updatedDataFlowSummary`: complete table of all data flows after your change
       (include existing flows unchanged, plus new/modified flows)
     - `updatedDataClassification`: complete classification table after your change
     - `dfdChangeRationale`: 1–3 sentences explaining what changed and why

Attestation notes must reference concrete evidence such as files, symbols, routes, tests,
migrations, config keys, or documentation. Do not include secrets, tokens, private keys,
`.env` values, or raw source blobs.
