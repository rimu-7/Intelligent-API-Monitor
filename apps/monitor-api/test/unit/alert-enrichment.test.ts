import { pino } from 'pino';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AlertRow } from '../../src/infrastructure/database/schema';
import type { CachedAlertText } from '../../src/modules/ai/ai-cache';
import {
  AlertEnrichmentService,
  type EnrichmentStore,
  type EnrichmentUpdate,
} from '../../src/modules/ai/alert-enrichment.service';
import { CircuitBreaker } from '../../src/modules/ai/circuit-breaker';
import type { LlmProvider } from '../../src/modules/ai/providers/llm-provider';
import { DEFAULT_THRESHOLDS, PDF_TEMPLATE_MESSAGE } from '../helpers/fixtures';
import { failing, FakeProvider, groundedReply } from '../helpers/fake-providers';

const alertRow = (overrides: Partial<AlertRow> = {}): AlertRow =>
  ({
    id: '6f1f7a2c-2c3b-4f51-9a49-0c0d6d7f2a10',
    fingerprint: 'f'.repeat(64),
    apiName: 'AppointmentAPI',
    status: 'ACTIVE',
    severity: 'CRITICAL',
    previousSeverity: null,
    anomalyTypes: ['SERVER_ERROR', 'HIGH_LATENCY', 'ZERO_RECORDS'],
    statusCode: 500,
    responseTimeMs: 5500,
    recordsReturned: 0,
    lastStatusCode: 500,
    lastResponseTimeMs: 5500,
    lastRecordsReturned: 0,
    peakResponseTimeMs: 5500,
    occurrenceCount: 1,
    alertMessage: PDF_TEMPLATE_MESSAGE,
    probableCause: 'x',
    recommendedAction: 'y',
    aiStatus: 'PENDING',
    aiProvider: null,
    aiModel: null,
    aiPromptVersion: null,
    aiGeneratedAt: null,
    enrichmentVersion: 1,
    firstSeenAt: new Date(),
    lastSeenAt: new Date(),
    escalatedAt: null,
    resolvedAt: null,
    resolvedBy: null,
    resolutionSource: null,
    resolutionNote: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

class MemoryStore implements EnrichmentStore {
  updates: EnrichmentUpdate[] = [];
  constructor(public row: AlertRow) {}
  findById() {
    return Promise.resolve(this.row);
  }
  applyEnrichment(_id: string, version: number, update: EnrichmentUpdate) {
    if (version !== this.row.enrichmentVersion || this.row.aiStatus !== 'PENDING')
      return Promise.resolve(undefined);
    this.updates.push(update);
    this.row = {
      ...this.row,
      aiStatus: update.aiStatus,
      alertMessage: update.text.alertMessage,
      aiProvider: update.provider,
    };
    return Promise.resolve(this.row);
  }
}

class MemoryCache {
  entries = new Map<string, CachedAlertText>();
  get() {
    return Promise.resolve([...this.entries.values()][0]);
  }
  set(_input: unknown, value: CachedAlertText) {
    this.entries.set('k', value);
    return Promise.resolve();
  }
}

const job = {
  alertId: '6f1f7a2c-2c3b-4f51-9a49-0c0d6d7f2a10',
  enrichmentVersion: 1,
  context: 'new_incident' as const,
};
let store: MemoryStore;
let cache: MemoryCache;

const service = (providers: LlmProvider[], breakers = new Map<string, CircuitBreaker>()) =>
  new AlertEnrichmentService({
    store,
    thresholds: { getThresholds: () => Promise.resolve(new Map()), merge: () => DEFAULT_THRESHOLDS },
    providers,
    breakers,
    cache,
    timeoutMs: 1000,
    logger: pino({ level: 'silent' }),
  });

beforeEach(() => {
  store = new MemoryStore(alertRow());
  cache = new MemoryCache();
});

describe('AlertEnrichmentService (§9.1)', () => {
  it('falls back to the exact template when no provider is configured', async () => {
    const result = await service([]).enrich(job);
    expect(result.outcome).toBe('fallback');
    expect(store.updates[0]).toMatchObject({
      aiStatus: 'FALLBACK',
      provider: 'template',
      model: null,
      promptVersion: 'alert-v1',
    });
    expect(store.updates[0]?.text.alertMessage).toBe(PDF_TEMPLATE_MESSAGE);
  });

  it('fails over: first provider fails, second succeeds', async () => {
    const first = failing('gemini');
    const second = new FakeProvider('openai', groundedReply);
    const result = await service([first, second]).enrich(job);
    expect(result.outcome).toBe('completed');
    expect(first.calls).toHaveLength(1);
    expect(store.updates[0]).toMatchObject({
      aiStatus: 'COMPLETED',
      provider: 'openai',
      model: 'openai-fake-model',
    });
    expect(store.updates[0]?.text.alertMessage).toMatch(/^AppointmentAPI returned HTTP 500 after 5500 ms/);
    expect(cache.entries.size).toBe(1);
  });

  it('uses the template when every provider fails or is rejected by the guard', async () => {
    const invented = new FakeProvider('mistral', () =>
      JSON.stringify({
        alert_message: 'AppointmentAPI failed for 87% of users.',
        probable_cause: 'Likely a bad deploy.',
        recommended_action: 'Roll back the deploy.',
      }),
    );
    const result = await service([failing('gemini'), failing('openai'), invented]).enrich(job);
    expect(result.outcome).toBe('fallback');
    expect(store.updates[0]?.text.alertMessage).toBe(PDF_TEMPLATE_MESSAGE);
    expect(cache.entries.size).toBe(0);
  });

  it('serves a cache hit without calling any provider (unless skipCache)', async () => {
    cache.entries.set('k', {
      alertMessage: 'AppointmentAPI cached text with HTTP 500.',
      probableCause: 'Likely cached.',
      recommendedAction: 'Do cached things.',
      provider: 'gemini',
      model: 'cached-model',
    });
    const provider = new FakeProvider('openai', groundedReply);
    const result = await service([provider]).enrich(job);
    expect(result.outcome).toBe('completed');
    expect(provider.calls).toHaveLength(0);
    expect(store.updates[0]).toMatchObject({ provider: 'gemini', model: 'cached-model' });

    store = new MemoryStore(alertRow({ enrichmentVersion: 2 }));
    await service([provider]).enrich({
      ...job,
      enrichmentVersion: 2,
      skipCache: true,
      context: 'regeneration',
    });
    expect(provider.calls).toHaveLength(1);
  });

  it('skips a provider whose circuit is OPEN', async () => {
    const breaker = new CircuitBreaker('gemini');
    for (let i = 0; i < 3; i += 1) breaker.recordFailure();
    const gemini = new FakeProvider('gemini', groundedReply);
    const openai = new FakeProvider('openai', groundedReply);
    await service([gemini, openai], new Map([['gemini', breaker]])).enrich(job);
    expect(gemini.calls).toHaveLength(0);
    expect(store.updates[0]?.provider).toBe('openai');
  });

  it('opens the circuit on call failures but not on guard rejections', async () => {
    const throwing = new CircuitBreaker('gemini');
    const rejecting = new CircuitBreaker('openai');
    const breakers = new Map([
      ['gemini', throwing],
      ['openai', rejecting],
    ]);
    const providers = [failing('gemini'), new FakeProvider('openai', () => 'not json')];
    for (let i = 0; i < 3; i += 1) {
      store = new MemoryStore(alertRow());
      await service(providers, breakers).enrich(job);
    }
    expect(throwing.state).toBe('OPEN');
    expect(rejecting.state).toBe('CLOSED');
  });

  it('skips stale jobs', async () => {
    expect(await service([]).enrich({ ...job, enrichmentVersion: 2 })).toEqual({
      outcome: 'skipped',
      reason: 'version_mismatch',
    });
    store = new MemoryStore(alertRow({ aiStatus: 'COMPLETED' }));
    expect(await service([]).enrich(job)).toEqual({ outcome: 'skipped', reason: 'not_pending' });
  });
});
