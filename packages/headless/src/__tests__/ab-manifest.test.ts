import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildAbRunManifest } from '../ab-manifest.js';
import { sha256 } from './helpers/hash-fixture.js';

describe('buildAbRunManifest', () => {
  test('records generic A/B arm identities for non-prompt experiments', () => {
    const manifest = buildAbRunManifest({
      experimentKind: 'tools',
      arms: [
        {
          id: 'tools-off',
          kind: 'tools',
          fingerprint: sha256('tools-off'),
          metadata: { toolProfile: 'standard' },
        },
        {
          id: 'tools-on',
          kind: 'tools',
          fingerprint: sha256('tools-on'),
          metadata: { toolProfile: 'standard-plus-new-tool' },
        },
      ],
      taskBudgetSec: 30 * 60,
      harborTimeoutMs: 35 * 60 * 1000,
      subjectFingerprint: 'subject:path=/repo;maka-head=abc123;dirty=false',
      taskSourceFingerprint: 'tasks:path=/cache/tasks;selected=task-a:/cache/tasks/a',
      toolchainFingerprint: sha256('c'),
      evaluationTaskIds: ['task-a'],
      reps: 3,
      candidateLimit: null,
      maxConcurrency: 16,
    });

    assert.equal(manifest.experimentKind, 'tools');
    assert.deepEqual(manifest.arms.map((arm) => `${arm.kind}:${arm.id}`), [
      'tools:tools-off',
      'tools:tools-on',
    ]);
    assert.match(manifest.fingerprint, /^sha256:[a-f0-9]{64}$/);
  });
});
