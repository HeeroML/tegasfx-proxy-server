# TegasFX Proxy Server

A secure proxy server for handling REST API calls to secure.tegasfx.com with encrypted API key transmission.

## Features

- Encrypts/decrypts API keys using AES-256-GCM
- Forwards REST API requests to secure.tegasfx.com
- Full header preservation including cookies
- CORS support for API wrapper integration
- Rate limiting protection

## Quick Deploy to Heroku

[![Deploy](https://www.herokucdn.com/deploy/button.svg)](https://heroku.com/deploy)

## Manual Deployment

### 1. Clone the repository
```bash
git clone https://github.com/HeeroML/tegasfx-proxy-server.git
cd tegasfx-proxy-server
```

### 2. Install dependencies
```bash
npm install
```

### 3. Set environment variables
Create a `.env` file:
```env
# Server Configuration
PORT=3001
NODE_ENV=production

# Security Configuration (MUST match PROXY_ENCRYPTION_KEY in Convex)
ENCRYPTION_KEY=your-32-character-encryption-key-here

# CORS Configuration
ALLOWED_ORIGINS=https://your-convex-app.convex.site,https://your-domain.com
```

### 4. Start the server
```bash
npm start
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `PORT` | Server port (default: 3001) | No |
| `ENCRYPTION_KEY` | 32-character key for API encryption | Yes |
| `ALLOWED_ORIGINS` | Comma-separated list of allowed origins | No |
| `NODE_ENV` | Environment (development/production) | No |

## API Endpoints

### Health Check
```
GET /health
```

### Encrypt API Key (for testing)
```
POST /encrypt-key
Body: { "apiKey": "your-api-key" }
```

### Proxy REST Endpoints
```
ALL /rest/*
Headers: Authorization: Bearer <encrypted-api-key>
```

## Security Notes

- The proxy server does not store any API keys
- All API keys are encrypted in transit
- Use HTTPS in production
- Regularly rotate encryption keys

## Integration with Convex API Wrapper

Set these environment variables in your Convex deployment:
```
PROXY_SERVER_URL=https://your-proxy-server.herokuapp.com
PROXY_ENCRYPTION_KEY=same-key-as-proxy-server
```