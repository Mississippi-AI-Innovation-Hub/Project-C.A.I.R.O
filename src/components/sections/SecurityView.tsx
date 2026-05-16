import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Search,
  Download,
  RefreshCw,
  FileText,
  Settings,
  Globe,
  Filter,
  Plus,
  Loader2,
  X,
  ChevronDown,
  ChevronRight,
  Brain,
  CheckCircle,
  Trash2,
} from 'lucide-react';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
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
import { SecuritySettingsModal } from './security/SecuritySettingsModal';
import { AddSSLCertificateModal } from './security/AddSSLCertificateModal';
import { useTranslation } from 'react-i18next';
import { api } from '@/utils/api';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';

// ── Types ────────────────────────────────────────────────────────────────────

interface ApiCert {
  certificate_id: string;
  domain_name: string;
  common_name: string;
  agency_name: string;
  owning_team: string;
  issuer: string;
  issuer_cn: string;
  status: string;
  days_to_expiry: number;
  issue_date: string;
  expiration_date: string;
  real_valid_from: string;
  real_valid_till: string;
  auto_renew_enabled: string;
  environment: string;
  csr_required: string;
  deployment_status: string;
  validation_status: string;
  renewal_threshold_days: number;
  notes: string;
  [key: string]: unknown;
}

interface RenewalJob {
  job_id: string;
  certificate_id: string;
  domain_name: string;
  overall_status: string;
}

interface CertSummary {
  total: number;
  active: number;
  expiring_soon: number;
  critical: number;
  expired: number;
}

const ITEMS_PER_PAGE = 10;

// ── Helpers ──────────────────────────────────────────────────────────────────

const agentBadge = (certId: string, status: string, jobsMap: Record<string, RenewalJob>) => {
  if (jobsMap[certId])
    return <Badge className="bg-green-600/20 text-green-400 border border-green-500/30 text-xs">Auto-renewed</Badge>;
  if (['expired', 'critical', 'expiring_soon'].includes(status))
    return <Badge className="bg-amber-600/20 text-amber-400 border border-amber-500/30 text-xs">Queued</Badge>;
  return <Badge className="bg-gray-600/20 text-gray-400 border border-gray-500/30 text-xs">Healthy</Badge>;
};

const statusBadge = (status: string, _days: number) => {
  if (status === 'pending_deployment')
    return <Badge className="bg-blue-600 hover:bg-blue-700 text-white border-0">Pending Deploy</Badge>;
  if (status === 'active')
    return <Badge className="bg-green-600 hover:bg-green-700 text-white border-0">Active</Badge>;
  if (status === 'expiring_soon')
    return <Badge className="bg-amber-500 hover:bg-amber-600 text-white border-0">Expiring Soon</Badge>;
  if (status === 'critical')
    return <Badge className="bg-red-600 hover:bg-red-700 text-white border-0">Critical</Badge>;
  if (status === 'expired' || _days < 0)
    return <Badge className="bg-red-600 hover:bg-red-700 text-white border-0">Expired</Badge>;
  return <Badge variant="secondary">{status}</Badge>;
};

// ── AI Analysis types ────────────────────────────────────────────────────────

interface AiAnalysis {
  urgency_score: number;
  action: string;
  reason: string;
  provider: string;
  risk_assessment?: {
    risk_level: string;
    risks: string[];
    consequences: string[];
  };
  change_tracking?: {
    city_changed: boolean;
    domain_changed: boolean;
    dept_name_changed: boolean;
  };
}

// ── Detail slide-out panel ───────────────────────────────────────────────────

