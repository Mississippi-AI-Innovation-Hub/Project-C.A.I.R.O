import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Bell, Settings, User, Menu, LogOut, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { api } from '@/utils/api';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface NotificationSummary {
  unread?: number;
  critical_unread?: number;
}

interface HeaderNotification {
  id: string;
  title: string;
  message: string;
  severity: string;
  read: boolean;
  domain_name?: string;
  created_at: string;
}

interface HeaderProps {
  toggleSidebar: () => void;
  sidebarCollapsed: boolean;
  isPublicMode?: boolean;
  onSectionChange?: (section: string) => void;
}

const severityBadgeClass = (severity: string) => {
  if (severity === 'critical') return 'bg-red-600/20 text-red-300 border-red-500/30';
  if (severity === 'warning') return 'bg-yellow-600/20 text-yellow-300 border-yellow-500/30';
  return 'bg-gray-600/20 text-gray-300 border-gray-500/30';
};

export const Header = ({
  toggleSidebar,
  sidebarCollapsed,
  isPublicMode = false,
  onSectionChange,
}: HeaderProps) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [unreadCount, setUnreadCount] = useState(0);
  const [recentNotifications, setRecentNotifications] = useState<HeaderNotification[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  const refreshSummary = useCallback(() => {
    if (!user) return;
    api
      .get<NotificationSummary>('/notifications/summary')
      .then((data) => setUnreadCount(data.unread ?? 0))
      .catch(() => {});
  }, [user]);

  useEffect(() => {
    refreshSummary();
  }, [refreshSummary]);

  const loadRecentNotifications = useCallback(async () => {
    if (!user) return;
    setNotificationsLoading(true);
    try {
      const data = await api.get<HeaderNotification[]>('/notifications?unread=true');
      if (data) {
        setRecentNotifications(data.slice(0, 5));
      }
    } finally {
      setNotificationsLoading(false);
    }
  }, [user]);

  const handleNotificationsOpenChange = (open: boolean) => {
    setNotificationsOpen(open);
    if (open) {
      void loadRecentNotifications();
      refreshSummary();
    }
  };

  const goToAlerts = () => {
    onSectionChange?.('alerts');
    setNotificationsOpen(false);
  };

  const handleSignOut = async () => {
    try {
      logout();
    } catch {
      window.location.hash = '#/';
    }
  };

  const handleSettingsClick = () => {
    onSectionChange?.('settings');
  };

  return (
    <header className="bg-gray-800 border-b border-gray-700 px-6 py-4 flex items-center justify-between">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={toggleSidebar}
          className="text-gray-300 hover:text-white hover:bg-gray-700"
        >
          <Menu className="h-5 w-5" />
        </Button>
        <h1 className="text-xl font-semibold text-white">
          {isPublicMode ? 'Certificate Monitor' : 'CSR Lifecycle Management'}
        </h1>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 bg-green-500 rounded-full animate-pulse" />
          <span className="text-sm text-gray-300">All Systems Operational</span>
        </div>

        {!isPublicMode && (
          <>
            <DropdownMenu open={notificationsOpen} onOpenChange={handleNotificationsOpenChange}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="relative text-gray-300 hover:text-gray-100 hover:bg-gray-700"
                  aria-label="Notifications"
                >
                  <Bell className="h-5 w-5" />
                  {unreadCount > 0 && (
                    <Badge className="absolute -top-1 -right-1 min-h-5 min-w-5 px-1 flex items-center justify-center bg-red-500 text-white text-xs">
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </Badge>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-80 bg-gray-900 border-gray-600 shadow-lg z-50"
                align="end"
                sideOffset={5}
              >
                <DropdownMenuLabel className="text-white font-semibold">
                  Notifications
                  {unreadCount > 0 && (
                    <span className="ml-2 text-xs font-normal text-gray-400">
                      {unreadCount} unread
                    </span>
                  )}
                </DropdownMenuLabel>
                <DropdownMenuSeparator className="bg-gray-600" />
                {notificationsLoading ? (
                  <div className="flex items-center justify-center py-6 text-gray-400">
                    <Loader2 className="h-5 w-5 animate-spin" />
                  </div>
                ) : recentNotifications.length === 0 ? (
                  <div className="px-3 py-4 text-sm text-gray-400">No unread notifications</div>
                ) : (
                  recentNotifications.map((notification) => (
                    <DropdownMenuItem
                      key={notification.id}
                      onClick={goToAlerts}
                      className="flex flex-col items-start gap-1 py-3 text-white hover:bg-gray-700 cursor-pointer focus:bg-gray-700 focus:text-white"
                    >
                      <div className="flex w-full items-center justify-between gap-2">
                        <span className="text-sm font-medium truncate">{notification.title}</span>
                        <Badge className={`text-[10px] border ${severityBadgeClass(notification.severity)}`}>
                          {notification.severity}
                        </Badge>
                      </div>
                      <span className="text-xs text-gray-400 line-clamp-2">{notification.message}</span>
                      {notification.domain_name && (
                        <span className="text-xs text-gray-500">{notification.domain_name}</span>
                      )}
                    </DropdownMenuItem>
                  ))
                )}
                <DropdownMenuSeparator className="bg-gray-600" />
                <DropdownMenuItem
                  onClick={goToAlerts}
                  className="text-blue-300 hover:text-blue-200 hover:bg-gray-700 cursor-pointer focus:bg-gray-700 focus:text-blue-200"
                >
                  View all alerts
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              variant="ghost"
              size="sm"
              className="text-gray-300 hover:text-gray-100 hover:bg-gray-700"
              onClick={handleSettingsClick}
              aria-label="Settings"
            >
              <Settings className="h-5 w-5" />
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="text-gray-300 hover:text-gray-100 hover:bg-gray-700">
                  <User className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-56 bg-gray-900 border-gray-600 shadow-lg z-50"
                align="end"
                sideOffset={5}
              >
                <DropdownMenuLabel className="text-white font-semibold">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">
                      {user?.email?.trim() || user?.name?.trim() || 'User'}
                    </span>
                    <Badge
                      className={
                        user?.role === 'admin'
                          ? 'bg-blue-600/20 text-blue-300 border border-blue-500/30'
                          : 'bg-gray-600/20 text-gray-300 border border-gray-500/30'
                      }
                    >
                      {user?.role || 'operator'}
                    </Badge>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator className="bg-gray-600" />
                <DropdownMenuItem
                  onClick={() => navigate('/profile')}
                  className="text-white hover:text-white hover:bg-gray-700 cursor-pointer focus:bg-gray-700 focus:text-white"
                >
                  <User className="mr-2 h-4 w-4" />
                  Profile
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={handleSignOut}
                  className="text-white hover:text-white hover:bg-gray-700 cursor-pointer focus:bg-gray-700 focus:text-white"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}

        {isPublicMode && <span className="text-sm text-gray-400">Public Mode</span>}
      </div>
    </header>
  );
};
