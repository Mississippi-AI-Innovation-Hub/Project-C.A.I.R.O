
import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { getSeverityBadge, getStatusBadge } from './AlertBadges';
import { AlertActions } from './AlertActions';

interface Alert {
  id: string;
  timestamp: string;
  severity: string;
  status: string;
  source: string;
  node: string;
  message: string;
  details: string;
}

interface AlertCardProps {
  alert: Alert;
  onActionComplete?: () => void;
}

export const AlertCard = ({ alert, onActionComplete }: AlertCardProps) => {
  return (
    <Card className="bg-gray-750 border-gray-600">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {getSeverityBadge(alert.severity)}
            {getStatusBadge(alert.status)}
          </div>
          <div className="text-xs text-gray-400">
            {alert.timestamp}
          </div>
        </div>
        
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">Source:</span>
            <span className="text-sm text-gray-300">{alert.source}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">Node:</span>
            <span className="text-sm text-white font-medium">{alert.node}</span>
          </div>
        </div>
        
        <div className="pt-2">
          <p className="text-sm text-gray-300 line-clamp-2">{alert.message}</p>
        </div>
        
        <div className="flex justify-end pt-2">
          <AlertActions 
            alertId={alert.id.toString()} 
            currentStatus={alert.status}
            size="sm"
            onActionComplete={onActionComplete}
          />
        </div>
      </CardContent>
    </Card>
  );
};
