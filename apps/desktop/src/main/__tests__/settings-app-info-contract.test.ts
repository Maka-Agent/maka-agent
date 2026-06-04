import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const settingsSource = readFileSync(
  join(process.cwd(), 'src/renderer/settings/SettingsModal.tsx'),
  'utf8',
);

function blockBetween(start: string, end: string): string {
  return settingsSource.match(new RegExp(`${start}[\\s\\S]*?${end}`))?.[0] ?? '';
}

describe('Settings app-info loading contract', () => {
  it('does not leave the About page in an endless skeleton when app info fails', () => {
    const aboutBlock = blockBetween('function AboutSettingsPage', 'function SettingsSkeleton');

    assert.match(aboutBlock, /const \[infoError, setInfoError\] = useState<string \| null>\(null\)/);
    assert.match(
      aboutBlock,
      /catch\(\(error\) => \{[\s\S]*const message = settingsActionErrorMessage\(error\);[\s\S]*setInfoError\(message\);[\s\S]*toast\.error\('载入关于信息失败', message\);/,
      'About page app.info failures must be visible to the user',
    );
    assert.match(
      aboutBlock,
      /if \(!info && !infoError\) \{[\s\S]*aria-label="正在加载关于页"/,
      'About page skeleton should only render while no error has occurred',
    );
    assert.match(
      aboutBlock,
      /if \(!info\) \{[\s\S]*role="alert"[\s\S]*无法载入关于信息[\s\S]*\{infoError\}/,
      'About page should render an alert state after app.info fails',
    );
    assert.doesNotMatch(aboutBlock, /catch\(\(\) => \{\}\)/, 'About page must not swallow app.info errors');
  });

  it('surfaces Data page workspace-path load failures instead of showing loading forever', () => {
    const dataBlock = blockBetween('function DataSettingsPage', 'function PersonalizationSettingsPage');

    assert.match(dataBlock, /const \[infoError, setInfoError\] = useState<string \| null>\(null\)/);
    assert.match(
      dataBlock,
      /catch\(\(error\) => \{[\s\S]*const message = settingsActionErrorMessage\(error\);[\s\S]*setInfo\(null\);[\s\S]*setInfoError\(message\);[\s\S]*toast\.error\('载入数据目录失败', message\);/,
      'Data page app.info failures must be visible to the user',
    );
    assert.match(
      dataBlock,
      /value=\{info\?\.workspacePath \?\? \(infoError \? '载入失败' : '正在加载…'\)\}/,
      'Data page should stop presenting the workspace path as still loading after failure',
    );
    assert.match(
      dataBlock,
      /role="alert"[\s\S]*无法载入工作区路径：\{infoError\}/,
      'Data page should render an alert with the workspace-path load failure',
    );
  });
});
