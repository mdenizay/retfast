import Native from './src/RetfastTrackingModule';
import type { StartOptions } from './src/RetfastTracking.types';

export * from './src/RetfastTracking.types';

/** Native takip modülü: konum yakalama, dayanıklı kuyruk ve toplu senkron JS'ten bağımsız çalışır. */
export const Tracking = {
  getStatus: () => Native.getStatus(),
  requestPermissions: () => Native.requestPermissions(),
  start: (o: StartOptions) => Native.start(JSON.stringify(o)),
  stop: () => Native.stop(),
  reset: () => Native.reset(),
  flush: () => Native.flush(),
  updateToken: (t: string) => Native.updateToken(t),
  onStatus: (fn: Parameters<typeof Native.addListener<'onStatus'>>[1]) => Native.addListener('onStatus', fn),
  onSessionEvent: (fn: Parameters<typeof Native.addListener<'onSessionEvent'>>[1]) => Native.addListener('onSessionEvent', fn),
};
