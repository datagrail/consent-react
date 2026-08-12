import { NativeModules } from 'react-native';
import { ConsentError } from '../../src/types';

const mockComputeUserHash = jest.fn<Promise<string>, [string, string, string]>();

NativeModules.DataGrailConsentCrypto = {
  computeUserHash: mockComputeUserHash,
};

// Import after the native module is stubbed.
import { computeUserHash } from '../../src/universal/userHash';

describe('computeUserHash', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    NativeModules.DataGrailConsentCrypto = { computeUserHash: mockComputeUserHash };
  });

  it('passes the three components to native without pre-processing them', () => {
    // The JS side deliberately does NOT normalize — Hermes has no dependable
    // `String.prototype.normalize`, so normalizing here would produce a hash that differs
    // between apps depending on their Intl configuration. Native owns the whole derivation.
    mockComputeUserHash.mockResolvedValue('a'.repeat(64));

    void computeUserHash('cust', 'proj', '  User@Example.COM  ');

    expect(mockComputeUserHash).toHaveBeenCalledWith('cust', 'proj', '  User@Example.COM  ');
  });

  it('returns the native hash verbatim', async () => {
    const hash = '1fee132c298d615098190e3e75f9c7e05db20d6cff6398f686fcebc67d1d87a4';
    mockComputeUserHash.mockResolvedValue(hash);

    await expect(
      computeUserHash('ac46d8ad-a67a-431f-a5d5-9e3eb922dae7', 'proj_abc123', 'user@example.com'),
    ).resolves.toBe(hash);
  });

  it('maps the native INVALID_IDENTIFIER rejection to VALIDATION_ERROR', async () => {
    // An identifier that normalizes to "" hashes the bare "{customerId}:{projectId}:" prefix,
    // which every such caller in the tenant shares — it would collapse unrelated users onto one
    // consent record. This must surface as a caller bug, not a retryable failure.
    const nativeError = Object.assign(new Error('empty after normalization'), {
      code: 'INVALID_IDENTIFIER',
    });
    mockComputeUserHash.mockRejectedValue(nativeError);

    await expect(computeUserHash('cust', 'proj', '   ')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'identifier must not be empty after normalization',
    });
  });

  it('surfaces other native rejections as VALIDATION_ERROR preserving the message', async () => {
    mockComputeUserHash.mockRejectedValue(new Error('bridge exploded'));

    await expect(computeUserHash('cust', 'proj', 'user@example.com')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'bridge exploded',
    });
  });

  it('throws NOT_INITIALIZED when the native module is not linked', async () => {
    delete (NativeModules as Record<string, unknown>).DataGrailConsentCrypto;

    await expect(computeUserHash('cust', 'proj', 'user@example.com')).rejects.toBeInstanceOf(
      ConsentError,
    );
    await expect(computeUserHash('cust', 'proj', 'user@example.com')).rejects.toMatchObject({
      code: 'NOT_INITIALIZED',
    });
  });
});
