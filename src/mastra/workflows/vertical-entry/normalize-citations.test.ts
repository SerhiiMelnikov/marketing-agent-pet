import { describe, it, expect } from 'vitest';
import { normalizeCitations } from './normalize-citations';

describe('normalizeCitations', () => {
  it('converts a daggered native marker to [N]', () => {
    expect(normalizeCitations('foo 【1†Source title】 bar')).toBe('foo [1] bar');
  });

  it('converts a double-dagger variant to [N]', () => {
    expect(normalizeCitations('【10‡Other】')).toBe('[10]');
  });

  it('converts a bare CJK-bracket marker to [N]', () => {
    expect(normalizeCitations('x 【2】 y')).toBe('x [2] y');
  });

  it('handles adjacent markers', () => {
    expect(normalizeCitations('a 【1】【2】 b')).toBe('a [1][2] b');
  });

  it('strips stray fullwidth brackets', () => {
    expect(normalizeCitations('stray 【 and 】 brackets')).toBe('stray  and  brackets');
  });

  it('leaves existing [N] citations untouched', () => {
    expect(normalizeCitations('clean [3] already')).toBe('clean [3] already');
  });

  it('normalizes a marker with internal whitespace', () => {
    expect(normalizeCitations('x 【 1 】 y')).toBe('x [1] y');
  });
});
