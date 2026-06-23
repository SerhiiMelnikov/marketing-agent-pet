import { describe, it, expect } from 'vitest';
import { detectBlock } from './detect-block';
import { BlockReason } from './enums/block-reason.enum';

describe('detectBlock', () => {
  it('flags a login wall in the title', () => {
    const b = detectBlock('Sign in to continue', 'short body');

    expect(b?.reason).toBe(BlockReason.LoginWall);
    expect(b?.signal).toContain('title:');
  });

  it('flags a captcha signal in a short body', () => {
    const b = detectBlock('Some page', 'Please verify you are human to proceed.');

    expect(b?.reason).toBe(BlockReason.Captcha);
  });

  it('flags a paywall signal in a short body', () => {
    const b = detectBlock('Article', 'Subscribe to read the rest of this story.');

    expect(b?.reason).toBe(BlockReason.PayWall);
  });

  it('does NOT flag a body signal inside a long article (length gate)', () => {
    const longBody = 'word '.repeat(400) + ' please sign in for our newsletter'; // > 1200 chars
    expect(longBody.length).toBeGreaterThan(1200);
    expect(detectBlock('A real healthcare article', longBody)).toBeUndefined();
  });

  it('returns undefined for a clean page', () => {
    expect(detectBlock('Healthcare IT trends', 'A normal article body with real content.')).toBeUndefined();
  });
});
