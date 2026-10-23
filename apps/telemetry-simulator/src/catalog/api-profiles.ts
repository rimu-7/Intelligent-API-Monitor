/** Synthetic healthcare APIs (§14). No vendor brand names. */
export interface ApiProfile {
  name: string;
  /** Median latency in ms; latency is log-normal around it. */
  medianLatencyMs: number;
  /** Log-normal sigma (spread). */
  latencySigma: number;
  serverErrorRate: number;
  authFailureRate: number;
  rateLimitRate: number;
  zeroRecordsRate: number;
  missingRecordsRate: number;
  invalidMetricsRate: number;
  records: { min: number; max: number };
}

export const API_PROFILES: readonly ApiProfile[] = [
  {
    name: 'PatientDataAPI',
    medianLatencyMs: 420,
    latencySigma: 0.45,
    serverErrorRate: 0.01,
    authFailureRate: 0.005,
    rateLimitRate: 0.005,
    zeroRecordsRate: 0.02,
    missingRecordsRate: 0.005,
    invalidMetricsRate: 0.002,
    records: { min: 1, max: 120 },
  },
  {
    name: 'AppointmentAPI',
    medianLatencyMs: 650,
    latencySigma: 0.6,
    serverErrorRate: 0.03,
    authFailureRate: 0.005,
    rateLimitRate: 0.01,
    zeroRecordsRate: 0.03,
    missingRecordsRate: 0.005,
    invalidMetricsRate: 0.002,
    records: { min: 0, max: 60 },
  },
  {
    name: 'BillingServiceAPI',
    medianLatencyMs: 900,
    latencySigma: 0.5,
    serverErrorRate: 0.02,
    authFailureRate: 0.005,
    rateLimitRate: 0.005,
    zeroRecordsRate: 0.01,
    missingRecordsRate: 0.01,
    invalidMetricsRate: 0.005,
    records: { min: 1, max: 40 },
  },
  {
    name: 'LabResultsAPI',
    medianLatencyMs: 1100,
    latencySigma: 0.55,
    serverErrorRate: 0.01,
    authFailureRate: 0.002,
    rateLimitRate: 0.005,
    zeroRecordsRate: 0.04,
    missingRecordsRate: 0.01,
    invalidMetricsRate: 0.002,
    records: { min: 1, max: 30 },
  },
  {
    name: 'EHRIntegrationAPI',
    medianLatencyMs: 1400,
    latencySigma: 0.7,
    serverErrorRate: 0.02,
    authFailureRate: 0.01,
    rateLimitRate: 0.01,
    zeroRecordsRate: 0.02,
    missingRecordsRate: 0.02,
    invalidMetricsRate: 0.01,
    records: { min: 1, max: 200 },
  },
  {
    name: 'PharmacyInventoryAPI',
    medianLatencyMs: 380,
    latencySigma: 0.4,
    serverErrorRate: 0.01,
    authFailureRate: 0.002,
    rateLimitRate: 0.005,
    zeroRecordsRate: 0.03,
    missingRecordsRate: 0.005,
    invalidMetricsRate: 0.01,
    records: { min: 1, max: 500 },
  },
  {
    name: 'InsuranceEligibilityAPI',
    medianLatencyMs: 750,
    latencySigma: 0.5,
    serverErrorRate: 0.015,
    authFailureRate: 0.005,
    rateLimitRate: 0.04,
    zeroRecordsRate: 0.02,
    missingRecordsRate: 0.005,
    invalidMetricsRate: 0.002,
    records: { min: 1, max: 5 },
  },
  {
    name: 'IdentityProviderAPI',
    medianLatencyMs: 220,
    latencySigma: 0.35,
    serverErrorRate: 0.005,
    authFailureRate: 0.03,
    rateLimitRate: 0.01,
    zeroRecordsRate: 0.005,
    missingRecordsRate: 0.002,
    invalidMetricsRate: 0.001,
    records: { min: 1, max: 1 },
  },
];

export const API_NAMES = API_PROFILES.map((profile) => profile.name);
