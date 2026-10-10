import { NativeModule, requireNativeModule } from 'expo';

import type { Authorization, RetfastTrackingModuleEvents, StartOptions, TrackingStatus } from './RetfastTracking.types';

declare class RetfastTrackingModule extends NativeModule<RetfastTrackingModuleEvents> {
  getStatus(): TrackingStatus;
  requestPermissions(): Promise<Authorization>;
  start(optionsJson: string): Promise<void>;
  stop(): Promise<void>;
  reset(): Promise<void>;
  flush(): Promise<void>;
  updateToken(token: string): Promise<void>;
}

export default requireNativeModule<RetfastTrackingModule>('RetfastTracking');
export type { StartOptions };
