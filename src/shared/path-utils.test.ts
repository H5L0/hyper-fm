import { describe, expect, test } from 'vitest';
import {
  basename,
  joinPosix,
  normalizePath,
  pathEquals,
  toPosix,
  trimTrailingSlash,
} from './path-utils.js';

describe('path-utils', () => {
  test('[toPosix] 反斜杠应转为正斜杠', () => {
    expect(toPosix('D:\\projects\\fm')).toBe('D:/projects/fm');
  });

  test('[trimTrailingSlash] 末尾斜杠应被去除', () => {
    expect(trimTrailingSlash('D:/projects/')).toBe('D:/projects');
    expect(trimTrailingSlash('/')).toBe('/');
  });

  test('[normalizePath] 应同时处理分隔符与尾斜杠', () => {
    expect(normalizePath('D:\\projects\\fm\\')).toBe('D:/projects/fm');
  });

  test('[pathEquals] win32 平台应忽略大小写', () => {
    expect(pathEquals('D:\\Projects\\FM', 'd:/projects/fm', 'win32')).toBe(true);
    expect(pathEquals('/usr/local', '/USR/LOCAL', 'linux')).toBe(false);
  });

  test('[basename] 应返回最后一段', () => {
    expect(basename('D:/projects/fm')).toBe('fm');
    expect(basename('D:/projects/fm/')).toBe('fm');
    expect(basename('fm')).toBe('fm');
  });

  test('[joinPosix] 应跳过空字符串并规范化', () => {
    expect(joinPosix('D:/projects', '', 'fm/')).toBe('D:/projects/fm');
  });
});
