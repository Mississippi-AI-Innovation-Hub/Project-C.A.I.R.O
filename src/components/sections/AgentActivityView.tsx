import { useCallback, useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { formatDistanceToNow } from 'date-fns';
import { Activity, Loader2, Bot, FileCode, X, ShieldCheck, AlertTriangle, CheckCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/utils/api';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';

// ── Types ────────────────────────────────────────────────────────────────────

interface PipelineStep {
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
  triggered_by: string;
  triggered_at: string;
  completed_at: string;
  trigger_reason: string;
  csr_path: string;
  key_path: string;
  pfx_path?: string | null;
  steps: PipelineStep[];
  overall_status: string;
}

interface IssuedCert {
  domain: string;
  cert_path: string;
  pfx_path: string | null;
  pfx_exists: boolean;
  serial_number: string;
  valid_from: string;
  valid_until: string;
  issued_by: string;
  file_size_kb: number;
}

interface CaInfo {
  ca_name?: string;
  ca_cert_path?: string;
  ca_cert_exists: boolean;
  issued_certs_count?: number;
  valid_until?: string;
  serial_number?: string;
  subject?: string;
  note?: string;
}

interface VerifyState {
  loading?: boolean;
  ok?: boolean;
  text?: string;
}

interface AgentFailure {
  failure_id: string;
  certificate_id: string;
  domain_name: string;
  agency_name: string;
  failed_step: string;
  error: string;
  occurred_at: string;
  status: 'open' | 'resolved';
  resolved_at?: string;
  job_id: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const STEP_ORDER = [
  'detect',
  'csr_generation',
  'ca_submission',
  'cert_issuance',
  'deployment',
  'validation',
];

const STEP_LABELS: Record<string, string> = {
  detect:         'Expiry Detected',
  csr_generation: 'CSR Generated (IIS)',
  ca_submission:  'Submitted to Entrust CA',
  cert_issuance:  'Certificate Issued (.CER received)',
  deployment:     'PFX Bundle Created',
  validation:     'Awaiting IIS Import',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

const fmtTime = (iso?: string) => {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch { return iso; }
};

const fmtDateTime = (iso?: string) => {
  if (!iso) return '';
  try { return new Date(iso).toLocaleString(); }
  catch { return iso; }
};

const fmtDate = (iso?: string) => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString(); }
  catch { return iso; }
};

const truncSerial = (s?: string, n = 16) => {
  if (!s) return '—';
  return s.length > n ? s.slice(0, n) + '…' : s;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type SimulatePhase = 'renew' | 'csr_fail' | 'sns' | 'posting';

const getPfxPath = (job: RenewalJob) => {
  const anyJob = job as RenewalJob & Record<string, unknown>;
  const pfx = (anyJob.pfx_path ?? anyJob.pfx_bundle_path ?? anyJob.pfx_bundle ?? anyJob.pfx) as unknown;
  if (typeof pfx === 'string' && pfx.trim()) return pfx.trim();
  return null;
};

const copyToClipboard = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  } catch {
    toast.error('Could not copy to clipboard');
  }
};

// ── Sub-components ───────────────────────────────────────────────────────────

const TriggerBadge = ({ reason }: { reason: string }) => {
  if (reason === 'expired')
    return <Badge className="bg-red-600 text-white text-xs px-2 py-0.5">expired</Badge>;
  if (reason === 'critical')
    return <Badge className="bg-orange-500 text-white text-xs px-2 py-0.5">critical</Badge>;
  if (reason === 'expiring_soon')
    return <Badge className="bg-yellow-600 text-white text-xs px-2 py-0.5">expiring soon</Badge>;
  return <Badge variant="secondary" className="text-xs">{reason}</Badge>;
};

const StepBar = ({ steps }: { steps: PipelineStep[] }) => {
  const stepMap = Object.fromEntries(steps.map(s => [s.step, s]));

  return (
    <div className="flex items-start gap-0 mt-3 overflow-x-auto pb-1">
      {STEP_ORDER.map((key, i) => {
        const s = stepMap[key];
        const done   = s?.status === 'completed';
        const failed = s?.status === 'failed';

        return (
          <div key={key} className="flex items-center gap-0 flex-shrink-0">
            {/* step circle + label */}
            <div className="flex flex-col items-center w-16">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 ${
                done
                  ? 'bg-green-600 border-green-500 text-white'
                  : failed
                  ? 'bg-red-600 border-red-500 text-white'
                  : 'bg-gray-700 border-gray-600 text-gray-400'
              }`}>
                {done ? '✓' : failed ? '✗' : i + 1}
              </div>
              <span className="text-gray-400 text-[10px] mt-1 text-center leading-tight px-0.5">
                {STEP_LABELS[key]}
              </span>
              {done && s?.completed_at && (
                <span className="text-gray-600 text-[9px] text-center mt-0.5">
                  {fmtTime(s.completed_at)}
                </span>
              )}
            </div>

            {/* connector line between circles */}
            {i < STEP_ORDER.length - 1 && (
              <div className={`h-0.5 w-4 mb-5 flex-shrink-0 ${done ? 'bg-green-600' : 'bg-gray-600'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
};

// ── CSR Detail Modal ─────────────────────────────────────────────────────────

const CsrModal = ({ job, onClose }: { job: RenewalJob; onClose: () => void }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
    <div className="bg-gray-800 border border-gray-700 rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto">

      {/* Modal header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700 sticky top-0 bg-gray-800 z-10">
        <h3 className="text-white font-semibold text-sm flex items-center gap-2">
          <FileCode className="h-4 w-4 text-blue-400" />
          CSR Details — {job.domain_name}
        </h3>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white transition-colors"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="p-5 space-y-5">
        {/* Key fields grid */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          {([
            ['Certificate ID', job.certificate_id],
            ['Domain',         job.domain_name],
            ['Agency',         job.agency_name],
            ['Triggered By',   job.triggered_by],
            ['Trigger Reason', job.trigger_reason],
            ['Generated At',   fmtDateTime(job.triggered_at)],
            ['Completed At',   fmtDateTime(job.completed_at)],
            ['Overall Status', job.overall_status],
          ] as [string, string][]).map(([label, value]) => (
            <div key={label}>
              <p className="text-gray-400 text-xs mb-0.5">{label}</p>
              <p className="text-white font-mono text-xs break-all">{value}</p>
            </div>
          ))}
        </div>

        {/* CSR path */}
        <div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-gray-400 text-xs mb-1">CSR Path</p>
            {!!job.csr_path && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-3 text-xs text-blue-400 hover:bg-blue-600/20"
                onClick={() => void copyToClipboard(job.csr_path)}
              >
                Download CSR
              </Button>
            )}
          </div>
          <p className="text-green-400 font-mono text-xs break-all bg-gray-900 px-3 py-2 rounded border border-gray-700">
            {job.csr_path}
          </p>
        </div>

        {/* Key path */}
        <div>
          <p className="text-gray-400 text-xs mb-1">Key Path</p>
          <p className="text-yellow-400 font-mono text-xs break-all bg-gray-900 px-3 py-2 rounded border border-gray-700">
            {job.key_path}
          </p>
        </div>

        {/* PFX bundle path */}
        {getPfxPath(job) && (
          <div>
            <p className="text-gray-400 text-xs mb-1">PFX Bundle</p>
            <p className="text-emerald-300 font-mono text-xs break-all bg-gray-900 px-3 py-2 rounded border border-gray-700">
              {getPfxPath(job)}
            </p>
          </div>
        )}

        {/* IIS note */}
        <div className="p-3 bg-indigo-900/20 border border-indigo-700/40 rounded text-indigo-200 text-xs leading-relaxed whitespace-pre-line">
          Import PFX on MDAWEB19, bind to website, then update FortiManager
        </div>

        {/* Pipeline steps */}
        <div>
          <p className="text-gray-300 text-xs font-medium mb-2">Pipeline Steps</p>
          <div className="space-y-1">
            {job.steps.map((step, i) => (
              <div
                key={i}
                className="flex items-center gap-3 text-xs px-3 py-2 bg-gray-700/40 rounded"
              >
                <span className={`font-mono w-28 shrink-0 ${
                  step.status === 'completed' ? 'text-green-400'
                  : step.status === 'failed'  ? 'text-red-400'
                  : 'text-gray-400'
                }`}>
                  {STEP_LABELS[step.step] ?? step.step}
                </span>
                <Badge className={`text-[10px] border ${
                  step.status === 'completed'
                    ? 'bg-green-600/20 text-green-400 border-green-500/30'
                    : step.status === 'failed'
                    ? 'bg-red-600/20 text-red-400 border-red-500/30'
                    : 'bg-gray-600/20 text-gray-400 border-gray-600/30'
                }`}>
                  {step.status}
                </Badge>
                {step.completed_at && (
                  <span className="text-gray-500 ml-auto">{fmtDateTime(step.completed_at)}</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Footer note */}
        <div className="p-3 bg-blue-900/20 border border-blue-700/40 rounded text-blue-300 text-xs leading-relaxed">
          This CSR was generated automatically by the renewal agent when the certificate monitor detected
          an expired or critical certificate.
        </div>
      </div>
    </div>
  </div>
);

// ── Main component ───────────────────────────────────────────────────────────

export const AgentActivityView = () => {
  const { isAdmin } = useAuth();
  const [jobs, setJobs]                   = useState<RenewalJob[]>([]);
  const [loading, setLoading]             = useState(true);
  const [modalJob, setModalJob]           = useState<RenewalJob | null>(null);
  const [loadingCsrId, setLoadingCsrId]   = useState<string | null>(null);
  const [issued, setIssued]               = useState<IssuedCert[]>([]);
  const [caInfo, setCaInfo]               = useState<CaInfo | null>(null);
  const [verify, setVerify]               = useState<Record<string, VerifyState>>({});
  const [failures, setFailures]           = useState<AgentFailure[]>([]);
  const [simulateConfirmOpen, setSimulateConfirmOpen] = useState(false);
  const [simulateDemo, setSimulateDemo] = useState<null | { domain: string; phase: SimulatePhase }>(null);
  const [retryingCertId, setRetryingCertId] = useState<string | null>(null);
  const [jobsLastFetchedAt, setJobsLastFetchedAt] = useState<Date | null>(null);
  const [flashingJobIds, setFlashingJobIds] = useState<Set<string>>(() => new Set());
  const [, setLiveTick] = useState(0);
  const simulateAbortRef = useRef(false);
  const knownJobIdsRef = useRef<Set<string> | null>(null);

  const onJobsFetched = useCallback((data: RenewalJob[] | null) => {
    if (!Array.isArray(data)) return;
    const sorted = [...data].sort(
      (a, b) => new Date(b.triggered_at).getTime() - new Date(a.triggered_at).getTime(),
    );
    const ids = sorted.map((j) => j.job_id);

    setJobs(sorted);
    setJobsLastFetchedAt(new Date());

    if (knownJobIdsRef.current === null) {
      knownJobIdsRef.current = new Set(ids);
      return;
    }

    const prev = knownJobIdsRef.current;
    const newlyAdded = ids.filter((id) => !prev.has(id));
    knownJobIdsRef.current = new Set(ids);

    if (newlyAdded.length === 0) return;

    setFlashingJobIds((s) => {
      const next = new Set(s);
      newlyAdded.forEach((id) => next.add(id));
      return next;
    });
    window.setTimeout(() => {
      setFlashingJobIds((s) => {
        const next = new Set(s);
        newlyAdded.forEach((id) => next.delete(id));
        return next;
      });
    }, 1600);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setLiveTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    api.get('/renew/jobs').then((data: RenewalJob[] | null) => {
      if (data) onJobsFetched(data);
      setLoading(false);
    });

    api.get('/ca/issued').then((data: IssuedCert[] | null) => {
      if (Array.isArray(data)) setIssued(data);
    });

    api.get('/ca/info').then((data: CaInfo | null) => {
      if (data) setCaInfo(data);
    });

    api.get('/agent/failures').then((data: AgentFailure[] | null) => {
      if (Array.isArray(data)) setFailures(data);
    });
  }, [onJobsFetched]);

  useEffect(() => {
    const poll = window.setInterval(() => {
      api.get('/renew/jobs').then((data: RenewalJob[] | null) => {
        if (data) onJobsFetched(data);
      });
    }, 10_000);
    return () => clearInterval(poll);
  }, [onJobsFetched]);

  useEffect(() => {
    simulateAbortRef.current = false;
    return () => {
      simulateAbortRef.current = true;
    };
  }, []);

  const handleViewCsr = async (job: RenewalJob) => {
    setLoadingCsrId(job.certificate_id);
    const fresh: RenewalJob | null = await api.get(`/csr/${job.certificate_id}`);
    setLoadingCsrId(null);
    setModalJob(fresh ?? job);
  };

  const runSimulateFailureSequence = useCallback(async () => {
    const domain = jobs[0]?.domain_name ?? 'certificate';
    try {
      await Notification.requestPermission();
    } catch {
      /* ignore */
    }

    setSimulateDemo({ domain, phase: 'renew' });
    await sleep(800);
    if (simulateAbortRef.current) return;
    setSimulateDemo({ domain, phase: 'csr_fail' });
    await sleep(600);
    if (simulateAbortRef.current) return;
    setSimulateDemo({ domain, phase: 'sns' });
    await sleep(400);
    if (simulateAbortRef.current) return;
    setSimulateDemo({ domain, phase: 'posting' });

    try {
      const result = await api.post('/simulate-failure', {});
      if (simulateAbortRef.current) return;
      if (result?.status === 'failure_injected' && result.failure) {
        const d = result.failure.domain_name as string;
        toast.error(
          `Failure alert sent to ITS — automation paused\nfor ${d}`,
          { className: '!bg-red-950 !text-red-50 !border !border-red-600 whitespace-pre-line' },
        );
        const data = await api.get('/agent/failures');
        if (Array.isArray(data)) setFailures(data);
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          try {
            new Notification('AGENT FAILURE', {
              body: `Renewal failed for ${d} — ITS notified`,
            });
          } catch {
            /* ignore */
          }
        }
      } else {
        toast.error(result?.error ?? 'Could not simulate failure', {
          className: '!bg-red-950 !text-red-50 !border !border-red-600',
        });
      }
    } catch {
      if (!simulateAbortRef.current) {
        toast.error('Simulate failure request failed', {
          className: '!bg-red-950 !text-red-50 !border !border-red-600',
        });
      }
    } finally {
      if (!simulateAbortRef.current) setSimulateDemo(null);
    }
  }, [jobs]);

  const handleRetryCsr = async (failure: AgentFailure) => {
    if (!isAdmin) return;
    setRetryingCertId(failure.certificate_id);
    try {
      await api.postExpectOk('/csr/generate', { certificate_id: failure.certificate_id });
      setFailures((prev) => prev.filter((f) => f.failure_id !== failure.failure_id));
      toast.success(
        'Renewal retried successfully — cert moved to\nPending Deployment',
        { className: '!bg-emerald-950 !text-emerald-50 !border !border-emerald-600 whitespace-pre-line' },
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Retry failed';
      toast.error(msg, {
        className: '!bg-red-950 !text-red-50 !border !border-red-600',
      });
    } finally {
      setRetryingCertId(null);
    }
  };

  const handleVerify = async (domain: string) => {
    setVerify((prev) => ({ ...prev, [domain]: { loading: true } }));
    try {
      const res = await api.post('/ssl/check', { hostname: domain, port: 443 });
      if (res && res.status === 'success') {
        const days = res.days_left ?? res.days_remaining ?? 0;
        setVerify((prev) => ({
          ...prev,
          [domain]: { ok: true, text: `Live SSL: ${days} days` },
        }));
      } else {
        setVerify((prev) => ({
          ...prev,
          [domain]: { ok: false, text: 'Not publicly reachable (sandbox)' },
        }));
      }
    } catch {
      setVerify((prev) => ({
        ...prev,
        [domain]: { ok: false, text: 'Not publicly reachable (sandbox)' },
      }));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
        <span className="text-white ml-3">Loading agent activity…</span>
      </div>
    );
  }

  return (
    <div className="space-y-8 p-2 md:p-4 lg:p-6 max-w-full overflow-hidden">

      {/* ── Live Activity ticker ── */}
      <div
        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-900/40 bg-gray-900/70 px-4 py-2.5"
        aria-live="polite"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-40" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
          </span>
          <Activity className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden />
          <span className="text-xs font-semibold uppercase tracking-wide text-emerald-400/95 whitespace-nowrap">
            Live Activity
          </span>
          <span className="text-[11px] text-gray-500 hidden sm:inline">
            GET /api/renew/jobs every 10s
          </span>
        </div>
        <p className="text-[11px] text-gray-400 tabular-nums shrink-0">
          Last updated
          {jobsLastFetchedAt ? (
            <>
              {' '}
              <span className="text-gray-300">{jobsLastFetchedAt.toLocaleTimeString()}</span>
              <span className="text-gray-500">
                {' '}
                ({formatDistanceToNow(jobsLastFetchedAt, { addSuffix: true })})
              </span>
            </>
          ) : (
            <span className="text-gray-600"> —</span>
          )}
        </p>
      </div>

      {/* ── Page header ── */}
      <div>
        <h2 className="text-2xl lg:text-3xl font-bold text-white flex items-center gap-3">
          <Bot className="h-7 w-7 text-blue-400" />
          Agent Activity
        </h2>
        <p className="text-gray-400 text-sm mt-1">
          Real-time pipeline — CSR generation, CA submission, deployment, and validation.
        </p>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          Section 1 — Renewal Jobs
         ══════════════════════════════════════════════════════════════════════ */}
      <section>
        <div className="flex items-center gap-3 mb-4">
          <h3 className="text-lg font-semibold text-white">Renewal Jobs</h3>
          <span className="text-sm text-gray-400">
            {jobs.length} job{jobs.length !== 1 ? 's' : ''} completed automatically by the agent
          </span>
        </div>

        {jobs.length === 0 ? (
          <div className="text-gray-400 text-sm py-10 text-center border border-dashed border-gray-700 rounded-lg">
            No renewal jobs yet — the agent runs automatically when expired or critical certificates are detected.
          </div>
        ) : (
          <div className="grid gap-4">
            {jobs.map(job => (
              <Card
                key={job.job_id}
                className={cn(
                  'bg-gray-800 border-gray-700',
                  flashingJobIds.has(job.job_id) && 'animate-job-new-flash',
                )}
              >
                <CardHeader className="pb-1 pt-4 px-5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-white font-semibold font-mono text-sm">{job.domain_name}</p>
                      <p className="text-gray-400 text-xs mt-0.5">
                        {job.agency_name}
                        <span className="text-gray-600 mx-1.5">·</span>
                        triggered by{' '}
                        <span className="text-blue-400">{job.triggered_by}</span>
                        <span className="text-gray-600 mx-1.5">·</span>
                        {fmtDateTime(job.triggered_at)}
                      </p>
                    </div>
                    <TriggerBadge reason={job.trigger_reason} />
                  </div>
                </CardHeader>

                <CardContent className="px-5 pb-4 pt-0">
                  <StepBar steps={job.steps} />

                  <div className="mt-3 pt-3 border-t border-gray-700/50 space-y-1">
                    <p className="font-mono text-[11px] text-gray-500">
                      CSR: <span className="text-green-400">{job.csr_path}</span>
                    </p>
                    {getPfxPath(job) && (
                      <p className="font-mono text-[11px] text-gray-500">
                        PFX: <span className="text-emerald-300">{getPfxPath(job)}</span>
                      </p>
                    )}
                    <p className="text-gray-600 text-[11px]">
                      Job ID: {job.job_id}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          Section 2 — CSR Files table
         ══════════════════════════════════════════════════════════════════════ */}
      <section>
        <h3 className="text-lg font-semibold text-white mb-4">CSR Files</h3>

        {jobs.length === 0 ? (
          <p className="text-gray-400 text-sm">No CSR files generated yet.</p>
        ) : (
          <Card className="bg-gray-800 border-gray-700">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-700 text-gray-400 text-xs">
                      <th className="text-left py-3 px-4 font-medium">Cert ID</th>
                      <th className="text-left py-3 px-4 font-medium">Domain</th>
                      <th className="text-left py-3 px-4 font-medium">Trigger</th>
                      <th className="text-left py-3 px-4 font-medium">CSR File</th>
                      <th className="text-left py-3 px-4 font-medium">Generated At</th>
                      <th className="text-left py-3 px-4 font-medium">Steps</th>
                      <th className="py-3 px-4" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700/40">
                    {jobs.map(job => (
                      <tr key={job.certificate_id} className="hover:bg-gray-700/30 transition-colors">
                        <td className="py-3 px-4 font-mono text-xs text-blue-300 whitespace-nowrap">
                          {job.certificate_id}
                        </td>
                        <td className="py-3 px-4 font-mono text-xs text-white">
                          {job.domain_name}
                        </td>
                        <td className="py-3 px-4">
                          <TriggerBadge reason={job.trigger_reason} />
                        </td>
                        <td
                          className="py-3 px-4 font-mono text-xs text-green-400 max-w-[200px] truncate"
                          title={job.csr_path}
                        >
                          <div className="truncate">
                            {job.csr_path.split(/[/\\]/).pop()}
                          </div>
                          {getPfxPath(job) && (
                            <div
                              className="truncate text-[10px] text-emerald-300/90 mt-0.5"
                              title={getPfxPath(job) ?? undefined}
                            >
                              PFX Bundle: {String(getPfxPath(job)).split(/[/\\]/).pop()}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 text-gray-400 text-xs whitespace-nowrap">
                          {fmtDateTime(job.triggered_at)}
                        </td>
                        <td className="py-3 px-4">
                          <span className="text-gray-300 text-xs">
                            {job.steps.filter(s => s.status === 'completed').length}
                            <span className="text-gray-600">/{job.steps.length}</span>
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-3 text-xs text-blue-400 hover:bg-blue-600/20"
                              onClick={() => void copyToClipboard(job.csr_path)}
                              title="Copies CSR path to clipboard"
                            >
                              Download CSR
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-3 text-xs text-blue-400 hover:bg-blue-600/20"
                              disabled={loadingCsrId === job.certificate_id}
                              onClick={() => handleViewCsr(job)}
                            >
                              {loadingCsrId === job.certificate_id
                                ? <Loader2 className="h-3 w-3 animate-spin" />
                                : 'View CSR'}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          Section 3 — Issued Certificates (Mississippi ITS Root CA)
         ══════════════════════════════════════════════════════════════════════ */}
      <section>
        <div className="flex items-center gap-3 mb-4">
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-emerald-400" />
            Issued Certificates
          </h3>
          <span className="text-sm text-gray-400">
            Mississippi ITS Root CA has issued{' '}
            <span className="text-emerald-400 font-semibold">{issued.length}</span>{' '}
            certificate{issued.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* CA info card */}
        <Card className="bg-gray-800 border-gray-700 mb-4">
          <CardContent className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-1">
                <p className="text-gray-400 text-xs">CA Name</p>
                <p className="text-white font-semibold text-sm">
                  {caInfo?.ca_name ?? 'Mississippi ITS Root Certificate Authority'}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-gray-400 text-xs">Valid Until</p>
                <p className="text-white font-mono text-xs">
                  {fmtDate(caInfo?.valid_until)}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-gray-400 text-xs">Status</p>
                {caInfo?.ca_cert_exists ? (
                  <Badge className="bg-green-600/20 text-green-400 border border-green-500/30 text-xs">
                    Active
                  </Badge>
                ) : (
                  <Badge className="bg-gray-600/20 text-gray-400 border border-gray-500/30 text-xs">
                    Not initialized
                  </Badge>
                )}
              </div>
            </div>
            <p className="mt-4 text-xs text-blue-300 bg-blue-900/20 border border-blue-700/40 rounded px-3 py-2 leading-relaxed">
              Acts as Entrust CA stand-in for PoC. Import CA certificate into Windows Trusted Root CAs to validate all issued certificates.
            </p>
          </CardContent>
        </Card>

        {/* Issued certs table */}
        {issued.length === 0 ? (
          <p className="text-gray-400 text-sm py-6 text-center border border-dashed border-gray-700 rounded-lg">
            No issued certificates yet — they will appear here once the agent completes a renewal job.
          </p>
        ) : (
          <Card className="bg-gray-800 border-gray-700">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-700 text-gray-400 text-xs">
                      <th className="text-left py-3 px-4 font-medium">Domain</th>
                      <th className="text-left py-3 px-4 font-medium">Serial Number</th>
                      <th className="text-left py-3 px-4 font-medium">Valid From</th>
                      <th className="text-left py-3 px-4 font-medium">Valid Until</th>
                      <th className="text-left py-3 px-4 font-medium">PFX Ready</th>
                      <th className="text-left py-3 px-4 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700/40">
                    {issued.map((cert) => {
                      const v = verify[cert.domain];
                      return (
                        <tr key={cert.domain} className="hover:bg-gray-700/30 transition-colors">
                          <td className="py-3 px-4 font-mono text-xs text-white">
                            {cert.domain}
                          </td>
                          <td
                            className="py-3 px-4 font-mono text-[11px] text-gray-300"
                            title={cert.serial_number}
                          >
                            {truncSerial(cert.serial_number)}
                          </td>
                          <td className="py-3 px-4 text-gray-300 text-xs whitespace-nowrap">
                            {fmtDate(cert.valid_from)}
                          </td>
                          <td className="py-3 px-4 text-gray-300 text-xs whitespace-nowrap">
                            {fmtDate(cert.valid_until)}
                          </td>
                          <td className="py-3 px-4">
                            {cert.pfx_exists ? (
                              <Badge className="bg-green-600/20 text-green-400 border border-green-500/30 text-xs">
                                Yes
                              </Badge>
                            ) : (
                              <Badge className="bg-gray-600/20 text-gray-400 border border-gray-500/30 text-xs">
                                No
                              </Badge>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-3 text-xs text-blue-400 hover:bg-blue-600/20"
                                disabled={v?.loading}
                                onClick={() => handleVerify(cert.domain)}
                              >
                                {v?.loading
                                  ? <Loader2 className="h-3 w-3 animate-spin" />
                                  : 'Verify'}
                              </Button>
                              {v?.text && (
                                <span className={`text-xs ${v.ok ? 'text-green-400' : 'text-gray-400'}`}>
                                  {v.text}
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          Section 4 — Exception Handling & Failure Alerts
         ══════════════════════════════════════════════════════════════════════ */}
      <section className="relative">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-400" />
              Exception Handling
            </h3>
            <span className="text-sm text-gray-400">
              {failures.filter(f => f.status === 'open').length} open
              {' · '}
              {failures.filter(f => f.status === 'resolved').length} resolved
            </span>
          </div>
          <Button
            size="sm"
            className="bg-red-700 hover:bg-red-600 text-white"
            disabled={simulateDemo !== null || jobs.length === 0 || !isAdmin}
            title={!isAdmin ? 'Admin access required' : undefined}
            onClick={() => setSimulateConfirmOpen(true)}
          >
            {simulateDemo
              ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              : <AlertTriangle className="h-4 w-4 mr-2" />}
            Simulate Failure
          </Button>
        </div>

        <div className="relative min-h-[140px] rounded-lg">
          {failures.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 border border-dashed border-gray-700 rounded-lg">
              <CheckCircle className="h-8 w-8 text-green-400 mb-2" />
              <p className="text-gray-400 text-sm">No pipeline failures detected</p>
              <p className="text-gray-600 text-xs mt-1">
                Click "Simulate Failure" to inject a demo failure and trigger an SNS alert
              </p>
            </div>
          ) : (
            <Card className="bg-gray-800 border-gray-700">
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-700 text-gray-400 text-xs">
                        <th className="text-left py-3 px-4 font-medium">Domain</th>
                        <th className="text-left py-3 px-4 font-medium">Failed Step</th>
                        <th className="text-left py-3 px-4 font-medium">Error</th>
                        <th className="text-left py-3 px-4 font-medium">Occurred</th>
                        <th className="text-left py-3 px-4 font-medium">Status</th>
                        <th className="text-left py-3 px-4 font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-700/40">
                      {failures.map(f => (
                        <tr key={f.failure_id} className={`hover:bg-gray-700/30 transition-colors ${f.status === 'resolved' ? 'opacity-50' : ''}`}>
                          <td className="py-3 px-4 font-mono text-xs text-white">
                            {f.domain_name}
                            <p className="text-gray-500 text-[10px] mt-0.5">{f.agency_name}</p>
                          </td>
                          <td className="py-3 px-4">
                            <Badge className="bg-red-600/20 text-red-400 border border-red-500/30 text-xs">
                              {f.failed_step}
                            </Badge>
                          </td>
                          <td className="py-3 px-4 text-gray-300 text-xs max-w-[200px] truncate" title={f.error}>
                            {f.error}
                          </td>
                          <td className="py-3 px-4 text-gray-400 text-xs whitespace-nowrap">
                            {fmtDateTime(f.occurred_at)}
                          </td>
                          <td className="py-3 px-4">
                            {f.status === 'open' ? (
                              <Badge className="bg-red-600/20 text-red-400 border border-red-500/30 text-xs">Open</Badge>
                            ) : (
                              <Badge className="bg-green-600/20 text-green-400 border border-green-500/30 text-xs">Resolved</Badge>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            {f.status === 'open' && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-3 text-xs text-green-400 hover:bg-green-600/20"
                                disabled={retryingCertId === f.certificate_id || !isAdmin}
                                title={!isAdmin ? 'Admin access required' : undefined}
                                onClick={() => handleRetryCsr(f)}
                              >
                                {retryingCertId === f.certificate_id
                                  ? <Loader2 className="h-3 w-3 animate-spin" />
                                  : 'Retry'}
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {simulateDemo && (
            <div
              className="absolute inset-0 z-20 flex items-center justify-center rounded-lg bg-gray-950/88 backdrop-blur-sm border border-red-900/40"
              aria-live="polite"
            >
              <div className="flex flex-col items-center text-center px-6 max-w-lg">
                <Loader2 className="h-9 w-9 animate-spin text-red-400 mb-4 shrink-0" />
                <p className="text-white text-sm leading-relaxed">
                  {simulateDemo.phase === 'renew' && (
                    <>Agent attempting renewal for {simulateDemo.domain}...</>
                  )}
                  {simulateDemo.phase === 'csr_fail' && (
                    <>⚠ Failure detected at CSR generation step...</>
                  )}
                  {(simulateDemo.phase === 'sns' || simulateDemo.phase === 'posting') && (
                    <>Sending AGENT FAILURE alert via AWS SNS...</>
                  )}
                </p>
              </div>
            </div>
          )}
        </div>

        <AlertDialog open={simulateConfirmOpen} onOpenChange={setSimulateConfirmOpen}>
          <AlertDialogContent className="bg-gray-900 border-gray-700 text-white sm:max-w-md">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-white">Simulate pipeline failure?</AlertDialogTitle>
              <AlertDialogDescription className="text-gray-400">
                This injects a demo failure, sends an SNS alert, and shows the failure in the table for judges.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="border-gray-600 bg-gray-800 text-white hover:bg-gray-700 hover:text-white">
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                className="bg-red-700 text-white hover:bg-red-600 focus:ring-red-600"
                onClick={() => {
                  setSimulateConfirmOpen(false);
                  void runSimulateFailureSequence();
                }}
              >
                Confirm
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </section>

      {/* CSR detail modal */}
      {modalJob && <CsrModal job={modalJob} onClose={() => setModalJob(null)} />}
    </div>
  );
};