const DetailPanel = ({ cert, onClose }: { cert: ApiCert | null; onClose: () => void }) => {
  const [aiData, setAiData] = useState<AiAnalysis | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiExpanded, setAiExpanded] = useState(true);

  useEffect(() => {
    if (!cert) return;
    setAiData(null);
    setAiLoading(true);
    api.get(`/certificates/${cert.certificate_id}/analysis?refresh=true`).then((data) => {
      if (data && !data.error) setAiData(data as AiAnalysis);
      setAiLoading(false);
    });
  }, [cert?.certificate_id]);

  if (!cert) return null;

  const rows: [string, string][] = [
    ['Common Name',        cert.common_name || '—'],
    ['Domain',             cert.domain_name],
    ['Agency',             cert.agency_name || '—'],
    ['Owning Team',        cert.owning_team || '—'],
    ['Issuer',             cert.issuer || cert.issuer_cn || '—'],
    ['Issue Date',         cert.issue_date || '—'],
    ['Expiration Date',    cert.expiration_date || '—'],
    ['Days to Expiry',     String(cert.days_to_expiry)],
    ['Status',             cert.status],
    ['Deployment Status',  cert.deployment_status || '—'],
    ['Validation Status',  cert.validation_status || '—'],
    ['Auto-Renew Enabled', cert.auto_renew_enabled],
    ['CSR Required',       cert.csr_required],
    ['Notes',              cert.notes || '—'],
  ];

  const urgencyColor = (score: number) =>
    score > 80 ? 'text-red-400' : score > 50 ? 'text-amber-400' : 'text-green-400';

  const actionBadgeClass = (action: string) => {
    if (action === 'renew_immediately') return 'bg-red-500/20 text-red-400 border-red-500/30';
    if (action === 'schedule_renewal') return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
    return 'bg-green-500/20 text-green-400 border-green-500/30';
  };

  const actionLabel = (action: string) => {
    if (action === 'renew_immediately') return 'Renew immediately';
    if (action === 'schedule_renewal') return 'Schedule renewal';
    return 'Monitor';
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-md bg-gray-900 border-l border-gray-700 overflow-y-auto shadow-2xl">
        <div className="sticky top-0 bg-gray-900 border-b border-gray-700 p-4 flex items-center justify-between">
          <div>
            <h3 className="text-white font-semibold">Certificate Details</h3>
            <p className="text-gray-400 text-xs font-mono">{cert.domain_name}</p>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose} className="text-gray-400 hover:text-white">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="p-4 space-y-1">
          {rows.map(([label, value]) => (
            <div key={label} className="grid grid-cols-2 gap-2 py-2 border-b border-gray-800 text-sm">
              <span className="text-gray-400">{label}</span>
              <span className="text-white break-all">{value}</span>
            </div>
          ))}
        </div>

        {/* AI Analysis section */}
        <div className="px-4 pb-4">
          <button
            onClick={() => setAiExpanded(v => !v)}
            className="w-full flex items-center gap-2 py-2 text-left text-sm font-semibold text-violet-300 hover:text-violet-200 border-t border-gray-700 mt-2 pt-3"
          >
            <Brain className="h-4 w-4" />
            AI Analysis
            {aiExpanded ? <ChevronDown className="h-3 w-3 ml-auto" /> : <ChevronRight className="h-3 w-3 ml-auto" />}
          </button>

          {aiExpanded && (
            <div className="mt-2 space-y-3">
              {aiLoading ? (
                <div className="flex items-center gap-2 text-gray-400 text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" /> Fetching AI analysis…
                </div>
              ) : !aiData ? (
                <p className="text-gray-500 text-sm italic">Analysis pending…</p>
              ) : (
                <>
                  {/* Urgency score */}
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400 text-xs">Urgency Score</span>
                    <span className={`text-2xl font-bold ${urgencyColor(aiData.urgency_score)}`}>
                      {aiData.urgency_score}
                    </span>
                  </div>

                  {/* Action badge */}
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400 text-xs">Action</span>
                    <Badge variant="outline" className={`text-xs border ${actionBadgeClass(aiData.action)}`}>
                      {actionLabel(aiData.action)}
                    </Badge>
                  </div>

                  {/* Risk level */}
                  {aiData.risk_assessment && (
                    <div className="flex items-center justify-between">
                      <span className="text-gray-400 text-xs">Risk Level</span>
                      <Badge variant="outline" className={`text-xs border ${actionBadgeClass(aiData.action)}`}>
                        {aiData.risk_assessment.risk_level}
                      </Badge>
                    </div>
                  )}

                  {/* Reason */}
                  <div>
                    <span className="text-gray-400 text-xs block mb-1">Reason</span>
                    <p className="text-gray-300 text-xs">{aiData.reason}</p>
                  </div>

                  {/* Risks list */}
                  {aiData.risk_assessment?.risks && aiData.risk_assessment.risks.length > 0 && (
                    <div>
                      <span className="text-gray-400 text-xs block mb-1">Risks</span>
                      <ul className="space-y-0.5">
                        {aiData.risk_assessment.risks.map((r, i) => (
                          <li key={i} className="text-xs text-gray-300 flex items-start gap-1">
                            <span className="text-red-400 mt-0.5">•</span> {r}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Consequences list */}
                  {aiData.risk_assessment?.consequences && aiData.risk_assessment.consequences.length > 0 && (
                    <div>
                      <span className="text-gray-400 text-xs block mb-1">Consequences</span>
                      <ul className="space-y-0.5">
                        {aiData.risk_assessment.consequences.map((c, i) => (
                          <li key={i} className="text-xs text-gray-300 flex items-start gap-1">
                            <span className="text-amber-400 mt-0.5">•</span> {c}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Change tracking */}
                  {aiData.change_tracking && (
                    <div>
                      <span className="text-gray-400 text-xs block mb-1">Change Tracking</span>
                      <div className="flex flex-wrap gap-1">
                        {[
                          ['Domain', aiData.change_tracking.domain_changed],
                          ['Dept', aiData.change_tracking.dept_name_changed],
                          ['City', aiData.change_tracking.city_changed],
                        ].map(([label, changed]) => (
                          <span
                            key={label as string}
                            className={`text-xs px-2 py-0.5 rounded-full border ${
                              changed
                                ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                                : 'bg-gray-500/20 text-gray-400 border-gray-500/30'
                            }`}
                          >
                            {label} changed: {changed ? 'Yes' : 'No'}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Footer */}
                  <p className="text-gray-600 text-xs pt-1">Analysis by: {aiData.provider}</p>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ── Main component ───────────────────────────────────────────────────────────

export const SecurityView = () => {
  const { t } = useTranslation();
  const { isAdmin } = useAuth();

  const [apiCerts, setApiCerts]           = useState<ApiCert[]>([]);
  const [renewalJobsMap, setRenewalJobsMap] = useState<Record<string, RenewalJob>>({});
  const [summary, setSummary]             = useState<CertSummary | null>(null);
  const [loading, setLoading]             = useState(true);
  const [searchTerm, setSearchTerm]       = useState('');
  const [statusFilter, setStatusFilter]   = useState('all');
  const [currentPage, setCurrentPage]     = useState(1);
  const [showSettingsModal, setShowSettingsModal]         = useState(false);
  const [showAddCertificateModal, setShowAddCertificateModal] = useState(false);
  const [detailCert, setDetailCert]       = useState<ApiCert | null>(null);
  const [checkingRows, setCheckingRows]   = useState<Record<string, boolean>>({});
  const [checkResults, setCheckResults]   = useState<Record<string, string>>({});
  const [confirmingDeploy, setConfirmingDeploy] = useState<Record<string, boolean>>({});
  const [confirmDeployOpen, setConfirmDeployOpen] = useState(false);
  const [confirmDeployCert, setConfirmDeployCert] = useState<ApiCert | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteCert, setDeleteCert] = useState<ApiCert | null>(null);
  const [deleting, setDeleting] = useState(false);

  const refreshCertificateData = async () => {
    const [certs, jobs, sum] = await Promise.all([
      api.get('/certificates'),
      api.get('/renew/jobs'),
      api.get('/certificates/summary'),
    ]);
    if (certs && Array.isArray(certs)) {
      const sorted = [...(certs as ApiCert[])].sort((a, b) => {
        const an = parseInt(String(a.certificate_id ?? '').replace('CERT-', ''), 10);
        const bn = parseInt(String(b.certificate_id ?? '').replace('CERT-', ''), 10);
        if (!Number.isNaN(an) && !Number.isNaN(bn)) return bn - an;
        return String(b.certificate_id ?? '').localeCompare(String(a.certificate_id ?? ''));
      });
      setApiCerts(sorted);
    }
    if (jobs) {
      const map: Record<string, RenewalJob> = {};
      (jobs as RenewalJob[]).forEach(j => { map[j.certificate_id] = j; });
      setRenewalJobsMap(map);
    }
    if (sum) setSummary(sum as CertSummary);
  };

  useEffect(() => {
    const load = async () => {
      const [certs, jobs, sum] = await Promise.all([
        api.get('/certificates'),
        api.get('/renew/jobs'),
        api.get('/certificates/summary'),
      ]);

      if (certs && Array.isArray(certs)) {
        const sorted = [...(certs as ApiCert[])].sort((a, b) => {
          const an = parseInt(String(a.certificate_id ?? '').replace('CERT-', ''), 10);
          const bn = parseInt(String(b.certificate_id ?? '').replace('CERT-', ''), 10);
          if (!Number.isNaN(an) && !Number.isNaN(bn)) return bn - an;
          return String(b.certificate_id ?? '').localeCompare(String(a.certificate_id ?? ''));
        });
        setApiCerts(sorted);
      }
      if (jobs) {
        const map: Record<string, RenewalJob> = {};
        (jobs as RenewalJob[]).forEach(j => { map[j.certificate_id] = j; });
        setRenewalJobsMap(map);
      }
      if (sum) setSummary(sum);

      // One-time navigation filters (set by OverviewDashboard)
      const savedStatus = localStorage.getItem('certStatusFilter');
      const savedDomain = localStorage.getItem('certDomainFilter');
      const savedCertId = localStorage.getItem('certDetailCertId');

      if (savedStatus) {
        setStatusFilter(savedStatus);
        localStorage.removeItem('certStatusFilter');
      }
      if (savedDomain) {
        setSearchTerm(savedDomain);
        localStorage.removeItem('certDomainFilter');
      }
      if (savedCertId) {
        const list = Array.isArray(certs) ? (certs as ApiCert[]) : [];
        const match = list.find(c => c.certificate_id === savedCertId);
        if (match) await handleDetail(match);
        localStorage.removeItem('certDetailCertId');
      }

      setLoading(false);
    };
    load();
  }, []);

  const handleConfirmDeploy = async (cert: ApiCert) => {
    setConfirmingDeploy(r => ({ ...r, [cert.certificate_id]: true }));
    try {
      await api.postExpectOk(`/certificates/${cert.certificate_id}/confirm-deploy`, {});
      toast.success(`${cert.domain_name} deployed successfully — status: Active`, {
        className: '!bg-emerald-950 !text-emerald-50 !border !border-emerald-600',
      });
      await refreshCertificateData();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Confirm deploy failed';
      toast.error(msg, {
        className: '!bg-red-950 !text-red-50 !border !border-red-600',
      });
    } finally {
      setConfirmingDeploy(r => ({ ...r, [cert.certificate_id]: false }));
    }
  };

  const handleDelete = async (cert: ApiCert) => {
    setDeleting(true);
    try {
      await api.deleteExpectOk(`/certificates/${cert.certificate_id}`);
      toast.success(`Deleted ${cert.domain_name}`, {
        className: '!bg-emerald-950 !text-emerald-50 !border !border-emerald-600',
      });
      await refreshCertificateData();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Delete failed';
      toast.error(msg, {
        className: '!bg-red-950 !text-red-50 !border !border-red-600',
      });
    } finally {
      setDeleting(false);
      setDeleteOpen(false);
      setDeleteCert(null);
    }
  };

  // Refresh a single cert via live SSL check
  const handleRefresh = async (cert: ApiCert) => {
    setCheckingRows(r => ({ ...r, [cert.certificate_id]: true }));
    const result = await api.post('/ssl/check', { hostname: cert.domain_name, port: 443 });
    if (!result || result.error) {
      setCheckResults(r => ({ ...r, [cert.certificate_id]: 'Check failed' }));
      toast.error(`SSL check failed for ${cert.domain_name}`);
    } else {
      const days = result.valid_days_to_expire ?? result.days_left ?? '?';
      const msg = `Live: ${days} days left`;
      setCheckResults(r => ({ ...r, [cert.certificate_id]: msg }));
      toast.success(`${cert.domain_name} — ${msg}`);
    }
    setCheckingRows(r => ({ ...r, [cert.certificate_id]: false }));
  };

  // Open detail slide-out with freshest data
  const handleDetail = async (cert: ApiCert) => {
    const fresh = await api.get(`/certificates/${cert.certificate_id}`);
    setDetailCert(fresh ?? cert);
  };

  // Client-side filtering — status filter matches the API `status` field directly
  const filteredCertificates = apiCerts.filter(cert => {
    const q = searchTerm.toLowerCase();
    const matchesSearch =
      cert.domain_name.toLowerCase().includes(q) ||
      (cert.agency_name || '').toLowerCase().includes(q) ||
      (cert.issuer || '').toLowerCase().includes(q);
    const matchesStatus = statusFilter === 'all' || cert.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const handleExportCsv = () => {
    const csvEscape = (value: unknown) => {
      const s = String(value ?? '');
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const hasCompletedRenewalJob = (certId: string) => {
      const job = renewalJobsMap[certId];
      return Boolean(job && String(job.overall_status ?? '').toLowerCase() === 'completed');
    };

    const headers = [
      'Certificate ID',
      'Domain',
      'Agency',
      'Issuer',
      'Environment',
      'Status',
      'Days Left',
      'Expires On',
      'Auto-Renew',
      'CSR Required',
      'Deployment Status',
      'PFX Ready',
    ];

    const rows = filteredCertificates.map((cert) => ([
      cert.certificate_id,
      cert.domain_name,
      cert.agency_name || '',
      cert.issuer || cert.issuer_cn || '',
      cert.environment || '',
      cert.status,
      cert.days_to_expiry,
      cert.expiration_date || '',
      cert.auto_renew_enabled,
      cert.csr_required,
      cert.deployment_status || '',
      hasCompletedRenewalJob(cert.certificate_id) ? 'Yes' : 'No',
    ]));

    const csv = [headers, ...rows]
      .map((row) => row.map(csvEscape).join(','))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });

    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const fileName = `certificate_report_${yyyy}-${mm}-${dd}.csv`;

    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);

    toast.success(`Exported ${filteredCertificates.length} certificates to CSV`);
  };

  const totalPages = Math.ceil(filteredCertificates.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const currentCertificates = filteredCertificates.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  React.useEffect(() => { setCurrentPage(1); }, [searchTerm, statusFilter]);

  // Summary card values — from API when available, fall back to local count
  const sumTotal    = summary?.total        ?? apiCerts.length;
  const sumValid    = summary?.active       ?? apiCerts.filter(c => c.status === 'active').length;
  const sumWarning  = summary?.expiring_soon ?? apiCerts.filter(c => c.status === 'expiring_soon').length;
  const sumCritical = (summary?.critical ?? 0) + (summary?.expired ?? 0)
    || apiCerts.filter(c => c.status === 'critical' || c.status === 'expired').length;

  const startItem = filteredCertificates.length === 0 ? 0 : startIndex + 1;
  const endItem   = Math.min(currentPage * ITEMS_PER_PAGE, filteredCertificates.length);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
        <span className="text-white ml-3">Loading certificates…</span>
      </div>
    );
  }

  return (
    <div className="space-y-4 md:space-y-6 p-2 md:p-4 lg:p-6 max-w-full overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl md:text-2xl lg:text-3xl font-bold mb-2 text-white">
            {t('navigation.security.sslMonitoring.title')}
          </h2>
          <p className="text-gray-400 text-xs md:text-sm lg:text-base">
            {t('navigation.security.sslMonitoring.subtitle')}
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <Button onClick={() => setShowAddCertificateModal(true)}
            disabled={!isAdmin}
            title={!isAdmin ? 'Admin access required' : undefined}
            className="bg-green-600 hover:bg-green-700 text-white w-full sm:w-auto px-3 py-2 text-sm">
            <Plus className="h-4 w-4 mr-2" />
            {t('navigation.security.sslMonitoring.buttons.addCertificate')}
          </Button>
          <Button onClick={() => setShowSettingsModal(true)}
            disabled={!isAdmin}
            title={!isAdmin ? 'Admin access required' : undefined}
            className="bg-blue-600 hover:bg-blue-700 text-white w-full sm:w-auto px-3 py-2 text-sm">
            <Settings className="h-4 w-4 mr-2" />
            {t('navigation.security.sslMonitoring.buttons.settingsSecurity')}
          </Button>
        </div>
      </div>

      {/* Summary Cards — from /api/certificates/summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-6">
        <Card className="bg-blue-600">
          <CardContent className="p-4 md:p-6 text-center">
            <div className="text-2xl md:text-4xl font-bold text-white mb-1 md:mb-2">{sumTotal}</div>
            <p className="text-blue-100 text-xs md:text-sm">{t('navigation.security.sslMonitoring.metrics.totalCertificates')}</p>
          </CardContent>
        </Card>
        <Card className="bg-green-600">
          <CardContent className="p-4 md:p-6 text-center">
            <div className="text-2xl md:text-4xl font-bold text-white mb-1 md:mb-2">{sumValid}</div>
            <p className="text-green-100 text-xs md:text-sm">{t('navigation.security.sslMonitoring.metrics.valid')}</p>
          </CardContent>
        </Card>
        <Card className="bg-orange-600">
          <CardContent className="p-4 md:p-6 text-center">
            <div className="text-2xl md:text-4xl font-bold text-white mb-1 md:mb-2">{sumWarning}</div>
            <p className="text-orange-100 text-xs md:text-sm">{t('navigation.security.sslMonitoring.metrics.warning')}</p>
          </CardContent>
        </Card>
        <Card className="bg-red-600">
          <CardContent className="p-4 md:p-6 text-center">
            <div className="text-2xl md:text-4xl font-bold text-white mb-1 md:mb-2">{sumCritical}</div>
            <p className="text-red-100 text-xs md:text-sm">{t('navigation.security.sslMonitoring.metrics.criticalExpired')}</p>
          </CardContent>
        </Card>
      </div>

      {/* Certificates Table */}
      <Card className="bg-gray-800 border-gray-700 w-full">
        <CardHeader className="pb-3">
          <div className="flex flex-col space-y-4">
            <CardTitle className="text-white text-base md:text-lg lg:text-xl">
              {t('navigation.security.sslMonitoring.table.title')}
            </CardTitle>
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                <Input
                  placeholder="Search domain, agency, issuer…"
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="pl-10 bg-gray-700 border-gray-600 text-white placeholder:text-gray-400"
                />
              </div>
              <div className="flex gap-2">
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-full sm:w-48 bg-gray-700 border-gray-600 text-white">
                    <Filter className="h-4 w-4 mr-2" />
                    <SelectValue placeholder="All statuses" />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-700 border-gray-600">
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="expiring_soon">Expiring Soon</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                    <SelectItem value="expired">Expired</SelectItem>
                    <SelectItem value="pending_deployment">Pending Deploy</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  onClick={handleExportCsv}
                  variant="outline"
                  size="sm"
                  className="bg-gray-700 border-gray-600 text-white hover:bg-gray-600"
                >
                  <Download className="h-4 w-4 mr-2" />
                  {t('navigation.security.sslMonitoring.buttons.export')}
                </Button>
              </div>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {/* Mobile Card View */}
          <div className="block lg:hidden">
            <div className="space-y-3 p-3">
              {currentCertificates.length === 0 ? (
                <div className="text-center py-8 text-gray-400">No certificates found</div>
              ) : currentCertificates.map(cert => (
                <Card key={cert.certificate_id} className="bg-gray-750 border-gray-600">
                  <CardContent className="p-4">
                    <div className="space-y-3">
                      <div className="flex justify-between items-start">
                        <div>
                          <h3 className="font-medium text-white text-sm flex items-center">
                            <Globe className="h-4 w-4 mr-2 text-blue-400" />
                            {cert.domain_name}
                          </h3>
                          <p className="text-xs text-gray-400">{cert.issuer || '—'}</p>
                          <p className="text-xs text-gray-500">{cert.agency_name}</p>
                        </div>
                        {statusBadge(cert.status, cert.days_to_expiry)}
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <span className="text-gray-400">Issue Date:</span>
                          <p className="text-white">{cert.issue_date || '—'}</p>
                        </div>
                        <div>
                          <span className="text-gray-400">Expires:</span>
                          <p className="text-white">{cert.expiration_date || '—'}</p>
                        </div>
                      </div>
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        {agentBadge(cert.certificate_id, cert.status, renewalJobsMap)}
                        <div className="flex gap-1 flex-wrap">
                          {cert.status === 'pending_deployment' && (
                            <Button
                              size="sm"
                              className="h-8 px-2 text-xs bg-green-600 hover:bg-green-700 text-white"
                              onClick={() => {
                                setConfirmDeployCert(cert);
                                setConfirmDeployOpen(true);
                              }}
                              disabled={confirmingDeploy[cert.certificate_id] || !isAdmin}
                              title={!isAdmin ? 'Admin access required' : undefined}
                            >
                              {confirmingDeploy[cert.certificate_id]
                                ? <Loader2 className="h-3 w-3 animate-spin" />
                                : <CheckCircle className="h-3 w-3 mr-1" />}
                              Confirm Deploy
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" className="h-8 w-8 p-0 hover:bg-blue-600"
                            onClick={() => handleDetail(cert)}>
                            <FileText className="h-3 w-3 text-blue-400" />
                          </Button>
                          <Button size="sm" variant="ghost" className="h-8 w-8 p-0 hover:bg-green-600"
                            onClick={() => handleRefresh(cert)} disabled={checkingRows[cert.certificate_id]}>
                            {checkingRows[cert.certificate_id]
                              ? <Loader2 className="h-3 w-3 animate-spin text-green-400" />
                              : <RefreshCw className="h-3 w-3 text-green-400" />}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 p-0 hover:bg-red-600"
                            onClick={() => {
                              setDeleteCert(cert);
                              setDeleteOpen(true);
                            }}
                            disabled={!isAdmin}
                            title={!isAdmin ? 'Admin access required' : 'Delete certificate'}
                          >
                            <Trash2 className="h-3 w-3 text-red-400" />
                          </Button>
                        </div>
                      </div>
                      {checkResults[cert.certificate_id] && (
                        <p className="text-xs text-blue-300 bg-blue-900/20 rounded px-2 py-1">
                          {checkResults[cert.certificate_id]}
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          {/* Desktop Table View */}
          <div className="hidden lg:block">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-700">
                    <th className="text-left py-3 px-4 text-gray-400 font-medium text-sm">Domain</th>
                    <th className="text-left py-3 px-4 text-gray-400 font-medium text-sm">Issuer</th>
                    <th className="text-left py-3 px-4 text-gray-400 font-medium text-sm">Valid Since</th>
                    <th className="text-left py-3 px-4 text-gray-400 font-medium text-sm">Expires On</th>
                    <th className="text-left py-3 px-4 text-gray-400 font-medium text-sm">Days Left</th>
                    <th className="text-left py-3 px-4 text-gray-400 font-medium text-sm">Status</th>
                    <th className="text-left py-3 px-4 text-gray-400 font-medium text-sm">Agent Status</th>
                    <th className="text-left py-3 px-4 text-gray-400 font-medium text-sm">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {currentCertificates.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-gray-400">No certificates found</td>
                    </tr>
                  ) : currentCertificates.map(cert => (
                    <tr key={cert.certificate_id} className="border-b border-gray-700 hover:bg-gray-750">
                      <td className="py-4 px-4">
                        <div className="text-white font-medium flex items-center">
                          <Globe className="h-4 w-4 mr-2 text-blue-400 flex-shrink-0" />
                          <span className="text-xs font-mono">{cert.domain_name}</span>
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5 ml-6">{cert.agency_name}</div>
                      </td>
                      <td className="py-4 px-4 text-gray-300 text-sm">{cert.issuer || '—'}</td>
                      <td className="py-4 px-4 text-gray-300 text-sm">{cert.issue_date || '—'}</td>
                      <td className="py-4 px-4 text-gray-300 text-sm">{cert.expiration_date || '—'}</td>
                      <td className="py-4 px-4">
                        <span className={`font-medium text-sm ${
                          cert.days_to_expiry < 0   ? 'text-red-500'   :
                          cert.days_to_expiry <= 7  ? 'text-red-400'  :
                          cert.days_to_expiry <= 30 ? 'text-yellow-400': 'text-green-400'
                        }`}>
                          {cert.days_to_expiry < 0
                            ? `Expired (${Math.abs(cert.days_to_expiry)}d)`
                            : `${cert.days_to_expiry}d`}
                        </span>
                      </td>
                      <td className="py-4 px-4">{statusBadge(cert.status, cert.days_to_expiry)}</td>
                      <td className="py-4 px-4">
                        {agentBadge(cert.certificate_id, cert.status, renewalJobsMap)}
                        {checkResults[cert.certificate_id] && (
                          <p className="text-xs text-blue-300 mt-1 max-w-[140px] truncate"
                            title={checkResults[cert.certificate_id]}>
                            {checkResults[cert.certificate_id]}
                          </p>
                        )}
                      </td>
                      <td className="py-4 px-4">
                        <div className="flex flex-wrap gap-2 items-center">
                          {cert.status === 'pending_deployment' && (
                            <Button
                              size="sm"
                              className="h-8 px-2 text-xs bg-green-600 hover:bg-green-700 text-white shrink-0"
                              onClick={() => {
                                setConfirmDeployCert(cert);
                                setConfirmDeployOpen(true);
                              }}
                              disabled={confirmingDeploy[cert.certificate_id] || !isAdmin}
                              title={!isAdmin ? 'Admin access required' : 'Confirm IIS deployment'}
                            >
                              {confirmingDeploy[cert.certificate_id]
                                ? <Loader2 className="h-4 w-4 animate-spin" />
                                : <CheckCircle className="h-4 w-4 mr-1" />}
                              Confirm Deploy
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" className="h-8 w-8 p-0 hover:bg-blue-600"
                            onClick={() => handleDetail(cert)} title="View details">
                            <FileText className="h-4 w-4 text-blue-400" />
                          </Button>
                          <Button size="sm" variant="ghost" className="h-8 w-8 p-0 hover:bg-green-600"
                            onClick={() => handleRefresh(cert)} disabled={checkingRows[cert.certificate_id]}
                            title="Live SSL check">
                            {checkingRows[cert.certificate_id]
                              ? <Loader2 className="h-4 w-4 animate-spin text-green-400" />
                              : <RefreshCw className="h-4 w-4 text-green-400" />}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 p-0 hover:bg-red-600"
                            onClick={() => {
                              setDeleteCert(cert);
                              setDeleteOpen(true);
                            }}
                            disabled={!isAdmin}
                            title={!isAdmin ? 'Admin access required' : 'Delete certificate'}
                          >
                            <Trash2 className="h-4 w-4 text-red-400" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4">
              <div className="text-sm text-gray-400">
                Showing {startItem} to {endItem} of {filteredCertificates.length} certificates
              </div>
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious href="#"
                      onClick={e => { e.preventDefault(); if (currentPage > 1) setCurrentPage(p => p - 1); }}
                      className={`bg-gray-700 border-gray-600 text-white hover:bg-gray-600 ${currentPage === 1 ? 'opacity-50 cursor-not-allowed' : ''}`}
                    />
                  </PaginationItem>
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                    <PaginationItem key={p}>
                      <PaginationLink href="#"
                        onClick={e => { e.preventDefault(); setCurrentPage(p); }}
                        isActive={currentPage === p}
                        className="bg-gray-700 border-gray-600 text-white hover:bg-gray-600">
                        {p}
                      </PaginationLink>
                    </PaginationItem>
                  ))}
                  <PaginationItem>
                    <PaginationNext href="#"
                      onClick={e => { e.preventDefault(); if (currentPage < totalPages) setCurrentPage(p => p + 1); }}
                      className={`bg-gray-700 border-gray-600 text-white hover:bg-gray-600 ${currentPage === totalPages ? 'opacity-50 cursor-not-allowed' : ''}`}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          )}

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mt-2 px-4 pb-4 text-xs text-gray-400 gap-4">
            <span>Showing {filteredCertificates.length} of {apiCerts.length} certificates</span>
              <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2"><div className="w-2 h-2 bg-green-500 rounded-full" /><span>Active</span></div>
              <div className="flex items-center gap-2"><div className="w-2 h-2 bg-amber-500 rounded-full" /><span>Expiring Soon</span></div>
              <div className="flex items-center gap-2"><div className="w-2 h-2 bg-blue-500 rounded-full" /><span>Pending Deploy</span></div>
              <div className="flex items-center gap-2"><div className="w-2 h-2 bg-red-500 rounded-full" /><span>Critical / Expired</span></div>
            </div>
          </div>
        </CardContent>
      </Card>

      <DetailPanel cert={detailCert} onClose={() => setDetailCert(null)} />

      <SecuritySettingsModal
        isOpen={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
        onSaved={refreshCertificateData}
      />
      <AddSSLCertificateModal
        isOpen={showAddCertificateModal}
        onClose={() => setShowAddCertificateModal(false)}
        onCertificateAdded={refreshCertificateData}
      />

      <AlertDialog
        open={confirmDeployOpen}
        onOpenChange={(open) => {
          setConfirmDeployOpen(open);
          if (!open) setConfirmDeployCert(null);
        }}
      >
        <AlertDialogContent className="bg-gray-900 border-gray-700 text-white sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">
              Confirm IIS Import Complete
            </AlertDialogTitle>
            <AlertDialogDescription className="text-gray-300">
              Confirm IIS Import Complete — This confirms that the PFX bundle has been imported on MDAWEB19, the website binding has been updated, and FortiManager has been updated with the new certificate.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-gray-600 bg-gray-800 text-white hover:bg-gray-700 hover:text-white">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-green-700 text-white hover:bg-green-600 focus:ring-green-600"
              disabled={!isAdmin}
              title={!isAdmin ? 'Admin access required' : undefined}
              onClick={() => {
                if (!confirmDeployCert) return;
                void handleConfirmDeploy(confirmDeployCert);
                setConfirmDeployOpen(false);
                setConfirmDeployCert(null);
              }}
            >
              Confirm Deployment Complete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          setDeleteOpen(open);
          if (!open) setDeleteCert(null);
        }}
      >
        <AlertDialogContent className="bg-gray-900 border-gray-700 text-white sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">
              Delete certificate
            </AlertDialogTitle>
            <AlertDialogDescription className="text-gray-300">
              Are you sure you want to delete{' '}
              <span className="font-semibold text-white">{deleteCert?.domain_name ?? 'this certificate'}</span>?
              <br />
              <span className="text-red-300">This action cannot be undone.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              className="border-gray-600 bg-gray-800 text-white hover:bg-gray-700 hover:text-white"
              disabled={deleting}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-700 text-white hover:bg-red-600 focus:ring-red-600"
              disabled={deleting || !isAdmin}
              title={!isAdmin ? 'Admin access required' : undefined}
              onClick={() => {
                if (!deleteCert) return;
                void handleDelete(deleteCert);
              }}
            >
              {deleting ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Deleting…
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
    </div>
  );
};
