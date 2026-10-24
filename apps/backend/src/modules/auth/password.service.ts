import argon2 from 'argon2';

/** argon2id with the OWASP-recommended minimum parameters (§12.5, A1). */
const HASH_OPTIONS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export class PasswordService {
  private dummyHash: Promise<string> | undefined;

  hash(password: string): Promise<string> {
    return argon2.hash(password, HASH_OPTIONS);
  }

  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      // Malformed hash: treat as a failed verification, never as a crash.
      return false;
    }
  }

  /**
   * Burns the same CPU time as a real verification when the email is unknown, so response
   * timing does not reveal whether an account exists (A3).
   */
  async verifyDummy(password: string): Promise<false> {
    this.dummyHash ??= this.hash('dummy-password-for-timing-equalisation');
    await this.verify(await this.dummyHash, password);
    return false;
  }

  /** Precompute the dummy hash at startup so the first unknown-email login is not faster. */
  async warmUp(): Promise<void> {
    this.dummyHash ??= this.hash('dummy-password-for-timing-equalisation');
    await this.dummyHash;
  }
}
