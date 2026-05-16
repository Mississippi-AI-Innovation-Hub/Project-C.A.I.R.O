export const useSystemNotifications = () => ({
  notifications: [],
  unreadCount: 0,
  markAsRead: (_id: string) => {},
  clearAll: () => {},
});
