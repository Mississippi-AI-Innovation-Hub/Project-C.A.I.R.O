/**
 * useSSLCertificates — local mock version
 *
 * Reads from the in-memory inventory built from
 * generated_certificates/certificate_inventory.csv.
 * No Supabase / network calls. Swap this file for the
 * real Supabase-backed version when the database is ready.
 */

import { useState } from 'react';

export interface SSLCertificate {
  id: string;
  domain: string;
  issuer: string | null;
  valid_from: string | null;
  valid_to: string | null;
  status: string | null;
  port: number | null;
  protocol: string | null;
  ip_address: string | null;
  common_name: string | null;
  subject_alt_names: string[] | null;
  days_remaining: number | null;
  last_checked: string | null;
  enabled: boolean | null;
  note: string | null;
  created_at: string;
  updated_at: string | null;
  auto_renew: boolean | null;
  service_id: string | null;
  realtime_days_remaining?: number | null;
  realtime_status?: string | null;
  tls_version?: string | null;
  issued_organization?: string | null;
  issuer_organization?: string | null;
  issuer_country?: string | null;
  issuer_organizational_unit?: string | null;
  issuer_common_name?: string | null;
  certificate_serial_number?: string | null;
  certificate_sha1_fingerprint?: string | null;
  certificate_algorithm?: string | null;
  certificate_version?: number | null;
  // Extra fields from CSV inventory
  agency_name?: string | null;
  owning_team?: string | null;
  environment?: string | null;
  certificate_type?: string | null;
  deployment_status?: string | null;
  validation_status?: string | null;
  renewal_threshold_days?: number | null;
}

export interface AddSSLCertificateData {
  domain: string;
  port?: number;
  protocol?: string;
  note?: string;
  issuer?: string;
  valid_from?: string;
  valid_to?: string;
  status?: string;
  days_remaining?: number;
  ip_address?: string;
  common_name?: string;
  subject_alt_names?: string[];
  tls_version?: string;
  issued_organization?: string;
  issuer_organization?: string;
  issuer_country?: string;
  issuer_organizational_unit?: string;
  issuer_common_name?: string;
  certificate_serial_number?: string;
  certificate_sha1_fingerprint?: string;
  certificate_algorithm?: string;
  certificate_version?: number;
}

export interface UpdateSSLCertificateData extends Partial<AddSSLCertificateData> {
  id: string;
}

// ---------------------------------------------------------------------------
// Mock data — sourced from generated_certificates/certificate_inventory.csv
// ---------------------------------------------------------------------------
const today = new Date();
const iso = (d: Date) => d.toISOString();
const daysFromNow = (n: number) => {
  const d = new Date(today);
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
};

const statusFromDays = (days: number): string => {
  if (days < 0)   return 'expired';
  if (days <= 7)  return 'critical';
  if (days <= 30) return 'warning';
  return 'valid';
};

const makeRow = (
  id: string,
  domain: string,
  issuer: string,
  certType: string,
  env: string,
  agency: string,
  team: string,
  issueOffset: number,
  daysLeft: number,
  threshold: number,
  autoRenew: boolean,
  deployment: string,
  validation: string,
  serial: string,
  fingerprint: string,
): SSLCertificate => {
  const days = daysLeft;
  return {
    id,
    domain,
    common_name: domain,
    issuer,
    issuer_organization: issuer,
    issuer_country: 'US',
    certificate_type: certType,
    environment: env,
    agency_name: agency,
    owning_team: team,
    valid_from: daysFromNow(issueOffset),
    valid_to: daysFromNow(days),
    days_remaining: days,
    realtime_days_remaining: days,
    status: statusFromDays(days),
    realtime_status: statusFromDays(days),
    renewal_threshold_days: threshold,
    auto_renew: autoRenew,
    deployment_status: deployment,
    validation_status: validation,
    certificate_serial_number: serial,
    certificate_sha1_fingerprint: fingerprint,
    certificate_algorithm: 'sha256WithRSAEncryption',
    certificate_version: 2,
    port: 443,
    protocol: 'https',
    ip_address: null,
    subject_alt_names: null,
    tls_version: 'TLS 1.2',
    enabled: true,
    note: agency,
    service_id: null,
    last_checked: iso(today),
    created_at: iso(today),
    updated_at: iso(today),
  };
};

