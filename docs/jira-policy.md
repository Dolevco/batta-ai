# Plan: Work Item Review Policy Editor + Redesigned Detail Page

## Context

Two related improvements:

1. **Policy editability**: The `work_item_review` policy type has a `jiraActionItems` config in the type system and the API accepts it on `PUT /policies/:id`, but the `SettingsTab` in `PolicyEditorPage.tsx` never surfaces UI for it. The current editor save payload also omits `jiraActionItems`, so users can't configure auto-export behavior from the UI.

2. **Details page rethink**: `SecurityReviewDetailsPage.tsx` was built for code reviews and reused as-is for work item reviews. Large sections (Threat Model, PR Correlation, PR Validation, Attestations) are irrelevant or confusing when `source === 'jira_work_item'`. The work item review also has unique data (Jira context, agent confidence/rationale/evidence, low-confidence/unknown answers, and task export) that deserves better prominence.

### Target experience

For Jira work item reviews, the page should read as:

```
Ticket context → Agent analysis → Security action items → Jira export
```

It should not read as a coding-agent lifecycle with implementation, attestation, PR correlation, or architecture validation steps.

---

## Part 1: Work Item Review Policy — Jira Action Items Tab

### What to build

Add a **5th tab** to `PolicyEditorPage.tsx` that only appears for `work_item_review` policies: **"Jira Automation"**. This tab edits `policy.jiraActionItems`.

### Tab structure

```
Jira Automation
├── Enable auto-create toggle  (autoCreate: boolean)
│   └── "Automatically create Jira issues for generated action items after agent analysis completes"
├── [shown only when enabled]
│   ├── Target Project Key     (targetProjectKey: string, e.g. "SEC")
│   ├── Issue Type             (issueType: string, default "Task")
│   ├── Severity Threshold     (severityThreshold: select)
│   └── Priority Mapping       (4 inputs: critical/high/medium/low → Jira priority name)
```

### Implementation steps

**File: `packages/ui/src/pages/policies/PolicyEditorPage.tsx`**

1. Add `JiraAutomationTab` component (new sub-component within the file):
   - Renders an enable/disable toggle for `autoCreate`
   - When enabled, shows the config fields (project key, issue type, severity threshold, priority map)
   - All inputs use the existing `fieldStyle` pattern from `SettingsTab`
   - Security: `maxLength` on text inputs (project key: 20, issue type: 50, priority names: 50 each)
   - Input validation: project key pattern `/^[A-Z][A-Z0-9]*$/` shown as hint, not blocking

2. Extend the tab list: add `{ id: 'jira-automation', label: 'Jira Automation', icon: <IssuesCloseOutlined /> }` conditionally rendered only when `policy.type === 'work_item_review'`

