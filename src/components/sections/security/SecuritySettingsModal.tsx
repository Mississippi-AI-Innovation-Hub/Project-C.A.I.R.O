
import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Shield, Clock, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/utils/api';
import { useAuth } from '@/contexts/AuthContext';

interface SecuritySettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

export const SecuritySettingsModal = ({ isOpen, onClose, onSaved }: SecuritySettingsModalProps) => {
  const { isAdmin } = useAuth();
  type MonitoringSettings = {
    critical_threshold_days: number;
    warning_threshold_days: number;
    check_interval: 'hourly' | 'daily' | 'weekly';
    auto_renewal_enabled: boolean;
  };

  const [loading, setLoading] = useState(false);

  const [criticalThreshold, setCriticalThreshold] = useState<number>(7);
  const [warningThreshold, setWarningThreshold] = useState<number>(30);
  const [checkInterval, setCheckInterval] = useState<MonitoringSettings['check_interval']>('daily');
  const [autoRenewalEnabled, setAutoRenewalEnabled] = useState<boolean>(true);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoading(true);
    api.get('/monitoring/settings').then((data) => {
      if (cancelled) return;
      if (!data || (data as { error?: string }).error) {
        toast.error('Failed to load monitoring settings', {
          className: '!bg-red-950 !text-red-50 !border !border-red-600',
        });
        setLoading(false);
        return;
      }
      const s = data as MonitoringSettings;
      setCriticalThreshold(Number(s.critical_threshold_days ?? 7));
      setWarningThreshold(Number(s.warning_threshold_days ?? 30));
      setCheckInterval((s.check_interval ?? 'daily') as MonitoringSettings['check_interval']);
      setAutoRenewalEnabled(Boolean(s.auto_renewal_enabled));
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [isOpen]);

  const handleSave = async () => {
    if (!isAdmin) return;
    if (warningThreshold < criticalThreshold) {
      toast.error('Warning threshold must be greater than or equal to critical threshold', {
        className: '!bg-red-950 !text-red-50 !border !border-red-600',
      });
      return;
    }

    const payload: MonitoringSettings = {
      critical_threshold_days: Number(criticalThreshold),
      warning_threshold_days: Number(warningThreshold),
      check_interval: checkInterval,
      auto_renewal_enabled: Boolean(autoRenewalEnabled),
    };

    setLoading(true);
    try {
      await api.postExpectOk('/monitoring/settings', payload);
      toast.success('Monitoring settings saved', {
        className: '!bg-emerald-950 !text-emerald-50 !border !border-emerald-600',
      });
      onSaved?.();
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to save monitoring settings';
      toast.error(msg, {
        className: '!bg-red-950 !text-red-50 !border !border-red-600',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto bg-gray-800 border-gray-700">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Certificate Monitoring Settings
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          <Card className="bg-gray-750 border-gray-600">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                Alert Thresholds
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="criticalThreshold" className="text-gray-300">
                    Critical Threshold (days)
                  </Label>
                  <Input
                    id="criticalThreshold"
                    type="number"
                    value={criticalThreshold}
                    onChange={(e) => setCriticalThreshold(Number(e.target.value))}
                    className="bg-gray-700 border-gray-600 text-white"
                    min="1"
                    max="365"
                    disabled={loading}
                  />
                  <p className="text-xs text-gray-400 mt-1">Days before expiry to mark a certificate as critical</p>
                </div>

                <div>
                  <Label htmlFor="warningThreshold" className="text-gray-300">
                    Warning Threshold (days)
                  </Label>
                  <Input
                    id="warningThreshold"
                    type="number"
                    value={warningThreshold}
                    onChange={(e) => setWarningThreshold(Number(e.target.value))}
                    className="bg-gray-700 border-gray-600 text-white"
                    min="1"
                    max="365"
                    disabled={loading}
                  />
                  <p className="text-xs text-gray-400 mt-1">Days before expiry to mark a certificate as expiring soon</p>
                </div>
              </div>

              <div>
                <Label htmlFor="checkInterval" className="text-gray-300">Check Interval</Label>
                <Select value={checkInterval} onValueChange={(value) => setCheckInterval(value as MonitoringSettings['check_interval'])} disabled={loading}>
                  <SelectTrigger className="bg-gray-700 border-gray-600 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-700 border-gray-600">
                    <SelectItem value="hourly">Hourly</SelectItem>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-gray-400 mt-1">How often the backend re-evaluates certificate status and auto-renewal</p>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gray-750 border-gray-600">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Auto-Renewal
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-white font-medium">Enable Auto-Renewal</h4>
                  <p className="text-sm text-gray-400">
                    When on, qualifying certificates with per-cert auto-renew enabled are renewed automatically
                  </p>
                </div>
                <Switch checked={autoRenewalEnabled} onCheckedChange={setAutoRenewalEnabled} disabled={loading} />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t border-gray-600">
          <Button variant="outline" onClick={onClose} className="bg-gray-700 border-gray-600 text-white hover:bg-gray-600">
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            className="bg-blue-600 hover:bg-blue-700 text-white"
            disabled={loading || !isAdmin}
            title={!isAdmin ? 'Admin access required' : undefined}
          >
            Save Settings
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
