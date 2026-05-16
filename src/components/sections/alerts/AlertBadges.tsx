
import React from 'react';
import { Badge } from '@/components/ui/badge';

export const getSeverityBadge = (severity: string) => {
  switch (severity) {
    case 'critical':
      return <Badge className="bg-red-600 hover:bg-red-700">Critical</Badge>;
    case 'warning':
      return <Badge className="bg-yellow-600 hover:bg-yellow-700">Warning</Badge>;
    case 'info':
      return <Badge className="bg-blue-600 hover:bg-blue-700">Info</Badge>;
    default:
      return <Badge variant="secondary">Unknown</Badge>;
  }
};

export const getStatusBadge = (status: string) => {
  switch (status) {
    case 'active':
      return <Badge className="bg-red-500 hover:bg-red-600">Active</Badge>;
    case 'acknowledged':
      return <Badge className="bg-orange-500 hover:bg-orange-600">Acknowledged</Badge>;
    case 'resolved':
      return <Badge className="bg-green-500 hover:bg-green-600">Resolved</Badge>;
    default:
      return <Badge variant="secondary">Unknown</Badge>;
  }
};
