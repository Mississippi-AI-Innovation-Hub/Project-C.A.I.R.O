
import React from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
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

interface AlertTableProps {
  alerts: Alert[];
  onActionComplete?: () => void;
}

export const AlertTable = ({ alerts, onActionComplete }: AlertTableProps) => {
  return (
    <div className="w-full overflow-x-auto">
      <Table className="w-full">
        <TableHeader>
          <TableRow className="border-b border-gray-700">
            <TableHead className="text-left py-2 px-2 text-gray-400 font-medium text-xs min-w-[100px]">Timestamp</TableHead>
            <TableHead className="text-left py-2 px-2 text-gray-400 font-medium text-xs min-w-[80px]">Severity</TableHead>
            <TableHead className="text-left py-2 px-2 text-gray-400 font-medium text-xs min-w-[90px]">Status</TableHead>
            <TableHead className="text-left py-2 px-2 text-gray-400 font-medium text-xs min-w-[90px]">Source</TableHead>
            <TableHead className="text-left py-2 px-2 text-gray-400 font-medium text-xs min-w-[70px]">Node</TableHead>
            <TableHead className="text-left py-2 px-2 text-gray-400 font-medium text-xs min-w-[200px]">Message</TableHead>
            <TableHead className="text-left py-2 px-2 text-gray-400 font-medium text-xs min-w-[120px]">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {alerts.map((alert) => (
            <TableRow key={alert.id} className="border-b border-gray-700 hover:bg-gray-750">
              <TableCell className="py-3 px-2 text-gray-300 text-xs min-w-[100px]">
                <div className="truncate text-xs">{alert.timestamp.split(' ')[1]}</div>
                <div className="truncate text-xs text-gray-500">{alert.timestamp.split(' ')[0]}</div>
              </TableCell>
              <TableCell className="py-3 px-2 min-w-[80px]">{getSeverityBadge(alert.severity)}</TableCell>
              <TableCell className="py-3 px-2 min-w-[90px]">{getStatusBadge(alert.status)}</TableCell>
              <TableCell className="py-3 px-2 text-gray-300 text-xs min-w-[90px]">
                <div className="truncate">{alert.source}</div>
              </TableCell>
              <TableCell className="py-3 px-2 text-white font-medium text-xs min-w-[70px]">
                <div className="truncate">{alert.node}</div>
              </TableCell>
              <TableCell className="py-3 px-2 text-gray-300 text-xs min-w-[200px]">
                <div className="line-clamp-2 max-w-[250px]">{alert.message}</div>
              </TableCell>
              <TableCell className="py-3 px-2 min-w-[120px]">
                <AlertActions
                  alertId={alert.id}
                  status={alert.status}
                  onStatusChange={() => onActionComplete?.()}
                  onDelete={() => onActionComplete?.()}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
};
