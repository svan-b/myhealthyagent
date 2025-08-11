import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

// Proper cn function for Tailwind class merging
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Format helpers
export function formatTime(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(date);
}

// Severity helpers
export function getSeverityLabel(value: number): string {
  if (value === 0) return 'None';
  if (value <= 2) return 'Mild';
  if (value <= 4) return 'Moderate';
  if (value <= 6) return 'Significant';
  if (value <= 8) return 'Severe';
  return 'Critical';
}

export function getSeverityColor(value: number): string {
  if (value === 0) return 'text-gray-500';
  if (value <= 3) return 'text-green-600';
  if (value <= 6) return 'text-yellow-600';
  if (value <= 8) return 'text-orange-600';
  return 'text-red-600';
}

// Debug helper for development
export function debugLog(message: string, data?: unknown) {
  if (process.env.NODE_ENV === 'development') {
    console.log(`[DEBUG] ${message}`, data || '');
  }
}
