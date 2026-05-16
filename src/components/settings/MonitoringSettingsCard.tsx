/**
 * Monitoring Settings Card Component
 * Provides UI for managing automatic monitoring and SMS notifications
 */

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { 
  Play, 
  Pause, 
  RefreshCw, 
  MessageSquare, 
  Activity, 
  AlertTriangle,
  CheckCircle,
  Clock,
  Settings
} from 'lucide-react';
import { useMonitoring } from '@/hooks/useMonitoring';
import { useSmsNotifications } from '@/hooks/useSmsNotifications';

export const MonitoringSettingsCard = () => {
  const {
    status,
    config,
    startMonitoring,
    stopMonitoring,
    triggerStatusCheck,
    updateConfig,
    sendTestMonitoringSms
  } = useMonitoring();

  const { isSmsEnabled, shouldSendSms } = useSmsNotifications();
  const [isExpanded, setIsExpanded] = useState(false);

  const getStatusIcon = () => {
    if (status.error) {
      return <AlertTriangle className="h-4 w-4 text-red-400" />;
    }
    if (status.isRunning) {
      return <CheckCircle className="h-4 w-4 text-green-400" />;
    }
    return <Pause className="h-4 w-4 text-gray-400" />;
  };

  const getStatusText = () => {
    if (status.error) {
      return 'Erreur';
    }
    if (status.isRunning) {
      return 'Actif';
    }
    return 'Arrêté';
  };

  const getStatusColor = () => {
    if (status.error) {
      return 'bg-red-600';
    }
    if (status.isRunning) {
      return 'bg-green-600';
    }
    return 'bg-gray-600';
  };

  const formatInterval = (ms: number) => {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
  };

  const handleIntervalChange = (key: keyof typeof config, value: string) => {
    const numValue = parseInt(value) * 1000; // Convert seconds to milliseconds
    if (!isNaN(numValue) && numValue > 0) {
      updateConfig({ [key]: numValue });
    }
  };

  return (
    <Card className="bg-gray-750 border-gray-600">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <Activity className="h-5 w-5" />
          Monitoring Automatique
        </CardTitle>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {getStatusIcon()}
            <span className="text-sm text-gray-300">
              Statut: <Badge className={`${getStatusColor()} text-white`}>{getStatusText()}</Badge>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsExpanded(!isExpanded)}
              className="text-gray-300 border-gray-600 hover:bg-gray-700"
            >
              <Settings className="h-4 w-4 mr-1" />
              {isExpanded ? 'Masquer' : 'Configurer'}
            </Button>
            {status.isRunning ? (
              <Button
                variant="destructive"
                size="sm"
                onClick={stopMonitoring}
                className="text-white"
              >
                <Pause className="h-4 w-4 mr-1" />
                Arrêter
              </Button>
            ) : (
              <Button
                variant="default"
                size="sm"
                onClick={startMonitoring}
                className="text-white bg-green-600 hover:bg-green-700"
              >
                <Play className="h-4 w-4 mr-1" />
                Démarrer
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Status Information */}
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <Label className="text-gray-400">Moniteurs actifs</Label>
            <div className="flex flex-wrap gap-1 mt-1">
              {status.activeMonitors.length > 0 ? (
                status.activeMonitors.map((monitor) => (
                  <Badge key={monitor} variant="secondary" className="text-xs">
                    {monitor}
                  </Badge>
                ))
              ) : (
                <span className="text-gray-500">Aucun</span>
              )}
            </div>
          </div>
          <div>
            <Label className="text-gray-400">Dernière vérification</Label>
            <div className="flex items-center gap-1 mt-1">
              <Clock className="h-3 w-3 text-gray-400" />
              <span className="text-gray-300">
                {status.lastCheck ? status.lastCheck.toLocaleTimeString() : 'Jamais'}
              </span>
            </div>
          </div>
        </div>

        {status.error && (
          <div className="p-3 bg-red-900/20 border border-red-600 rounded-md">
            <div className="flex items-center gap-2 text-red-400">
              <AlertTriangle className="h-4 w-4" />
              <span className="text-sm font-medium">Erreur de monitoring</span>
            </div>
            <p className="text-sm text-red-300 mt-1">{status.error}</p>
          </div>
        )}

        {/* SMS Configuration Status */}
        <div className="p-3 bg-gray-700 rounded-md">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-blue-400" />
              <span className="text-sm text-gray-300">Notifications SMS</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge className={isSmsEnabled() ? 'bg-green-600' : 'bg-red-600'}>
                {isSmsEnabled() ? 'Configuré' : 'Non configuré'}
              </Badge>
              <Button
                variant="outline"
                size="sm"
                onClick={sendTestMonitoringSms}
                disabled={!isSmsEnabled()}
                className="text-gray-300 border-gray-600 hover:bg-gray-600"
              >
                <MessageSquare className="h-3 w-3 mr-1" />
                Test
              </Button>
            </div>
          </div>
          {!isSmsEnabled() && (
            <p className="text-xs text-gray-400 mt-1">
              Configurez les paramètres SMS pour recevoir des notifications automatiques
            </p>
          )}
        </div>

        {/* Expanded Configuration */}
        {isExpanded && (
          <div className="space-y-4">
            <Separator className="bg-gray-600" />
            
            <div>
              <Label className="text-gray-300 mb-3 block">Intervalles de vérification</Label>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="ssl-interval" className="text-sm text-gray-400">
                    Certificats SSL (secondes)
                  </Label>
                  <Input
                    id="ssl-interval"
                    type="number"
                    value={Math.floor(config.sslCheckInterval / 1000)}
                    onChange={(e) => handleIntervalChange('sslCheckInterval', e.target.value)}
                    className="bg-gray-700 border-gray-600 text-white"
                    min="30"
                    max="3600"
                  />
                </div>
                <div>
                  <Label htmlFor="temp-interval" className="text-sm text-gray-400">
                    Température (secondes)
                  </Label>
                  <Input
                    id="temp-interval"
                    type="number"
                    value={Math.floor(config.temperatureCheckInterval / 1000)}
                    onChange={(e) => handleIntervalChange('temperatureCheckInterval', e.target.value)}
                    className="bg-gray-700 border-gray-600 text-white"
                    min="30"
                    max="1800"
                  />
                </div>
                <div>
                  <Label htmlFor="backup-interval" className="text-sm text-gray-400">
                    Sauvegardes (secondes)
                  </Label>
                  <Input
                    id="backup-interval"
                    type="number"
                    value={Math.floor(config.backupCheckInterval / 1000)}
                    onChange={(e) => handleIntervalChange('backupCheckInterval', e.target.value)}
                    className="bg-gray-700 border-gray-600 text-white"
                    min="300"
                    max="7200"
                  />
                </div>
                <div>
                  <Label htmlFor="server-interval" className="text-sm text-gray-400">
                    Serveurs (secondes)
                  </Label>
                  <Input
                    id="server-interval"
                    type="number"
                    value={Math.floor(config.serverCheckInterval / 1000)}
                    onChange={(e) => handleIntervalChange('serverCheckInterval', e.target.value)}
                    className="bg-gray-700 border-gray-600 text-white"
                    min="30"
                    max="1800"
                  />
                </div>
              </div>
            </div>

            <div>
              <Label className="text-gray-300 mb-3 block">Actions de test</Label>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => triggerStatusCheck('ssl_certificate', 'test')}
                  className="text-gray-300 border-gray-600 hover:bg-gray-700"
                >
                  <RefreshCw className="h-3 w-3 mr-1" />
                  Test SSL
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => triggerStatusCheck('temperature', 'test')}
                  className="text-gray-300 border-gray-600 hover:bg-gray-700"
                >
                  <RefreshCw className="h-3 w-3 mr-1" />
                  Test Température
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => triggerStatusCheck('backup', 'test')}
                  className="text-gray-300 border-gray-600 hover:bg-gray-700"
                >
                  <RefreshCw className="h-3 w-3 mr-1" />
                  Test Sauvegarde
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => triggerStatusCheck('server', 'test')}
                  className="text-gray-300 border-gray-600 hover:bg-gray-700"
                >
                  <RefreshCw className="h-3 w-3 mr-1" />
                  Test Serveur
                </Button>
              </div>
            </div>

            <div className="p-3 bg-blue-900/20 border border-blue-600 rounded-md">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-blue-400 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-blue-300">Comment ça fonctionne</p>
                  <p className="text-xs text-blue-200 mt-1">
                    Le monitoring automatique vérifie périodiquement l'état de vos équipements. 
                    Quand un changement de statut est détecté, une alerte est créée et un SMS 
                    est envoyé selon vos préférences de notification.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
