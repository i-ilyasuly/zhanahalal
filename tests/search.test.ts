import { describe, it, expect, beforeEach } from 'vitest';
import { searchData, formatDetailMessage, getQuoteCategory } from '../src/server/src_server_search.js';
import { cleanText } from '../src/server/src_server_utils.js';
import { CACHE } from '../src/server/src_server_db.js';

describe('search', () => {
  beforeEach(() => {
    // Override cache for testing
    CACHE.loaded = true;
    CACHE.companies = [
      {
        id: 'c1',
        title: 'Madi Burger',
        is_active: true,
        certificate_status: 'active',
        address: 'Abay Ave 10',
        _titleStr: 'Madi Burger',
        _legalStr: '',
        _cleanTitle: cleanText('Madi Burger'),
        _cleanLegal: ''
      },
      {
        id: 'c2',
        title: 'KFC',
        is_active: true,
        certificate_status: 'expired',
        address: 'Mega Center',
        _titleStr: 'KFC',
        _legalStr: '',
        _cleanTitle: 'kfc',
        _cleanLegal: ''
      },
      {
        id: 'c3',
        title: 'Inactive Cafe',
        is_active: false,
        certificate_status: 'active',
        address: 'Al-Farabi 123',
        _titleStr: 'Inactive Cafe',
        _legalStr: '',
        _cleanTitle: 'inactivecafe',
        _cleanLegal: ''
      }
    ];

    CACHE.ingredients = [
      {
        id: 'i1',
        status: 'haram',
        code: 'E120',
        name_kz: 'Кармин',
        is_active: true,
        _code: 'E120',
        _nameKz: 'Кармин',
        _nameRu: '',
        _cleanCode: cleanText('E120'),
        _cleanName: cleanText('Кармин')
      },
      {
        id: 'i2',
        status: 'halal',
        code: 'E330',
        name_kz: 'Лимон қышқылы',
        is_active: true,
        _code: 'E330',
        _nameKz: 'Лимон қышқылы',
        _nameRu: '',
        _cleanCode: cleanText('E330'),
        _cleanName: cleanText('Лимон қышқылы')
      }
    ];
  });

  describe('searchData', () => {
    it('should find exact matches for companies', async () => {
      const results = await searchData('Madi Burger');
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Madi Burger');
      expect(results[0].type).toBe('Мекеме');
      expect(results[0].confidence).toBe('exact');
    });

    it('should not find inactive companies', async () => {
      const results = await searchData('Inactive Cafe');
      expect(results).toHaveLength(0);
    });

    it('should find fuzzy matches for companies', async () => {
      const results = await searchData('mad burge'); // fuzzy
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Madi Burger');
      expect(results[0].type).toBe('Мекеме');
    });

    it('should find ingredient by code', async () => {
      const results = await searchData('E120');
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe('Қоспа');
      expect(results[0].code).toBe('E120');
      
      const results2 = await searchData('120');
      expect(results2).toHaveLength(1);
      expect(results2[0].code).toBe('E120');
    });

    it('should find ingredient by Kazakh name', async () => {
      const results = await searchData('Кармин');
      expect(results).toHaveLength(1);
      expect(results[0].code).toBe('E120');
    });
  });

  describe('formatDetailMessage', () => {
    it('should format company details correctly', () => {
      const formatted = formatDetailMessage({ ...CACHE.companies[0], type: 'Мекеме' });
      expect(formatted).toContain('Madi Burger');
      expect(formatted).toContain('Белсенді');
    });

    it('should format ingredient details correctly', () => {
      const formatted = formatDetailMessage({ ...CACHE.ingredients[0], type: 'Қоспа' });
      expect(formatted).toContain('E120');
      expect(formatted).toContain('Кармин');
      expect(formatted).toContain('Харам');
    });
  });

  describe('getQuoteCategory', () => {
    it('should return halal for active company', () => {
      expect(getQuoteCategory({ type: 'Мекеме', certificate_status: 'active' })).toBe('halal');
    });

    it('should return expired for expired company', () => {
      expect(getQuoteCategory({ type: 'Мекеме', certificate_status: 'expired' })).toBe('expired');
    });

    it('should return haram for haram ingredient', () => {
      expect(getQuoteCategory({ type: 'Қоспа', status: 'haram' })).toBe('haram');
    });
  });
});
