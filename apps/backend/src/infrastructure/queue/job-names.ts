/** Queue and job names (§13.3). Custom job ids use "-", never ":" (§21.8). */
export const QUEUE_NAMES = {
  aiEnrichment: 'ai-enrichment',
  email: 'email',
  maintenance: 'maintenance',
} as const;

export const MAINTENANCE_JOBS = {
  reconcile: 'reconcile',
  autoResolve: 'auto-resolve',
  retention: 'retention',
} as const;
export type MaintenanceJobName = (typeof MAINTENANCE_JOBS)[keyof typeof MAINTENANCE_JOBS];

export const PROMPT_CONTEXTS = ['new_incident', 'escalation', 'regeneration'] as const;
export type PromptContext = (typeof PROMPT_CONTEXTS)[number];

export const aiJobId = (alertId: string, enrichmentVersion: number) => `ai-${alertId}-${enrichmentVersion}`;
export const emailJobId = (notificationId: string) => `email-${notificationId}`;
