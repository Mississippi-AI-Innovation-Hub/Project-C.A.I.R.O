/**
 * Utility functions for SSL certificate date validation and conversion.
 */

/**
 * Validates and converts Python API date format to ISO string for database storage.
 * Python API format: "2025-09-04 12:50:00 UTC"
 */
export function validateAndConvertSSLDate(pythonApiDate: string): string | null {
  if (!pythonApiDate) {
    return null;
  }

  try {
    const isoFormat = pythonApiDate.replace(' UTC', 'Z').replace(' ', 'T');
    const dateObj = new Date(isoFormat);

    if (isNaN(dateObj.getTime())) {
      console.error('Invalid date format from Python API:', pythonApiDate);
      return null;
    }

    return dateObj.toISOString();
  } catch (error) {
    console.error('Error converting Python API date:', pythonApiDate, error);
    return null;
  }
}

/**
 * Formats a date and time for display in the UI in English.
 */
export function formatSSLDateForDisplay(dateString: string | null): string {
  if (!dateString) {
    return 'N/A';
  }

  try {
    const date = new Date(dateString);

    return `${date.toLocaleString('en-US', {
      timeZone: 'UTC',
      year: 'numeric',
      month: 'long',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })} UTC`;
  } catch (error) {
    console.error('Error formatting date for display:', dateString, error);
    return dateString;
  }
}

/**
 * Formats a date and time for display in the UI.
 */
export function formatSSLDateTimeForDisplay(dateString: string | null): string {
  if (!dateString) {
    return 'N/A';
  }

  try {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short'
    });
  } catch (error) {
    console.error('Error formatting date and time for display:', dateString, error);
    return dateString;
  }
}

/**
 * Validates the Python API SSL certificate response structure.
 */
export function validateSSLCertificateApiResponse(apiResponse: any): boolean {
  const requiredFields = [
    'host', 'resolved_ip', 'tls_version', 'timestamp', 'issued_to',
    'issuer_cn', 'cert_valid', 'valid_from', 'valid_till'
  ];

  for (const field of requiredFields) {
    if (!(field in apiResponse)) {
      console.error(`Missing required field in SSL API response: ${field}`);
      return false;
    }
  }

  if (!validateAndConvertSSLDate(apiResponse.valid_from)) {
    console.error('Invalid valid_from date in SSL API response:', apiResponse.valid_from);
    return false;
  }

  if (!validateAndConvertSSLDate(apiResponse.valid_till)) {
    console.error('Invalid valid_till date in SSL API response:', apiResponse.valid_till);
    return false;
  }

  return true;
}
