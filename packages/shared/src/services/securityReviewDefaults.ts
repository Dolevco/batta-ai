import type { SecurityReviewQuestion, SecurityTask } from '../types';
import type { PolicyTaskRule } from '../types';

// ── Security Review defaults ───────────────────────────────────────────────────

export const BASE_QUESTIONS: SecurityReviewQuestion[] = [
  {
    id: 'auth',
    question: 'Does this feature introduce or modify authentication or authorization logic?',
    hint: 'Include any changes to login, session, role checks, permission gates, or token handling.',
  },
  {
    id: 'data_sensitivity',
    question: 'Does this feature handle personally identifiable information (PII), credentials, or other sensitive data?',
    hint: 'PII includes names, emails, phone numbers, addresses, financial data, health data, or any government IDs.',
  },
  {
    id: 'input_validation',
    question: 'Does this feature accept input from external or untrusted sources (users, APIs, files, webhooks)?',
    hint: 'External sources include browser forms, REST/GraphQL payloads, file uploads, webhooks, and inter-service calls.',
  },
  {
    id: 'crypto',
    question: 'Does this feature store, transmit, or process secrets, tokens, or cryptographic material?',
    hint: 'Secrets include API keys, passwords, private keys, certificates, OAuth tokens, and encryption keys.',
  },
  {
    id: 'third_party',
    question: 'Does this feature integrate with a new third-party service, library, or dependency?',
    hint: 'Include any new npm/pip/cargo package, external API, SaaS product, or cloud service.',
  },
  {
    id: 'network',
    question: 'Does this feature open new network endpoints, change CORS policy, or alter firewall/WAF rules?',
    hint: 'Include new HTTP routes, WebSocket endpoints, gRPC services, or changes to allowed origins.',
  },
  {
    id: 'data_retention',
    question: 'Does this feature persist data to a database, file system, cache, or audit log?',
    hint: 'Include writes to SQL/NoSQL databases, blob storage, Redis, local files, or any structured log sink.',
  },
  {
    id: 'supply_chain',
    question: 'Does this feature change the build pipeline, CI/CD configuration, or deployment infrastructure?',
    hint: 'Include Dockerfile changes, GitHub Actions workflows, Terraform/Pulumi configs, and Helm charts.',
  },
  {
    id: 'error_handling',
    question: 'Could this feature leak sensitive information through error messages, logs, or API responses?',
    hint: 'Consider stack traces in error responses, verbose logging of secrets, or diagnostic endpoints.',
  },
];