const MOCK_CERTS: SSLCertificate[] = [
  makeRow('CERT-001','www.dev.agency01.ms.gov',          'Amazon Trust Services','internal','production','Mississippi Citizen Services',           'Identity Team', -187, 13,  45, true,  'failed',   'failed',   '3DEC35140E6D','42:4C:FE:1B'),
  makeRow('CERT-002','portal.agency02.ms.gov',           "Let's Encrypt",        'wildcard','production','Mississippi Department of Health',         'Infra Team',    -244,136,  15, false, 'deployed',  'passed',   '1E06F720F916','6C:2E:76:1E'),
  makeRow('CERT-003','portal.agency03.ms.gov',           'Entrust',              'DV',      'production','Mississippi Department of Finance',        'Engineering',   -296, 21,  45, false, 'deployed',  'pending',  '1BCA86AF0910','E1:37:2D:36'),
  makeRow('CERT-004','portal.dev.agency04.ms.gov',       "Let's Encrypt",        'internal','production','Mississippi Department of Labor',          'QA Team',       -185,155,  60, true,  'deployed',  'passed',   '4346C1212D8B','9B:6F:0E:C4'),
  makeRow('CERT-005','portal.dev.agency05.ms.gov',       'Amazon Trust Services','wildcard','dev',       'Mississippi Department of Finance',        'Engineering',    -95, -16, 45, true,  'failed',    'failed',   '3EE257431FAF','00:0F:F8:B9'),
  makeRow('CERT-006','portal.dev.agency06.ms.gov',       'Amazon Trust Services','EV',      'dev',       'Mississippi Department of Transportation', 'Platform Team',  -79,  2,  60, false, 'deployed',  'pending',  '60D84A49A2B0','0E:BE:4A:15'),
  makeRow('CERT-007','api.staging.agency07.ms.gov',      'Entrust',              'EV',      'staging',   'Mississippi Department of Finance',        'Engineering',    -43, 10,  15, false, 'pending',   'pending',  '0378EA8D48C2','25:95:88:23'),
  makeRow('CERT-008','education.agency08.ms.gov',        'DigiCert',             'wildcard','production','Mississippi Department of Education',      'DevOps',        -268, 12,  15, true,  'deployed',  'pending',  '19430A726154','D3:0F:34:71'),
  makeRow('CERT-009','health.staging.agency09.ms.gov',   'GlobalSign',           'EV',      'staging',   'Mississippi Department of Health',         'Infra Team',   -144,  9,   15, true,  'failed',    'failed',   '77C48B034566','99:5F:6D:8F'),
  makeRow('CERT-010','login.dev.agency10.ms.gov',        'DigiCert',             'internal','production','Mississippi Department of Finance',        'Engineering',  -215, -2,   15, true,  'failed',    'failed',   '7077E3D515E8','CD:52:B2:F4'),
  makeRow('CERT-011','education.dev.agency11.ms.gov',    'Entrust',              'wildcard','dev',       'Mississippi Citizen Services',             'Identity Team', -173,  5,  45, true,  'pending',   'pending',  '71EF36062A27','7F:74:70:6F'),
  makeRow('CERT-012','finance.staging.agency12.ms.gov',  'DigiCert',             'EV',      'staging',   'Mississippi Development Authority',        'WebOps',         -23, 34,  45, false, 'pending',   'pending',  '142FC07F8154','6B:A7:63:33'),
  makeRow('CERT-013','education.staging.agency13.ms.gov','Amazon Trust Services','internal','staging',   'Mississippi Department of Education',      'DevOps',         -35, -8,  45, false, 'failed',    'failed',   '2814AA24D839','3B:8F:91:DB'),
  makeRow('CERT-014','www.staging.agency14.ms.gov',      'Entrust',              'wildcard','production','Mississippi Citizen Services',             'Identity Team', -166,-20,  60, true,  'failed',    'failed',   '098353431D0F','40:F4:7A:27'),
  makeRow('CERT-015','login.dev.agency15.ms.gov',        'GlobalSign',           'wildcard','production','Mississippi Department of Labor',          'QA Team',       -197, 17,  30, true,  'failed',    'failed',   '78B110EA501D','A0:56:3E:13'),
  makeRow('CERT-016','transport.staging.agency16.ms.gov','Lets Encrypt',         'EV',      'staging',   'Mississippi Citizen Services',             'Identity Team',  -22,341,  60, true,  'deployed',  'passed',   '3A67B7923808','FA:A2:84:87'),
  makeRow('CERT-017','api.dev.agency17.ms.gov',          'DigiCert',             'OV',      'staging',   'Mississippi Department of Health',         'Infra Team',    -186,207,  60, false, 'deployed',  'passed',   '6BBA769A6087','F4:B4:B9:DE'),
  makeRow('CERT-018','citizen.agency18.ms.gov',          'DigiCert',             'wildcard','production','Mississippi Citizen Services',             'Identity Team',  -35,140,  45, false, 'deployed',  'passed',   '4A370A233F38','DF:A1:3F:74'),
  makeRow('CERT-019','citizen.dev.agency19.ms.gov',      'GlobalSign',           'EV',      'staging',   'Mississippi Department of Education',      'DevOps',         -75,  8,  45, true,  'deployed',  'pending',  '656F69C36F52','70:BF:FF:8A'),
  makeRow('CERT-020','education.staging.agency20.ms.gov','GlobalSign',           'DV',      'staging',   'Mississippi Department of Finance',        'Engineering',    -10, 10,  15, false, 'pending',   'pending',  '58C1A6B5D645','02:52:E0:C9'),
];

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------
export const useSSLCertificates = () => {
  const [sslCertificates, setSslCertificates] = useState<SSLCertificate[]>(MOCK_CERTS);
  const loading = false;

  const refreshData = () => {
    // No-op in mock mode — data is static
  };

  const addSSLCertificate = async (data: AddSSLCertificateData): Promise<SSLCertificate> => {
    const newCert: SSLCertificate = {
      id: `CERT-${String(sslCertificates.length + 1).padStart(3, '0')}`,
      domain: data.domain,
      common_name: data.common_name ?? data.domain,
      issuer: data.issuer ?? null,
      valid_from: data.valid_from ?? null,
      valid_to: data.valid_to ?? null,
      status: data.status ?? 'valid',
      realtime_status: data.status ?? 'valid',
      days_remaining: data.days_remaining ?? null,
      realtime_days_remaining: data.days_remaining ?? null,
      port: data.port ?? 443,
      protocol: data.protocol ?? 'https',
      ip_address: data.ip_address ?? null,
      subject_alt_names: data.subject_alt_names ?? null,
      tls_version: data.tls_version ?? null,
      issued_organization: data.issued_organization ?? null,
      issuer_organization: data.issuer_organization ?? null,
      issuer_country: data.issuer_country ?? null,
      issuer_organizational_unit: data.issuer_organizational_unit ?? null,
      issuer_common_name: data.issuer_common_name ?? null,
      certificate_serial_number: data.certificate_serial_number ?? null,
      certificate_sha1_fingerprint: data.certificate_sha1_fingerprint ?? null,
      certificate_algorithm: data.certificate_algorithm ?? null,
      certificate_version: data.certificate_version ?? null,
      enabled: true,
      auto_renew: false,
      note: data.note ?? null,
      service_id: null,
      last_checked: iso(today),
      created_at: iso(today),
      updated_at: iso(today),
    };
    setSslCertificates(prev => [...prev, newCert]);
    return newCert;
  };

  const updateSSLCertificate = async (data: UpdateSSLCertificateData): Promise<SSLCertificate> => {
    let updated: SSLCertificate | undefined;
    setSslCertificates(prev =>
      prev.map(cert => {
        if (cert.id !== data.id) return cert;
        updated = { ...cert, ...data, updated_at: iso(today) };
        return updated;
      })
    );
    if (!updated) throw new Error(`Certificate ${data.id} not found`);
    return updated;
  };

  const updateSSLCertificateFromPythonAPI = async (
    certificateId: string,
    apiResponse: Record<string, unknown>
  ): Promise<SSLCertificate> => {
    return updateSSLCertificate({
      id: certificateId,
      issuer: (apiResponse.issuer_cn ?? apiResponse.issuer_o) as string,
      valid_from: apiResponse.valid_from as string,
      valid_to: apiResponse.valid_till as string,
      status: apiResponse.cert_valid ? 'valid' : 'invalid',
      days_remaining: (apiResponse.valid_days_to_expire ?? apiResponse.days_left) as number,
      ip_address: (apiResponse.resolved_ip ?? apiResponse.host) as string,
      common_name: apiResponse.issued_to as string,
    });
  };

  const deleteSSLCertificate = async (certificateId: string): Promise<void> => {
    setSslCertificates(prev => prev.filter(c => c.id !== certificateId));
  };

  return {
    sslCertificates,
    loading,
    refreshData,
    addSSLCertificate,
    updateSSLCertificate,
    updateSSLCertificateFromPythonAPI,
    deleteSSLCertificate,
  };
};
