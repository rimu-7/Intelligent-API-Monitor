import type { AlertDto, MonitorRunDto } from './alert';

/** Realtime events published on Redis channel `apimon:events` and streamed over SSE (§13.1). */
export const REALTIME_EVENTS = [
  'alert.created',
  'alert.updated',
  'alert.resolved',
  'alerts.invalidated',
  'monitor.run.completed',
] as const;
export type RealtimeEventName = (typeof REALTIME_EVENTS)[number];

export interface RealtimeEventPayloads {
  'alert.created': { alert: AlertDto };
  'alert.updated': { alert: AlertDto };
  'alert.resolved': { alert: AlertDto };
  'alerts.invalidated': { reason: string; count: number };
  'monitor.run.completed': { run: MonitorRunDto };
}

export interface RealtimeEvent<N extends RealtimeEventName = RealtimeEventName> {
  id: string;
  name: N;
  data: RealtimeEventPayloads[N];
}

/** Above this many alerts touched by one run, a single `alerts.invalidated` replaces per-alert events. */
export const MAX_ALERT_EVENTS_PER_RUN = 50;

export const REALTIME_CHANNEL = 'apimon:events';
