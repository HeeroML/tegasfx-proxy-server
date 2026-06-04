# TegasFX API Gateway

This service is a minimal operational gateway for `api.tegasfx.com`.

The legacy TegasFX CRM REST proxy has been permanently disabled. The service no
longer decrypts API keys, no longer forwards `/rest/*` requests to
`secure.tegasfx.com`, and no longer exposes an API-key encryption helper.

## Endpoints

- `GET /health` returns service health and confirms `crmProxyEnabled: false`.
- `GET /ip` returns the caller IP as seen by the Railway edge.
- `ALL /rest` and `ALL /rest/*` return `410 crm_proxy_disabled`.
- `ALL /encrypt-key` returns `410 crm_proxy_disabled`.

## Environment

```env
PORT=3001
NODE_ENV=production
ALLOWED_ORIGINS=https://account.tegasfx.com,https://api.tegasfx.com
```

Do not add CRM API keys, encrypted API keys, or shared encryption keys to this
service. Any future upstream integration must be built as a narrow, reviewed
server-to-server endpoint with an explicit allowlist, its own scoped credential,
request authentication, audit logging, and tests that prove dangerous CRM
methods cannot be reached.

## Development

```bash
npm install
npm test
npm start
```
