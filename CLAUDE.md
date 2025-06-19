# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TegasFX Proxy Server is a secure Node.js/Express proxy that forwards REST API requests to secure.tegasfx.com with
encrypted API key handling. It acts as an intermediary between client applications (like Convex) and the TegasFX API,
ensuring API keys are never exposed in client-side code.

## Common Development Commands

```bash
# Install dependencies
npm install

# Start the production server
npm start

# Start the development server with auto-reload
npm run dev

# Deploy to Heroku (using Heroku CLI)
git push heroku main
```

## Architecture

### Core Components

1. **server.js:1-257** - Main Express server with:
    - AES-256-GCM encryption/decryption for API keys (ApiKeyEncryption class at server.js:32-81)
    - Proxy middleware for /rest/* endpoints (server.js:95-203)
    - Rate limiting and security headers via helmet
    - CORS configuration for cross-origin requests

### Request Flow

1. Client sends request to proxy with encrypted API key in Authorization header
2. Proxy decrypts the API key using the shared ENCRYPTION_KEY
3. Proxy forwards request to secure.tegasfx.com with decrypted API key
4. Response is forwarded back to client with all headers preserved

### Key Endpoints

- `GET /health` - Health check endpoint
- `POST /encrypt-key` - Utility endpoint to encrypt API keys for testing
- `ALL /rest/*` - Main proxy endpoint that forwards to TegasFX API

## Environment Configuration

Required environment variables:

- `ENCRYPTION_KEY` - 32-character key for AES-256-GCM encryption (must match client-side key)
- `PORT` - Server port (default: 3001)
- `ALLOWED_ORIGINS` - Comma-separated list of allowed CORS origins
- `NODE_ENV` - Environment setting (development/production)

## Deployment

The project is configured for easy Heroku deployment with app.json configuration. It requires Node.js 18+ and uses ES
modules for the node-fetch import.

## Security Considerations

- API keys are encrypted using AES-256-GCM with authentication
- Rate limiting is applied (1000 requests per 15 minutes per IP)
- All proxy-specific headers are stripped before forwarding
- Response headers from TegasFX are preserved including cookies