export const TASK_RULES: PolicyTaskRule[] = [
  {
    questionId: 'auth',
    tasks: [
      {
        title: 'Enforce least-privilege access control',
        description:
          'Verify that every new route / action has an explicit authorization check. ' +
          'Deny by default; never grant access through omission.',
        severity: 'critical',
        principle: 'Least Privilege',
      },
      {
        title: 'Validate and rotate session tokens',
        description:
          'Ensure tokens have short expiry, are signed with a strong algorithm (RS256/ES256), ' +
          'and are invalidated on logout or privilege change.',
        severity: 'high',
        principle: 'Defense in Depth',
      },
    ],
  },
  {
    questionId: 'data_sensitivity',
    tasks: [
      {
        title: 'Encrypt PII at rest and in transit',
        description:
          'Confirm PII fields are encrypted at rest (AES-256 or equivalent) and that all ' +
          'connections use TLS 1.2+. Never log raw PII.',
        severity: 'critical',
        principle: 'Data Protection',
      },
      {
        title: 'Apply data minimization and retention limits',
        description:
          'Collect only the PII strictly necessary, define a retention period, and ' +
          'implement automated deletion or anonymization after that period.',
        severity: 'high',
        principle: 'Privacy by Design',
      },
    ],
  },
  {
    questionId: 'input_validation',
    tasks: [
      {
        title: 'Validate and sanitize all external input',
        description:
          'Apply allow-list validation (type, length, format) on every input field. ' +
          'Use parameterized queries for DB access; never interpolate user data into SQL/NoSQL queries.',
        severity: 'critical',
        principle: 'Input Validation',
      },
      {
        title: 'Guard against injection attacks (SQLi, XSS, command injection)',
        description:
          'Use an ORM or prepared statements. Escape output rendered in HTML. ' +
          'Avoid shell interpolation of user-supplied values.',
        severity: 'critical',
        principle: 'OWASP Top 10',
      },
    ],
  },
  {
    questionId: 'crypto',
    tasks: [
      {
        title: 'Store secrets in a secrets manager, never in code or config files',
        description:
          'Use a vault (HashiCorp Vault, AWS Secrets Manager, Azure Key Vault, or equivalent). ' +
          'Ensure secrets are not committed to the repository or embedded in container images.',
        severity: 'critical',
        principle: 'Secrets Management',
      },
      {
        title: 'Use vetted cryptographic libraries only',
        description:
          'Never implement cryptographic primitives from scratch. ' +
          'Use platform-standard libraries (Node crypto, libsodium, etc.) with recommended algorithms.',
        severity: 'high',
        principle: 'Cryptographic Hygiene',
      },
    ],
  },
  {
    questionId: 'third_party',
    tasks: [
      {
        title: 'Assess third-party dependency for known vulnerabilities',
        description:
          'Run `npm audit` / `pip-audit` / equivalent before merging. ' +
          "Check the package's license, maintenance status, and CVE history.",
        severity: 'high',
        principle: 'Supply Chain Security',
      },
      {
        title: 'Pin dependency versions and verify integrity',
        description:
          'Use exact version pins (lock files) and enable integrity checks (SRI for CDN assets, ' +
          'hash verification in package managers).',
        severity: 'medium',
        principle: 'Supply Chain Security',
      },
    ],
  },
  {
    questionId: 'network',
    tasks: [
      {
        title: 'Apply strict CORS policy on new endpoints',
        description:
          'Explicitly allow-list trusted origins. Avoid wildcard (*) for authenticated endpoints. ' +
          'Validate Origin header server-side.',
        severity: 'high',
        principle: 'Network Security',
      },
      {
        title: 'Rate-limit and throttle new public endpoints',
        description:
          'Apply rate limiting (e.g., 100 req/min per IP/token) to prevent abuse, ' +
          'brute-force, and denial-of-service.',
        severity: 'high',
        principle: 'Availability',
      },
    ],
  },
  {
    questionId: 'data_retention',
    tasks: [
      {
        title: 'Classify data stored and apply appropriate access controls',
        description:
          'Tag new DB tables / collections with a data classification label. ' +
          'Grant access only to service accounts that strictly need it.',
        severity: 'high',
        principle: 'Data Governance',
      },
      {
        title: 'Ensure audit trail for sensitive writes',
        description:
          'Log create/update/delete events for sensitive records with actor, timestamp, and diff. ' +
          'Store audit logs in an append-only sink.',
        severity: 'medium',
        principle: 'Accountability',
      },
    ],
  },
  {
    questionId: 'supply_chain',
    tasks: [
      {
        title: 'Review CI/CD changes for secret exposure and privilege escalation',
        description:
          'Ensure new pipeline steps do not print secrets to logs, ' +
          'do not grant overly broad cloud permissions, and cannot be triggered by untrusted actors.',
        severity: 'critical',
        principle: 'Supply Chain Security',
      },
    ],
  },
  {
    questionId: 'error_handling',
    tasks: [
      {
        title: 'Return generic error messages to clients; log detail server-side only',
        description:
          'API error responses must not include stack traces, internal paths, or ' +
          'system configuration details. Structured errors should use stable error codes.',
        severity: 'medium',
        principle: 'Secure Error Handling',
      },
    ],
  },
];

export const BASELINE_TASKS: Omit<SecurityTask, 'id'>[] = [
  {
    title: 'Document security decisions in the security review attestation',
    description:
      'After implementation, attest how each security task was addressed, ' +
      'including specific file paths, functions, or mechanisms used. ' +
      'Flag any tasks that could not be fully addressed and explain why.',
    severity: 'medium',
    principle: 'Accountability',
  },
];

// ── Responsible AI Review defaults ─────────────────────────────────────────────

export const RESPONSIBLE_AI_QUESTIONS: SecurityReviewQuestion[] = [
  {
    id: 'ai_bias',
    question: 'Does this feature introduce or rely on an AI/ML model that could produce biased outputs affecting users?',
    hint: 'Consider training data provenance, demographic fairness, disparate impact across user groups, and output equity testing.',
  },
  {
    id: 'ai_explainability',
    question: 'Are AI-generated decisions or recommendations explainable and contestable by end users?',
    hint: 'Users subject to AI decisions should be able to request an explanation, understand the rationale, or escalate to human review.',
  },
  {
    id: 'ai_hallucination',
    question: 'Could AI outputs include fabricated facts, citations, or sensitive information from training data?',
    hint: 'Include prompt-injection risks, retrieval-augmented generation accuracy, and cases where the model may surface confidential training data.',
  },
  {
    id: 'ai_data_usage',
    question: 'Is user data used to train, fine-tune, or evaluate AI/ML models?',
    hint: 'Confirm data retention controls, user consent and opt-out paths, and whether data leaves the tenant boundary for model training.',
  },
  {
    id: 'ai_autonomy',
    question: 'Does the feature allow the AI to take autonomous actions (e.g., sending messages, modifying data, executing code) without human approval?',
    hint: 'Identify the blast radius of autonomous actions, confirm rollback capability, and ensure meaningful human-in-the-loop controls exist.',
  },
  {
    id: 'ai_misuse',
    question: 'Could this feature be misused to generate harmful, illegal, or deceptive content at scale?',
    hint: 'Consider content generation abuse, synthetic identity creation, automated misinformation, and adversarial prompt attacks.',
  },
];

