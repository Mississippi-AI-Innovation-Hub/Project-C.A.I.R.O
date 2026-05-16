import { Button } from '@/components/ui/button';
import { CheckCircle, Trash2 } from 'lucide-react';

interface AlertActionsProps {
  alertId: string;
  status?: string | null;
  currentStatus?: string | null;
  onStatusChange?: (id: string, status: string) => void;
  onDelete?: (id: string) => void;
  onActionComplete?: () => void;
  size?: 'sm' | 'default' | 'lg' | 'icon';
}

export const AlertActions = ({
  alertId,
  status,
  currentStatus,
  onStatusChange,
  onDelete,
  onActionComplete,
  size = 'sm',
}: AlertActionsProps) => {
  const resolvedStatus = currentStatus ?? status ?? 'active';

  return (
    <div className="flex items-center gap-2">
      {resolvedStatus !== 'resolved' && (
        <Button
          size={size}
          className="bg-green-600 hover:bg-green-700 text-white border border-green-500/60 shadow-sm"
          onClick={() => {
            onStatusChange?.(alertId, 'resolved');
            onActionComplete?.();
          }}
        >
          <CheckCircle className="h-3.5 w-3.5 mr-1.5" />
          Resolve
        </Button>
      )}
      <Button
        size={size}
        className="bg-red-600 hover:bg-red-700 text-white border border-red-500/60 shadow-sm"
        onClick={() => {
          onDelete?.(alertId);
          onActionComplete?.();
        }}
      >
        <Trash2 className="h-3.5 w-3.5 mr-1.5" />
        Delete
      </Button>
    </div>
  );
};
