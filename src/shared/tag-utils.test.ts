import type { SharedConfig } from './types.js';
import { collectTagReferences, removeTagFromSharedConfig } from './tag-utils.js';

describe('tag-utils', () => {
  test('collectTagReferences 应该列出引用标签的项目和标签组', () => {
    const config = {
      projects: [
        { id: 'p1', name: 'alpha', tags: ['electron', 'desktop'] },
        { id: 'p2', name: 'beta', tags: ['desktop'] },
        { id: 'p3', name: 'gamma', tags: ['cli'] },
      ],
      tagGroups: [
        { name: '桌面端', tags: ['electron', 'desktop'] },
        { name: '命令行', tags: ['cli'] },
      ],
    };

    expect(collectTagReferences(config, 'desktop')).toEqual({
      projects: [
        { id: 'p1', name: 'alpha' },
        { id: 'p2', name: 'beta' },
      ],
      tagGroups: [{ name: '桌面端' }],
    });
  });

  test('removeTagFromSharedConfig 应该移除项目和标签组中的标签引用', () => {
    const shared: SharedConfig = {
      version: 2,
      name: 'fm',
      ignore: { respectGitignore: true, globs: [] },
      tags: [
        { name: 'electron', color: '#60a5fa' },
        { name: 'desktop', color: '#34d399' },
      ],
      projects: [
        {
          id: 'p1',
          name: 'alpha',
          tags: ['electron', 'desktop'],
          ignore: [],
          fingerprint: { kind: 'folder-name', folderName: 'alpha' },
        },
        {
          id: 'p2',
          name: 'beta',
          tags: ['desktop'],
          ignore: [],
          fingerprint: { kind: 'folder-name', folderName: 'beta' },
        },
      ],
      tagGroups: [
        { name: '桌面端', tags: ['electron', 'desktop'] },
        { name: '仅桌面', tags: ['desktop'] },
      ],
    };

    expect(removeTagFromSharedConfig(shared, 'desktop')).toEqual({
      ...shared,
      tags: [{ name: 'electron', color: '#60a5fa' }],
      projects: [
        {
          id: 'p1',
          name: 'alpha',
          tags: ['electron'],
          ignore: [],
          fingerprint: { kind: 'folder-name', folderName: 'alpha' },
        },
        {
          id: 'p2',
          name: 'beta',
          tags: [],
          ignore: [],
          fingerprint: { kind: 'folder-name', folderName: 'beta' },
        },
      ],
      tagGroups: [{ name: '桌面端', tags: ['electron'] }],
    });
  });
});