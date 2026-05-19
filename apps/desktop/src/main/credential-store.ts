import { safeStorage } from 'electron';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

type StoredCredentialKind = 'apiKey' | 'oauthToken';
export type CredentialKind = 'api_key' | 'oauth_token';

interface CredentialFile {
  values: Record<string, string>;
}

export interface CredentialStore {
  getSecret(slug: string, kind: CredentialKind): Promise<string | null>;
  setSecret(slug: string, kind: CredentialKind, value: string): Promise<void>;
  deleteSecret(slug: string, kind?: CredentialKind): Promise<void>;
  getApiKey(slug: string): Promise<string | null>;
  getOAuthToken(slug: string): Promise<string | null>;
  setApiKey(slug: string, apiKey: string): Promise<void>;
  setOAuthToken(slug: string, token: string): Promise<void>;
  delete(slug: string): Promise<void>;
}

export function createSafeStorageCredentialStore(workspaceRoot: string): CredentialStore {
  return new SafeStorageCredentialStore(join(workspaceRoot, 'credentials.json'));
}

class SafeStorageCredentialStore implements CredentialStore {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly path: string) {}

  getSecret(slug: string, kind: CredentialKind): Promise<string | null> {
    return this.get(slug, toStoredKind(kind));
  }

  setSecret(slug: string, kind: CredentialKind, value: string): Promise<void> {
    return this.set(slug, toStoredKind(kind), value);
  }

  async deleteSecret(slug: string, kind?: CredentialKind): Promise<void> {
    if (!kind) {
      await this.delete(slug);
      return;
    }
    await this.withQueue(async () => {
      const file = await this.readUnlocked();
      delete file.values[this.key(slug, toStoredKind(kind))];
      await this.write(file);
    });
  }

  getApiKey(slug: string): Promise<string | null> {
    return this.get(slug, 'apiKey');
  }

  getOAuthToken(slug: string): Promise<string | null> {
    return this.get(slug, 'oauthToken');
  }

  setApiKey(slug: string, apiKey: string): Promise<void> {
    return this.set(slug, 'apiKey', apiKey);
  }

  setOAuthToken(slug: string, token: string): Promise<void> {
    return this.set(slug, 'oauthToken', token);
  }

  async delete(slug: string): Promise<void> {
    await this.withQueue(async () => {
      const file = await this.readUnlocked();
      delete file.values[this.key(slug, 'apiKey')];
      delete file.values[this.key(slug, 'oauthToken')];
      await this.write(file);
    });
  }

  private async get(slug: string, kind: StoredCredentialKind): Promise<string | null> {
    const encrypted = (await this.readUnlocked()).values[this.key(slug, kind)];
    if (!encrypted) return null;
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
  }

  private async set(slug: string, kind: StoredCredentialKind, value: string): Promise<void> {
    await this.withQueue(async () => {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('Electron safeStorage encryption is not available on this system.');
      }
      const file = await this.readUnlocked();
      file.values[this.key(slug, kind)] = safeStorage.encryptString(value).toString('base64');
      await this.write(file);
    });
  }

  private key(slug: string, kind: StoredCredentialKind): string {
    return `${slug}:${kind}`;
  }

  private async readUnlocked(): Promise<CredentialFile> {
    try {
      return JSON.parse(await readFile(this.path, 'utf8')) as CredentialFile;
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') return { values: {} };
      throw error;
    }
  }

  private async write(file: CredentialFile): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const tempPath = `${this.path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, JSON.stringify(file, null, 2) + '\n', 'utf8');
    await rename(tempPath, this.path);
  }

  private withQueue(operation: () => Promise<void>): Promise<void> {
    const next = this.queue.then(operation, operation);
    this.queue = next.catch(() => {});
    return next;
  }
}

function toStoredKind(kind: CredentialKind): StoredCredentialKind {
  return kind === 'api_key' ? 'apiKey' : 'oauthToken';
}
