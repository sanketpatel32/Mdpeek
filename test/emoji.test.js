import { describe, it, expect } from 'vitest';
import { replaceEmojis, hasEmoji, EMOJI_COUNT, markedEmojiExt } from '../src/lib/emoji.js';

describe('replaceEmojis', () => {
  it('replaces a known shortcode with the emoji', () => {
    expect(replaceEmojis('hello :smile: world')).toBe('hello 😄 world');
  });

  it('leaves unknown shortcodes untouched', () => {
    expect(replaceEmojis('see :not_a_real_emoji: here')).toBe('see :not_a_real_emoji: here');
  });

  it('handles multiple shortcodes in one string', () => {
    expect(replaceEmojis(':thumbsup: and :heart:')).toBe('👍 and ❤️');
  });

  it('accepts +1 / -1 shortcodes (special names)', () => {
    expect(replaceEmojis(':+1: :-1:')).toBe('👍 👎');
  });

  it('does not match colons in URLs', () => {
    expect(replaceEmojis('see https://example.com:8080/x')).toBe('see https://example.com:8080/x');
  });

  it('does not match times like 12:30', () => {
    expect(replaceEmojis('meet at 12:30 sharp')).toBe('meet at 12:30 sharp');
  });

  it('does not match wiki-link-style colons ([[Page:Section]])', () => {
    expect(replaceEmojis('[[Notes:Chapter 1]]')).toBe('[[Notes:Chapter 1]]');
  });

  it('does not match adjacent :: (wiki-links / flashcards)', () => {
    // The existing flashcard feature uses ::card:: syntax — must survive.
    expect(replaceEmojis('::card::')).toBe('::card::');
  });

  it('early-exits unchanged when there is no colon', () => {
    expect(replaceEmojis('no colons here at all')).toBe('no colons here at all');
  });

  it('handles null / empty input', () => {
    expect(replaceEmojis('')).toBe('');
    expect(replaceEmojis(null)).toBe(null);
    expect(replaceEmojis(undefined)).toBe(undefined);
  });

  it('replaces a shortcode at the start and end of the string', () => {
    expect(replaceEmojis(':smile: lead')).toBe('😄 lead');
    expect(replaceEmojis('trailing :tada:')).toBe('trailing 🎉');
  });
});

describe('hasEmoji', () => {
  it('returns true for known shortcodes', () => {
    expect(hasEmoji('smile')).toBe(true);
    expect(hasEmoji('heart')).toBe(true);
    expect(hasEmoji('+1')).toBe(true);
  });

  it('returns false for unknown shortcodes', () => {
    expect(hasEmoji('not_real')).toBe(false);
    expect(hasEmoji('')).toBe(false);
  });
});

describe('EMOJI_COUNT', () => {
  it('exposes a non-trivial curated set (> 100 entries)', () => {
    expect(EMOJI_COUNT).toBeGreaterThan(100);
  });
});

describe('markedEmojiExt', () => {
  it('returns a marked extension object with a text renderer', () => {
    const ext = markedEmojiExt();
    expect(ext.async).toBe(false);
    expect(typeof ext.renderer.text).toBe('function');
  });

  it('the renderer replaces shortcodes in the token text', () => {
    const ext = markedEmojiExt();
    const out = ext.renderer.text({ text: ':smile:' });
    expect(out).toBe('😄');
  });

  it('the renderer leaves plain text alone', () => {
    const ext = markedEmojiExt();
    const out = ext.renderer.text({ text: 'no shortcodes' });
    expect(out).toBe('no shortcodes');
  });
});