3. The `mutate` pattern for `jiraActionItems` should merge from defaults first, because `jiraActionItems` may be undefined:
   ```ts
   mutate(p => {
     const current = p.jiraActionItems ?? defaultJira;
     return { ...p, jiraActionItems: { ...current, autoCreate: val } };
   })
   ```
   When `autoCreate` is toggled off, keep the config values (don't wipe them).

4. Default values when `jiraActionItems` is undefined:
   ```ts
   const defaultJira: JiraActionItemsConfig = {
     autoCreate: false, severityThreshold: 'high',
     targetProjectKey: '', issueType: 'Task',
     priorityMap: { critical: 'Highest', high: 'High', medium: 'Medium', low: 'Low' },
   };
   ```

5. Update `handleSave()` to include `jiraActionItems` in the update payload:
   ```ts
   const updated = await updatePolicy(localPolicy.id, {
     name: localPolicy.name,
     description: localPolicy.description,
     questions: localPolicy.questions,
     taskRules: localPolicy.taskRules,
     baselineTasks: localPolicy.baselineTasks,
     isActive: localPolicy.isActive,
     jiraActionItems: localPolicy.jiraActionItems,
   });
   ```

6. Update the Framework Overview tab's "Jira Action Items" section description to note it's configurable here.

**Backend note**: `PUT /policies/:id` already accepts `jiraActionItems`; the missing piece is the UI save payload.

---

## Part 2: Work Item Review Details Page — Redesigned Nav & Sections

### Core insight

Work item reviews don't have: git context, PR correlation, PR validation, architecture diffs, threat models, or human attestations (tasks are auto-acknowledged). They *do* have: Jira work item context, agent analysis details (confidence/rationale/evidence), action items, and task export to Jira.

### Changes

**File: `packages/ui/src/pages/security-reviews/SecurityReviewDetailsPage.tsx`**

#### 1. Filter NAV_ITEMS based on `review.source`

The `NAV_ITEMS` array is currently static. After loading the review, compute a filtered version:

```ts
const visibleNavItems = NAV_ITEMS.filter(item => {
  if (review.source !== 'jira_work_item') return true; // code reviews: show everything
  // work item reviews: hide code-specific sections
  return !['threat-model', 'pr-correlation', 'pr-validation', 'attestations'].includes(item.id);
});
```

Use `visibleNavItems` instead of `NAV_ITEMS` in the sidebar render loop.

Hidden for `jira_work_item`: `['threat-model', 'pr-correlation', 'pr-validation', 'attestations']`

Default `activeSection` stays `'overview'` for both.

#### 2. Rename/retitle sections for work item context

In the section header bar, when `review.source === 'jira_work_item'`:
- "Security Questionnaire" → "Agent Analysis" (in `QuestionnaireSection` subtitle)
- "Security Tasks" → "Security Action Items"
- "Summary" is still relevant (final compliance state)

Also map status copy for work item reviews so backend statuses do not leak code-review language:

| Backend status | Work item UI label |
|----------------|--------------------|
| `questionnaire_pending` | Queued / Analyzing |
| `questionnaire_answered` | Action items generated |
| `tasks_acknowledged` | Ready to export / Export pending |
| `attested` | Completed |

Use `agentStatus` (`pending`, `running`, `completed`, `failed`) for the most precise queued/running/failed copy.

#### 3. Overview section: replace stepper with status card for work item reviews

For `jira_work_item` source, replace the 4-step progress stepper with a compact **status card** showing:
- Current status pill with work-item-specific labels
- `WorkItemContextPanel` (Jira issue details) — prominent at top
- `AgentStatusBanner` (running/failed/complete indicator)
- Key stats: total tasks, critical count, tasks exported to Jira
- Agent completed timestamp if available

The 4-step stepper is kept as-is for code reviews.

#### 4. Questionnaire section: surface agent analysis quality

When `review.source === 'jira_work_item'`, update `QuestionnaireSection` to:
- Show the section title as "Agent Analysis" with subtitle "Autonomous security analysis of the Jira work item"
- Show an **analysis quality summary** bar at the top, replacing the generic "answered/yes/no" stats:
  - high/medium/low confidence answer counts
  - unknown answer count
  - low-confidence and unknown answers highlighted as "needs reviewer attention"
- The existing per-question rendering already shows confidence + rationale + evidence — keep as-is

#### 5. Tasks section: show action items, not export controls

For `jira_work_item` source, in `TasksSection`:
- Retitle "Security Tasks" as "Security Action Items"
- Add a summary line showing how many tasks have already been exported vs. pending
- Show each task's `jiraIssueKey`/`jiraIssueUrl` chip when exported
- Do **not** put the primary "Export to Jira" action here; keep the primary export workflow in the dedicated "Jira Export" section to avoid two competing export entry points

#### 6. Policies section: show only the `work_item_review` policy

Currently `PoliciesSection` hard-codes `allTypes: PolicyTemplateType[] = ['security_review', 'responsible_ai', 'privacy']` — it never shows the work item policy!

Fix: when `review.source === 'jira_work_item'`, show `allTypes = ['work_item_review']` instead. Add a "Configure policy" link to the Work Item Review policy.

#### 7. Add "Jira Export" nav item for work item reviews

Add a new nav item only visible for `jira_work_item` reviews:
```ts
{ id: 'jira-export', label: 'Jira Export', icon: <ExportOutlined />, group: 'Integrations' }
```

This section shows:
- Export history (tasks with `jiraIssueKey` set, linking to Jira)
- Unexported tasks grouped by severity
- "Export to Jira" button (opening the existing `ExportToJiraModal`)
- Any `jiraExportError` on the review level

This is the single primary place for manual Jira export. The Tasks section may show export status, but not the main export button.

---

## Part 3: Auto-export lifecycle fix

### Problem

The existing service auto-export is triggered only after `submitAttestations()`. Work item reviews are auto-acknowledged by `WorkItemReviewRunner` and the UI intentionally hides Attestations, so "auto-create on attestation" is a dead path for `jira_work_item`.

### What to change

**File: `packages/shared/src/services/work-item-review-runner.ts` or `packages/shared/src/services/security-review.service.ts`**

After the work item agent successfully submits answers and acknowledges tasks:

1. Mark `agentStatus: 'completed'` and `agentCompletedAt`.
2. If the active `work_item_review` policy has `jiraActionItems.autoCreate === true`, export tasks to Jira using that config.
3. Preserve manual export as a fallback in the "Jira Export" section.
4. On export failure, set `review.jiraExportError` so the details page can show it.
5. On successful export, set/update exported task fields and `review.jiraExportedAt`.

The trigger should be "after agent analysis completes and action items are generated," not "on attestation."

---

## Files to modify

| File | Change |
|------|--------|
| `packages/ui/src/pages/policies/PolicyEditorPage.tsx` | Add `JiraAutomationTab` component + tab entry for work_item_review |
| `packages/ui/src/pages/security-reviews/SecurityReviewDetailsPage.tsx` | Filter nav by source, rename sections, fix PoliciesSection, add Jira Export nav item, adjust Overview for work items |
| `packages/shared/src/services/work-item-review-runner.ts` or `packages/shared/src/services/security-review.service.ts` | Trigger work-item auto-export after agent completion/task acknowledgement instead of attestation |

No type or public API changes required.

## Decisions (confirmed)

- **Attestations**: hidden for work item reviews (auto-acknowledged tasks don't need an audit section in the UI)
- **Overview stepper**: replaced with a status card for work item reviews; stepper kept for code reviews
- **Jira Automation save validation**: warn-only (inline hint), never blocks save
- **Auto-export trigger**: for work item reviews, auto-export runs after agent analysis completes and action items are generated, not on attestation
- **Primary manual export UI**: one primary export entry point in the "Jira Export" section; Tasks only shows export status

---

## Verification

1. Open a `work_item_review` policy in the editor — verify the "Jira Automation" tab appears
2. Toggle `autoCreate` on, fill fields, save — verify the saved policy includes `jiraActionItems`
3. Open a `security_review` policy — verify no "Jira Automation" tab appears
4. Open a work item security review detail page — verify PR Correlation, PR Validation, Threat Model nav items are gone
5. Open a code security review — verify all nav items remain
6. Open work item review Policies section — verify it shows the `work_item_review` policy (currently shows nothing relevant)
7. Run a work item review with `autoCreate` enabled — verify Jira export happens after agent completion/task acknowledgement without requiring attestation
8. Force or simulate export failure — verify `jiraExportError` is visible in the Jira Export section and manual retry still works
9. Open Agent Analysis for a sparse Jira ticket — verify unknown and low-confidence answers are visible in the quality summary
