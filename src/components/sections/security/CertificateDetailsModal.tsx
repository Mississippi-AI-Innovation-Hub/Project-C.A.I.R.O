import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Globe,
  Shield,
  Calendar,
  Clock,
  AlertTriangle,
  CheckCircle,
  X,
  Server,
  Key,
  Info,
  ExternalLink
} from 'lucide-react';
import { SSLCertificate } from '@/hooks/useSSLCertificates';
import { Label } from '@/components/ui/label';
import { formatDateLocal } from '@/lib/utils';

interface CertificateDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  certificate: SSLCertificate | null;
}

export const CertificateDetailsModal = ({
  isOpen,
  onClose,
  certificate
}: CertificateDetailsModalProps) => {
  if (!certificate) return null;

  const getStatusBadge = (cert: SSLCertificate) => {
    const daysRemaining = cert.realtime_days_remaining ?? cert.days_remaining;
    const status = cert.realtime_status ?? cert.status?.toLowerCase();

    if (status === 'expired' || (daysRemaining !== null && daysRemaining < 0)) {
      return <Badge className="bg-red-600 hover:bg-red-700">✗ Expired</Badge>;
    } else if (daysRemaining !== null && daysRemaining <= 5) {
      return <Badge className="bg-red-500 hover:bg-red-600">⚠ Expires in {daysRemaining} days</Badge>;
    } else if (daysRemaining !== null && daysRemaining <= 30) {
      return <Badge className="bg-yellow-600 hover:bg-yellow-700">⚠ Expires in {daysRemaining} days</Badge>;
    } else if (status === 'valid') {
      return <Badge className="bg-green-600 hover:bg-green-700">✓ Valid</Badge>;
    } else if (status === 'invalid') {
      return <Badge className="bg-red-600 hover:bg-red-700">✗ Invalid</Badge>;
    } else {
      return <Badge variant="secondary">Unknown</Badge>;
    }
  };

  const getStatusIcon = (cert: SSLCertificate) => {
    const daysRemaining = cert.realtime_days_remaining ?? cert.days_remaining;
    const status = cert.realtime_status ?? cert.status?.toLowerCase();

    if (status === 'expired' || (daysRemaining !== null && daysRemaining < 0)) {
      return <X className="h-5 w-5 text-red-400" />;
    } else if (daysRemaining !== null && daysRemaining <= 30) {
      return <AlertTriangle className="h-5 w-5 text-yellow-400" />;
    } else if (status === 'valid') {
      return <CheckCircle className="h-5 w-5 text-green-400" />;
    } else {
      return <Info className="h-5 w-5 text-blue-400" />;
    }
  };

  const formatDate = (dateString: string | null) => formatDateLocal(dateString, true, false);

  const formatDateTime = (dateString: string | null) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleString('en-US', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getDaysRemainingColor = (days: number | null) => {
    if (days === null) return 'text-gray-400';
    if (days < 0) return 'text-red-400';
    if (days <= 5) return 'text-red-400';
    if (days <= 30) return 'text-yellow-400';
    return 'text-green-400';
  };

  const getDaysRemainingText = (days: number | null) => {
    if (days === null) return 'N/A';
    if (days < 0) return `${Math.abs(days)} days overdue`;
    if (days === 0) return 'Expires today';
    if (days === 1) return '1 day';
    return `${days} days`;
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-gray-800 border-gray-700 text-white max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <Shield className="h-5 w-5 text-blue-400" />
            Certificate Details
          </DialogTitle>
          <DialogDescription className="text-gray-400">
            Detailed information for {certificate.domain}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Header */}
          <Card className="bg-gray-900 border-gray-600">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Globe className="h-8 w-8 text-blue-400" />
                  <div>
                    <CardTitle className="text-white text-xl">{certificate.domain}</CardTitle>
                    <p className="text-gray-400">{certificate.protocol || 'https'}:{certificate.port || 443}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {getStatusIcon(certificate)}
                  {getStatusBadge(certificate)}
                </div>
              </div>
            </CardHeader>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Basic Information */}
            <Card className="bg-gray-900 border-gray-600">
              <CardHeader>
                <CardTitle className="text-white text-lg flex items-center gap-2">
                  <Info className="h-5 w-5 text-blue-400" />
                  Basic Information
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-gray-400 text-sm">Domain</Label>
                    <p className="text-white font-medium">{certificate.domain}</p>
                  </div>
                  <div>
                    <Label className="text-gray-400 text-sm">Port</Label>
                    <p className="text-white font-medium">{certificate.port || 443}</p>
                  </div>
                  <div>
                    <Label className="text-gray-400 text-sm">Protocol</Label>
                    <p className="text-white font-medium">{certificate.protocol || 'https'}</p>
                  </div>
                  <div>
                    <Label className="text-gray-400 text-sm">IP Address</Label>
                    <p className="text-white font-medium">{certificate.ip_address || 'N/A'}</p>
                  </div>
                </div>

                {certificate.tls_version && (
                  <div>
                    <Label className="text-gray-400 text-sm">TLS Version</Label>
                    <p className="text-white font-medium">{certificate.tls_version}</p>
                  </div>
                )}

                {certificate.common_name && certificate.common_name !== certificate.domain && (
                  <div>
                    <Label className="text-gray-400 text-sm">Common Name (CN)</Label>
                    <p className="text-white font-medium">{certificate.common_name}</p>
                  </div>
                )}

                {certificate.issued_organization && certificate.issued_organization !== 'N/A' && (
                  <div>
                    <Label className="text-gray-400 text-sm">Organization</Label>
                    <p className="text-white font-medium">{certificate.issued_organization}</p>
                  </div>
                )}

                {certificate.subject_alt_names && certificate.subject_alt_names.length > 0 && (
                  <div>
                    <Label className="text-gray-400 text-sm">Subject Alt Names (SAN)</Label>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {certificate.subject_alt_names.map((san, index) => (
                        <Badge key={index} variant="outline" className="text-xs">{san}</Badge>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Validity */}
            <Card className="bg-gray-900 border-gray-600">
              <CardHeader>
                <CardTitle className="text-white text-lg flex items-center gap-2">
                  <Calendar className="h-5 w-5 text-green-400" />
                  Certificate Validity
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-gray-400 text-sm">Valid From</Label>
                    <p className="text-white font-medium">{formatDate(certificate.valid_from)}</p>
                  </div>
                  <div>
                    <Label className="text-gray-400 text-sm">Expires On</Label>
                    <p className="text-white font-medium">{formatDate(certificate.valid_to)}</p>
                  </div>
                </div>

                <div>
                  <Label className="text-gray-400 text-sm">Days Remaining</Label>
                  <p className={`font-bold text-lg ${getDaysRemainingColor(certificate.realtime_days_remaining ?? certificate.days_remaining)}`}>
                    {getDaysRemainingText(certificate.realtime_days_remaining ?? certificate.days_remaining)}
                  </p>
                </div>

                {(certificate.realtime_days_remaining ?? certificate.days_remaining) !== null && (
                  <div className="w-full bg-gray-700 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full ${
                        ((certificate.realtime_days_remaining ?? certificate.days_remaining) || 0) <= 5 ? 'bg-red-500' :
                        ((certificate.realtime_days_remaining ?? certificate.days_remaining) || 0) <= 30 ? 'bg-yellow-500' :
                        'bg-green-500'
                      }`}
                      style={{
                        width: `${Math.min(Math.max(((certificate.realtime_days_remaining ?? certificate.days_remaining) || 0) / 365 * 100, 0), 100)}%`
                      }}
                    />
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Issuer */}
            <Card className="bg-gray-900 border-gray-600">
              <CardHeader>
                <CardTitle className="text-white text-lg flex items-center gap-2">
                  <Key className="h-5 w-5 text-purple-400" />
                  Certificate Authority
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label className="text-gray-400 text-sm">Issuer</Label>
                  <p className="text-white font-medium">{certificate.issuer || 'N/A'}</p>
                </div>
                {certificate.issuer_organization && certificate.issuer_organization !== 'N/A' && (
                  <div>
                    <Label className="text-gray-400 text-sm">Issuer Organization</Label>
                    <p className="text-white font-medium">{certificate.issuer_organization}</p>
                  </div>
                )}
                {certificate.issuer_country && certificate.issuer_country !== 'N/A' && (
                  <div>
                    <Label className="text-gray-400 text-sm">Issuer Country</Label>
                    <p className="text-white font-medium">{certificate.issuer_country}</p>
                  </div>
                )}
                {certificate.issuer_organizational_unit && certificate.issuer_organizational_unit !== 'N/A' && (
                  <div>
                    <Label className="text-gray-400 text-sm">Organizational Unit</Label>
                    <p className="text-white font-medium">{certificate.issuer_organizational_unit}</p>
                  </div>
                )}
                {certificate.issuer_common_name && certificate.issuer_common_name !== 'N/A' && (
                  <div>
                    <Label className="text-gray-400 text-sm">Issuer Common Name</Label>
                    <p className="text-white font-medium">{certificate.issuer_common_name}</p>
                  </div>
                )}
                <div>
                  <Label className="text-gray-400 text-sm">Status</Label>
                  <p className="text-white font-medium">{certificate.status || 'N/A'}</p>
                </div>
              </CardContent>
            </Card>

            {/* Technical Details */}
            <Card className="bg-gray-900 border-gray-600">
              <CardHeader>
                <CardTitle className="text-white text-lg flex items-center gap-2">
                  <Server className="h-5 w-5 text-cyan-400" />
                  Technical Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {certificate.certificate_serial_number && (
                  <div>
                    <Label className="text-gray-400 text-sm">Serial Number</Label>
                    <p className="text-white font-medium text-xs font-mono break-all">{certificate.certificate_serial_number}</p>
                  </div>
                )}
                {certificate.certificate_sha1_fingerprint && (
                  <div>
                    <Label className="text-gray-400 text-sm">SHA1 Fingerprint</Label>
                    <p className="text-white font-medium text-xs font-mono break-all">{certificate.certificate_sha1_fingerprint}</p>
                  </div>
                )}
                {certificate.certificate_algorithm && (
                  <div>
                    <Label className="text-gray-400 text-sm">Signature Algorithm</Label>
                    <p className="text-white font-medium">{certificate.certificate_algorithm}</p>
                  </div>
                )}
                {certificate.certificate_version && (
                  <div>
                    <Label className="text-gray-400 text-sm">Certificate Version</Label>
                    <p className="text-white font-medium">{certificate.certificate_version}</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Monitoring */}
            <Card className="bg-gray-900 border-gray-600">
              <CardHeader>
                <CardTitle className="text-white text-lg flex items-center gap-2">
                  <Clock className="h-5 w-5 text-orange-400" />
                  Monitoring
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label className="text-gray-400 text-sm">Last Checked</Label>
                  <p className="text-white font-medium">{formatDateTime(certificate.last_checked)}</p>
                </div>
                <div>
                  <Label className="text-gray-400 text-sm">Enabled</Label>
                  <p className="text-white font-medium">{certificate.enabled ? 'Yes' : 'No'}</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {certificate.note && (
            <Card className="bg-gray-900 border-gray-600">
              <CardHeader>
                <CardTitle className="text-white text-lg">Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-white">{certificate.note}</p>
              </CardContent>
            </Card>
          )}

          <div className="flex justify-end gap-3 pt-4">
            <Button variant="outline" onClick={onClose} className="bg-gray-700 border-gray-600 text-white hover:bg-gray-600">
              Close
            </Button>
            <Button
              onClick={() => {
                const url = `${certificate.protocol || 'https'}://${certificate.domain}:${certificate.port || 443}`;
                window.open(url, '_blank');
              }}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              <ExternalLink className="h-4 w-4 mr-2" />
              Visit Site
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
