import { API_PROFILES, type ApiProfile } from '../catalog/api-profiles';
import { Prng } from './prng';

/** Exactly the PDF item shape (plus intentionally malformed values for invalid-metrics samples). */
export interface TelemetryItem {
  api_name: string;
  response_time_ms: number | string;
  status_code: number | string;
  records_returned?: number;
}

/** Seeded generator: the same seed produces the same telemetry sequence (reproducible demos). */
export class TelemetryGenerator {
  private readonly prng: Prng;

  constructor(seed: number) {
    this.prng = new Prng(seed);
  }

  latency(profile: ApiProfile): number {
    const value = profile.medianLatencyMs * Math.exp(profile.latencySigma * this.prng.normal());
    return Math.max(5, Math.round(value));
  }

  item(profile: ApiProfile = this.prng.pick(API_PROFILES)): TelemetryItem {
    const p = this.prng;
    const latency = this.latency(profile);
    const records = p.int(profile.records.min, profile.records.max);
    const roll = p.float();
    let threshold = profile.serverErrorRate;
    if (roll < threshold)
      return {
        api_name: profile.name,
        response_time_ms: latency * 3,
        status_code: p.pick([500, 502, 503, 504]),
        records_returned: 0,
      };
    threshold += profile.authFailureRate;
    if (roll < threshold)
      return {
        api_name: profile.name,
        response_time_ms: latency,
        status_code: p.pick([401, 403]),
        records_returned: 0,
      };
    threshold += profile.rateLimitRate;
    if (roll < threshold)
      return {
        api_name: profile.name,
        response_time_ms: Math.round(latency / 3),
        status_code: 429,
        records_returned: 0,
      };
    threshold += profile.zeroRecordsRate;
    if (roll < threshold)
      return { api_name: profile.name, response_time_ms: latency, status_code: 200, records_returned: 0 };
    threshold += profile.missingRecordsRate;
    if (roll < threshold) return { api_name: profile.name, response_time_ms: latency, status_code: 200 };
    threshold += profile.invalidMetricsRate;
    if (roll < threshold)
      return {
        api_name: profile.name,
        response_time_ms: latency,
        status_code: String(p.pick([200, 500])),
        records_returned: records,
      };
    return { api_name: profile.name, response_time_ms: latency, status_code: 200, records_returned: records };
  }

  batch(count: number): TelemetryItem[] {
    return Array.from({ length: count }, () => this.item());
  }

  /** Only healthy samples (status 200, latency below the default warning threshold, records > 0). */
  healthy(count: number): TelemetryItem[] {
    return Array.from({ length: count }, () => {
      const profile = this.prng.pick(API_PROFILES);
      return {
        api_name: profile.name,
        response_time_ms: Math.min(this.latency(profile), 1_900),
        status_code: 200,
        records_returned: this.prng.int(Math.max(1, profile.records.min), Math.max(1, profile.records.max)),
      };
    });
  }
}
