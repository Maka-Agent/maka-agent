import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { formatRedactedJson } from '@maka/ui';

describe('tool and permission args redaction', () => {
  it('redacts JSON-shaped args before they are rendered', () => {
    const rendered = formatRedactedJson({
      command: 'curl -H "Authorization: Bearer sk-live-secret-token" https://example.test',
      nested: { apiKey: 'sk-ant-test-secret-token-12345' },
    });

    assert.doesNotMatch(rendered, /sk-live-secret-token/);
    assert.doesNotMatch(rendered, /sk-ant-test-secret-token-12345/);
    assert.match(rendered, /Authorization: Bearer/);
    assert.match(rendered, /command/);
  });

  it('routes ToolActivity and PermissionDialog args through formatRedactedJson', async () => {
    const source = await readFile(join(process.cwd(), '../../packages/ui/src/components.tsx'), 'utf8');
    const toolActivity = source.match(/export function ToolActivity[\s\S]*?function ToolOutputStream/)?.[0] ?? '';
    const permissionDialog = source.match(/export function PermissionDialog[\s\S]*?function renderPermissionSummary/)?.[0] ?? '';

    assert.match(toolActivity, /\{formatRedactedJson\(item\.args\)\}/);
    assert.doesNotMatch(toolActivity, /JSON\.stringify\(item\.args/);
    assert.match(permissionDialog, /\{formatRedactedJson\(props\.request\.args\)\}/);
    assert.doesNotMatch(permissionDialog, /JSON\.stringify\(props\.request\.args/);
  });
});
