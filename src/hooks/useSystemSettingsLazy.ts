/**
 * useSystemSettingsLazy — local mock version.
 * Replace with an AWS-backed version when the backend is ready.
 */

export interface SystemSettings {
  id: string;
  smtp_host: string;
  smtp_port: string;
  smtp_secure: string;
  smtp_username: string;
  smtp_password: string;
  smtp_from_email: string;
  smtp_from_name: string;
  email_smtp_api_key: string;
  smtp_api_url: string;
  alert_email: string;
  enable_notifications: boolean;
  enable_sms_notifications: boolean;
  phone_number: string;
  enable_slack_integration: boolean;
  slack_webhook_url: string;
  slack_channel_name: string;
  enable_telegram_bot: boolean;
  email_critical_alerts: boolean;
  email_warning_alerts: boolean;
  email_informational: boolean;
  sms_critical_alerts: boolean;
  sms_warning_alerts: boolean;
  sms_informational: boolean;
  slack_critical_alerts: boolean;
  slack_warning_alerts: boolean;
  slack_informational: boolean;
  sms_gateway_url: string;
  sms_gateway_login: string;
  sms_gateway_password: string;
  ssl_alert_threshold_days: number;
  ssl_warning_threshold_days: number;
  ssl_check_frequency: 'hourly' | '6hourly' | '12hourly' | 'daily' | 'weekly';
  ssl_email_notifications: boolean;
  ssl_sms_notifications: boolean;
  ssl_notification_frequency: 'immediate' | 'hourly' | 'daily' | 'weekly' | 'monthly';
  ssl_reminder_enabled: boolean;
  ssl_reminder_days_before: number;
  ssl_auto_renewal_enabled: boolean;
  ssl_auto_renewal_days_before: number;
}

const mockSettings: SystemSettings = {
  id: 'local-settings',
  smtp_host: 'smtp.gmail.com',
  smtp_port: '587',
  smtp_secure: 'TLS',
  smtp_username: '',
  smtp_password: '',
  smtp_from_email: 'noreply@its.ms.gov',
  smtp_from_name: 'Mississippi ITS Certificate Monitor',
  email_smtp_api_key: '',
  smtp_api_url: 'http://localhost:5000',
  alert_email: 'admin@its.ms.gov',
  enable_notifications: true,
  enable_sms_notifications: false,
  phone_number: '',
  enable_slack_integration: false,
  slack_webhook_url: '',
  slack_channel_name: '#certificate-alerts',
  enable_telegram_bot: false,
  email_critical_alerts: true,
  email_warning_alerts: true,
  email_informational: false,
  sms_critical_alerts: true,
  sms_warning_alerts: false,
  sms_informational: false,
  slack_critical_alerts: true,
  slack_warning_alerts: true,
  slack_informational: false,
  sms_gateway_url: '',
  sms_gateway_login: '',
  sms_gateway_password: '',
  ssl_alert_threshold_days: 30,
  ssl_warning_threshold_days: 7,
  ssl_check_frequency: 'daily',
  ssl_email_notifications: true,
  ssl_sms_notifications: false,
  ssl_notification_frequency: 'immediate',
  ssl_reminder_enabled: true,
  ssl_reminder_days_before: 3,
  ssl_auto_renewal_enabled: false,
  ssl_auto_renewal_days_before: 14,
};

export const useSystemSettingsLazy = () => ({
  settings: mockSettings,
  loading: false,
  updateSettings: async (_: Partial<SystemSettings>) => {},
  saveSettings: async () => {},
  initialize: () => {},
});
