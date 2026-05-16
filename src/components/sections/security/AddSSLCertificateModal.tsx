import React, { useEffect, useMemo, useState } from 'react';
import Papa from 'papaparse';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import {
  Globe,
  Shield,
  Info,
  Plus,
  Loader2,
  AlertCircle,
  CheckCircle,
  Upload,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from 'react-i18next';
import { api } from '@/utils/api';
import { useAuth } from '@/contexts/AuthContext';

interface AddSSLCertificateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCertificateAdded?: () => void;
}

// Interface for the Python API response
interface SSLCertificateAPIResponse {
  host: string;
  resolved_ip: string;
  tls_version: string;
  timestamp: string;
  issued_to: string;
  issued_o: string;
  issuer_o: string;
  issuer_c: string;
  issuer_ou: string;
  issuer_cn: string;
  cert_sn: string;
  cert_sha1: string;
  cert_alg: string;
  cert_ver: number;
  cert_sans: string;
  cert_exp: boolean;
  cert_valid: boolean;
  valid_from: string;
  valid_till: string;
  validity_days: number;
  days_left: number;
  valid_days_to_expire: number;
  tcp_port: number;
  status: string;
}

const BULK_CSV_TEMPLATE =
  'domain_name,agency_name,expiration_date,environment,certificate_type,issuer,owning_team,notes\n' +
  'portal.agency.ms.gov,Mississippi Department of Finance,2026-12-31,production,DV,GlobalSign,Web Operations,Example entry';

type BulkCsvRow = {
  domain_name: string;
  agency_name: string;
  expiration_date: string;
  environment: string;
  certificate_type: string;
  issuer: string;
  owning_team: string;
  notes: string;
  valid: boolean;
};

