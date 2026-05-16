import React from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { SSLCertificate } from '@/hooks/useSSLCertificates';

interface DeleteSSLCertificateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  certificate: SSLCertificate | null;
  isDeleting?: boolean;
}

export const DeleteSSLCertificateDialog: React.FC<DeleteSSLCertificateDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  certificate,
  isDeleting = false
}) => {
  return (
    <AlertDialog open={isOpen} onOpenChange={onClose}>
      <AlertDialogContent className="bg-gray-800 border-gray-700 text-white max-w-md">
        <AlertDialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0">
              <AlertTriangle className="h-6 w-6 text-red-500" />
            </div>
            <AlertDialogTitle className="text-lg font-semibold text-white">
              Delete Certificate
            </AlertDialogTitle>
          </div>
        </AlertDialogHeader>

        <AlertDialogDescription className="text-gray-300 space-y-2">
          <p>
            Are you sure you want to delete{' '}
            <span className="font-semibold text-white">"{certificate?.domain}"</span>?
          </p>
          <p className="text-red-400 font-medium">
            This action cannot be undone.
          </p>
        </AlertDialogDescription>

        <AlertDialogFooter className="flex gap-2 sm:gap-0">
          <AlertDialogCancel
            onClick={onClose}
            className="bg-gray-600 hover:bg-gray-700 text-white border-gray-500"
            disabled={isDeleting}
          >
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-red-600 hover:bg-red-700 text-white"
            disabled={isDeleting}
          >
            {isDeleting ? (
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Deleting...
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Trash2 className="h-4 w-4" />
                Delete
              </div>
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
