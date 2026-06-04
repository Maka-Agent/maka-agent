import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it } from 'node:test';

describe('session row actions fail soft', () => {
  it('surfaces sidebar session action failures instead of leaving fire-and-forget rejections', async () => {
    const main = await readFile(join(process.cwd(), 'src/renderer/main.tsx'), 'utf8');
    const flagSession = main.match(/async function flagSession\(sessionId: string, flagged: boolean\) \{[\s\S]*?\n  \}/)?.[0] ?? '';
    const archiveSession = main.match(/async function archiveSession\(sessionId: string\) \{[\s\S]*?\n  \}/)?.[0] ?? '';
    const unarchiveSession = main.match(/async function unarchiveSession\(sessionId: string\) \{[\s\S]*?\n  \}/)?.[0] ?? '';
    const renameSession = main.match(/async function renameSession\(sessionId: string, name: string\) \{[\s\S]*?\n  \}/)?.[0] ?? '';
    const deleteSession = main.match(/async function deleteSession\(sessionId: string\) \{[\s\S]*?async function refreshConnections/)?.[0] ?? '';

    assert.match(flagSession, /try \{[\s\S]*window\.maka\.sessions\.setFlagged\(sessionId, flagged\)[\s\S]*refreshSessions\(\)[\s\S]*\} catch \(error\) \{[\s\S]*toastApi\.error\(flagged \? '标记会话失败' : '取消标记失败', cleanErrorMessage\(error\)\)/);
    assert.match(archiveSession, /try \{[\s\S]*window\.maka\.sessions\.archive\(sessionId\)[\s\S]*activeIdRef\.current === sessionId[\s\S]*setActiveId\(undefined\)[\s\S]*setMessages\(\[\]\)[\s\S]*refreshSessions\(\)[\s\S]*\} catch \(error\) \{[\s\S]*toastApi\.error\('归档会话失败', cleanErrorMessage\(error\)\)/);
    assert.match(unarchiveSession, /try \{[\s\S]*window\.maka\.sessions\.unarchive\(sessionId\)[\s\S]*refreshSessions\(\)[\s\S]*\} catch \(error\) \{[\s\S]*toastApi\.error\('恢复会话失败', cleanErrorMessage\(error\)\)/);
    assert.match(renameSession, /try \{[\s\S]*window\.maka\.sessions\.rename\(sessionId, name\)[\s\S]*refreshSessions\(\)[\s\S]*\} catch \(error\) \{[\s\S]*toastApi\.error\('重命名会话失败', cleanErrorMessage\(error\)\)/);
    assert.match(deleteSession, /try \{[\s\S]*window\.maka\.sessions\.remove\(sessionId\)[\s\S]*activeIdRef\.current === sessionId[\s\S]*setActiveId\(undefined\)[\s\S]*setMessages\(\[\]\)[\s\S]*refreshSessions\(\)[\s\S]*toastApi\.success\(`已删除 \$\{name\}`\)[\s\S]*\} catch \(error\) \{[\s\S]*toastApi\.error\('删除会话失败', cleanErrorMessage\(error\)\)/);
  });
});
