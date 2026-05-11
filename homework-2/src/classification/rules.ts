import { Category, Priority } from '../domain/ticket.types.js';

export interface KeywordRule {
  pattern: RegExp;
  weight: number;
}

export const CATEGORY_RULES: Record<Category, KeywordRule[]> = {
  [Category.ACCOUNT_ACCESS]: [
    { pattern: /\bcan'?t\s+access\b/i, weight: 3 },
    { pattern: /\blogin\b/i, weight: 2 },
    { pattern: /\bpassword\b/i, weight: 2 },
    { pattern: /\b2fa\b/i, weight: 2 },
    { pattern: /\bsign[\s-]?in\b/i, weight: 1 },
    { pattern: /\bsign[\s-]?up\b/i, weight: 1 },
    { pattern: /\bauth\b/i, weight: 1 },
  ],
  [Category.TECHNICAL_ISSUE]: [
    { pattern: /\bbug\b/i, weight: 2 },
    { pattern: /\berror\b/i, weight: 2 },
    { pattern: /\bcrash\b/i, weight: 2 },
    { pattern: /\bfail\b/i, weight: 1 },
    { pattern: /\bbreak\b/i, weight: 1 },
    { pattern: /\bnot\s+work/i, weight: 1 },
  ],
  [Category.BILLING_QUESTION]: [
    { pattern: /\bpayment\b/i, weight: 3 },
    { pattern: /\binvoice\b/i, weight: 3 },
    { pattern: /\brefund\b/i, weight: 3 },
    { pattern: /\bbilling\b/i, weight: 2 },
    { pattern: /\bcharge\b/i, weight: 1 },
    { pattern: /\bsubscription\b/i, weight: 2 },
    { pattern: /\bprice\b/i, weight: 1 },
  ],
  [Category.FEATURE_REQUEST]: [
    { pattern: /\badd\b/i, weight: 1 },
    { pattern: /\bfeature\b/i, weight: 2 },
    { pattern: /\benhanc/i, weight: 2 },
    { pattern: /\bsuggestion\b/i, weight: 2 },
    { pattern: /\bimprov/i, weight: 1 },
    { pattern: /\bwould\s+like\b/i, weight: 1 },
  ],
  [Category.BUG_REPORT]: [
    { pattern: /\bbug\b/i, weight: 3 },
    { pattern: /\bdefect\b/i, weight: 3 },
    { pattern: /\brepro\b/i, weight: 2 },
    { pattern: /\bsteps?\s+to\s+reproduce\b/i, weight: 3 },
    { pattern: /\berror\b/i, weight: 1 },
  ],
  [Category.OTHER]: [],
};

export const PRIORITY_RULES: Record<Priority, KeywordRule[]> = {
  [Priority.URGENT]: [
    { pattern: /\bcan'?t\s+access\b/i, weight: 3 },
    { pattern: /\bcritical\b/i, weight: 3 },
    { pattern: /\bproduction\s+down\b/i, weight: 3 },
    { pattern: /\bproduction\s+issue\b/i, weight: 3 },
    { pattern: /\bsecurity\b/i, weight: 2 },
    { pattern: /\bbreach\b/i, weight: 3 },
    { pattern: /\nemergency\b/i, weight: 3 },
  ],
  [Priority.HIGH]: [
    { pattern: /\bimportant\b/i, weight: 2 },
    { pattern: /\bblocking\b/i, weight: 2 },
    { pattern: /\basap\b/i, weight: 2 },
    { pattern: /\burgent\b/i, weight: 2 },
    { pattern: /\bpriority\b/i, weight: 1 },
  ],
  [Priority.MEDIUM]: [],
  [Priority.LOW]: [
    { pattern: /\bminor\b/i, weight: 2 },
    { pattern: /\bcosmetic\b/i, weight: 2 },
    { pattern: /\bsuggestion\b/i, weight: 1 },
    { pattern: /\bnot\s+urgent\b/i, weight: 1 },
  ],
};

function normalizeText(text: string): string {
  return text.toLowerCase().trim();
}

export interface CategorizeResult {
  category: Category;
  confidence: number;
  matchedKeywords: string[];
}

export function categorize(text: string): CategorizeResult {
  const normalized = normalizeText(text);
  const scores: Record<Category, { weight: number; keywords: string[] }> = {
    [Category.ACCOUNT_ACCESS]: { weight: 0, keywords: [] },
    [Category.TECHNICAL_ISSUE]: { weight: 0, keywords: [] },
    [Category.BILLING_QUESTION]: { weight: 0, keywords: [] },
    [Category.FEATURE_REQUEST]: { weight: 0, keywords: [] },
    [Category.BUG_REPORT]: { weight: 0, keywords: [] },
    [Category.OTHER]: { weight: 0, keywords: [] },
  };

  Object.entries(CATEGORY_RULES).forEach(([category, rules]) => {
    rules.forEach(({ pattern, weight }) => {
      const matches = normalized.match(pattern);
      if (matches) {
        scores[category as Category].weight += weight;
        const matched = matches[0].trim();
        if (!scores[category as Category].keywords.includes(matched)) {
          scores[category as Category].keywords.push(matched);
        }
      }
    });
  });

  const sortedCategories = Object.entries(scores).sort((a, b) => b[1].weight - a[1].weight);

  const topCategory = sortedCategories[0]?.[0] as Category | undefined;
  const topScore = sortedCategories[0]?.[1].weight ?? 0;
  const secondScore = sortedCategories[1]?.[1].weight ?? 0;

  if (!topCategory || topScore === 0) {
    return {
      category: Category.OTHER,
      confidence: 0.3,
      matchedKeywords: [],
    };
  }

  if (secondScore > 0 && Math.abs(topScore - secondScore) / topScore < 0.15) {
    return {
      category: Category.OTHER,
      confidence: 0.5,
      matchedKeywords: [...(sortedCategories[0]?.[1].keywords ?? []), ...(sortedCategories[1]?.[1].keywords ?? [])],
    };
  }

  const totalPossibleWeight = CATEGORY_RULES[topCategory].reduce((sum, r) => sum + r.weight, 0);
  const confidence = Math.min(1.0, totalPossibleWeight > 0 ? topScore / totalPossibleWeight : 0);

  return {
    category: topCategory,
    confidence,
    matchedKeywords: sortedCategories[0]?.[1].keywords ?? [],
  };
}

export interface PrioritizeResult {
  priority: Priority;
  confidence: number;
  matchedKeywords: string[];
}

export function prioritize(text: string): PrioritizeResult {
  const normalized = normalizeText(text);
  const scores: Record<Priority, { weight: number; keywords: string[] }> = {
    [Priority.URGENT]: { weight: 0, keywords: [] },
    [Priority.HIGH]: { weight: 0, keywords: [] },
    [Priority.MEDIUM]: { weight: 0, keywords: [] },
    [Priority.LOW]: { weight: 0, keywords: [] },
  };

  Object.entries(PRIORITY_RULES).forEach(([priority, rules]) => {
    rules.forEach(({ pattern, weight }) => {
      const matches = normalized.match(pattern);
      if (matches) {
        scores[priority as Priority].weight += weight;
        const matched = matches[0].trim();
        if (!scores[priority as Priority].keywords.includes(matched)) {
          scores[priority as Priority].keywords.push(matched);
        }
      }
    });
  });

  const sortedPriorities = Object.entries(scores).sort(
    (a, b) => b[1].weight - a[1].weight,
  );

  if (!sortedPriorities[0] || sortedPriorities[0][1].weight === 0) {
    return {
      priority: Priority.MEDIUM,
      confidence: 0.5,
      matchedKeywords: [],
    };
  }

  const topPriority = sortedPriorities[0]?.[0] as Priority | undefined;
  const topScore = sortedPriorities[0]?.[1].weight ?? 0;
  const secondScore = sortedPriorities[1]?.[1].weight ?? 0;

  if (!topPriority) {
    return {
      priority: Priority.MEDIUM,
      confidence: 0.5,
      matchedKeywords: [],
    };
  }

  if (secondScore > 0 && Math.abs(topScore - secondScore) / topScore < 0.15) {
    return {
      priority: Priority.MEDIUM,
      confidence: 0.5,
      matchedKeywords: [...(sortedPriorities[0]?.[1].keywords ?? []), ...(sortedPriorities[1]?.[1].keywords ?? [])],
    };
  }

  const totalPossibleWeight = PRIORITY_RULES[topPriority].reduce((sum, r) => sum + r.weight, 0);
  const confidence = Math.min(1.0, totalPossibleWeight > 0 ? topScore / totalPossibleWeight : 0);

  return {
    priority: topPriority,
    confidence,
    matchedKeywords: sortedPriorities[0]?.[1].keywords ?? [],
  };
}
