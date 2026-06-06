/**
 * server/platform/notificationAdapter.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Manus owner notification adapter — implements INotificationAdapter.
 *
 * Wraps the existing notifyOwner() helper from server/_core/notification.ts.
 * When the Forge API is not configured, notify() returns false gracefully.
 */
import { notifyOwner } from "../_core/notification";
import type { INotificationAdapter, NotificationPayload } from "./types";

class ManusNotificationAdapter implements INotificationAdapter {
  isAvailable(): boolean {
    return !!(process.env.BUILT_IN_FORGE_API_KEY && process.env.BUILT_IN_FORGE_API_URL);
  }

  async notify(payload: NotificationPayload): Promise<boolean> {
    try {
      return await notifyOwner({ title: payload.title, content: payload.content });
    } catch {
      return false;
    }
  }
}

let _adapter: ManusNotificationAdapter | null = null;

export function getNotificationAdapter(): INotificationAdapter {
  if (!_adapter) _adapter = new ManusNotificationAdapter();
  return _adapter;
}

export function setNotificationAdapter(adapter: INotificationAdapter): void {
  _adapter = adapter as ManusNotificationAdapter;
}
