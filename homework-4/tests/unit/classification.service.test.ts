import { describe, it, expect } from 'vitest';
import { classificationService } from '../../src/services/classification.service.js';

describe('ClassificationService', () => {
  it('classify returns bounded confidence and merged keywords', () => {
    const r = classificationService.classify('login password critical production down');
    expect(r.category).toBeDefined();
    expect(r.priority).toBeDefined();
    expect(r.confidence).toBeGreaterThanOrEqual(0);
    expect(r.confidence).toBeLessThanOrEqual(1);
    expect(Array.isArray(r.keywords)).toBe(true);
    expect(r.reasoning.length).toBeGreaterThan(0);
  });

  it('classify handles text with no strong signals', () => {
    const r = classificationService.classify('hello world');
    expect(r.category).toBeDefined();
    expect(r.priority).toBeDefined();
  });
});
