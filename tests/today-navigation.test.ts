import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('stage B navigation and capture', () => {
  it('uses two destinations and a non-destination quick capture action', () => {
    const html = readFileSync('index.html', 'utf8');

    expect(html.match(/class="tab tab-destination"/g)).toHaveLength(2);
    expect(html).toContain('id="global-capture"');
    expect(html).toContain('<em>记一句</em>');
    expect(html).toContain('<em>表达库</em>');
    expect(html).not.toContain('data-route="compress" class="tab"');
    expect(html).not.toContain('data-route="preflight" class="tab"');
  });

  it('keeps both practice modes inside today and removes the inline capture box', () => {
    const views = readFileSync('js/views.js', 'utf8');
    const home = views.slice(
      views.indexOf('export function viewHome'),
      views.indexOf('/* ---------------------------------------------------------------- 收编 */'),
    );

    expect(views).toContain('data-today-mode="review"');
    expect(views).toContain('data-today-mode="recommendation"');
    expect(home).toContain('createReviewGroup');
    expect(home).not.toContain('quick-capture-input');
    expect(home).not.toContain('常用工具');
    expect(home).not.toContain('最近添加');
  });

  it('keeps legacy tools reachable from the expression library first screen', () => {
    const views = readFileSync('js/views2.js', 'utf8');
    const library = views.slice(
      views.indexOf('export function viewLibrary'),
      views.indexOf('/* ---------------------------------------------------------------- 画像 */'),
    );

    expect(library).toContain('data-nav="compress"');
    expect(library).toContain('data-nav="preflight"');
    expect(library.indexOf('library-tools')).toBeLessThan(
      library.indexOf('class="seg"'),
    );
  });
});
