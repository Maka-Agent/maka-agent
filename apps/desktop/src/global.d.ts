import type {
  ConnectionEvent,
  ConnectionTestResult,
  CreateConnectionInput,
  LlmConnection,
  ModelInfo,
  PermissionResponse,
  SessionCommand,
  SessionEvent,
  SessionListFilter,
  SessionSummary,
  StoredMessage,
  UpdateConnectionInput,
} from '@maka/core';
import type { CreateSessionInput } from '@maka/core';

declare global {
  interface Window {
    maka: {
      sessions: {
        list(filter?: SessionListFilter): Promise<SessionSummary[]>;
        create(input?: Partial<CreateSessionInput>): Promise<SessionSummary>;
        send(sessionId: string, command: SessionCommand): Promise<void>;
        stop(sessionId: string): Promise<void>;
        readMessages(sessionId: string): Promise<StoredMessage[]>;
        respondToPermission(sessionId: string, response: PermissionResponse): Promise<void>;
        subscribeEvents(sessionId: string, handler: (event: SessionEvent) => void): () => void;
      };
      connections: {
        list(): Promise<LlmConnection[]>;
        getDefault(): Promise<string | null>;
        setDefault(slug: string | null): Promise<void>;
        create(input: CreateConnectionInput): Promise<LlmConnection>;
        update(slug: string, patch: UpdateConnectionInput): Promise<LlmConnection>;
        delete(slug: string): Promise<void>;
        test(slug: string, opts?: { model?: string }): Promise<ConnectionTestResult>;
        fetchModels(slug: string): Promise<ModelInfo[]>;
        hasSecret(slug: string): Promise<boolean>;
        subscribeEvents(handler: (event: ConnectionEvent) => void): () => void;
      };
      appWindow: {
        subscribeOpenSettings(handler: () => void): () => void;
      };
    };
  }
}

export {};
