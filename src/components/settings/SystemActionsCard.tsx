
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Settings } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { SystemSaveButton } from './system/SystemSaveButton';
import { SystemRefreshButton } from './system/SystemRefreshButton';

interface SystemActionsCardProps {
  onSave: () => void;
  isSaving?: boolean;
}

export const SystemActionsCard = ({ onSave, isSaving = false }: SystemActionsCardProps) => {
  const { toast } = useToast();

  const handleSaveSettings = async () => {
    try {
      await onSave();
      toast({
        title: 'Settings Saved',
        description: 'System settings have been saved successfully.',
      });
    } catch (error) {
      console.error('Error saving settings:', error);
      toast({
        title: 'Save Error',
        description: 'Failed to save settings. Please try again.',
        variant: 'destructive',
      });
    }
  };

  return (
    <Card className="bg-gray-800 border-gray-700">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <Settings className="h-5 w-5" />
          System Actions
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex gap-4">
          <SystemSaveButton onSave={handleSaveSettings} isSaving={isSaving} />
          <SystemRefreshButton />
        </div>
      </CardContent>
    </Card>
  );
};
