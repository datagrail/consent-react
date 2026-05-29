import type { ATTStatus } from '../types';

// TODO: Agent implements — iOS native module bridge via TurboModules
// Uses NativeModules to call ATTrackingManager.requestTrackingAuthorization()
// Maps ATT result → consent categories → savePreferences()

export async function requestTrackingAuthorization(): Promise<ATTStatus> {
  throw new Error('Not implemented');
}

export function getTrackingStatus(): ATTStatus {
  throw new Error('Not implemented');
}
