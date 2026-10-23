import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Finds `relative` in the nearest ancestor of `fromDir` (inclusive). Works both from
 * `src/**` (tsx, host mode) and from the bundled `dist/` (containers).
 */
export const findUp = (relative: string, fromDir: string, maxLevels = 8): string | undefined => {
  let dir = fromDir;
  for (let level = 0; level <= maxLevels; level += 1) {
    const candidate = path.join(dir, relative);
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
};
