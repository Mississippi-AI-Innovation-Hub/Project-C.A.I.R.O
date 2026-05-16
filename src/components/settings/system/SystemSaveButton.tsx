
import React from 'react';
import { Button } from '@/components/ui/button';
import { Save, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface SystemSaveButtonProps {
  onSave: () => void;
  isSaving?: boolean;
}

export const SystemSaveButton = ({ onSave, isSaving = false }: SystemSaveButtonProps) => {
  const { t } = useTranslation();
  
  return (
    <Button 
      onClick={onSave} 
      className="flex items-center gap-2 bg-green-600 hover:bg-green-700"
      disabled={isSaving}
    >
      {isSaving ? (
        <RefreshCw className="h-4 w-4 animate-spin" />
      ) : (
        <Save className="h-4 w-4" />
      )}
      {isSaving ? t('saving') : t('saveSettings')}
    </Button>
  );
};
