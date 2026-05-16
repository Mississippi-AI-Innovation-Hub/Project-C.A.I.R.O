import { useSystemSettingsLazy } from '@/hooks/useSystemSettingsLazy';
import { Skeleton } from '@/components/ui/skeleton';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Loader2,
  Wifi,
  WifiOff,
  Mail,
  Bell,
  Calendar,
  Plus,
  Trash2,
  Save,
  Clock,
  Database,
  RefreshCw,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { api } from '@/utils/api';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';

type DynamoDbStatus = Record<string, 'ok' | 'error' | string>;

interface S3BucketInfo {
  bucket: string;
  accessible: boolean;
  object_count?: number;
  error?: string;
}

interface S3Status {
  buckets: S3BucketInfo[];
  region: string;
}

interface EmailLogEntry {
  id: string;
  certificate_id: string;
  domain_name: string;
  recipient_email: string;
  subject: string;
  message: string;
  sent_at: string;
  status: string;
  provider?: string;
  sns_message_id?: string;
  report_type?: string;
}

interface HealthData {
  status: string;
  cert_count: number;
  last_refreshed: string;
  version: string;
}

interface AwsSnsConfig {
  configured: boolean;
  topic_arn: string;
  region: string;
  provider: 'aws_sns' | 'simulated';
}

interface NotificationPrefs {
  recipients: string[];
  daily_time: string;
  triggers: string[];
  startup_alerts_enabled?: boolean;
}

const DEFAULT_RECIPIENT = 'admin@its.ms.gov';
const MAX_RECIPIENTS = 3;

const DIGEST_TIME_OPTIONS: { value: string; label: string }[] = [
  { value: '06:00', label: '06:00 AM' },
  { value: '07:00', label: '07:00 AM' },
  { value: '08:00', label: '08:00 AM' },
  { value: '09:00', label: '09:00 AM' },
  { value: '12:00', label: '12:00 PM' },
  { value: '17:00', label: '05:00 PM' },
];

const TRIGGER_OPTIONS: { id: 'expired' | 'critical' | 'expiring_soon' | 'agent_jobs'; label: string }[] = [
  { id: 'expired',       label: 'Expired certificates' },
  { id: 'critical',      label: 'Critical (≤7 days)' },
  { id: 'expiring_soon', label: 'Expiring soon' },
  { id: 'agent_jobs',    label: 'Agent job completions' },
];

