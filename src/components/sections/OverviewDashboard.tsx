import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Shield, AlertTriangle, CheckCircle, XCircle, Clock,
  RefreshCw, FileText, Activity, Bot, Loader2, Mail, Brain,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { api, checkHealth } from '@/utils/api';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';

// ── Types ────────────────────────────────────────────────────────────────────

interface Summary {
  total: number;
  active: number;
  expiring_soon: number;
  critical: number;
  expired: number;
  pending_deployment?: number;
  auto_renew_enabled_count: number;
  renewal_rate_pct: number;
  csr_pending_count: number;
  failed_renewal_count: number;
  last_refreshed: string;
}

interface ApiCert {
  certificate_id: string;
  domain_name: string;
  agency_name: string;
  status: string;
  days_to_expiry: number;
  auto_renew_enabled: string;
  renewal_threshold_days: number;
}

interface AgentStatus {
  running: boolean;
  jobs_completed: number;
  certs_processed: number;
  last_refreshed: string;
  interval_minutes: number;
}

interface AiSummary {
  total_analyzed: number;
  critical_count: number;
  high_risk_count: number;
  renew_immediately_count: number;
  bedrock_powered: number;
  rule_based_fallback: number;
  ai_provider: string;
  status?: string;
}

interface AiTopRisk {
  certificate_id: string;
  domain_name: string;
  agency_name: string;
  status: string;
  urgency_score: number;
  action: string;
  reason: string;
  risk_level: string;
  risks: string[];
  consequences: string[];
  estimated_impact: string;
  provider: string;
}

interface RunAgentNowResponse {
  status?: string;
  jobs_processed?: number;
  certs_scanned?: number;
  message?: string;
}

interface RenewalPipelineStep {
  step: string;
  status: 'completed' | 'failed' | 'pending';
  started_at?: string;
  completed_at?: string;
  error?: string;
}

interface RenewalJob {
  job_id: string;
  certificate_id: string;
  domain_name: string;
  agency_name: string;
  steps?: RenewalPipelineStep[];
  overall_status?: string;
}

const truncateDomain = (s: string, max = 30) =>
  (s?.length ?? 0) > max ? `${s.slice(0, max)}…` : s;

const UrgencyScoreBadge = ({ score }: { score: number }) => {
  const className =
    score >= 80
      ? 'bg-red-500/20 text-red-400 border-red-500/40'
      : score >= 50
        ? 'bg-amber-500/20 text-amber-400 border-amber-500/40'
        : 'bg-green-500/20 text-green-400 border-green-500/40';
  return (
    <Badge variant="outline" className={`text-[10px] font-semibold border px-1.5 py-0 h-5 ${className}`}>
      {score}
    </Badge>
  );
};

// ── StatusBadge ──────────────────────────────────────────────────────────────

