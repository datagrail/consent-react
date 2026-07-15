import type { ATTStatus } from '../types';

// Fallback for platforms where neither att.ios.ts nor att.android.ts resolves
// (e.g. non-iOS/non-Android targets). ATT is a mobile-only concept here, so
// this is a graceful no-op — mirroring att.android.ts's degraded behavior —
// rather than throwing like att.ios.ts does when its native module is unlinked.
export async function requestTrackingAuthorization(): Promise<ATTStatus> {
  return 'authorized';
}

export function getTrackingStatus(): ATTStatus {
  return 'authorized';
}
