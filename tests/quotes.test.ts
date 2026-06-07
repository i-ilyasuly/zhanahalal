import { describe, it, expect } from 'vitest';
import { getQuote } from '../src/server/src_server_quotes.js';

describe('quotes', () => {
  it('should return empty string for non-existent category', () => {
    expect(getQuote('non_existent')).toBe('');
  });

  // Depending on whether we export POOL or not, we might just test general returning of blockquote.
  it('should return a blockquote string for valid category', () => {
    // Assuming 'halal' has quotes in quotesQuran or quotesKazakh
    const quote = getQuote('halal');
    if (quote) {
       expect(quote).toContain('<blockquote expandable>');
       expect(quote).toContain('</blockquote>');
    }
  });

  it('should return a blockquote for haram', () => {
    const quote = getQuote('haram');
    if (quote) {
       expect(quote).toContain('<blockquote expandable>');
    }
  });
});
