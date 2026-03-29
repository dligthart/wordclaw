window.WORDCLAW_MULTI_TENANT_CONFIG = {
  apiUrl: 'http://localhost:4000/api',
  tenants: {
    acme: {
      name: 'Acme Corp',
      key: 'replace-after-running-setup',
      class: 'acme',
    },
    globex: {
      name: 'Globex Inc',
      key: 'replace-after-running-setup',
      class: 'globex',
    },
  },
};
