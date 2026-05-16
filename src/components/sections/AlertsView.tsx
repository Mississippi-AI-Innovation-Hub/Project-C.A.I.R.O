import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Settings, Mail, CheckCheck, Loader2, Send, BellRing } from 'lucide-react';
import { AlertSettingsModal } from './alerts/AlertSettingsModal';
import { AlertSummaryCards } from './alerts/AlertSummaryCards';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import { useTranslation } from 'react-i18next';
import { api } from '@/utils/api';
import { toast } from 'sonner';
import type { AlertDisplaySettings, AlertSeverityFilter } from './alerts/AlertSettingsModal';
import { useAuth } from '@/contexts/AuthContext';

// ── Types ────────────────────────────────────────────────────────────────────

interface Notification {
  id: string;
  certificate_id: string;
  domain_name: string;
  agency_name: string;
  severity: string;
  title: string;
  message: string;
  action_required: boolean;
  read: boolean;
  created_at: string;
  source: string;
}

interface NotifSummary {
  total: number;
  unread: number;
  critical_unread: number;
  warning_unread: number;
}

const ALERT_SETTINGS_KEY = 'alertSettings';

const parseAlertSettings = (): AlertDisplaySettings | null => {
  try {
    const raw = localStorage.getItem(ALERT_SETTINGS_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw) as Partial<AlertDisplaySettings>;
    if (!obj || typeof obj !== 'object') return null;
    const severity: AlertSeverityFilter =
      obj.defaultSeverityFilter === 'critical' || obj.defaultSeverityFilter === 'warning' || obj.defaultSeverityFilter === 'all'
        ? obj.defaultSeverityFilter
        : 'all';
    return {
      autoRefreshEnabled: typeof obj.autoRefreshEnabled === 'boolean' ? obj.autoRefreshEnabled : true,
      refreshIntervalSeconds:
        typeof obj.refreshIntervalSeconds === 'number' && Number.isFinite(obj.refreshIntervalSeconds)
          ? Math.max(5, Math.floor(obj.refreshIntervalSeconds))
          : 30,
      alertsPerPage:
        typeof obj.alertsPerPage === 'number' && Number.isFinite(obj.alertsPerPage)
          ? Math.max(10, Math.floor(obj.alertsPerPage))
          : 50,
      defaultSeverityFilter: severity,
    };
  } catch {
    return null;
  }
};

// ── Helpers ──────────────────────────────────────────────────────────────────

const fmtDate = (iso: string) => {
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
};

const SeverityBadge = ({ severity }: { severity: string }) => {
  if (severity === 'critical')
    return <Badge className="bg-red-600 text-white text-xs">Critical</Badge>;
  if (severity === 'warning')
    return <Badge className="bg-yellow-600 text-white text-xs">Warning</Badge>;
  if (severity === 'info')
    return <Badge className="bg-blue-600 text-white text-xs">Info</Badge>;
  return <Badge variant="secondary" className="text-xs">{severity}</Badge>;
};

// ── Email mini-form ──────────────────────────────────────────────────────────

const EmailForm = ({
  certId,
  message,
  onDone,
  isAdmin,
}: {
  certId: string;
  message: string;
  onDone: () => void;
  isAdmin: boolean;
}) => {
  const [email, setEmail]   = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent]     = useState(false);
  const [failed, setFailed] = useState(false);

  const handleSend = async () => {
    if (!isAdmin) return;
    if (!email) return;
    setSending(true);
    const result = await api.post('/notify/email', {
      certificate_id: certId,
      recipient_email: email,
      message,
    });
    setSending(false);
    if (result) {
      setSent(true);
      const provider = result.email_log_entry?.provider;
      const label = provider === 'aws_sns' ? 'via AWS SNS' : '(simulated)';
      toast.success(`Email sent ${label} to ${email}`);
    } else {
      setFailed(true);
      toast.error('Failed to send email');
    }
  };

  if (sent)   return <span className="text-green-400 text-xs font-medium">Sent ✓</span>;
  if (failed) return <span className="text-red-400 text-xs font-medium">Failed</span>;

  return (
    <div className="flex items-center gap-2 mt-1">
      <Input
        placeholder="recipient@agency.ms.gov"
        value={email}
        onChange={e => setEmail(e.target.value)}
        className="h-7 text-xs bg-gray-700 border-gray-600 text-white placeholder:text-gray-500 w-48"
      />
      <Button
        size="sm"
        disabled={sending || !email || !isAdmin}
        title={!isAdmin ? 'Admin access required' : undefined}
        onClick={handleSend}
        className="h-7 px-2 text-xs bg-blue-600 hover:bg-blue-700">
        {sending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
      </Button>
      <button onClick={onDone} className="text-gray-500 hover:text-white text-xs">✕</button>
    </div>
  );
};