export const RESPONSIBLE_AI_TASK_RULES: PolicyTaskRule[] = [
  {
    questionId: 'ai_bias',
    tasks: [
      {
        title: 'Evaluate model outputs for demographic bias before deployment',
        description:
          'Run fairness benchmarks across representative demographic groups. ' +
          'Document disparity findings and implement mitigations (reweighting, adversarial debiasing, output filters).',
        severity: 'high',
        principle: 'AI Fairness',
      },
      {
        title: 'Establish ongoing bias monitoring in production',
        description:
          'Instrument output sampling and periodic bias audits. ' +
          'Define thresholds that trigger automatic review or rollback.',
        severity: 'medium',
        principle: 'AI Fairness',
      },
    ],
  },
  {
    questionId: 'ai_explainability',
    tasks: [
      {
        title: 'Provide in-product explanation mechanism for AI decisions',
        description:
          'Implement a "Why did the AI say this?" pathway. ' +
          'Surface confidence scores and the primary contributing factors in language users can understand.',
        severity: 'high',
        principle: 'Transparency',
      },
      {
        title: 'Ensure human escalation path for consequential AI decisions',
        description:
          'Any decision that materially affects a user (access, scoring, filtering) must include ' +
          'a human-review request option with documented SLA.',
        severity: 'high',
        principle: 'Human Oversight',
      },
    ],
  },
  {
    questionId: 'ai_hallucination',
    tasks: [
      {
        title: 'Implement output grounding and citation validation',
        description:
          'Ground AI responses in verifiable sources (RAG with source attribution). ' +
          'Run automated factuality checks on high-stakes outputs before surfacing to users.',
        severity: 'high',
        principle: 'Accuracy & Reliability',
      },
      {
        title: 'Guard against prompt injection and jailbreak attacks',
        description:
          'Apply input sanitization, system-prompt isolation, and output filtering. ' +
          'Test adversarial prompts covering known jailbreak categories before release.',
        severity: 'critical',
        principle: 'AI Security',
      },
    ],
  },
  {
    questionId: 'ai_data_usage',
    tasks: [
      {
        title: 'Obtain explicit user consent before using data for model training',
        description:
          'Present clear opt-in/opt-out controls at point of data collection. ' +
          'Document the consent mechanism and ensure it is auditable.',
        severity: 'critical',
        principle: 'Privacy by Design',
      },
      {
        title: 'Enforce tenant data isolation in model training pipelines',
        description:
          'Verify that customer data never crosses tenant boundaries in training jobs. ' +
          'Apply differential privacy or data anonymization where required.',
        severity: 'high',
        principle: 'Data Protection',
      },
    ],
  },
  {
    questionId: 'ai_autonomy',
    tasks: [
      {
        title: 'Define and enforce human-in-the-loop approval gates for autonomous actions',
        description:
          'List all autonomous actions and their blast radius. ' +
          'Require explicit user confirmation for irreversible or high-impact operations.',
        severity: 'critical',
        principle: 'Human Oversight',
      },
      {
        title: 'Implement undo / rollback capability for AI-initiated changes',
        description:
          'All data mutations triggered by AI must be reversible within a defined window. ' +
          'Expose rollback UI or API endpoint to operators.',
        severity: 'high',
        principle: 'Resilience',
      },
    ],
  },
  {
    questionId: 'ai_misuse',
    tasks: [
      {
        title: 'Deploy content safety filters on all generative outputs',
        description:
          'Apply classifier-based or rule-based filters for harmful content categories ' +
          '(CSAM, violence, hate speech, PII leakage). Log and alert on filter triggers.',
        severity: 'critical',
        principle: 'Content Safety',
      },
    ],
  },
];

export const RESPONSIBLE_AI_BASELINE_TASKS: Omit<SecurityTask, 'id'>[] = [
  {
    title: 'Document AI model card and intended use in the attestation',
    description:
      'Record the model name/version, training data sources, intended use cases, known limitations, ' +
      'and out-of-scope uses. Link to the attestation from the feature documentation.',
    severity: 'medium',
    principle: 'Transparency',
  },
];

// ── Privacy Review defaults ────────────────────────────────────────────────────

