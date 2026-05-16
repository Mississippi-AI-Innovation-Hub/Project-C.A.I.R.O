
import React from 'react';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from 'react-i18next';

export const SystemRefreshButton = () => {
  const { toast } = useToast();
  const { t } = useTranslation();

  const refreshData = async () => {
    try {
      window.dispatchEvent(new CustomEvent('refresh-dashboard-data'));
      
      toast({
        title: t('systemActions.messages.refreshSuccess'),
        description: t('systemActions.messages.refreshSuccessDesc'),
      });
    } catch (err) {
      console.error('Error refreshing data:', err);
      toast({
        title: t('systemActions.messages.refreshError'),
        description: t('systemActions.messages.refreshErrorDesc'),
        variant: "destructive",
      });
    }
  };

  return (
    <Button 
      variant="outline" 
      className="flex items-center gap-2"
      onClick={refreshData}
    >
      <RefreshCw className="h-4 w-4" />
      {t('systemActions.refreshData')}
    </Button>
  );
};