const StatusBadge = ({ status }: { status: string }) => {
  const map: Record<string, { label: string; className: string }> = {
    active:              { label: 'Active',         className: 'bg-green-500/20 text-green-400 border-green-500/30' },
    expiring_soon:       { label: 'Expiring Soon',  className: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
    critical:            { label: 'Critical',       className: 'bg-red-500/20 text-red-400 border-red-500/30' },
    expired:             { label: 'Expired',        className: 'bg-red-500/20 text-red-400 border-red-500/30' },
    pending_deployment:  { label: 'Pending Deploy', className: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  };
  const s = map[status] ?? { label: status.replace(/_/g, ' '), className: 'bg-gray-500/20 text-gray-400 border-gray-500/30' };
  return (
    <Badge variant="outline" className={`text-xs font-medium border ${s.className}`}>
      {s.label}
    </Badge>
  );
};

// ── HealthDot ────────────────────────────────────────────────────────────────

const HealthDot = ({ online }: { online: boolean | null }) => {
  if (online === null) return <span className="text-gray-500 text-xs">checking…</span>;
  return (
    <span className="flex items-center gap-1.5 text-xs">
      <span className={`relative flex h-2 w-2 ${online ? '' : ''}`}>
        {online && (
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
        )}
        <span className={`relative inline-flex rounded-full h-2 w-2 ${online ? 'bg-green-400' : 'bg-red-500'}`} />
      </span>
      <span className={online ? 'text-green-400' : 'text-red-400'}>{online ? 'Live' : 'Offline'}</span>
    </span>
  );
};

// ── Main component ───────────────────────────────────────────────────────────

export const OverviewDashboard = ({ onSectionChange }: { onSectionChange?: (section: string) => void }) => {
  const { isAdmin } = useAuth();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [urgentCerts, setUrgentCerts] = useState<ApiCert[]>([]);
  const [agentStatus, setAgentStatus] = useState<AgentStatus | null>(null);
  const [aiSummary, setAiSummary] = useState<AiSummary | null>(null);
  const [aiTopRisks, setAiTopRisks] = useState<AiTopRisk[]>([]);
  const [loading, setLoading] = useState(true);
  const [agentRunning, setAgentRunning] = useState(false);
  const [bulkConfirming, setBulkConfirming] = useState(false);
  const [confirmAllDialogOpen, setConfirmAllDialogOpen] = useState(false);
  const [bulkConfirmLabelCount, setBulkConfirmLabelCount] = useState(0);
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);
  const [allCerts, setAllCerts] = useState<ApiCert[]>([]);
  const [renewalJobs, setRenewalJobs] = useState<RenewalJob[]>([]);
  const healthRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const reloadDashboardCards = async () => {
    try {
      const [
        sumData,
        expiredData,
        criticalData,
        pendingDeployData,
        agentData,
        certsData,
        jobsData,
      ] = await Promise.all([
        api.get('/certificates/summary'),
        api.get('/certificates/status/expired'),
        api.get('/certificates/status/critical'),
        api.get('/certificates/status/pending_deployment'),
        api.get('/agent/status'),
        api.get('/certificates'),
        api.get('/renew/jobs'),
      ]);
      setSummary(sumData);
      const expired = Array.isArray(expiredData) ? expiredData : [];
      const critical = Array.isArray(criticalData) ? criticalData : [];
      const pendingDeploy = Array.isArray(pendingDeployData) ? pendingDeployData : [];
      const combined: ApiCert[] = [...expired, ...critical, ...pendingDeploy];
      const statusWeight = (s: string) =>
        s === 'expired' ? 0
        : s === 'critical' ? 1
        : s === 'pending_deployment' ? 2
        : 3;
      combined.sort((a, b) => {
        const sw = statusWeight(a.status) - statusWeight(b.status);
        if (sw !== 0) return sw;
        return (a.days_to_expiry ?? 0) - (b.days_to_expiry ?? 0);
      });
      setUrgentCerts(combined);
      setAgentStatus(agentData);
      setAllCerts(Array.isArray(certsData) ? certsData : []);
      setRenewalJobs(Array.isArray(jobsData) ? jobsData : []);
    } catch {
      // API unreachable — leave existing state
    }

    const [sumRes, topRes] = await Promise.allSettled([
      api.get('/ai/summary'),
      api.get('/ai/top-risks'),
    ]);
    if (sumRes.status === 'fulfilled' && sumRes.value) setAiSummary(sumRes.value);
    if (topRes.status === 'fulfilled' && Array.isArray(topRes.value)) {
      setAiTopRisks(topRes.value);
    }
  };

  // Load summary, urgent certs, agent status, AI summary
  useEffect(() => {
    const load = async () => {
      try {
        await reloadDashboardCards();
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  // Health polling every 30 s
  useEffect(() => {
    const poll = async () => setApiOnline(await checkHealth());
    poll();
    healthRef.current = setInterval(poll, 30_000);
    return () => { if (healthRef.current) clearInterval(healthRef.current); };
  }, []);

  const handleRunAgent = async () => {
    setAgentRunning(true);
    try {
      const data = await api.postExpectOk<RunAgentNowResponse>('/agent/run-now', {});
      const jobs =
        typeof data.jobs_processed === 'number' ? data.jobs_processed : 0;
      toast.success(`Agent scan complete — ${jobs} jobs processed`, {
        className: '!bg-emerald-950 !text-emerald-50 !border !border-emerald-600',
      });
      await reloadDashboardCards();
    } catch {
      toast.error('Agent scan failed — check API connection', {
        className: '!bg-red-950 !text-red-50 !border !border-red-600',
      });
    } finally {
      setAgentRunning(false);
    }
  };

  const pendingDeployCount = summary?.pending_deployment ?? 0;

  const handleConfirmAllDeployments = async () => {
    setBulkConfirming(true);
    try {
      const data = await api.postExpectOk<{
        confirmed_count?: number;
        status?: string;
      }>('/certificates/confirm-deploy-all', {});
      const n = typeof data.confirmed_count === 'number' ? data.confirmed_count : 0;
      toast.success(`${n} certificate${n === 1 ? '' : 's'} deployed — all active`, {
        className: '!bg-emerald-950 !text-emerald-50 !border !border-emerald-600',
      });
      setConfirmAllDialogOpen(false);
      await reloadDashboardCards();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Bulk confirm deploy failed';
      toast.error(msg, {
        className: '!bg-red-950 !text-red-50 !border !border-red-600',
      });
    } finally {
      setBulkConfirming(false);
    }
  };

  // ── Stat cards ─────────────────────────────────────────────────────────────

  const navigateToCertificates = (opts?: { statusFilter?: string; domainFilter?: string; certId?: string }) => {
    localStorage.setItem('activeSection', 'certificates');
    if (opts?.statusFilter) localStorage.setItem('certStatusFilter', opts.statusFilter);
    if (opts?.domainFilter) localStorage.setItem('certDomainFilter', opts.domainFilter);
    if (opts?.certId) localStorage.setItem('certDetailCertId', opts.certId);
    onSectionChange?.('certificates');
  };

  const statCards = summary
    ? [
        { label: 'Total Certificates', value: summary.total,                        icon: Shield,        color: 'text-blue-400',    bg: 'bg-blue-500/10',    statusFilter: 'all' },
        { label: 'Active',             value: summary.active,                       icon: CheckCircle,   color: 'text-green-400',   bg: 'bg-green-500/10',   statusFilter: 'active' },
        { label: 'Expiring Soon',      value: summary.expiring_soon,                icon: Clock,         color: 'text-amber-400',  bg: 'bg-amber-500/10',   statusFilter: 'expiring_soon' },
        { label: 'Critical / Expired', value: summary.critical + summary.expired,   icon: XCircle,       color: 'text-red-400',     bg: 'bg-red-500/10',     statusFilter: 'critical' },
        { label: 'Auto-Renew Enabled', value: summary.auto_renew_enabled_count,     icon: RefreshCw,     color: 'text-emerald-400', bg: 'bg-emerald-500/10', statusFilter: 'all' },
        { label: 'Renewal Rate',       value: `${summary.renewal_rate_pct}%`,       icon: Activity,      color: 'text-purple-400',  bg: 'bg-purple-500/10',  statusFilter: 'pending_deployment' },
        { label: 'CSR Pending',        value: summary.csr_pending_count,            icon: FileText,      color: 'text-amber-400',   bg: 'bg-amber-500/10',   statusFilter: 'expiring_soon' },
        { label: 'Failed Renewals',    value: summary.failed_renewal_count,         icon: AlertTriangle, color: 'text-red-400',     bg: 'bg-red-500/10',     statusFilter: 'expired' },
      ]
    : [];

  const now = new Date();

  const stageCount = useMemo(() => {
    const certs = allCerts;
    const jobs = renewalJobs;
    return {
      active: certs.filter((c) => c.status === 'active').length,
      expiration_detected: certs.filter((c) =>
        ['expired', 'critical', 'expiring_soon'].includes(c.status),
      ).length,
      critical: certs.filter((c) => c.status === 'critical').length,
      renewal_initiated: jobs.length,
      csr_generated: jobs.filter((j) =>
        j.steps?.some(
          (s) => s.step === 'csr_generation' && s.status === 'completed',
        ),
      ).length,
      cert_issued: jobs.filter((j) =>
        j.steps?.some(
          (s) => s.step === 'cert_issuance' && s.status === 'completed',
        ),
      ).length,
      deployed: jobs.filter((j) =>
        j.steps?.some((s) => s.step === 'deployment' && s.status === 'completed'),
      ).length,
      validated: jobs.filter((j) =>
        j.steps?.some((s) => s.step === 'validation' && s.status === 'completed'),
      ).length,
      expired: certs.filter((c) => c.status === 'expired').length,
    };
  }, [allCerts, renewalJobs]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h2 className="text-3xl font-bold text-white">Certificate Lifecycle Overview</h2>
        <p className="text-gray-400 mt-1 flex flex-wrap items-center gap-3">
          <span>Mississippi ITS / MDA · Automated CSR Lifecycle Management PoC</span>
          <span className="flex items-center gap-2 text-sm text-gray-500">
            Last refreshed {now.toLocaleTimeString()}
            <HealthDot online={apiOnline} />
          </span>
        </p>
      </div>

      {/* Stat cards */}
      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-28 rounded-xl bg-gray-800 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {statCards.map((card) => {
            const Icon = card.icon;
            return (
              <Card
                key={card.label}
                className="bg-gray-800 border-gray-700 cursor-pointer hover:brightness-110 transition-all duration-150"
                role="button"
                tabIndex={0}
                onClick={() => navigateToCertificates({ statusFilter: card.statusFilter })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    navigateToCertificates({ statusFilter: card.statusFilter });
                  }
                }}
              >
                <CardContent className="p-5 select-none">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-gray-400 mb-1">{card.label}</p>
                      <p className={`text-3xl font-bold ${card.color}`}>{card.value}</p>
                    </div>
                    <div className={`p-3 rounded-xl ${card.bg}`}>
                      <Icon className={`h-6 w-6 ${card.color}`} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* AI Risk Intelligence card */}
      <Card className="bg-gray-800 border-gray-700">
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="p-3 rounded-xl bg-violet-500/10">
                <Brain className="h-6 w-6 text-violet-400" />
              </div>
              <div>
                <p className="text-xs text-gray-400">AI Risk Intelligence</p>
                {aiSummary ? (
                  <p className="text-2xl font-bold text-violet-400">{aiSummary.total_analyzed} analyzed</p>
                ) : (
                  <p className="text-sm text-gray-500 mt-0.5">Loading…</p>
                )}
              </div>
            </div>
          </div>
          {aiSummary && aiSummary.total_analyzed > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium border ${
                aiSummary.renew_immediately_count > 0
                  ? 'bg-red-500/20 text-red-400 border-red-500/30'
                  : 'bg-green-500/20 text-green-400 border-green-500/30'
              }`}>
                {aiSummary.renew_immediately_count} renew immediately
              </span>
              <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium border bg-red-500/20 text-red-400 border-red-500/30">
                {aiSummary.critical_count} critical risk
              </span>
              <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium border bg-amber-500/20 text-amber-400 border-amber-500/30">
                {aiSummary.high_risk_count} high risk
              </span>
            </div>
          )}
          {aiTopRisks.length > 0 && (
            <div className="mt-3 overflow-x-auto rounded-md border border-gray-700/80 bg-gray-900/40">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-gray-700/80">
                    <th className="py-1.5 px-2 font-medium w-[8.5rem]">Domain</th>
                    <th className="py-1.5 px-2 font-medium">AI Reason</th>
                    <th className="py-1.5 px-2 font-medium w-[4.5rem] text-right">Urgency</th>
                  </tr>
                </thead>
                <tbody>
                  {aiTopRisks.map((row) => (
                    <tr key={row.certificate_id} className="border-b border-gray-800/90 last:border-0">
                      <td className="py-1.5 px-2 text-gray-200 font-mono align-top whitespace-nowrap" title={row.domain_name}>
                        {truncateDomain(row.domain_name ?? '')}
                      </td>
                      <td className="py-1.5 px-2 text-gray-400 align-top leading-snug">
                        {row.reason || '—'}
                      </td>
                      <td className="py-1.5 px-2 align-top text-right">
                        <UrgencyScoreBadge score={Number(row.urgency_score) || 0} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className={aiTopRisks.length > 0 ? 'mt-3' : 'mt-1'}>
            {aiSummary ? (
              aiSummary.ai_provider?.includes('Bedrock') ? (
                <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30">
                  Powered by Amazon Bedrock
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-gray-500/20 text-gray-400 border border-gray-500/30">
                  Rule-based analysis
                </span>
              )
            ) : null}
          </div>
        </CardContent>
      </Card>

      {/* AI Renewal Agent card */}
      <Card className="bg-gray-800 border-gray-700">
        <CardHeader className="pb-3">
          <CardTitle className="text-white flex items-center gap-2 text-base">
            <Bot className="h-4 w-4 text-blue-400" />
            AI Renewal Agent
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading || !agentStatus ? (
            <div className="flex gap-8">
              <div className="h-6 w-32 bg-gray-700 rounded animate-pulse" />
              <div className="h-6 w-32 bg-gray-700 rounded animate-pulse" />
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-6">
              <div>
                <span className="text-gray-400 text-sm">Jobs Completed: </span>
                <span className="text-white font-bold">{agentStatus.jobs_completed}</span>
              </div>
              <div>
                <span className="text-gray-400 text-sm">Certs Processed: </span>
                <span className="text-white font-bold">{agentStatus.certs_processed}</span>
              </div>
              <div>
                <span className="text-gray-400 text-sm">Interval: </span>
                <span className="text-white font-bold">{agentStatus.interval_minutes} min</span>
              </div>
              <Button
                onClick={handleRunAgent}
                disabled={agentRunning || !isAdmin}
                title={!isAdmin ? 'Admin access required' : undefined}
                className="bg-blue-600 hover:bg-blue-700 text-white ml-auto"
                size="sm"
              >
                {agentRunning ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Running…
                  </>
                ) : (
                  <>
                    <Bot className="h-4 w-4 mr-2" />
                    Run Agent Now
                  </>
                )}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Urgent attention table */}
      <Card className="bg-gray-800 border-gray-700">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-white flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-yellow-400" />
              Certificates Requiring Attention
              {urgentCerts.length > 0 && (
                <Badge className="ml-1 bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 text-xs">
                  {urgentCerts.length}
                </Badge>
              )}
            </CardTitle>
            {pendingDeployCount > 0 && (
              <Button
                type="button"
                size="sm"
                className="bg-green-600 hover:bg-green-700 text-white shrink-0"
                onClick={() => {
                  setBulkConfirmLabelCount(pendingDeployCount);
                  setConfirmAllDialogOpen(true);
                }}
                disabled={bulkConfirming || !isAdmin}
                title={!isAdmin ? 'Admin access required' : undefined}
              >
                <CheckCircle className="h-4 w-4 mr-2" />
                Confirm All Deployments
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-10 rounded-lg bg-gray-700 animate-pulse" />
              ))}
            </div>
          ) : urgentCerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <CheckCircle className="h-10 w-10 text-green-400 mb-3" />
              <p className="text-white font-medium">All certificates are healthy</p>
              <p className="text-gray-400 text-sm mt-1">No expired, critical, or pending-deployment certificates</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-400 border-b border-gray-700">
                    <th className="text-left py-2 pr-4 font-medium">Domain</th>
                    <th className="text-left py-2 pr-4 font-medium">Agency</th>
                    <th className="text-left py-2 pr-4 font-medium">Status</th>
                    <th className="text-left py-2 pr-4 font-medium">Days Left</th>
                    <th className="text-left py-2 font-medium">Auto-Renew</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700/50">
                  {urgentCerts.map((cert) => (
                    <tr
                      key={cert.certificate_id}
                      className="hover:bg-gray-700/40 transition-all cursor-pointer hover:brightness-110 duration-150"
                      role="button"
                      tabIndex={0}
                      onClick={() => navigateToCertificates({ certId: cert.certificate_id, domainFilter: cert.domain_name })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          navigateToCertificates({ certId: cert.certificate_id, domainFilter: cert.domain_name });
                        }
                      }}
                    >
                      <td className="py-3 pr-4 text-white font-mono text-xs">{cert.domain_name}</td>
                      <td className="py-3 pr-4 text-gray-300">{cert.agency_name || '—'}</td>
                      <td className="py-3 pr-4">
                        <StatusBadge status={cert.status} />
                      </td>
                      <td className="py-3 pr-4">
                        <span className={`font-bold ${
                          cert.days_to_expiry < 0   ? 'text-red-400'    :
                          cert.days_to_expiry <= 7  ? 'text-orange-400' :
                          cert.days_to_expiry <= 15 ? 'text-yellow-400' : 'text-gray-300'
                        }`}>
                          {cert.days_to_expiry < 0
                            ? `${cert.days_to_expiry}d (expired)`
                            : `${cert.days_to_expiry}d`}
                        </span>
                      </td>
                      <td className="py-3">
                        {cert.auto_renew_enabled === 'yes'
                          ? <span className="text-emerald-400 text-xs font-medium">Enabled</span>
                          : <span className="text-gray-500 text-xs">Manual</span>
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Renewal Workflow Stages */}
      <Card className="bg-gray-800 border-gray-700">
        <CardHeader className="pb-3">
          <CardTitle className="text-white flex items-center gap-2 text-base">
            <FileText className="h-4 w-4 text-blue-400" />
            Renewal Workflow Stages
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-1 flex-wrap">
            {[
              { label: 'Active',              color: 'bg-green-500',  count: stageCount.active },
              { label: 'Expiration Detected', color: 'bg-yellow-500', count: stageCount.expiration_detected },
              { label: 'Critical',            color: 'bg-orange-500', count: stageCount.critical },
              { label: 'Renewal Initiated',   color: 'bg-blue-500',   count: stageCount.renewal_initiated },
              { label: 'CSR Generated',       color: 'bg-purple-500', count: stageCount.csr_generated },
              { label: 'Cert Issued',         color: 'bg-indigo-500', count: stageCount.cert_issued },
              { label: 'Deployed',            color: 'bg-teal-500',   count: stageCount.deployed },
              { label: 'Validated',           color: 'bg-cyan-500',   count: stageCount.validated },
              { label: 'Expired',             color: 'bg-red-500',    count: stageCount.expired },
            ].map((stage, i, arr) => (
              <div key={stage.label} className="flex items-center">
                <div className="flex flex-col items-center gap-1 px-2">
                  <div className={`w-3 h-3 rounded-full ${stage.color}`} />
                  <span className="text-xs text-gray-400 whitespace-nowrap">{stage.label}</span>
                  <span className="text-xs font-bold text-white">{stage.count}</span>
                </div>
                {i < arr.length - 1 && <div className="w-6 h-px bg-gray-600 mt-[-1.25rem]" />}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={confirmAllDialogOpen} onOpenChange={setConfirmAllDialogOpen}>
        <AlertDialogContent className="bg-gray-900 border-gray-700 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Confirm all IIS deployments?</AlertDialogTitle>
            <AlertDialogDescription className="text-gray-400">
              This simulates ITS confirming that all {bulkConfirmLabelCount} PFX bundle
              {bulkConfirmLabelCount === 1 ? ' has' : 's have'} been imported into IIS. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-gray-600 bg-gray-800 text-white hover:bg-gray-700 hover:text-white">
              Cancel
            </AlertDialogCancel>
            <Button
              type="button"
              className="bg-green-600 hover:bg-green-700 text-white"
              disabled={bulkConfirming}
              onClick={() => { void handleConfirmAllDeployments(); }}
            >
              {bulkConfirming ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <CheckCircle className="h-4 w-4 mr-2" />
              )}
              Continue
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
