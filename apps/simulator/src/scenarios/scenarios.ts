import type { TelemetryGenerator, TelemetryItem } from '../generator/telemetry-generator';

/** A scenario is one or more batches pushed in order (escalation needs two). */
export interface Scenario {
  name: string;
  description: string;
  batches: (generator: TelemetryGenerator) => TelemetryItem[][];
}

const repeat = (count: number, make: (i: number) => TelemetryItem): TelemetryItem[] =>
  Array.from({ length: count }, (_, i) => make(i));

export const SCENARIOS: readonly Scenario[] = [
  {
    name: 'pdf-example',
    description: 'The exact two-item array from the assignment (one healthy, one CRITICAL).',
    batches: () => [
      [
        { api_name: 'PatientDataAPI', response_time_ms: 1200, status_code: 200, records_returned: 50 },
        { api_name: 'AppointmentAPI', response_time_ms: 5500, status_code: 500, records_returned: 0 },
      ],
    ],
  },
  {
    name: 'healthy-batch',
    description: '20 healthy samples across every API.',
    batches: (g) => [g.healthy(20)],
  },
  {
    name: 'high-latency',
    description: 'LabResultsAPI slows down: warning then critical latency.',
    batches: () => [
      repeat(3, (i) => ({
        api_name: 'LabResultsAPI',
        response_time_ms: 2400 + i * 300,
        status_code: 200,
        records_returned: 12,
      })),
    ],
  },
  {
    name: 'server-error',
    description: 'BillingServiceAPI returns HTTP 503.',
    batches: () => [
      repeat(3, (i) => ({
        api_name: 'BillingServiceAPI',
        response_time_ms: 640 + i * 20,
        status_code: 503,
        records_returned: 8,
      })),
    ],
  },
  {
    name: 'zero-records',
    description: 'PatientDataAPI answers 200 with no data.',
    batches: () => [
      repeat(3, (i) => ({
        api_name: 'PatientDataAPI',
        response_time_ms: 300 + i * 15,
        status_code: 200,
        records_returned: 0,
      })),
    ],
  },
  {
    name: 'missing-records',
    description: 'EHRIntegrationAPI omits records_returned.',
    batches: () => [
      repeat(2, (i) => ({ api_name: 'EHRIntegrationAPI', response_time_ms: 900 + i * 40, status_code: 200 })),
    ],
  },
  {
    name: 'invalid-metrics',
    description: 'PharmacyInventoryAPI sends a numeric string status code.',
    batches: () => [
      repeat(2, () => ({
        api_name: 'PharmacyInventoryAPI',
        response_time_ms: 300,
        status_code: '500',
        records_returned: 3,
      })),
    ],
  },
  {
    name: 'auth-failure',
    description: 'IdentityProviderAPI rejects credentials (HTTP 401).',
    batches: () => [
      repeat(2, () => ({
        api_name: 'IdentityProviderAPI',
        response_time_ms: 200,
        status_code: 401,
        records_returned: 0,
      })),
    ],
  },
  {
    name: 'rate-limited',
    description: 'InsuranceEligibilityAPI hits its rate limit (HTTP 429).',
    batches: () => [
      repeat(5, (i) => ({
        api_name: 'InsuranceEligibilityAPI',
        response_time_ms: 150 + i * 5,
        status_code: 429,
        records_returned: 0,
      })),
    ],
  },
  {
    name: 'outage-burst',
    description: '25 × AppointmentAPI HTTP 503 in one batch → one alert, occurrence_count 25, one email.',
    batches: () => [
      repeat(25, (i) => ({
        api_name: 'AppointmentAPI',
        response_time_ms: 800 + (i % 5) * 10,
        status_code: 503,
        records_returned: 12,
      })),
    ],
  },
  {
    name: 'escalation',
    description: 'AppointmentAPI at 2500 ms (WARNING), then 6000 ms (CRITICAL) → escalation + email.',
    batches: () => [
      [{ api_name: 'AppointmentAPI', response_time_ms: 2500, status_code: 200, records_returned: 5 }],
      [{ api_name: 'AppointmentAPI', response_time_ms: 6000, status_code: 200, records_returned: 5 }],
    ],
  },
  {
    name: 'mixed-batch',
    description: '200 random samples from the seeded generator.',
    batches: (g) => [g.batch(200)],
  },
];

export const findScenario = (name: string): Scenario | undefined =>
  SCENARIOS.find((scenario) => scenario.name === name);