export const PRIVACY_QUESTIONS: SecurityReviewQuestion[] = [
  {
    id: 'personal_data_collection',
    question: 'Does this feature collect or process personal data as defined under GDPR, CCPA, or applicable privacy laws?',
    hint: 'Personal data includes names, emails, device IDs, IP addresses, location, behavioral data, and any data that can identify an individual directly or indirectly.',
  },
  {
    id: 'consent',
    question: 'Is explicit, informed user consent obtained before collecting or processing personal data?',
    hint: 'Consent must be freely given, specific, unambiguous, and withdrawable. Pre-ticked boxes or consent bundled with ToS do not qualify.',
  },
  {
    id: 'data_subject_rights',
    question: 'Does the feature support data subject rights — access, rectification, erasure, and portability?',
    hint: 'Users must be able to request a copy of their data, correct inaccuracies, request deletion, and export their data in a machine-readable format.',
  },
  {
    id: 'cross_border_transfer',
    question: 'Is personal data transferred across jurisdictional boundaries (e.g., EU to US)?',
    hint: 'Transfers outside the EEA require an adequacy decision, SCCs, or Binding Corporate Rules. Document the legal basis for each transfer.',
  },
  {
    id: 'data_sharing',
    question: 'Is personal data shared with third parties, processors, or sub-processors?',
    hint: 'Include analytics vendors, cloud providers, CDNs, and any service that touches the data. Data Processing Agreements (DPAs) are required for processors.',
  },
  {
    id: 'retention_deletion',
    question: 'Does the feature define a data retention period and automated deletion process?',
    hint: 'Data should not be retained longer than necessary for its stated purpose. Define the retention schedule and verify automated purge jobs exist.',
  },
];

export const PRIVACY_TASK_RULES: PolicyTaskRule[] = [
  {
    questionId: 'personal_data_collection',
    tasks: [
      {
        title: 'Complete Privacy Impact Assessment (PIA) before launch',
        description:
          'Document what personal data is collected, why it is needed, how it is protected, ' +
          'and the legal basis for processing. Get DPO sign-off for high-risk processing.',
        severity: 'critical',
        principle: 'Privacy by Design',
      },
      {
        title: 'Classify personal data and apply field-level encryption',
        description:
          'Tag all personal data fields with their classification tier. ' +
          'Apply encryption at rest (AES-256) and column-level access controls.',
        severity: 'high',
        principle: 'Data Protection',
      },
    ],
  },
  {
    questionId: 'consent',
    tasks: [
      {
        title: 'Implement granular, revocable consent management',
        description:
          'Build a consent UI that records purpose, timestamp, and version of the privacy notice shown. ' +
          'Provide a self-service consent withdrawal mechanism.',
        severity: 'critical',
        principle: 'User Rights',
      },
    ],
  },
  {
    questionId: 'data_subject_rights',
    tasks: [
      {
        title: 'Implement data access and export endpoints (DSAR)',
        description:
          'Build or integrate a Data Subject Access Request workflow. ' +
          'Responses must be fulfilled within 30 days. Export format must be machine-readable (JSON/CSV).',
        severity: 'high',
        principle: 'User Rights',
      },
      {
        title: 'Implement right-to-erasure (right to be forgotten)',
        description:
          'Ensure full deletion of personal data — including backups, caches, and downstream copies — ' +
          'within the legally mandated timeframe. Document the deletion propagation path.',
        severity: 'high',
        principle: 'User Rights',
      },
    ],
  },
  {
    questionId: 'cross_border_transfer',
    tasks: [
      {
        title: 'Document legal basis and safeguards for cross-border data transfers',
        description:
          'Identify the transfer mechanism (SCCs, adequacy decision, BCRs). ' +
          'Update the Record of Processing Activities (RoPA) and notify the DPO.',
        severity: 'high',
        principle: 'Legal Compliance',
      },
    ],
  },
  {
    questionId: 'data_sharing',
    tasks: [
      {
        title: 'Ensure Data Processing Agreements are in place for all processors',
        description:
          'Review and execute DPAs with every vendor that touches personal data. ' +
          'Add new processors to the vendor register before launch.',
        severity: 'high',
        principle: 'Accountability',
      },
    ],
  },
  {
    questionId: 'retention_deletion',
    tasks: [
      {
        title: 'Define retention schedule and verify automated purge jobs',
        description:
          'Document the retention period in the data inventory. ' +
          'Implement and test automated deletion jobs. Verify deletion propagates to all replicas and backups.',
        severity: 'high',
        principle: 'Data Minimization',
      },
    ],
  },
];

export const PRIVACY_BASELINE_TASKS: Omit<SecurityTask, 'id'>[] = [
  {
    title: 'Update the Record of Processing Activities (RoPA) with new processing activity',
    description:
      'Add an entry to the RoPA for this feature, including: controller/processor role, ' +
      'purpose, legal basis, data categories, recipients, retention period, and safeguards.',
    severity: 'medium',
    principle: 'Accountability',
  },
];
