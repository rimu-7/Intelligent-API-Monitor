import { readdirSync, statSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { findUp } from '../../lib/paths';
import { PayloadTooLargeError, ValidationError } from '../../lib/errors';

export const SAMPLE_FILE_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}\.json$/;
const MAX_SAMPLE_BYTES = 1024 * 1024;

/** SAMPLES_DIR, or `<repo>/data/samples` found from this module (host mode runs from the workspace dir). */
export const resolveSamplesDir = (configured: string | undefined): string | undefined =>
  configured ? path.resolve(configured) : findUp('data/samples', import.meta.dirname);

/**
 * Allowlisted sample files (§6.4). The allowlist is built once from the directory listing;
 * a request names an exact allowlist key and user input is never joined into a path.
 */
export class StaticSources {
  private readonly files: ReadonlyMap<string, string>;

  constructor(readonly directory: string | undefined) {
    const entries = new Map<string, string>();
    if (directory) {
      for (const name of readdirSync(directory)) {
        const full = path.join(directory, name);
        if (SAMPLE_FILE_PATTERN.test(name) && statSync(full).isFile()) entries.set(name, full);
      }
    }
    this.files = entries;
  }

  list(): string[] {
    return [...this.files.keys()].sort();
  }

  /** Throws UNKNOWN_SAMPLE_FILE for anything that is not an exact allowlist key. */
  resolve(file: string): string {
    const full = this.files.get(file);
    if (!full) {
      throw new ValidationError(
        'Unknown sample file',
        [{ path: 'file', message: `must be one of: ${this.list().join(', ')}` }],
        'UNKNOWN_SAMPLE_FILE',
      );
    }
    return full;
  }

  async read(file: string): Promise<unknown> {
    const full = this.resolve(file);
    if ((await stat(full)).size > MAX_SAMPLE_BYTES) {
      throw new PayloadTooLargeError('Sample file exceeds 1 MB', 'PAYLOAD_TOO_LARGE');
    }
    try {
      return JSON.parse(await readFile(full, 'utf8')) as unknown;
    } catch {
      throw new ValidationError('Sample file is not valid JSON', undefined, 'INVALID_JSON');
    }
  }
}