export const SettingsView = () => {
  const { isAdmin } = useAuth();
  const { settings, loading, initialize } = useSystemSettingsLazy();

  // API connection test
  const [apiUrl] = useState('http://localhost:5000');
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionResult, setConnectionResult] = useState<{ ok: boolean; data?: HealthData } | null>(null);

  // Email log
  const [emailLog, setEmailLog] = useState<EmailLogEntry[]>([]);
  const [emailLogLoading, setEmailLogLoading] = useState(true);

  // SNS test
  const [snsTestLoading, setSnsTestLoading] = useState(false);
  const [weeklyReportLoading, setWeeklyReportLoading] = useState(false);

  // SNS config (from backend)
  const [snsConfig, setSnsConfig] = useState<AwsSnsConfig | null>(null);
  const [snsConfigLoading, setSnsConfigLoading] = useState(true);

  // S3 status
  const [s3Status, setS3Status] = useState<S3Status | null>(null);
  const [s3StatusLoading, setS3StatusLoading] = useState(true);
  const [s3Syncing, setS3Syncing] = useState(false);

  // DynamoDB status
  const [ddbStatus, setDdbStatus] = useState<DynamoDbStatus | null>(null);
  const [ddbStatusLoading, setDdbStatusLoading] = useState(true);
  const [ddbTesting, setDdbTesting] = useState(false);

  // Notification preferences
  const [recipients, setRecipients] = useState<string[]>([DEFAULT_RECIPIENT]);
  const [dailyTime, setDailyTime] = useState<string>('09:00');
  const [triggers, setTriggers] = useState<Record<string, boolean>>({
    expired:       true,
    critical:      true,
    expiring_soon: true,
    agent_jobs:    false,
  });
  const [startupAlertsEnabled, setStartupAlertsEnabled] = useState(false);
  const [npSaving, setNpSaving] = useState(false);

  useEffect(() => {
    api.get('/notify/email/log').then((data: EmailLogEntry[] | null) => {
      if (data) setEmailLog(data);
      setEmailLogLoading(false);
    });
  }, []);

  const inferReportType = (entry: EmailLogEntry) => {
    const rt = String(entry.report_type ?? '').trim().toLowerCase();
    if (rt) return rt;
    const subject = String(entry.subject ?? '').toLowerCase();
    if (entry.certificate_id === 'WEEKLY_REPORT' || subject.includes('[weekly report]')) return 'weekly report';
    if (entry.certificate_id === 'BULK_ALERT' || subject.includes('[urgent]')) return 'bulk alert';
    if (subject.includes('[deployed]') || subject.includes('deployment')) return 'deployment confirmed';
    return 'single cert alert';
  };

  useEffect(() => {
    api.get('/aws/sns/config').then((data: AwsSnsConfig | null) => {
      if (data && typeof data.region === 'string') setSnsConfig(data);
      setSnsConfigLoading(false);
    });
  }, []);

  useEffect(() => {
    api.get('/aws/s3/status').then((data: S3Status | null) => {
      if (data) setS3Status(data);
      setS3StatusLoading(false);
    });
  }, []);

  const fetchDynamoDbStatus = async () => {
    const data: DynamoDbStatus | null = await api.get('/aws/dynamodb/status');
    if (data) setDdbStatus(data);
  };

  useEffect(() => {
    fetchDynamoDbStatus().finally(() => setDdbStatusLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    api.get('/notifications/settings').then((data: NotificationPrefs | null) => {
      if (data && Array.isArray(data.recipients)) {
        setRecipients(
          data.recipients.length > 0 ? data.recipients.slice(0, MAX_RECIPIENTS) : [DEFAULT_RECIPIENT],
        );
        if (typeof data.daily_time === 'string' && data.daily_time) {
          setDailyTime(data.daily_time);
        }
        if (Array.isArray(data.triggers)) {
          setTriggers({
            expired:       data.triggers.includes('expired'),
            critical:      data.triggers.includes('critical'),
            expiring_soon: data.triggers.includes('expiring_soon'),
            agent_jobs:    data.triggers.includes('agent_jobs'),
          });
        }
        if (typeof data.startup_alerts_enabled === 'boolean') {
          setStartupAlertsEnabled(data.startup_alerts_enabled);
        }
      }
    });
  }, []);

  const formatArn = (arn: string) => {
    const trimmed = (arn ?? '').trim();
    if (!trimmed) return '';
    if (trimmed.length <= 42) return trimmed;
    return `${trimmed.slice(0, 22)}…${trimmed.slice(-12)}`;
  };

  const handleS3Sync = async () => {
    if (!isAdmin) return;
    setS3Syncing(true);
    const result = await api.post('/aws/s3/sync', {});
    setS3Syncing(false);
    if (result?.status === 'triggered') {
      toast.success('Sync triggered successfully');
      setTimeout(async () => {
        const data: S3Status | null = await api.get('/aws/s3/status');
        if (data) setS3Status(data);
      }, 3000);
    } else {
      toast.error('S3 sync failed — check api_bridge logs');
    }
  };

  const handleTestDynamoDb = async () => {
    setDdbTesting(true);
    try {
      await fetchDynamoDbStatus();
      toast.success('DynamoDB status refreshed');
    } catch {
      toast.error('DynamoDB test failed — check api_bridge logs');
    } finally {
      setDdbTesting(false);
    }
  };

  const handleSnsTest = async () => {
    if (!isAdmin) return;
    setSnsTestLoading(true);
    const result = await api.post('/notify/email', {
      certificate_id: 'CERT-006',
      recipient_email: 'admin@its.ms.gov',
      message: 'Test notification from CSR Lifecycle dashboard',
    });
    setSnsTestLoading(false);
    if (result?.email_log_entry) {
      const entry = result.email_log_entry;
      if (entry.provider === 'aws_sns') {
        toast.success('Real email sent via AWS SNS — check your inbox');
      } else {
        toast.info('Sent (simulated) — configure SNS_TOPIC_ARN and restart the API for real emails');
      }
      const log = await api.get('/notify/email/log');
      if (log) setEmailLog(log);

      setSnsConfigLoading(true);
      const cfg = await api.get('/aws/sns/config');
      if (cfg && typeof cfg.region === 'string') setSnsConfig(cfg);
      setSnsConfigLoading(false);
    } else {
      toast.error('SNS test failed — check api_bridge logs');
    }
  };

  const handleWeeklyReport = async () => {
    if (!isAdmin) return;
    setWeeklyReportLoading(true);
    const result = await api.post('/reports/weekly', {});
    setWeeklyReportLoading(false);

    if (result?.status === 'triggered') {
      const recipients: string[] = Array.isArray(result?.recipients) ? result.recipients : [];
      toast.success(`Weekly report sent to ${recipients.length ? recipients.join(', ') : '(no recipients)'} via AWS SNS`);
    } else {
      toast.error('Failed to send report');
    }
  };

  const handleTestConnection = async () => {
    setTestingConnection(true);
    setConnectionResult(null);
    const data: HealthData | null = await api.get('/health');
    if (data && data.status) {
      setConnectionResult({ ok: true, data });
    } else {
      setConnectionResult({ ok: false });
    }
    setTestingConnection(false);
  };

  // Initialize settings on mount
  if (typeof initialize === 'function') {
    // lazy init — called once via useEffect in the hook itself
  }

  const handleRecipientChange = (index: number, value: string) => {
    setRecipients(prev => prev.map((r, i) => (i === index ? value : r)));
  };

  const handleAddRecipient = () => {
    setRecipients(prev => (prev.length >= MAX_RECIPIENTS ? prev : [...prev, '']));
  };

  const handleRemoveRecipient = (index: number) => {
    setRecipients(prev => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  };

  const handleTriggerToggle = (id: string, checked: boolean) => {
    setTriggers(prev => ({ ...prev, [id]: checked }));
  };

  const handleSaveNotificationPrefs = async () => {
    if (!isAdmin) return;
    const cleaned = recipients.map(r => r.trim()).filter(Boolean);
    if (cleaned.length === 0) {
      toast.error('At least one recipient email is required');
      return;
    }
    setNpSaving(true);
    const payload = {
      recipients: cleaned,
      daily_time: dailyTime,
      triggers: Object.entries(triggers).filter(([, v]) => v).map(([k]) => k),
      startup_alerts_enabled: startupAlertsEnabled,
    };
    const result = await api.post('/notifications/settings', payload);
    setNpSaving(false);
    if (result?.status === 'saved') {
      const added: string[] = Array.isArray(result?.sns_added) ? result.sns_added : [];
      const removed: string[] = Array.isArray(result?.sns_removed) ? result.sns_removed : [];
      const snsError: string | null = typeof result?.sns_error === 'string' && result.sns_error
        ? result.sns_error
        : null;

      if (added.length > 0) {
        toast.success(`Settings saved — confirmation email sent to: ${added.join(', ')}`);
      }

      if (removed.length > 0) {
        toast(`${removed.join(', ')} unsubscribed from alerts`);
      }

      if (snsError) {
        toast.warning('Settings saved locally — SNS sync pending (check IAM permissions)');
      }

      if (added.length === 0 && removed.length === 0 && !snsError) {
        toast.success('Notification settings saved');
      }

      if (result.settings?.recipients) {
        setRecipients(result.settings.recipients.slice(0, MAX_RECIPIENTS));
      }
      if (typeof result.settings?.startup_alerts_enabled === 'boolean') {
        setStartupAlertsEnabled(result.settings.startup_alerts_enabled);
      }
    } else {
      toast.error('Failed to save notification settings');
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-3xl font-bold text-white">Settings</h2>
          <p className="text-gray-400">Certificate lifecycle configuration</p>
        </div>
        <div className="grid grid-cols-1 gap-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-64 w-full bg-gray-800" />
          ))}
        </div>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="space-y-4">
        <h2 className="text-3xl font-bold text-white">Settings</h2>
        <p className="text-gray-400">Failed to load settings.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold text-white">Settings</h2>
        <p className="text-gray-400">Certificate lifecycle configuration</p>
      </div>

      {/* Notification Preferences — recipients, digest time, triggers */}
      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Bell className="h-5 w-5 text-orange-400" />
            Notification Preferences
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <Label className="text-gray-300 mb-2 block">Alert Recipients</Label>
            <div className="space-y-2">
              {recipients.map((email, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => handleRecipientChange(idx, e.target.value)}
                    placeholder="name@example.com"
                    className="bg-gray-700 border-gray-600 text-white flex-1"
                  />
                  {recipients.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemoveRecipient(idx)}
                      className="text-gray-400 hover:text-red-400 hover:bg-gray-700 shrink-0"
                      aria-label="Remove recipient"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
            {recipients.length < MAX_RECIPIENTS && (
              <button
                type="button"
                onClick={handleAddRecipient}
                className="mt-2 inline-flex items-center gap-1 text-sm text-blue-400 hover:text-blue-300"
              >
                <Plus className="h-3.5 w-3.5" />
                Add recipient
              </button>
            )}
            <p className="mt-1 text-xs text-gray-500">
              Up to {MAX_RECIPIENTS} recipients will receive alerts.
            </p>
          </div>

          <div>
            <Label className="text-gray-300 mb-2 block flex items-center gap-2">
              <Clock className="h-4 w-4 text-gray-400" />
              Send daily alert summary at
            </Label>
            <Select value={dailyTime} onValueChange={setDailyTime}>
              <SelectTrigger className="bg-gray-700 border-gray-600 text-white w-full sm:w-64">
                <SelectValue placeholder="Select a time" />
              </SelectTrigger>
              <SelectContent className="bg-gray-800 border-gray-700 text-white">
                {DIGEST_TIME_OPTIONS.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-xs text-gray-500">
              Time is evaluated in UTC on the server.
            </p>
          </div>

          <div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="startup-alerts"
                checked={startupAlertsEnabled}
                onCheckedChange={(checked) => setStartupAlertsEnabled(checked === true)}
              />
              <label htmlFor="startup-alerts" className="text-sm text-gray-300 cursor-pointer">
                Send bulk alert when the API server starts (STARTUP ALERT)
              </label>
            </div>
            <p className="mt-1 text-xs text-gray-500 pl-6">
              When off, only the scheduled daily digest and automatic weekly report are sent via SNS (plus manual test buttons). Saves with Notification Settings below.
            </p>
          </div>

          <div>
            <Label className="text-gray-300 mb-2 block">Alert Triggers</Label>
            <div className="space-y-2">
              {TRIGGER_OPTIONS.map(opt => (
                <div key={opt.id} className="flex items-center gap-2">
                  <Checkbox
                    id={`trigger-${opt.id}`}
                    checked={!!triggers[opt.id]}
                    onCheckedChange={(checked) => handleTriggerToggle(opt.id, checked === true)}
                  />
                  <label
                    htmlFor={`trigger-${opt.id}`}
                    className="text-sm text-gray-300 cursor-pointer"
                  >
                    {opt.label}
                  </label>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end">
            <Button
              onClick={handleSaveNotificationPrefs}
              disabled={npSaving || !isAdmin}
              title={!isAdmin ? 'Admin access required' : undefined}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {npSaving
                ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                : <Save className="h-4 w-4 mr-2" />}
              Save Notification Settings
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* AWS SNS Configuration Card */}
      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Bell className="h-5 w-5 text-orange-400" />
            AWS SNS Configuration
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label className="text-gray-400 text-sm mb-1 block">Topic ARN</Label>
              <div className="flex items-center gap-2">
                {snsConfigLoading ? (
                  <Badge className="bg-gray-600/20 text-gray-300 border border-gray-500/30 text-xs px-3 py-1">
                    Loading…
                  </Badge>
                ) : snsConfig?.configured ? (
                  <Badge className="bg-green-600/20 text-green-400 border border-green-500/30 text-xs px-3 py-1">
                    Configured
                  </Badge>
                ) : (
                  <Badge className="bg-gray-600/20 text-gray-300 border border-gray-500/30 text-xs px-3 py-1">
                    Not configured
                  </Badge>
                )}
                <span className="text-gray-500 text-xs font-mono truncate max-w-[260px]">
                  {snsConfig?.topic_arn ? formatArn(snsConfig.topic_arn) : '—'}
                </span>
              </div>
            </div>
            <div>
              <Label className="text-gray-400 text-sm mb-1 block">Region</Label>
              <span className="text-white font-mono text-sm">
                {snsConfigLoading ? 'loading…' : (snsConfig?.region || '—')}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <Button
              onClick={handleSnsTest}
              disabled={snsTestLoading || !isAdmin}
              title={!isAdmin ? 'Admin access required' : undefined}
              className="bg-orange-600 hover:bg-orange-500 text-white"
              size="sm"
            >
              {snsTestLoading
                ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                : <Bell className="h-4 w-4 mr-2" />}
              Test SNS
            </Button>
            <Button
              onClick={handleWeeklyReport}
              disabled={weeklyReportLoading || !isAdmin}
              title={!isAdmin ? 'Admin access required' : undefined}
              className="bg-blue-600 hover:bg-blue-500 text-white"
              size="sm"
            >
              {weeklyReportLoading
                ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                : <Calendar className="h-4 w-4 mr-2" />}
              Send Weekly Report
            </Button>
          </div>
          <p className="text-gray-500 text-xs">
            Generates and emails a full certificate lifecycle report to all configured recipients. Runs automatically every 7 days.
          </p>
        </CardContent>
      </Card>

      {/* API Connection Card */}
      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Wifi className="h-5 w-5 text-blue-400" />
            API Connection
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <Label className="text-gray-400 text-sm mb-1 block">API Base URL</Label>
              <Input
                readOnly
                value={apiUrl}
                className="bg-gray-700 border-gray-600 text-white"
              />
            </div>
            <Button
              onClick={handleTestConnection}
              disabled={testingConnection}
              className="bg-blue-600 hover:bg-blue-700 text-white shrink-0"
            >
              {testingConnection
                ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                : <Wifi className="h-4 w-4 mr-2" />}
              Test Connection
            </Button>
          </div>

          {connectionResult && (
            connectionResult.ok ? (
              <div className="p-3 bg-green-900/30 border border-green-600 rounded-md text-green-300 text-sm space-y-0.5">
                <p className="font-semibold flex items-center gap-2">
                  <Wifi className="h-4 w-4" /> Connected
                </p>
                {connectionResult.data && (
                  <>
                    <p>{connectionResult.data.cert_count} certificates loaded</p>
                    <p>Last refreshed: {new Date(connectionResult.data.last_refreshed).toLocaleString()}</p>
                    <p>Version: {connectionResult.data.version}</p>
                  </>
                )}
              </div>
            ) : (
              <div className="p-3 bg-red-900/30 border border-red-600 rounded-md text-red-300 text-sm flex items-center gap-2">
                <WifiOff className="h-4 w-4" />
                Cannot reach API at localhost:5000 — make sure api_bridge.py is running
              </div>
            )
          )}
        </CardContent>
      </Card>

      {/* AWS S3 Data Sync */}
      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Database className="h-5 w-5 text-emerald-400" />
            AWS S3 Data Sync
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {s3StatusLoading ? (
            <div className="flex items-center gap-2 text-gray-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Checking S3 status…
            </div>
          ) : s3Status ? (
            <div className="space-y-2">
              {s3Status.buckets.map(b => (
                <div key={b.bucket} className="flex items-center justify-between py-1.5 border-b border-gray-700 last:border-0">
                  <span className="text-gray-300 text-sm font-mono">{b.bucket}</span>
                  {b.accessible ? (
                    <span className="text-xs text-green-400 font-medium">
                      Accessible ({b.object_count} object{b.object_count !== 1 ? 's' : ''})
                    </span>
                  ) : (
                    <span className="text-xs text-red-400 font-medium" title={b.error}>
                      Not accessible
                    </span>
                  )}
                </div>
              ))}
              <p className="text-xs text-gray-500">Region: {s3Status.region}</p>
            </div>
          ) : (
            <p className="text-gray-400 text-sm">S3 status unavailable</p>
          )}

          <div className="flex items-center gap-3 pt-1">
            <Button
              onClick={handleS3Sync}
              disabled={s3Syncing || !isAdmin}
              title={!isAdmin ? 'Admin access required' : undefined}
              className="bg-emerald-600 hover:bg-emerald-500 text-white"
              size="sm"
            >
              {s3Syncing
                ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                : <RefreshCw className="h-4 w-4 mr-2" />}
              Sync Now
            </Button>
            <span className="text-gray-500 text-xs">
              Uploads certificate inventory and renewal jobs to S3
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Email Notification Log */}
      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Mail className="h-5 w-5 text-blue-400" />
            Email Notification Log
          </CardTitle>
        </CardHeader>
        <CardContent>
          {emailLogLoading ? (
            <div className="flex items-center gap-2 text-gray-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading email log…
            </div>
          ) : emailLog.length === 0 ? (
            <p className="text-gray-400 text-sm">No emails sent yet — send a test alert from the Alerts page.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-400 border-b border-gray-700 text-xs">
                    <th className="text-left py-2 pr-4 font-medium">Domain</th>
                    <th className="text-left py-2 pr-4 font-medium">Report Type</th>
                    <th className="text-left py-2 pr-4 font-medium">Recipient</th>
                    <th className="text-left py-2 pr-4 font-medium">Subject</th>
                    <th className="text-left py-2 pr-4 font-medium">Sent At</th>
                    <th className="text-left py-2 pr-4 font-medium">Provider</th>
                    <th className="text-left py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700/50">
                  {emailLog.map(entry => (
                    <tr key={entry.id} className="hover:bg-gray-700/40">
                      <td className="py-2 pr-4 text-white font-mono text-xs">{entry.domain_name}</td>
                      <td className="py-2 pr-4 text-gray-300 text-xs whitespace-nowrap">
                        <Badge className="bg-violet-600/20 text-violet-300 border border-violet-500/30 text-xs">
                          {inferReportType(entry)}
                        </Badge>
                      </td>
                      <td className="py-2 pr-4 text-gray-300 text-xs">{entry.recipient_email}</td>
                      <td className="py-2 pr-4 text-gray-300 text-xs max-w-[180px] truncate" title={entry.subject}>
                        {entry.subject}
                      </td>
                      <td className="py-2 pr-4 text-gray-400 text-xs whitespace-nowrap">
                        {new Date(entry.sent_at).toLocaleString()}
                      </td>
                      <td className="py-2 pr-4">
                        {entry.provider === 'aws_sns' ? (
                          <div>
                            <Badge className="bg-blue-600/20 text-blue-400 border border-blue-500/30 text-xs">
                              AWS SNS
                            </Badge>
                            {entry.sns_message_id && (
                              <p className="text-gray-600 text-[10px] font-mono mt-0.5 truncate max-w-[120px]"
                                title={entry.sns_message_id}>
                                {entry.sns_message_id}
                              </p>
                            )}
                          </div>
                        ) : (
                          <Badge className="bg-gray-600/20 text-gray-400 border border-gray-500/30 text-xs">
                            Simulated
                          </Badge>
                        )}
                      </td>
                      <td className="py-2">
                        <Badge className="bg-green-600/20 text-green-400 border border-green-500/30 text-xs">
                          Sent
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* AWS DynamoDB Status */}
      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Database className="h-5 w-5 text-emerald-400" />
            AWS DynamoDB Status
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-gray-500">
              AWS Region: <span className="font-mono text-gray-300">{snsConfig?.region || '—'}</span>
            </div>
            <Button
              onClick={handleTestDynamoDb}
              disabled={ddbTesting}
              className="bg-emerald-600 hover:bg-emerald-500 text-white"
              size="sm"
            >
              {ddbTesting
                ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                : <RefreshCw className="h-4 w-4 mr-2" />}
              Test DynamoDB
            </Button>
          </div>

          {ddbStatusLoading ? (
            <div className="flex items-center gap-2 text-gray-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Checking DynamoDB tables…
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-400 border-b border-gray-700 text-xs">
                    <th className="text-left py-2 pr-4 font-medium">Table</th>
                    <th className="text-left py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700/50">
                  {[
                    'cert-lifecycle-certificates',
                    'cert-lifecycle-notifications',
                    'cert-lifecycle-email-log',
                    'cert-lifecycle-settings',
                    'cert-lifecycle-agent-jobs',
                  ].map((table) => {
                    const status = ddbStatus?.[table];
                    const ok = status === 'ok';
                    const unknown = status === undefined || status === null || status === '';
                    return (
                      <tr key={table} className="hover:bg-gray-700/40">
                        <td className="py-2 pr-4 text-white font-mono text-xs">{table}</td>
                        <td className="py-2">
                          {unknown ? (
                            <Badge className="bg-gray-600/20 text-gray-300 border border-gray-500/30 text-xs">
                              Unknown
                            </Badge>
                          ) : ok ? (
                            <Badge className="bg-green-600/20 text-green-400 border border-green-500/30 text-xs">
                              Connected
                            </Badge>
                          ) : (
                            <Badge className="bg-red-600/20 text-red-400 border border-red-500/30 text-xs">
                              Error
                            </Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!ddbStatus && (
                <p className="text-gray-500 text-xs mt-2">
                  No status response received. Ensure `api_bridge.py` is running and DynamoDB tables exist.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

    </div>
  );
};