export const AddSSLCertificateModal = ({ 
  isOpen, 
  onClose, 
  onCertificateAdded 
}: AddSSLCertificateModalProps) => {
  const { isAdmin } = useAuth();
  const { t } = useTranslation();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionResult, setConnectionResult] = useState<{ success: boolean; message: string } | null>(null);
  const [showPipeline, setShowPipeline] = useState(false);
  const [pipelineTick, setPipelineTick] = useState(0);
  const [pipelineJob, setPipelineJob] = useState<any | null>(null);

  const [mode, setMode] = useState<'live' | 'manual' | 'bulk'>('live');

  const [liveForm, setLiveForm] = useState({
    domain: '',
    port: '443',
    protocol: 'https',
    note: '',
  });

  const [manualForm, setManualForm] = useState({
    domain_name: '',
    agency_name: '',
    issuer: 'Mississippi ITS Root CA',
    environment: 'production' as 'production' | 'staging' | 'dev',
    certificate_type: 'DV' as 'DV' | 'OV' | 'EV',
    expiration_date: '',
    owning_team: '',
    auto_renew_enabled: true,
    notes: '',
  });

  const [bulkRows, setBulkRows] = useState<BulkCsvRow[]>([]);
  const [bulkFileKey, setBulkFileKey] = useState(0);
  const [bulkImporting, setBulkImporting] = useState(false);
  const [bulkImportProgress, setBulkImportProgress] = useState<{ current: number; total: number } | null>(null);

  const [errors, setErrors] = useState<{ [key: string]: string }>({});

  const daysToExpiry = useMemo(() => {
    if (!manualForm.expiration_date) return null;
    const exp = new Date(`${manualForm.expiration_date}T00:00:00Z`);
    if (Number.isNaN(exp.getTime())) return null;
    const now = new Date();
    const diffMs = exp.getTime() - now.getTime();
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }, [manualForm.expiration_date]);

  const bulkValidCount = useMemo(() => bulkRows.filter((r) => r.valid).length, [bulkRows]);
  const bulkErrorCount = bulkRows.length - bulkValidCount;

  useEffect(() => {
    setErrors({});
    setConnectionResult(null);
    if (mode !== 'bulk') {
      setBulkRows([]);
      setBulkFileKey((k) => k + 1);
      setBulkImportProgress(null);
      setBulkImporting(false);
    }
  }, [mode]);

  useEffect(() => {
    if (!showPipeline || pipelineJob) return;
    const tmr = window.setInterval(() => setPipelineTick((n) => n + 1), 650);
    return () => window.clearInterval(tmr);
  }, [showPipeline, pipelineJob]);

  const validateForm = () => {
    const newErrors: { [key: string]: string } = {};

    if (mode === 'live') {
      if (!liveForm.domain.trim()) {
        newErrors.domain = t('navigation.security.sslMonitoring.addCertificate.validation.domainRequired');
      }

      const port = parseInt(liveForm.port);
      if (isNaN(port) || port < 1 || port > 65535) {
        newErrors.port = t('navigation.security.sslMonitoring.addCertificate.validation.invalidPort');
      }
    } else if (mode === 'manual') {
      if (!manualForm.domain_name.trim()) newErrors.domain_name = 'Domain name is required';
      if (!manualForm.agency_name.trim()) newErrors.agency_name = 'Agency name is required';
      if (!manualForm.expiration_date.trim()) newErrors.expiration_date = 'Expiration date is required';
      if (manualForm.expiration_date && daysToExpiry === null) newErrors.expiration_date = 'Invalid expiration date';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const testConnection = async () => {
    if (!liveForm.domain.trim()) {
      toast({
        title: "Error",
        description: "Enter a domain before testing the connection.",
        variant: "destructive",
      });
      return;
    }

    setTestingConnection(true);
    setConnectionResult(null);

    try {
      // Call the Python API to test the connection and get certificate info
      const certificateData = await api.postExpectOk<SSLCertificateAPIResponse>('/ssl/check', {
        hostname: liveForm.domain.trim(),
        port: parseInt(liveForm.port),
      });
      
      if (certificateData.status === 'success') {
        setConnectionResult({
          success: true,
          message: `Connected to ${liveForm.domain}:${liveForm.port} - certificate valid until ${certificateData.valid_till}`
        });
        
        toast({
          title: "Connection Test",
          description: "Connection successful and SSL certificate found.",
          variant: "default",
        });
      } else {
        throw new Error('SSL certificate verification failed');
      }
    } catch (error) {
      console.error('Connection test error:', error);
      setConnectionResult({
        success: false,
        message: `Connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
      
      toast({
        title: "Connection Test",
        description: "Connection failed. The certificate will be checked during the first monitoring run.",
        variant: "destructive",
      });
    } finally {
      setTestingConnection(false);
    }
  };

  const downloadBulkTemplate = () => {
    const blob = new Blob([BULK_CSV_TEMPLATE], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'certificate-import-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleBulkFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      setBulkRows([]);
      return;
    }
    Papa.parse<Record<string, unknown>>(file, {
      header: true,
      skipEmptyLines: 'greedy',
      complete: (results) => {
        if (results.errors?.length) {
          const first = results.errors[0];
          toast({
            title: 'CSV parse error',
            description: first.message || 'Could not read the file.',
            variant: 'destructive',
          });
          setBulkRows([]);
          return;
        }
        const fields = (results.meta.fields ?? []).map((f) => String(f ?? '').trim());
        const required = ['domain_name', 'agency_name', 'expiration_date'];
        const missing = required.filter((col) => !fields.includes(col));
        if (missing.length) {
          toast({
            title: 'Invalid CSV',
            description: `Missing required columns: ${missing.join(', ')}`,
            variant: 'destructive',
          });
          setBulkRows([]);
          return;
        }
        const rows = (results.data as Record<string, unknown>[]).map((raw) => {
          const domain_name = String(raw.domain_name ?? '').trim();
          const agency_name = String(raw.agency_name ?? '').trim();
          const expiration_date = String(raw.expiration_date ?? '').trim();
          const valid = Boolean(domain_name && agency_name && expiration_date);
          return {
            domain_name,
            agency_name,
            expiration_date,
            environment: String(raw.environment ?? '').trim(),
            certificate_type: String(raw.certificate_type ?? '').trim(),
            issuer: String(raw.issuer ?? '').trim(),
            owning_team: String(raw.owning_team ?? '').trim(),
            notes: String(raw.notes ?? '').trim(),
            valid,
          } satisfies BulkCsvRow;
        });
        setBulkRows(rows);
      },
    });
  };

  const handleBulkImport = async () => {
    if (!isAdmin) return;
    const validRows = bulkRows.filter((r) => r.valid);
    if (validRows.length === 0) return;

    setBulkImporting(true);
    let succeeded = 0;
    let failed = 0;

    try {
      for (let i = 0; i < validRows.length; i++) {
        const row = validRows[i];
        setBulkImportProgress({ current: i + 1, total: validRows.length });
        try {
          await api.postExpectOk('/certificates', {
            hostname: row.domain_name,
            domain_name: row.domain_name,
            agency_name: row.agency_name,
            expiration_date: row.expiration_date,
            environment: row.environment || 'production',
            certificate_type: row.certificate_type || 'DV',
            issuer: row.issuer || 'Unknown',
            owning_team: row.owning_team || '',
            notes: row.notes || 'Imported via bulk CSV upload',
            date_mode: 'manual',
          });
          succeeded += 1;
        } catch (err) {
          console.error('Bulk import row failed:', row.domain_name, err);
          failed += 1;
        }
      }

      toast({
        title: 'Import complete',
        description: `Import complete: ${succeeded} added successfully, ${failed} failed`,
        variant: failed > 0 && succeeded === 0 ? 'destructive' : 'default',
      });

      setBulkRows([]);
      setBulkFileKey((k) => k + 1);
      setBulkImportProgress(null);
      onCertificateAdded?.();
      onClose();
    } finally {
      setBulkImporting(false);
      setBulkImportProgress(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'bulk') return;
    if (!isAdmin) return;

    if (!validateForm()) {
      toast({
        title: "Validation Error",
        description: "Fix the validation errors in the form and try again.",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    setShowPipeline(true);
    setPipelineJob(null);
    setPipelineTick(0);

    try {
      type AddCertApiResponse = Record<string, unknown> & { renewal_job?: unknown };

      const payload =
        mode === 'manual'
          ? {
              hostname: manualForm.domain_name.trim(),
              domain_name: manualForm.domain_name.trim(),
              agency_name: manualForm.agency_name.trim(),
              issuer: manualForm.issuer.trim() || 'Mississippi ITS Root CA',
              environment: manualForm.environment,
              certificate_type: manualForm.certificate_type,
              expiration_date: manualForm.expiration_date,
              days_to_expiry: daysToExpiry ?? undefined,
              owning_team: manualForm.owning_team.trim() || undefined,
              auto_renew_enabled: manualForm.auto_renew_enabled,
              notes: manualForm.notes.trim() || undefined,
              date_mode: 'manual',
            }
          : {
              hostname: liveForm.domain.trim(),
              port: parseInt(liveForm.port),
              protocol: liveForm.protocol,
              notes: liveForm.note.trim() || undefined,
              date_mode: 'live',
            };

      const added = await api.postExpectOk<AddCertApiResponse>('/certificates', payload);

      const started = Boolean(added && typeof added === 'object' && 'renewal_job' in added && added.renewal_job);
      if (started) {
        setPipelineJob((added as any).renewal_job);
        toast({
          title: "Success",
          description: "Certificate added — CSR generation started",
          variant: "default",
        });
      } else {
        toast({
          title: "Success",
          description: "Certificate added to monitoring",
          variant: "default",
        });
      }

      if (!started) {
        // Reset form
        setLiveForm({
          domain: '',
          port: '443',
          protocol: 'https',
          note: '',
        });
        setManualForm({
          domain_name: '',
          agency_name: '',
          issuer: 'Mississippi ITS Root CA',
          environment: 'production',
          certificate_type: 'DV',
          expiration_date: '',
          owning_team: '',
          auto_renew_enabled: true,
          notes: '',
        });
        setErrors({});
        setConnectionResult(null);

        onCertificateAdded?.();
        setShowPipeline(false);
        onClose();
      } else {
        // Keep modal open so user can see the pipeline animation/result.
        onCertificateAdded?.();
      }
    } catch (error) {
      console.error('Error adding SSL certificate:', error);
      toast({
        title: "Error",
        description: `Unable to add the SSL certificate: ${error instanceof Error ? error.message : 'Unknown error'}`,
        variant: "destructive",
      });
      setShowPipeline(false);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading && !bulkImporting) {
      setLiveForm({
        domain: '',
        port: '443',
        protocol: 'https',
        note: '',
      });
      setManualForm({
        domain_name: '',
        agency_name: '',
        issuer: 'Mississippi ITS Root CA',
        environment: 'production',
        certificate_type: 'DV',
        expiration_date: '',
        owning_team: '',
        auto_renew_enabled: true,
        notes: '',
      });
      setBulkRows([]);
      setBulkFileKey((k) => k + 1);
      setBulkImportProgress(null);
      setBulkImporting(false);
      setErrors({});
      setConnectionResult(null);
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="bg-gray-800 border-gray-700 text-white max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="relative">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <Shield className="h-5 w-5 text-blue-400" />
              {t('navigation.security.sslMonitoring.addCertificate.title')}
            </DialogTitle>
            <DialogDescription className="text-gray-400">
              {t('navigation.security.sslMonitoring.addCertificate.description')}
            </DialogDescription>
          </DialogHeader>

          {showPipeline && (
            <div className="absolute inset-0 z-50 flex items-start justify-center p-4 pointer-events-none">
              <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" />
              <Card className="pointer-events-auto relative w-full max-w-xl bg-gray-900 border-gray-700 shadow-2xl mt-8">
                <CardHeader>
                  <CardTitle className="text-white text-lg flex items-center gap-2">
                    {pipelineJob ? (
                      <CheckCircle className="h-5 w-5 text-emerald-400" />
                    ) : (
                      <Loader2 className="h-5 w-5 text-blue-400 animate-spin" />
                    )}
                    {pipelineJob ? 'Renewal pipeline completed' : 'Running renewal pipeline…'}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="text-xs text-gray-400">
                    {pipelineJob
                      ? 'CSR + key generated and job recorded. Next step is IIS import confirmation.'
                      : 'Generating private key, CSR, and issuing artifacts. This runs synchronously for urgent certificates.'}
                  </div>

                  <div className="space-y-2">
                    {(
                      pipelineJob?.steps ??
                      ['detect', 'csr_generation', 'ca_submission', 'cert_issuance', 'deployment', 'validation'].map((s, i) => ({
                        step: s,
                        status: i <= (pipelineTick % 6) ? 'completed' : 'running',
                      }))
                    ).map((s: any) => (
                      <div key={String(s.step)} className="flex items-center gap-2 text-sm">
                        {String(s.status).toLowerCase() === 'completed' ? (
                          <CheckCircle className="h-4 w-4 text-emerald-400" />
                        ) : String(s.status).toLowerCase() === 'failed' ? (
                          <AlertCircle className="h-4 w-4 text-red-400" />
                        ) : (
                          <Loader2 className="h-4 w-4 text-blue-400 animate-spin" />
                        )}
                        <span className="text-gray-200">{String(s.step).replaceAll('_', ' ')}</span>
                        {pipelineJob && (
                          <span className="ml-auto text-xs text-gray-500">
                            {String(s.status)}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>

                  {pipelineJob && (
                    <div className="space-y-1 text-xs text-gray-400 pt-2 border-t border-gray-800">
                      {pipelineJob.csr_path && <div><span className="text-gray-500">CSR:</span> {String(pipelineJob.csr_path)}</div>}
                      {pipelineJob.key_path && <div><span className="text-gray-500">Key:</span> {String(pipelineJob.key_path)}</div>}
                    </div>
                  )}

                  {pipelineJob && (
                    <div className="flex justify-end pt-2">
                      <Button
                        type="button"
                        onClick={() => {
                          if (loading || bulkImporting) return;
                          setShowPipeline(false);
                          setPipelineJob(null);
                          handleClose();
                        }}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white"
                      >
                        Done
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
          <Tabs value={mode} onValueChange={(v) => setMode(v as 'live' | 'manual' | 'bulk')}>
            <TabsList className="bg-gray-900 border border-gray-700">
              <TabsTrigger value="live">Live Domain</TabsTrigger>
              <TabsTrigger value="manual">Manual / Internal Domain</TabsTrigger>
              <TabsTrigger value="bulk">Bulk Import (CSV)</TabsTrigger>
            </TabsList>

            <TabsContent value="live" className="mt-4 space-y-6">
              {/* Live Domain Configuration */}
              <Card className="bg-gray-900 border-gray-600">
                <CardHeader>
                  <CardTitle className="text-white text-lg">{t('navigation.security.sslMonitoring.addCertificate.sections.domainConfig')}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label htmlFor="domain" className="text-white flex items-center gap-2">
                      <Globe className="h-4 w-4" />
                      {t('navigation.security.sslMonitoring.addCertificate.fields.domain')} *
                    </Label>
                    <Input
                      id="domain"
                      value={liveForm.domain}
                      onChange={(e) => {
                        setLiveForm({ ...liveForm, domain: e.target.value });
                        if (errors.domain) setErrors({ ...errors, domain: '' });
                      }}
                      className={`bg-gray-700 border-gray-600 text-white ${errors.domain ? 'border-red-500' : ''}`}
                      placeholder={t('navigation.security.sslMonitoring.addCertificate.fields.domainPlaceholder')}
                      required={mode === 'live'}
                    />
                    {errors.domain && (
                      <p className="text-red-400 text-sm mt-1 flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" />
                        {errors.domain}
                      </p>
                    )}
                    <p className="text-xs text-gray-500 mt-1">
                      {t('navigation.security.sslMonitoring.addCertificate.fields.domainHint')}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor='protocol' className='text-white'>{t('navigation.security.sslMonitoring.addCertificate.fields.protocol')}</Label>
                      <Select 
                        value={liveForm.protocol} 
                        onValueChange={(value) => setLiveForm({ ...liveForm, protocol: value })}
                      >
                        <SelectTrigger className="bg-gray-700 border-gray-600 text-white">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-gray-700 border-gray-600">
                          <SelectItem value="https">HTTPS</SelectItem>
                          <SelectItem value="http">HTTP</SelectItem>
                          <SelectItem value="ftp">FTP</SelectItem>
                          <SelectItem value="smtp">SMTP</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label htmlFor='port' className='text-white'>{t('navigation.security.sslMonitoring.addCertificate.fields.port')}</Label>
                      <Input
                        id="port"
                        type="number"
                        value={liveForm.port}
                        onChange={(e) => {
                          setLiveForm({ ...liveForm, port: e.target.value });
                          if (errors.port) setErrors({ ...errors, port: '' });
                        }}
                        className={`bg-gray-700 border-gray-600 text-white ${errors.port ? 'border-red-500' : ''}`}
                        min="1"
                        max="65535"
                      />
                      {errors.port && (
                        <p className="text-red-400 text-sm mt-1">{errors.port}</p>
                      )}
                    </div>
                  </div>

                  {/* Connection Test */}
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={testConnection}
                      disabled={testingConnection || !liveForm.domain.trim()}
                      className="bg-gray-700 border-gray-600 text-white hover:bg-gray-600"
                    >
                      {testingConnection ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Info className="h-4 w-4 mr-2" />
                      )}
                      {t('navigation.security.sslMonitoring.buttons.testConnection')}
                    </Button>
                    
                    {connectionResult && (
                      <div className={`flex items-center gap-1 text-sm ${
                        connectionResult.success ? 'text-green-400' : 'text-yellow-400'
                      }`}>
                        {connectionResult.success ? (
                          <CheckCircle className="h-4 w-4" />
                        ) : (
                          <AlertCircle className="h-4 w-4" />
                        )}
                        {connectionResult.message}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Additional Settings */}
              <Card className="bg-gray-900 border-gray-600">
                <CardHeader>
                  <CardTitle className="text-white text-lg">{t('navigation.security.sslMonitoring.addCertificate.sections.additionalSettings')}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label htmlFor='note' className='text-white'>{t('navigation.security.sslMonitoring.addCertificate.fields.note')}</Label>
                    <Textarea
                      id="note"
                      value={liveForm.note}
                      onChange={(e) => setLiveForm({ ...liveForm, note: e.target.value })}
                      className="bg-gray-700 border-gray-600 text-white"
                      placeholder={t('navigation.security.sslMonitoring.addCertificate.fields.notePlaceholder')}
                      rows={3}
                    />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="manual" className="mt-4 space-y-6">
              <Card className="bg-gray-900 border-gray-600">
                <CardHeader>
                  <CardTitle className="text-white text-lg">Manual / Internal Domain</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label htmlFor="manual_domain" className="text-white">Domain Name *</Label>
                    <Input
                      id="manual_domain"
                      value={manualForm.domain_name}
                      onChange={(e) => {
                        setManualForm({ ...manualForm, domain_name: e.target.value });
                        if (errors.domain_name) setErrors({ ...errors, domain_name: '' });
                      }}
                      className={`bg-gray-700 border-gray-600 text-white ${errors.domain_name ? 'border-red-500' : ''}`}
                      placeholder="portal.agency.ms.gov"
                      required={mode === 'manual'}
                    />
                    {errors.domain_name && (
                      <p className="text-red-400 text-sm mt-1 flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" />
                        {errors.domain_name}
                      </p>
                    )}
                    <p className="text-xs text-gray-500 mt-1">
                      Any format allowed (no strict URL/domain validation).
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="manual_agency" className="text-white">Agency Name *</Label>
                      <Input
                        id="manual_agency"
                        value={manualForm.agency_name}
                        onChange={(e) => {
                          setManualForm({ ...manualForm, agency_name: e.target.value });
                          if (errors.agency_name) setErrors({ ...errors, agency_name: '' });
                        }}
                        className={`bg-gray-700 border-gray-600 text-white ${errors.agency_name ? 'border-red-500' : ''}`}
                        placeholder="Mississippi Department of ..."
                      />
                      {errors.agency_name && (
                        <p className="text-red-400 text-sm mt-1 flex items-center gap-1">
                          <AlertCircle className="h-3 w-3" />
                          {errors.agency_name}
                        </p>
                      )}
                    </div>

                    <div>
                      <Label htmlFor="manual_issuer" className="text-white">Issuer</Label>
                      <Input
                        id="manual_issuer"
                        value={manualForm.issuer}
                        onChange={(e) => setManualForm({ ...manualForm, issuer: e.target.value })}
                        className="bg-gray-700 border-gray-600 text-white"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="text-white">Environment</Label>
                      <Select
                        value={manualForm.environment}
                        onValueChange={(v) => setManualForm({ ...manualForm, environment: v as 'production' | 'staging' | 'dev' })}
                      >
                        <SelectTrigger className="bg-gray-700 border-gray-600 text-white">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-gray-700 border-gray-600">
                          <SelectItem value="production">production</SelectItem>
                          <SelectItem value="staging">staging</SelectItem>
                          <SelectItem value="dev">dev</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label className="text-white">Certificate Type</Label>
                      <Select
                        value={manualForm.certificate_type}
                        onValueChange={(v) => setManualForm({ ...manualForm, certificate_type: v as 'DV' | 'OV' | 'EV' })}
                      >
                        <SelectTrigger className="bg-gray-700 border-gray-600 text-white">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-gray-700 border-gray-600">
                          <SelectItem value="DV">DV</SelectItem>
                          <SelectItem value="OV">OV</SelectItem>
                          <SelectItem value="EV">EV</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="manual_exp" className="text-white">Expiration Date *</Label>
                      <Input
                        id="manual_exp"
                        type="date"
                        value={manualForm.expiration_date}
                        onChange={(e) => {
                          setManualForm({ ...manualForm, expiration_date: e.target.value });
                          if (errors.expiration_date) setErrors({ ...errors, expiration_date: '' });
                        }}
                        className={`bg-gray-700 border-gray-600 text-white ${errors.expiration_date ? 'border-red-500' : ''}`}
                        required={mode === 'manual'}
                      />
                      {errors.expiration_date && (
                        <p className="text-red-400 text-sm mt-1 flex items-center gap-1">
                          <AlertCircle className="h-3 w-3" />
                          {errors.expiration_date}
                        </p>
                      )}
                    </div>

                    <div>
                      <Label className="text-white">Days to Expiry</Label>
                      <div className="h-10 flex items-center px-3 rounded-md bg-gray-700 border border-gray-600 text-gray-200">
                        {daysToExpiry === null ? '—' : `${daysToExpiry} days`}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="manual_team" className="text-white">Owning Team</Label>
                      <Input
                        id="manual_team"
                        value={manualForm.owning_team}
                        onChange={(e) => setManualForm({ ...manualForm, owning_team: e.target.value })}
                        className="bg-gray-700 border-gray-600 text-white"
                        placeholder="Web Operations"
                      />
                    </div>

                    <div className="flex items-center justify-between rounded-md bg-gray-800 border border-gray-700 px-3 py-2">
                      <div>
                        <p className="text-white text-sm font-medium">Auto-Renew</p>
                        <p className="text-xs text-gray-400">Enable automated renewal workflows</p>
                      </div>
                      <Switch
                        checked={manualForm.auto_renew_enabled}
                        onCheckedChange={(v) => setManualForm({ ...manualForm, auto_renew_enabled: v })}
                      />
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="manual_notes" className="text-white">Notes</Label>
                    <Textarea
                      id="manual_notes"
                      value={manualForm.notes}
                      onChange={(e) => setManualForm({ ...manualForm, notes: e.target.value })}
                      className="bg-gray-700 border-gray-600 text-white"
                      placeholder="Internal notes..."
                      rows={3}
                    />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="bulk" className="mt-4 space-y-6">
              <Card className="bg-gray-900 border-gray-600">
                <CardHeader>
                  <CardTitle className="text-white text-lg">Bulk Import (CSV)</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="bulk_csv_upload" className="text-white">
                      Upload certificate list (.csv)
                    </Label>
                    <Input
                      key={bulkFileKey}
                      id="bulk_csv_upload"
                      type="file"
                      accept=".csv"
                      disabled={bulkImporting}
                      className="bg-gray-700 border-gray-600 text-white file:text-gray-200 file:bg-gray-800 file:border-0 file:px-3 file:py-2 file:mr-3 file:rounded"
                      onChange={handleBulkFileChange}
                    />
                    <button
                      type="button"
                      onClick={downloadBulkTemplate}
                      className="text-sm text-blue-400 hover:text-blue-300 underline"
                    >
                      Download CSV Template
                    </button>
                  </div>

                  {bulkRows.length > 0 && (
                    <div className="rounded-md border border-gray-700 max-h-60 overflow-y-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="border-gray-700 hover:bg-transparent">
                            <TableHead className="text-gray-400">Domain</TableHead>
                            <TableHead className="text-gray-400">Agency</TableHead>
                            <TableHead className="text-gray-400">Expires</TableHead>
                            <TableHead className="text-gray-400">Environment</TableHead>
                            <TableHead className="text-gray-400 w-[90px]">Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {bulkRows.map((row, idx) => (
                            <TableRow key={idx} className="border-gray-700 text-gray-200">
                              <TableCell className="text-gray-200">{row.domain_name || '—'}</TableCell>
                              <TableCell className="text-gray-200">{row.agency_name || '—'}</TableCell>
                              <TableCell className="text-gray-200">{row.expiration_date || '—'}</TableCell>
                              <TableCell className="text-gray-200">
                                {row.environment || 'production'}
                              </TableCell>
                              <TableCell>
                                {row.valid ? (
                                  <CheckCircle className="h-4 w-4 text-emerald-400" aria-label="Valid row" />
                                ) : (
                                  <AlertCircle className="h-4 w-4 text-red-400" aria-label="Missing required fields" />
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}

                  {bulkRows.length > 0 && (
                    <div className="space-y-1 text-sm text-gray-300">
                      <p>
                        <span className="text-emerald-400 font-medium">{bulkValidCount}</span> certificates
                        ready to import
                      </p>
                      {bulkErrorCount > 0 && (
                        <p className="text-amber-400">
                          {bulkErrorCount} rows have errors and will be skipped
                        </p>
                      )}
                    </div>
                  )}

                  {bulkImporting && bulkImportProgress && (
                    <div className="space-y-2 rounded-md border border-gray-700 bg-gray-800/50 p-3">
                      <div className="flex items-center gap-2 text-sm text-gray-200">
                        <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
                        Importing {bulkImportProgress.current} of {bulkImportProgress.total}…
                      </div>
                      <Progress
                        value={
                          bulkImportProgress.total > 0
                            ? (bulkImportProgress.current / bulkImportProgress.total) * 100
                            : 0
                        }
                        className="h-2 bg-gray-700"
                      />
                    </div>
                  )}

                  <div className="space-y-2">
                    <Button
                      type="button"
                      onClick={handleBulkImport}
                      disabled={
                        bulkImporting || bulkValidCount < 1 || !isAdmin || bulkRows.length === 0
                      }
                      title={!isAdmin ? 'Admin access required' : undefined}
                      className="bg-blue-600 hover:bg-blue-700 text-white"
                    >
                      {bulkImporting ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Importing…
                        </>
                      ) : (
                        <>
                          <Upload className="h-4 w-4 mr-2" />
                          Import {bulkValidCount} Certificates
                        </>
                      )}
                    </Button>
                    <p className="text-xs text-gray-500">
                      Each certificate will be added individually. Large lists may take a moment.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

          {/* Action Buttons */}
          <div className="flex justify-end gap-3 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={loading || bulkImporting}
              className="bg-gray-700 border-gray-600 text-white hover:bg-gray-600"
            >
              {t('navigation.security.sslMonitoring.addCertificate.buttons.cancel')}
            </Button>
            {mode !== 'bulk' && (
              <Button
                type="submit"
                disabled={loading || !isAdmin}
                title={!isAdmin ? 'Admin access required' : undefined}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {t('navigation.security.sslMonitoring.addCertificate.buttons.adding')}
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4 mr-2" />
                    {t('navigation.security.sslMonitoring.addCertificate.buttons.add')} Certificate
                  </>
                )}
              </Button>
            )}
          </div>
        </form>
        </div>
      </DialogContent>
    </Dialog>
  );
};

