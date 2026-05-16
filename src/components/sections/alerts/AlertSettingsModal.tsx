
import React, { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Settings, Bell, Clock, Filter } from 'lucide-react';
import { toast } from 'sonner';

interface AlertSettingsModalProps {
  trigger?: React.ReactNode;
  onSaved?: (settings: AlertDisplaySettings) => void;
  initialSettings?: Partial<AlertDisplaySettings>;
}

export type AlertSeverityFilter = 'all' | 'critical' | 'warning';

export type AlertDisplaySettings = {
  autoRefreshEnabled: boolean;
  refreshIntervalSeconds: number;
  alertsPerPage: number;
  defaultSeverityFilter: AlertSeverityFilter;
};

const STORAGE_KEY = 'alertSettings';

const DEFAULT_SETTINGS: AlertDisplaySettings = {
  autoRefreshEnabled: true,
  refreshIntervalSeconds: 30,
  alertsPerPage: 50,
  defaultSeverityFilter: 'all',
};

const parseStored = (raw: string | null): AlertDisplaySettings | null => {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw) as Partial<AlertDisplaySettings>;
    if (!obj || typeof obj !== 'object') return null;
    const autoRefreshEnabled =
      typeof obj.autoRefreshEnabled === 'boolean' ? obj.autoRefreshEnabled : DEFAULT_SETTINGS.autoRefreshEnabled;
    const refreshIntervalSeconds =
      typeof obj.refreshIntervalSeconds === 'number' && Number.isFinite(obj.refreshIntervalSeconds)
        ? Math.max(5, Math.floor(obj.refreshIntervalSeconds))
        : DEFAULT_SETTINGS.refreshIntervalSeconds;
    const alertsPerPage =
      typeof obj.alertsPerPage === 'number' && Number.isFinite(obj.alertsPerPage)
        ? Math.max(10, Math.floor(obj.alertsPerPage))
        : DEFAULT_SETTINGS.alertsPerPage;
    const defaultSeverityFilter =
      obj.defaultSeverityFilter === 'critical' || obj.defaultSeverityFilter === 'warning' || obj.defaultSeverityFilter === 'all'
        ? obj.defaultSeverityFilter
        : DEFAULT_SETTINGS.defaultSeverityFilter;
    return { autoRefreshEnabled, refreshIntervalSeconds, alertsPerPage, defaultSeverityFilter };
  } catch {
    return null;
  }
};

export const AlertSettingsModal = ({ trigger, onSaved, initialSettings }: AlertSettingsModalProps) => {
  const [open, setOpen] = useState(false);

  const hydratedDefaults = useMemo<AlertDisplaySettings>(() => {
    const stored = parseStored(localStorage.getItem(STORAGE_KEY));
    return { ...DEFAULT_SETTINGS, ...stored, ...initialSettings };
  }, [initialSettings]);

  const [settings, setSettings] = useState<AlertDisplaySettings>(hydratedDefaults);

  // Re-hydrate on open (covers settings changed elsewhere / multi-tab)
  useEffect(() => {
    if (!open) return;
    const stored = parseStored(localStorage.getItem(STORAGE_KEY));
    if (stored) setSettings(prev => ({ ...prev, ...stored }));
  }, [open]);

  const handleSave = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    onSaved?.(settings);
    toast.success('Alert display settings saved', {
      className: '!bg-emerald-950 !text-emerald-50 !border !border-emerald-600',
    });
    setOpen(false);
  };

  const handleCancel = () => setOpen(false);

  const handleReset = () => {
    setSettings(hydratedDefaults);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(hydratedDefaults));
    onSaved?.(hydratedDefaults);
    toast.success('Alert display settings saved', {
      className: '!bg-emerald-950 !text-emerald-50 !border !border-emerald-600',
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button className="bg-blue-600 hover:bg-blue-700 text-white">
            <Settings className="h-4 w-4 mr-2" />
            Alert Settings
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto bg-gray-800 border-gray-700">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Alert Settings
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* General Settings */}
          <Card className="bg-gray-750 border-gray-600">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Bell className="h-4 w-4" />
                General
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex items-center justify-between">
                  <Label className="text-gray-300">Auto Refresh</Label>
                  <Switch
                    checked={settings.autoRefreshEnabled}
                    onCheckedChange={(checked) => setSettings(prev => ({ ...prev, autoRefreshEnabled: checked }))}
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-gray-300">Refresh Interval (seconds)</Label>
                  <Input
                    type="number"
                    value={settings.refreshIntervalSeconds}
                    onChange={(e) => setSettings(prev => ({ ...prev, refreshIntervalSeconds: Math.max(5, Number(e.target.value || 0)) }))}
                    className="bg-gray-700 border-gray-600 text-white"
                    disabled={!settings.autoRefreshEnabled}
                    min={5}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Display Settings */}
          <Card className="bg-gray-750 border-gray-600">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Filter className="h-4 w-4" />
                Display
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-gray-300">Alerts Per Page</Label>
                  <Select
                    value={String(settings.alertsPerPage)}
                    onValueChange={(value) => setSettings(prev => ({ ...prev, alertsPerPage: Number(value) }))}
                  >
                    <SelectTrigger className="bg-gray-700 border-gray-600 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-gray-700 border-gray-600">
                      <SelectItem value="25">25</SelectItem>
                      <SelectItem value="50">50</SelectItem>
                      <SelectItem value="100">100</SelectItem>
                      <SelectItem value="200">200</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-gray-300">Default Severity Filter</Label>
                  <Select
                    value={settings.defaultSeverityFilter}
                    onValueChange={(value) => setSettings(prev => ({ ...prev, defaultSeverityFilter: value }))}
                  >
                    <SelectTrigger className="bg-gray-700 border-gray-600 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-gray-700 border-gray-600">
                      <SelectItem value="all">All Severity</SelectItem>
                      <SelectItem value="critical">Critical</SelectItem>
                      <SelectItem value="warning">Warning</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Action Buttons */}
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={handleCancel} className="bg-gray-700 border-gray-600 text-white hover:bg-gray-600">
              Cancel
            </Button>
            <Button variant="outline" onClick={handleReset} className="bg-gray-700 border-gray-600 text-white hover:bg-gray-600">
              Reset to Defaults
            </Button>
            <Button onClick={handleSave} className="bg-blue-600 hover:bg-blue-700 text-white">
              Save Settings
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
