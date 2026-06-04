# CLAUDE.md

This repository serves `api.tegasfx.com` as a minimal TegasFX API gateway.

## Current Security Posture

The legacy CRM REST proxy is intentionally disabled:

- Do not add `/rest/*` forwarding.
- Do not add API-key encryption/decryption helpers.
- Do not store CRM API keys, encrypted API keys, or shared encryption keys in
  this service.
- `/rest`, `/rest/*`, and `/encrypt-key` must continue to return
  `410 crm_proxy_disabled`.

Any future upstream integration must be implemented as a narrow endpoint with an
explicit allowlist, scoped credentials, request authentication, audit logging,
and tests that prove privileged CRM endpoints such as password change,
direct-login, transaction, and withdrawal methods cannot be reached.

## Commands

```bash
npm install
npm test
npm start
```
