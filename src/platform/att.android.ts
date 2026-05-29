import type { ATTStatus } from '../types';

// Android no-op — ATT is iOS-only

export async function requestTrackingAuthorization(): Promise<ATTStatus> {
  return 'authorized';
}

export function getTrackingStatus(): ATTStatus {
  return 'authorized';
}
