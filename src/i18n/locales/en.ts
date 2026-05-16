export default {
  overview: {
    status: {
      error: 'Error',
      failedToLoad: 'Failed to load',
    },
    datetime: {
      todayDate: "Today's Date",
      currentTime: 'Current Time',
    },
  },
  navigation: {
    alerts: {
      management: {
        title: 'Alerts Management',
        subtitle: 'Monitor and manage system alerts and notifications',
        buttons: {
          alertSettings: 'Alert Settings',
        },
        table: {
          title: 'Alerts',
          loading: 'Loading alerts...',
        },
      },
    },
    security: {
      sslMonitoring: {
        title: 'SSL Monitoring',
        subtitle: 'SSL certificate monitoring and security compliance',
        buttons: {
          addCertificate: 'Add Certificate',
          settingsSecurity: 'Security Settings',
          export: 'Export',
          testConnection: 'Test Connection',
        },
        metrics: {
          totalCertificates: 'Total Certificates',
          valid: 'Valid',
          warning: 'Warning',
          criticalExpired: 'Critical / Expired',
        },
        table: {
          title: 'SSL Certificate Status',
          searchPlaceholder: 'Search certificates...',
          allStatuses: 'All statuses',
          headers: {
            domain: 'Domain',
            issuer: 'Issuer',
            validSince: 'Valid Since',
            expiresOn: 'Expires On',
            daysRemaining: 'Days Remaining',
            status: 'Status',
            actions: 'Actions',
          },
          status: {
            valid: 'Valid',
            warning: 'Warning',
            critical: 'Critical',
            expired: 'Expired',
            invalid: 'Invalid',
            unknown: 'Unknown',
            expiresIn: 'Expires in',
            days: 'days',
            hours: 'h',
            minutes: 'm',
          },
        },
        addCertificate: {
          title: 'Add SSL Certificate',
          description: 'Add a new domain for SSL certificate monitoring.',
          sections: {
            domainConfig: 'Domain Configuration',
            additionalSettings: 'Additional Settings',
          },
          fields: {
            domain: 'Domain / URL',
            domainPlaceholder: 'example.com or www.example.com',
            domainHint: 'Enter the domain name without the protocol.',
            protocol: 'Protocol',
            port: 'Port',
            note: 'Note',
            notePlaceholder: 'Optional certificate description...',
          },
          validation: {
            domainRequired: 'Domain is required',
            invalidDomainFormat: 'Invalid domain format',
            invalidPort: 'Port must be a number between 1 and 65535',
          },
          buttons: {
            cancel: 'Cancel',
            add: 'Add',
            adding: 'Adding...',
          },
        },
      },
    },
  },
  saveSettings: 'Save Settings',
  saving: 'Saving...',
} as const;
