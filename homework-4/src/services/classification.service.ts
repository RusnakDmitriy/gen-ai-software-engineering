import { categorize, prioritize } from '../classification/rules.js';
import type { ClassificationResult } from '../domain/ticket.schema.js';

export class ClassificationService {
  classify(text: string): ClassificationResult {
    const categoryResult = categorize(text);
    const priorityResult = prioritize(text);

    const allKeywords = Array.from(
      new Set([...categoryResult.matchedKeywords, ...priorityResult.matchedKeywords]),
    );

    const reasoning =
      categoryResult.category === 'other' && priorityResult.priority === 'medium'
        ? 'No matching keywords found; using defaults'
        : `Matched keywords: ${allKeywords.join(', ')}`;

    return {
      category: categoryResult.category,
      priority: priorityResult.priority,
      confidence: Math.min(categoryResult.confidence, priorityResult.confidence),
      reasoning,
      keywords: allKeywords,
    };
  }
}

export const classificationService = new ClassificationService();
