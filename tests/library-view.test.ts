import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('stage C library and tool restoration', () => {
  const librarySource = readFileSync('js/views2.js', 'utf8');
  const captureSource = readFileSync('js/views.js', 'utf8');

  it('keeps search, content sections, tools, and the current list in the intended order', () => {
    const library = librarySource.slice(
      librarySource.indexOf('export function viewLibrary'),
      librarySource.indexOf('/* ---------------------------------------------------------------- 画像 */'),
    );

    expect(library.indexOf('library-search')).toBeLessThan(
      library.indexOf('library-sections'),
    );
    expect(library.indexOf('library-sections')).toBeLessThan(
      library.indexOf('library-tools'),
    );
    expect(library.indexOf('library-tools')).toBeLessThan(
      library.indexOf('library-list'),
    );
    expect(library).toContain('学习记录');
    expect(library).toContain('library-kind-filter');
    expect(library).toContain("['term', `词汇 ${termCount}`]");
    expect(library).toContain('专业词汇');
    expect(library).toContain('待查看');
    expect(library).toContain('已处理');
  });

  it('offers record organization, compression, preservation, and deletion', () => {
    expect(librarySource).toContain('data-record-action="open"');
    expect(librarySource).toContain('data-record-action="compress"');
    expect(librarySource).toContain('data-record-action="keep"');
    expect(librarySource).toContain('data-record-action="delete"');
    expect(captureSource).toContain('S.markFlashHandled(pendingFlashId');
    expect(captureSource).not.toContain('S.dropFlash(pendingFlashId)');
    expect(captureSource).toContain("pendingStatus === 'analyzing'");
    expect(captureSource).toContain('正在后台整理，稍后回来查看');
  });

  it('restores completed tool results instead of automatically requesting again', () => {
    expect(librarySource).toContain("task.status === 'ready'");
    expect(librarySource).toContain("S.completeToolTask('compression'");
    expect(librarySource).toContain("S.completeToolTask('preflight'");
    expect(librarySource).toContain("task.status === 'interrupted'");
  });
});
