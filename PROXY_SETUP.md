# TegasFX Proxy Setup Guide

## Overview

This application uses an external proxy server to securely communicate with TegasFX CRM API endpoints.

## Architecture

```
Your App                    External Proxy                  TegasFX API
   |                             |                              |
   |--[Encrypted API Key]------->|                              |
   |                             |--[Decrypted API Key]-------->|
   |                             |                              |
   |<--------[Response]----------|<--------[Response]-----------|
```

## Environment Variables

### For Your Next.js Application (.env.local)

```bash
# Encryption key for securing API keys (must be 32+ characters)
ENCRYPTION_KEY=your-secure-32-character-encryption-key-here

# Your TegasFX CRM API key (will be encrypted before sending)
CRM_API_KEY=your-tegasfx-crm-api-key-here

# External proxy server URL
PROXY_BASE_URL=https://tegasfx-proxy-server-production.up.railway.app
```

### For the Railway Proxy Server

```bash
# ONLY the encryption key is needed (must match your app's key)
ENCRYPTION_KEY=your-secure-32-character-encryption-key-here

# NO CRM_API_KEY needed on proxy! (Better security)
```

## How It Works

1. **App Side**:
    - Encrypts `CRM_API_KEY` using AES-256-GCM with `ENCRYPTION_KEY`
    - Sends encrypted data in `Authorization: Bearer {"encrypted":"...","iv":"...","authTag":"..."}`

2. **Proxy Side**:
    - Decrypts the API key using the shared `ENCRYPTION_KEY`
    - Forwards request to TegasFX with decrypted key
    - Returns response to your app

3. **Security Benefits**:
    - CRM API key never stored on proxy server
    - API key encrypted in transit
    - Proxy compromise doesn't expose API key

## API Endpoints

- **Proxied**: `/rest/*` endpoints (e.g., `/rest/user/direct_login`)
    - Go through: `https://tegasfx-proxy-server-production.up.railway.app/rest/*`

- **Direct**: `/client-api/*` endpoints (e.g., `/client-api/registration`)
    - Go directly to: `https://secure.tegasfx.com/client-api/*`

## Testing

To verify the proxy is working:

```bash
# Check proxy health
curl https://tegasfx-proxy-server-production.up.railway.app/health

# Expected response:
# {"status":"healthy","timestamp":"...","service":"tegasfx-proxy"}
```

## Important Notes

- Ensure `ENCRYPTION_KEY` is exactly the same on both app and proxy
- Keep your `ENCRYPTION_KEY` secure and never commit it to version control
- The proxy handles all authentication - your app just needs to encrypt the API key

## Troubleshooting

### "Failed to decrypt the provided API key" Error

If you're getting this error, check:

1. **ENCRYPTION_KEY Match**: The key must be EXACTLY the same on both your app and the proxy server
2. **Key Format**: Should be a 64-character hex string (32 bytes)
3. **Direct API Test**: Verify your CRM_API_KEY works (note: direct calls may be blocked by Cloudflare)

