import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { FixedPromptTask } from '../fixed-prompt-controller.js';
import {
  filterPromptAbCandidateTasksByMetadata,
  limitPromptAbCandidateTasks,
} from '../prompt-ab-selection.js';

describe('filterPromptAbCandidateTasksByMetadata', () => {
  test('keeps only tasks whose expert estimate fits the short-horizon slice', () => {
    const result = filterPromptAbCandidateTasksByMetadata({
      tasks: [
        { id: 'short', path: '/tasks/short', metadata: { expertTimeEstimateMin: 20 } },
        { id: 'long', path: '/tasks/long', metadata: { expertTimeEstimateMin: 60 } },
        { id: 'unknown', path: '/tasks/unknown' },
      ],
      maxExpertTimeEstimateMin: 30,
    });

    assert.deepEqual(result.selectedTaskIds, ['short']);
    assert.deepEqual(result.rejected.longExpertEstimateTaskIds, ['long']);
    assert.deepEqual(result.rejected.missingExpertEstimateTaskIds, ['unknown']);
  });
});

describe('limitPromptAbCandidateTasks', () => {
  test('keeps every metadata-filtered task unless a limit is explicit', () => {
    const tasks: FixedPromptTask[] = Array.from({ length: 61 }, (_, index) => ({
      id: `task-${index}`,
      path: `/tasks/task-${index}`,
    }));

    const unlimited = limitPromptAbCandidateTasks(tasks, undefined);
    assert.equal(unlimited.limit, null);
    assert.equal(unlimited.inputTaskCount, 61);
    assert.equal(unlimited.selectedTasks.length, 61);
    assert.deepEqual(unlimited.truncatedTaskIds, []);

    const limited = limitPromptAbCandidateTasks(tasks, 60);
    assert.equal(limited.limit, 60);
    assert.equal(limited.selectedTasks.length, 60);
    assert.deepEqual(limited.truncatedTaskIds, ['task-60']);
  });
});
