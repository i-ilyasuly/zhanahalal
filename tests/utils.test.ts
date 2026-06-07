import { describe, it, expect } from 'vitest';
import { cleanText, escapeHTML, getDistance } from '../src/server/src_server_utils.js';

describe('utils', () => {
  describe('cleanText', () => {
    it('should lower case text', () => {
      expect(cleanText('HELLO')).toBe('hello');
    });

    it('should remove non-word characters', () => {
      expect(cleanText('hello world! 123')).toBe('helloworld123');
    });

    it('should replace specific characters', () => {
      expect(cleanText('әңғүұқөһ')).toBe('anguuqoh');
      expect(cleanText('üöşçğı')).toBe('');
    });

    it('should replace cyrillic similarities', () => {
      expect(cleanText('еаоскхрутмвні')).toBe('eaoskxrutmvni');
    });

    it('should handle empty strings', () => {
      expect(cleanText('')).toBe('');
      expect(cleanText(null as any)).toBe('');
    });
  });

  describe('escapeHTML', () => {
    it('should escape < and >', () => {
      expect(escapeHTML('<b>Bold</b>')).toBe('&lt;b&gt;Bold&lt;/b&gt;');
    });

    it('should escape &', () => {
      expect(escapeHTML('AT&T')).toBe('AT&amp;T');
    });

    it('should return empty string for falsy values', () => {
      expect(escapeHTML('')).toBe('');
      expect(escapeHTML(undefined as any)).toBe('');
    });
  });

  describe('getDistance', () => {
    it('should calculate distance correctly', () => {
      // Almaty to Astana
      const lat1 = 43.2389; // Almaty
      const lon1 = 76.8897;
      const lat2 = 51.1694; // Astana
      const lon2 = 71.4491;
      
      const distance = getDistance(lat1, lon1, lat2, lon2);
      // Roughly 970 km straight line
      expect(Math.floor(distance)).toBeGreaterThan(950);
      expect(Math.floor(distance)).toBeLessThan(1000);
    });

    it('should be 0 for same location', () => {
      expect(getDistance(43.2, 76.9, 43.2, 76.9)).toBe(0);
    });
  });
});
