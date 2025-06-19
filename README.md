# TegasFX Proxy Server

A secure proxy server for TegasFX API that provides encrypted API key handling and full REST API forwarding capabilities. This proxy server is designed to provide a fixed IP address for API calls while maintaining security through encryption.

## Features

- **Encrypted API Key Handling**: Receives encrypted API keys and decrypts them server-side
- **Full REST API Forwarding**: Forwards all `/rest/*` endpoints to `secure.tegasfx.com`
- **Complete Header Preservation**: Maintains all response headers including cookies
- **Security Middleware**: Includes CORS, rate limiting, and security headers
- **Health Monitoring**: Built-in health check endpoint
- **Request Logging**: Comprehensive logging without exposing sensitive data

## Architecture

The proxy server acts as an intermediary between your main application and the TegasFX API:

```
Main Application → Proxy Server → TegasFX API (secure.tegasfx.com)
                ↑ (encrypted key)  ↑ (decrypted key)
```

### Security Model

1. **Encryption**: API keys are encrypted using AES-256-GCM encryption
2. **No Storage**: The proxy server never stores the actual API keys
3. **Environment Key**: Only the decryption key is stored as an environment variable
4. **Fixed IP**: Provides a consistent IP address for IP-locked APIs

## Installation

1. Clone this repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy environment configuration:
   ```bash
   cp .env.example .env
   ```
4. Configure your environment variables in `.env`

## Configuration

### Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `PORT` | Server port | No | 3001 |
| `NODE_ENV` | Environment mode | No | development |
| `ENCRYPTION_KEY` | 32+ character encryption key | **Yes** | - |
| `ALLOWED_ORIGINS` | Comma-separated CORS origins | No | * |

### Example .env file

```bash
PORT=3001
NODE_ENV=production
ENCRYPTION_KEY=your-very-secure-32-character-key-here
ALLOWED_ORIGINS=https://your-app.com,https://localhost:3000
```

## Usage

### Starting the Server

```bash
# Development mode with auto-restart
npm run dev

# Production mode
npm start
```

### API Endpoints

#### Health Check
```
GET /health
```
Returns server status and timestamp.

#### Encrypt API Key (Utility)
```
POST /encrypt-key
Content-Type: application/json

{
  "apiKey": "your-tegasfx-api-key"
}
```
Returns encrypted API key for use in requests.

#### Proxy REST API Calls
```
ALL /rest/*
Authorization: Bearer <encrypted-api-key>
```
Forwards all REST API calls to TegasFX with decrypted authentication.

### Example Usage

1. **Encrypt your API key:**
   ```bash
   curl -X POST http://your-proxy-server:3001/encrypt-key \
     -H "Content-Type: application/json" \
     -d '{"apiKey": "your-actual-tegasfx-api-key"}'
   ```

2. **Use encrypted key in API calls:**
   ```bash
   curl -X GET http://your-proxy-server:3001/rest/some-endpoint \
     -H "Authorization: Bearer <encrypted-api-key-from-step-1>"
   ```

## Integration with Main Application

To integrate this proxy with your main application:

1. **Update API Base URL**: Point your REST API calls to the proxy server
2. **Encrypt API Keys**: Use the proxy's encryption for storing API keys
3. **Update Headers**: Send encrypted API keys in Authorization headers

### Example Integration

```javascript
// Before (direct to TegasFX)
const response = await fetch('https://secure.tegasfx.com/rest/endpoint', {
  headers: {
    'Authorization': `Bearer ${plainApiKey}`
  }
});

// After (through proxy)
const response = await fetch('http://your-proxy-server:3001/rest/endpoint', {
  headers: {
    'Authorization': `Bearer ${encryptedApiKey}`
  }
});
```

## Security Considerations

- **Encryption Key**: Use a strong, randomly generated encryption key
- **Environment Security**: Secure your environment variables
- **Network Security**: Use HTTPS in production
- **Access Control**: Implement proper firewall rules
- **Monitoring**: Monitor logs for suspicious activity

## Deployment

### Docker Deployment

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3001
CMD ["npm", "start"]
```

### Environment Setup

Ensure your deployment environment has:
- Node.js 18+
- Secure environment variable management
- Proper firewall configuration
- SSL/TLS termination (if needed)

## Monitoring and Logging

The proxy server logs:
- Request timestamps and response times
- HTTP status codes and methods
- Error messages (without sensitive data)
- Health check status

Example log output:
```
2024-01-15T10:30:45.123Z - GET /rest/accounts - 200 - 245ms
2024-01-15T10:30:46.456Z - POST /rest/orders - 201 - 189ms
```

## Error Handling

The proxy handles various error scenarios:

- **Invalid encrypted keys**: Returns 401 with clear error message
- **Missing authorization**: Returns 401 with usage instructions
- **TegasFX API errors**: Forwards original error responses
- **Network timeouts**: Returns 502 with timeout information
- **Server errors**: Returns 500 with request ID for tracking

## Rate Limiting

Built-in rate limiting:
- **Window**: 15 minutes
- **Limit**: 1000 requests per IP
- **Response**: 429 status with retry information

## Support

For issues related to:
- **Proxy functionality**: Check logs and configuration
- **TegasFX API**: Refer to TegasFX documentation
- **Integration**: Review the integration examples above

## License

ISC License - See LICENSE file for details.