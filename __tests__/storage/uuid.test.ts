import { generateUuidV4 } from '../../src/storage/uuid';

describe('generateUuidV4', () => {
  it('produces a canonical RFC 4122 v4 UUID string', () => {
    const uuid = generateUuidV4();
    expect(uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('sets the version nibble to 4', () => {
    for (let i = 0; i < 50; i++) {
      // 15th hex char (index 14) is the version nibble.
      expect(generateUuidV4()[14]).toBe('4');
    }
  });

  it('sets the variant nibble to one of 8, 9, a, b', () => {
    for (let i = 0; i < 50; i++) {
      // 20th hex char (index 19) is the variant nibble.
      expect('89ab').toContain(generateUuidV4()[19]);
    }
  });

  it('generates unique values across many calls', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      seen.add(generateUuidV4());
    }
    expect(seen.size).toBe(1000);
  });

  it('draws from crypto.getRandomValues', () => {
    const spy = jest.spyOn(crypto, 'getRandomValues');
    generateUuidV4();
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
