
import React from 'react';
import { Card, CardContent } from '@/components/ui/card';

interface AlertSummaryCardsProps {
  criticalCount: number;
  warningCount: number;
  infoCount: number;
  resolvedCount: number;
}

export const AlertSummaryCards = ({
  criticalCount,
  warningCount,
  infoCount,
  resolvedCount
}: AlertSummaryCardsProps) => {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 md:gap-3 lg:gap-4">
      <Card className="bg-red-600">
        <CardContent className="p-3 md:p-4 lg:p-6 text-center">
          <div className="text-xl md:text-2xl lg:text-4xl font-bold text-white mb-1 md:mb-2">
            {criticalCount}
          </div>
          <p className="text-red-100 text-xs md:text-sm">Critical Alerts</p>
        </CardContent>
      </Card>

      <Card className="bg-yellow-600">
        <CardContent className="p-3 md:p-4 lg:p-6 text-center">
          <div className="text-xl md:text-2xl lg:text-4xl font-bold text-white mb-1 md:mb-2">
            {warningCount}
          </div>
          <p className="text-yellow-100 text-xs md:text-sm">Warnings</p>
        </CardContent>
      </Card>

      <Card className="bg-blue-600">
        <CardContent className="p-3 md:p-4 lg:p-6 text-center">
          <div className="text-xl md:text-2xl lg:text-4xl font-bold text-white mb-1 md:mb-2">
            {infoCount}
          </div>
          <p className="text-blue-100 text-xs md:text-sm">Informational</p>
        </CardContent>
      </Card>

      <Card className="bg-green-600">
        <CardContent className="p-3 md:p-4 lg:p-6 text-center">
          <div className="text-xl md:text-2xl lg:text-4xl font-bold text-white mb-1 md:mb-2">
            {resolvedCount}
          </div>
          <p className="text-green-100 text-xs md:text-sm">Resolved</p>
        </CardContent>
      </Card>
    </div>
  );
};
