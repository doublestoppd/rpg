import { z } from 'zod';

export const notificationTypeSchema = z.enum([
  'TRAVEL_COMPLETED',
  'DELIVERY_COMPLETED',
  'LISTING_SOLD',
  'GATHERING_COMPLETED',
  'CRAFTING_COMPLETED',
  'QUEST_COMPLETED',
]);
export type NotificationTypeValue = z.infer<typeof notificationTypeSchema>;

export const notificationSchema = z.object({
  id: z.uuid(),
  type: notificationTypeSchema,
  title: z.string(),
  body: z.string(),
  readAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type NotificationView = z.infer<typeof notificationSchema>;

export const notificationsResponseSchema = z.object({
  notifications: z.array(notificationSchema),
  unreadCount: z.number().int().min(0),
});
export type NotificationsResponse = z.infer<typeof notificationsResponseSchema>;

/** Message pushed over the live socket: a nudge to refetch, nothing more. */
export const notificationSyncMessageSchema = z.object({
  type: z.literal('sync'),
});
export type NotificationSyncMessage = z.infer<typeof notificationSyncMessageSchema>;
