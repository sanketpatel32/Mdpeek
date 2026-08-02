import { describe, it, expect } from 'vitest';
import { classifyPasswordError } from '../src/lib/pdf-auth.js';

describe('classifyPasswordError', () => {
  it('returns "need" for a NEED_PASSWORD PasswordException (code 1)', () => {
    expect(classifyPasswordError({ name: 'PasswordException', code: 1 })).toBe('need');
  });

  it('returns "incorrect" for an INCORRECT_PASSWORD PasswordException (code 2)', () => {
    expect(classifyPasswordError({ name: 'PasswordException', code: 2 })).toBe('incorrect');
  });

  it('returns "need" for a PasswordException with an unknown code', () => {
    // Unknown code → fall back to "need" so the prompt still shows.
    expect(classifyPasswordError({ name: 'PasswordException', code: 99 })).toBe('need');
    expect(classifyPasswordError({ name: 'PasswordException' })).toBe('need');
  });

  it('returns null for non-password pdf.js errors', () => {
    expect(classifyPasswordError({ name: 'InvalidPDFException', code: 1 })).toBeNull();
    expect(classifyPasswordError({ name: 'UnknownErrorException', code: 0 })).toBeNull();
    expect(classifyPasswordError(new Error('network failure'))).toBeNull();
  });

  it('returns null for falsy / malformed input (never throws)', () => {
    expect(classifyPasswordError(null)).toBeNull();
    expect(classifyPasswordError(undefined)).toBeNull();
    expect(classifyPasswordError('string error')).toBeNull();
    expect(classifyPasswordError({})).toBeNull();
  });

  it('does not treat a code of 1/2 alone as a password error without the name', () => {
    // The name must be 'PasswordException'; a generic error with code 1 isn't one.
    expect(classifyPasswordError({ name: 'TypeError', code: 1 })).toBeNull();
    expect(classifyPasswordError({ code: 2 })).toBeNull();
  });
});
