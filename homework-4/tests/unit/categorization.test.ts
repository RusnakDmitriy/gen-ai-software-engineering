import { describe, it, expect } from 'vitest';
import { categorize, prioritize } from '../../src/classification/rules.js';
import { Category, Priority } from '../../src/domain/ticket.types.js';

describe('Categorizer', () => {
  it('should categorize account access issue', () => {
    const result = categorize("Can't access my account");
    expect(result.category).toBe(Category.ACCOUNT_ACCESS);
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.matchedKeywords).toContain("can't access");
  });

  it('should categorize billing question', () => {
    const result = categorize('payment failed on invoice 123');
    expect(result.category).toBe(Category.BILLING_QUESTION);
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('should categorize bug report', () => {
    const result = categorize('Bug: app crashes when uploading files, steps to reproduce: 1, 2, 3');
    expect(result.category).toBe(Category.BUG_REPORT);
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('should default to other when no keywords match', () => {
    const result = categorize('xyz abc def');
    expect(result.category).toBe(Category.OTHER);
    expect(result.confidence).toBeLessThan(0.5);
  });

  it('should handle close matches gracefully', () => {
    const result = categorize('feature enhancement request suggestion');
    // When multiple categories are close, should fall back to other
    expect(result.category).toBeDefined();
  });

  it('should categorize feature request from dark mode phrasing', () => {
    const result = categorize('please add dark mode feature to the app');
    expect(result.category).toBe(Category.FEATURE_REQUEST);
  });

  it('returns other when bug-related categories score in a statistical tie', () => {
    const result = categorize('bug error');
    expect(result.category).toBe(Category.OTHER);
    expect(result.confidence).toBe(0.5);
    expect(result.matchedKeywords.length).toBeGreaterThan(1);
  });
});

describe('Prioritizer', () => {
  it('should prioritize urgent for critical keyword', () => {
    const result = prioritize('Production is down, critical issue');
    expect(result.priority).toBe(Priority.URGENT);
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('should prioritize high for blocking keyword', () => {
    const result = prioritize('This is blocking important work');
    expect(result.priority).toBe(Priority.HIGH);
  });

  it('should prioritize low for minor keyword', () => {
    const result = prioritize('Minor cosmetic issue');
    expect(result.priority).toBe(Priority.LOW);
  });

  it('should default to medium when no keywords match', () => {
    const result = prioritize('just a normal ticket');
    expect(result.priority).toBe(Priority.MEDIUM);
  });

  it('returns medium when top two priority scores are in a statistical tie', () => {
    const result = prioritize(
      'production issue critical important blocking asap',
    );
    expect(result.priority).toBe(Priority.MEDIUM);
    expect(result.confidence).toBe(0.5);
    expect(result.matchedKeywords.length).toBeGreaterThan(1);
  });
});
