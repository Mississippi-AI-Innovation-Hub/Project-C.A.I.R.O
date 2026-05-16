import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(bytes: number, decimals = 2) {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * Format a date string to display in local timezone with time.
 */
export function formatDateLocal(
  dateString: string | null,
  includeTime: boolean = true,
  shortMonth: boolean = false
): string {
  if (!dateString) return 'N/A';

  try {
    const date = new Date(dateString);
    const month = shortMonth ? 'short' : 'long';

    if (includeTime) {
      return date.toLocaleString('en-US', {
        year: 'numeric',
        month,
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    }

    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month,
      day: '2-digit',
    });
  } catch (error) {
    console.error('Error formatting date:', dateString, error);
    return dateString || 'N/A';
  }
}
