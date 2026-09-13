import { fetchDemoSnapshot, fetchSnapshot, type SnapshotResult } from './api';

export type AppDataMode = 'real' | 'demo';

export interface ProviderRepository {
  mode?: AppDataMode;
  fetch: () => Promise<SnapshotResult> | SnapshotResult;
}

// Default real: demo ONLY via explicit opt-in (?demo=1 or localStorage flag).
export function resolveAppDataMode(): AppDataMode {
  try {
    const q = typeof window !== 'undefined' ? window.location?.search ?? '' : '';
    if (q.includes('demo=1')) return 'demo';
    const stored = typeof window !== 'undefined' ? window.localStorage?.getItem('usagehalo.dataMode') : null;
    if (stored === 'demo') return 'demo';
  } catch {
    // Storage/location unavailable — stay on real.
  }
  return 'real';
}

export const RealProviderRepository: ProviderRepository = { mode: 'real', fetch: fetchSnapshot };

export const DemoProviderRepository: ProviderRepository = { fetch: async () => fetchDemoSnapshot() };

export function getRepository(mode: AppDataMode): ProviderRepository {
  return mode === 'demo' ? DemoProviderRepository : RealProviderRepository;
}
