import { describe, expect, it } from 'vitest';
import { parseEnvelope } from '../../src/modules/monitoring/monitoring.schemas';
import { StaticSources } from '../../src/modules/monitoring/static-sources';
import { SAMPLES_DIR } from '../helpers/fixtures';

describe('static sample allowlist (§6.4)', () => {
  const sources = new StaticSources(SAMPLES_DIR);

  it('lists only well-formed .json names from the directory', () => {
    expect(sources.list()).toEqual(['edge-cases.json', 'pdf-example.json', 'sample-telemetry.json']);
  });

  it.each([
    '../.env',
    '../../.env',
    '/etc/passwd',
    '..%2f.env',
    'sample.json/../../x',
    'pdf-example.json ',
    'PDF-EXAMPLE.JSON',
    '',
  ])('rejects %j', (name) => {
    expect(() => sources.resolve(name)).toThrow(expect.objectContaining({ code: 'UNKNOWN_SAMPLE_FILE' }));
  });

  it('reads an allowlisted file', async () => {
    expect(await sources.read('pdf-example.json')).toHaveLength(2);
  });

  it('works with no samples directory', () => {
    expect(new StaticSources(undefined).list()).toEqual([]);
  });
});

describe('ingestion envelope (§6.1)', () => {
  it('accepts an array, a wrapped batch and a single object', () => {
    expect(parseEnvelope([{ api_name: 'A' }], 10)).toEqual({
      items: [{ api_name: 'A' }],
      sourceDetail: null,
    });
    expect(parseEnvelope({ logs: [{}], source: '  webhook ' }, 10)).toEqual({
      items: [{}],
      sourceDetail: 'webhook',
    });
    expect(parseEnvelope({ api_name: 'A' }, 10).items).toHaveLength(1);
    expect(parseEnvelope({ logs: [{}], source: 'x'.repeat(80) }, 10).sourceDetail).toHaveLength(50);
  });

  it.each([
    ['x', 'INVALID_PAYLOAD'],
    [42, 'INVALID_PAYLOAD'],
    [null, 'INVALID_PAYLOAD'],
    [{ foo: 1 }, 'INVALID_PAYLOAD'],
    [{ logs: {} }, 'INVALID_PAYLOAD'],
    [{ logs: [{}], source: 7 }, 'INVALID_PAYLOAD'],
    [[], 'EMPTY_BATCH'],
    [{ logs: [] }, 'EMPTY_BATCH'],
    [[1, 2, 3], 'BATCH_TOO_LARGE'],
  ])('rejects %j with %s', (body, code) => {
    expect(() => parseEnvelope(body, 2)).toThrow(expect.objectContaining({ code }));
  });
});

describe('missing samples directory', () => {
  it('yields an empty allowlist instead of crashing', () => {
    expect(new StaticSources('/definitely/not/here').list()).toEqual([]);
  });
});