// ── Main component ───────────────────────────────────────────────────────────

export const AlertsView = () => {
  const { t } = useTranslation();
  const { isAdmin } = useAuth();

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [notifSummary, setNotifSummary]   = useState<NotifSummary | null>(null);
  const [loading, setLoading]             = useState(true);
  const [itemsPerPage, setItemsPerPage]     = useState<number>(50);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState<boolean>(true);
  const [refreshIntervalSeconds, setRefreshIntervalSeconds] = useState<number>(30);
  const [severityFilter, setSeverityFilter] = useState<'all' | 'critical' | 'warning'>('all');
  const [searchTerm, setSearchTerm]       = useState('');
  const [currentPage, setCurrentPage]     = useState(1);
  const [resolvingIds, setResolvingIds]   = useState<Set<string>>(new Set());
  const [markingAll, setMarkingAll]       = useState(false);
  const [emailOpen, setEmailOpen]         = useState<string | null>(null);
  const [bulkSending, setBulkSending]     = useState(false);

  // Hydrate settings from localStorage on load
  useEffect(() => {
    const s = parseAlertSettings();
    if (!s) return;
    setItemsPerPage(s.alertsPerPage);
    setAutoRefreshEnabled(s.autoRefreshEnabled);
    setRefreshIntervalSeconds(s.refreshIntervalSeconds);
    setSeverityFilter(s.defaultSeverityFilter);
  }, []);

  const loadAll = async () => {
    const [data, sum] = await Promise.all([
      api.get('/notifications'),
      api.get('/notifications/summary'),
    ]);
    if (data) setNotifications(data);
    if (sum)  setNotifSummary(sum);
    setLoading(false);
  };

  useEffect(() => { loadAll(); }, []);
  React.useEffect(() => { setCurrentPage(1); }, [severityFilter, searchTerm]);

  // Auto refresh
  useEffect(() => {
    if (!autoRefreshEnabled) return;
    const ms = Math.max(5, refreshIntervalSeconds) * 1000;
    const t = window.setInterval(() => { loadAll(); }, ms);
    return () => window.clearInterval(t);
  }, [autoRefreshEnabled, refreshIntervalSeconds]);

  // After resolving a single notification, update local state + summary counts
  const handleResolve = async (id: string) => {
    if (!isAdmin) return;
    setResolvingIds(s => new Set(s).add(id));
    const result = await api.post(`/notifications/${id}/read`);
    if (result) {
      setNotifications(ns => ns.map(n => n.id === id ? { ...n, read: true } : n));
      setNotifSummary(s => s ? {
        ...s,
        unread: Math.max(0, s.unread - 1),
        critical_unread: notifications.find(n => n.id === id)?.severity === 'critical'
          ? Math.max(0, s.critical_unread - 1) : s.critical_unread,
        warning_unread: notifications.find(n => n.id === id)?.severity === 'warning'
          ? Math.max(0, s.warning_unread - 1) : s.warning_unread,
      } : s);
    } else {
      toast.error('Failed to mark notification as read');
    }
    setResolvingIds(s => { const n = new Set(s); n.delete(id); return n; });
  };

  const handleBulkNotify = async () => {
    if (!isAdmin) return;
    setBulkSending(true);
    const result = await api.post('/notify/bulk', { recipient_email: 'admin@its.ms.gov' });
    setBulkSending(false);
    if (result && result.status === 'sent') {
      const provider = result.provider === 'aws_sns' ? 'AWS SNS' : 'simulated';
      toast.success(`Alert sent for ${result.count} certificate${result.count !== 1 ? 's' : ''} via ${provider}`);
    } else if (result && result.status === 'nothing_to_send') {
      toast.info('No expired or critical certificates to notify about');
    } else {
      toast.error('Failed to send bulk alert');
    }
  };

  const handleMarkAllRead = async () => {
    if (!isAdmin) return;
    setMarkingAll(true);
    const result = await api.post('/notifications/read-all');
    if (result !== null) {
      setNotifications(ns => ns.map(n => ({ ...n, read: true })));
      setNotifSummary(s => s ? { ...s, unread: 0, critical_unread: 0, warning_unread: 0 } : s);
      toast.success('All notifications marked as read');
    } else {
      toast.error('Failed to mark all notifications as read');
    }
    setMarkingAll(false);
  };

  // Client-side filtering
  const filtered = notifications.filter(n => {
    const matchSeverity = severityFilter === 'all' || n.severity === severityFilter;
    const q = searchTerm.toLowerCase();
    const matchSearch = !q ||
      n.domain_name.toLowerCase().includes(q) ||
      n.message.toLowerCase().includes(q) ||
      n.agency_name.toLowerCase().includes(q);
    return matchSeverity && matchSearch;
  });

  const totalPages  = Math.ceil(filtered.length / itemsPerPage);
  const startIndex  = (currentPage - 1) * itemsPerPage;
  const currentItems = filtered.slice(startIndex, startIndex + itemsPerPage);

  // Summary card values — from API summary endpoint
  const sumTotal    = notifSummary?.total ?? notifications.length;
  const sumUnread   = notifSummary?.unread ?? notifications.filter(n => !n.read).length;
  const criticalCount = notifSummary?.critical_unread ?? notifications.filter(n => n.severity === 'critical').length;
  const warningCount  = notifSummary?.warning_unread  ?? notifications.filter(n => n.severity === 'warning').length;
  const resolvedCount = sumTotal - sumUnread;
  const infoCount     = 0;

  const startItem = filtered.length === 0 ? 0 : startIndex + 1;
  const endItem   = Math.min(currentPage * itemsPerPage, filtered.length);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
        <span className="text-white ml-3">Loading notifications…</span>
      </div>
    );
  }

  return (
    <div className="space-y-4 md:space-y-6 p-2 md:p-4 lg:p-6 max-w-full overflow-hidden">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl md:text-2xl lg:text-3xl font-bold mb-2 text-white flex items-center gap-3">
            {t('navigation.alerts.management.title')}
            {sumUnread > 0 && (
              <Badge className="bg-red-600 text-white text-xs">{sumUnread} unread</Badge>
            )}
          </h2>
          <p className="text-gray-400 text-xs md:text-sm lg:text-base">
            Certificate expiry and renewal-agent events from the API.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button
            onClick={handleBulkNotify}
            disabled={bulkSending || !isAdmin}
            title={!isAdmin ? 'Admin access required' : undefined}
            className="bg-red-700 hover:bg-red-600 text-white text-sm"
            size="sm"
          >
            {bulkSending
              ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              : <BellRing className="h-4 w-4 mr-2" />}
            Notify All Critical
          </Button>
          <Button
            onClick={handleMarkAllRead}
            disabled={markingAll || sumUnread === 0 || !isAdmin}
            title={!isAdmin ? 'Admin access required' : undefined}
            className="bg-gray-700 hover:bg-gray-600 text-white text-sm"
            size="sm"
          >
            {markingAll
              ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              : <CheckCheck className="h-4 w-4 mr-2" />}
            Mark All Read
          </Button>
          <AlertSettingsModal
            trigger={
              <Button className="bg-blue-600 hover:bg-blue-700 text-white w-full sm:w-auto px-3 py-2 text-sm">
                <Settings className="h-4 w-4 mr-2" />
                {t('navigation.alerts.management.buttons.alertSettings')}
              </Button>
            }
            initialSettings={{
              autoRefreshEnabled,
              refreshIntervalSeconds,
              alertsPerPage: itemsPerPage,
              defaultSeverityFilter: severityFilter,
            }}
            onSaved={(s) => {
              setItemsPerPage(s.alertsPerPage);
              setAutoRefreshEnabled(s.autoRefreshEnabled);
              setRefreshIntervalSeconds(s.refreshIntervalSeconds);
              setSeverityFilter(s.defaultSeverityFilter);
            }}
          />
        </div>
      </div>

      {/* Summary cards — driven by /api/notifications/summary */}
      <AlertSummaryCards
        criticalCount={criticalCount}
        warningCount={warningCount}
        infoCount={infoCount}
        resolvedCount={resolvedCount}
      />

      <Card className="bg-gray-800 border-gray-700 w-full">
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <CardTitle className="text-white text-base md:text-lg lg:text-xl flex-1">
              Certificate Lifecycle Alerts
            </CardTitle>
            <div className="relative w-full sm:w-64">
              <input
                placeholder="Search domain, message…"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full bg-gray-700 border border-gray-600 text-white text-sm rounded-md pl-3 pr-3 py-1.5 placeholder:text-gray-400 focus:outline-none"
              />
            </div>
            {/* All / Critical / Warning filter pills */}
            <div className="flex gap-2 flex-wrap">
              {(['all', 'critical', 'warning'] as const).map(s => (
                <button key={s} onClick={() => setSeverityFilter(s)}
                  className={`px-3 py-1 rounded-full text-xs font-medium capitalize transition-colors ${
                    severityFilter === s
                      ? s === 'critical' ? 'bg-red-600 text-white'
                        : s === 'warning' ? 'bg-yellow-600 text-white'
                        : 'bg-blue-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}>
                  {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {/* Desktop table */}
          <div className="hidden lg:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700 text-gray-400 font-medium">
                  <th className="text-left py-3 px-4">Severity</th>
                  <th className="text-left py-3 px-4">Domain</th>
                  <th className="text-left py-3 px-4">Message</th>
                  <th className="text-left py-3 px-4">Created</th>
                  <th className="text-left py-3 px-4">Actions</th>
                </tr>
              </thead>
              <tbody>
                {currentItems.length === 0 ? (
                  <tr><td colSpan={5} className="py-8 text-center text-gray-400">No notifications</td></tr>
                ) : currentItems.map(n => (
                  <tr key={n.id}
                    className={`border-b border-gray-700 hover:bg-gray-750 ${!n.read ? 'bg-gray-800/80' : 'opacity-60'}`}>
                    <td className="py-3 px-4"><SeverityBadge severity={n.severity} /></td>
                    <td className="py-3 px-4">
                      <p className={`font-mono text-xs ${!n.read ? 'text-white font-semibold' : 'text-gray-300'}`}>
                        {n.domain_name}
                      </p>
                      <p className="text-gray-500 text-xs">{n.agency_name}</p>
                    </td>
                    <td className="py-3 px-4">
                      <p className={!n.read ? 'text-white' : 'text-gray-400'}>{n.message}</p>
                      <p className="text-gray-500 text-xs mt-0.5">Source: certificate_monitor</p>
                      {emailOpen === n.id && (
                        <EmailForm
                          certId={n.certificate_id}
                          message={n.message}
                          onDone={() => setEmailOpen(null)}
                          isAdmin={isAdmin}
                        />
                      )}
                    </td>
                    <td className="py-3 px-4 text-gray-400 text-xs whitespace-nowrap">
                      {fmtDate(n.created_at)}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex gap-2">
                        {!n.read && (
                          <Button size="sm" variant="ghost"
                            className="h-7 px-2 text-xs text-green-400 hover:bg-green-600/20"
                            disabled={resolvingIds.has(n.id) || !isAdmin}
                            title={!isAdmin ? 'Admin access required' : undefined}
                            onClick={() => handleResolve(n.id)}>
                            {resolvingIds.has(n.id)
                              ? <Loader2 className="h-3 w-3 animate-spin" />
                              : 'Resolve'}
                          </Button>
                        )}
                        <Button size="sm" variant="ghost"
                          className="h-7 px-2 text-xs text-blue-400 hover:bg-blue-600/20"
                          onClick={() => setEmailOpen(emailOpen === n.id ? null : n.id)}
                          title="Send email alert">
                          <Mail className="h-3 w-3" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile card view */}
          <div className="block lg:hidden space-y-3 p-3">
            {currentItems.length === 0 ? (
              <div className="text-center py-8 text-gray-400">No notifications</div>
            ) : currentItems.map(n => (
              <Card key={n.id} className={`border-gray-600 ${!n.read ? 'bg-gray-750' : 'bg-gray-800 opacity-60'}`}>
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <SeverityBadge severity={n.severity} />
                    <span className="text-gray-500 text-xs">{fmtDate(n.created_at)}</span>
                  </div>
                  <p className={`text-xs font-mono ${!n.read ? 'text-white font-semibold' : 'text-gray-300'}`}>
                    {n.domain_name}
                  </p>
                  <p className="text-sm text-gray-300">{n.message}</p>
                  <p className="text-gray-500 text-xs">Source: certificate_monitor</p>
                  {emailOpen === n.id && (
                    <EmailForm
                      certId={n.certificate_id}
                      message={n.message}
                      onDone={() => setEmailOpen(null)}
                      isAdmin={isAdmin}
                    />
                  )}
                  <div className="flex gap-2 pt-1">
                    {!n.read && (
                      <Button size="sm" className="text-xs h-7 bg-green-700 hover:bg-green-600"
                        disabled={resolvingIds.has(n.id) || !isAdmin}
                        title={!isAdmin ? 'Admin access required' : undefined}
                        onClick={() => handleResolve(n.id)}>
                        {resolvingIds.has(n.id) ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Resolve'}
                      </Button>
                    )}
                    <Button size="sm" variant="ghost"
                      className="h-7 px-2 text-xs text-blue-400 hover:bg-blue-600/20"
                      onClick={() => setEmailOpen(emailOpen === n.id ? null : n.id)}>
                      <Mail className="h-3 w-3 mr-1" /> Email
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4">
              <div className="text-sm text-gray-400">
                Showing {startItem} to {endItem} of {filtered.length} notifications
              </div>
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious href="#"
                      onClick={e => { e.preventDefault(); if (currentPage > 1) setCurrentPage(p => p - 1); }}
                      className={`bg-gray-700 border-gray-600 text-white hover:bg-gray-600 ${currentPage === 1 ? 'opacity-50 cursor-not-allowed' : ''}`}
                    />
                  </PaginationItem>
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                    <PaginationItem key={p}>
                      <PaginationLink href="#"
                        onClick={e => { e.preventDefault(); setCurrentPage(p); }}
                        isActive={currentPage === p}
                        className="bg-gray-700 border-gray-600 text-white hover:bg-gray-600">
                        {p}
                      </PaginationLink>
                    </PaginationItem>
                  ))}
                  <PaginationItem>
                    <PaginationNext href="#"
                      onClick={e => { e.preventDefault(); if (currentPage < totalPages) setCurrentPage(p => p + 1); }}
                      className={`bg-gray-700 border-gray-600 text-white hover:bg-gray-600 ${currentPage === totalPages ? 'opacity-50 cursor-not-allowed' : ''}`}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          )}

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between px-4 pb-4 text-xs text-gray-400 gap-4">
            <span>Showing {filtered.length} of {notifications.length} notifications</span>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2"><div className="w-2 h-2 bg-red-500 rounded-full" /><span>Critical</span></div>
              <div className="flex items-center gap-2"><div className="w-2 h-2 bg-yellow-500 rounded-full" /><span>Warning</span></div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
