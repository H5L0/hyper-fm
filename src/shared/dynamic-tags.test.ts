import {
  countProjectsForDynamicTag,
  countProjectsForTagGroup,
  ensureRequiredTagGroups,
  FAVORITE_TAG_GROUP_NAME,
  getDynamicTagDefinition,
  isRequiredTagGroupName,
  isDynamicTagLabel,
  matchesTagGroup,
  matchesDynamicTag,
} from './dynamic-tags.js';

describe('dynamic-tags', () => {
  const NOW = Date.parse('2026-05-09T12:00:00.000Z');

  test('matchesDynamicTag 应该按最近一月判断修改时间', () => {
    expect(matchesDynamicTag({ modifiedAt: '2026-04-10T12:00:00.000Z' }, 'recent-month', NOW)).toBe(true);
    expect(matchesDynamicTag({ modifiedAt: '2026-04-09T11:59:59.999Z' }, 'recent-month', NOW)).toBe(false);
  });

  test('matchesDynamicTag 应该忽略未来时间与非法时间', () => {
    expect(matchesDynamicTag({ modifiedAt: '2026-05-10T12:00:00.000Z' }, 'recent-year', NOW)).toBe(false);
    expect(matchesDynamicTag({ modifiedAt: 'not-a-date' }, 'recent-year', NOW)).toBe(false);
    expect(matchesDynamicTag({}, 'recent-year', NOW)).toBe(false);
  });

  test('countProjectsForDynamicTag 应该统计命中的项目数量', () => {
    expect(countProjectsForDynamicTag([
      { modifiedAt: '2026-05-01T12:00:00.000Z' },
      { modifiedAt: '2025-08-01T12:00:00.000Z' },
      { modifiedAt: '2024-08-01T12:00:00.000Z' },
      { modifiedAt: undefined },
    ], 'recent-year', NOW)).toBe(2);
  });

  test('matchesTagGroup 应该同时支持普通标签与动态标签', () => {
    expect(matchesTagGroup({
      tags: ['electron', 'react'],
      modifiedAt: '2026-04-20T12:00:00.000Z',
    }, ['electron', '最近一年'], NOW)).toBe(true);

    expect(matchesTagGroup({
      tags: ['electron', 'react'],
      modifiedAt: '2024-04-20T12:00:00.000Z',
    }, ['electron', '最近一年'], NOW)).toBe(false);

    expect(matchesTagGroup({
      tags: ['react'],
      modifiedAt: '2026-04-20T12:00:00.000Z',
    }, ['electron', '最近一年'], NOW)).toBe(false);
  });

  test('countProjectsForTagGroup 应该统计包含动态标签条件的标签组', () => {
    expect(countProjectsForTagGroup([
      { tags: ['electron'], modifiedAt: '2026-04-20T12:00:00.000Z' },
      { tags: ['electron'], modifiedAt: '2024-04-20T12:00:00.000Z' },
      { tags: ['react'], modifiedAt: '2026-04-20T12:00:00.000Z' },
    ], ['electron', '最近一年'], NOW)).toBe(1);
  });

  test('ensureRequiredTagGroups 应该在缺少收藏时虚拟补上', () => {
    expect(ensureRequiredTagGroups([{ name: '桌面工具', tags: ['electron'] }])).toEqual([
      { name: FAVORITE_TAG_GROUP_NAME, tags: ['最近一月'] },
      { name: '桌面工具', tags: ['electron'] },
    ]);
  });

  test('isRequiredTagGroupName 应该识别系统必备标签组', () => {
    expect(isRequiredTagGroupName(FAVORITE_TAG_GROUP_NAME)).toBe(true);
    expect(isRequiredTagGroupName('桌面工具')).toBe(false);
  });

  test('isDynamicTagLabel 应该识别系统内置动态标签', () => {
    expect(isDynamicTagLabel(getDynamicTagDefinition('recent-month').label)).toBe(true);
    expect(isDynamicTagLabel('electron')).toBe(false);
  });
});