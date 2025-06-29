# TegasFX Proxy Server - Technical Documentation

## Current Deployment URL

tegasfx-proxy-server-production.up.railway.app

## Overview

The TegasFX Proxy Server is a secure Node.js/Express middleware that acts as an encrypted bridge between client
applications and the TegasFX API. It ensures API keys are never exposed in client-side code while maintaining full
request/response fidelity.

## How It Works

### Request Flow Architecture

```
Client Application → TegasFX Proxy → secure.tegasfx.com → TegasFX API
                  ↑ Encrypted    ↑ Decrypted
                  API Key        API Key
```

1. **Client Request**: Client sends request with encrypted API key in Authorization header
2. **Decryption**: Proxy decrypts API key using AES-256-GCM encryption
3. **Forwarding**: Proxy forwards request to TegasFX API with decrypted key
4. **Response**: TegasFX response is forwarded back to client with all headers preserved

### Security Implementation

#### AES-256-GCM Encryption

- **Algorithm**: AES-256-GCM with authenticated encryption
- **Key Derivation**: Uses scrypt with salt for key strengthening
- **Authentication**: Additional Authenticated Data (AAD) prevents tampering
- **IV**: Random 16-byte initialization vector for each encryption
- **Auth Tag**: Ensures message integrity and authenticity

**Implementation Details** (server.js:36-90):

```javascript
- 32-byte key derived from ENCRYPTION_KEY environment variable
- Random IV generation for each encryption operation
- AAD tag "tegasfx-proxy" for additional security
- Full decryption validation with error handling
```

#### Request Security

- **Rate Limiting**: 1000 requests per 15 minutes per IP (server.js:23-28)
- **CORS Protection**: Configurable allowed origins (server.js:17-20)
- **Helmet Security**: Standard security headers applied (server.js:16)
- **Input Validation**: Request body size limits (10MB) (server.js:31-33)
- **Trust Proxy**: Configured to trust first proxy hop for proper IP detection (server.js:13)

## Header Forwarding Analysis

### Headers Forwarded to TegasFX API

**Always Forwarded** (server.js:145-149):

- `accept`: Always set to `application/json`
- `Content-Type`: Always set to `application/json`
- `Authorization`: Decrypted API key as `Bearer <key>`

**Note**: The proxy uses a minimal header approach, only forwarding essential headers to match the auth.ts behavior. Client-specific headers like User-Agent, Accept-Language, cookies, and proxy headers are not forwarded to ensure consistency and security.

### Headers Forwarded from TegasFX API

**All Response Headers Preserved** (server.js:186-190):

- **Cookies**: Set-Cookie headers are fully preserved
- **Content Headers**: Content-Type, Content-Length, etc.
- **Cache Headers**: Cache-Control, ETag, etc.
- **Custom Headers**: Any TegasFX-specific headers

**Added Proxy Headers** (server.js:193-194):

- `X-Proxy-Response-Time`: Request processing time in milliseconds
- `X-Proxy-Service`: Identifies the proxy service as "tegasfx-proxy"

## Security Assessment

### ✅ Strong Security Features

1. **Encryption Strength**
    - AES-256-GCM: Military-grade encryption standard
    - Authenticated encryption prevents tampering
    - Random IV prevents replay attacks
    - Key derivation adds computational cost to brute force

2. **API Key Protection**
    - Keys never stored in plain text
    - Keys never logged or exposed in errors
    - Encryption/decryption happens in memory only
    - Failed decryption returns generic error messages

3. **Network Security**
    - HTTPS enforcement for external communications
    - Rate limiting prevents abuse
    - Input validation prevents injection attacks
    - Timeout protection (30s) prevents hanging requests

4. **Error Handling**
    - Generic error messages prevent information leakage
    - Request correlation IDs for debugging
    - Comprehensive logging without sensitive data

### ⚠️ Security Considerations

1. **Environment Variables**
    - `ENCRYPTION_KEY` must be 32+ characters and kept secret
    - Key must match between proxy and client applications
    - Consider key rotation strategy for production

2. **Network Transport**
    - Ensure HTTPS is used for all client-proxy communications
    - Railway/deployment platform should provide TLS termination

3. **Access Control**
    - Rate limiting is IP-based (can be bypassed with multiple IPs)
    - Consider additional authentication layers for production
    - CORS origins should be strictly configured

## API Endpoints

### Primary Endpoints

#### `ALL /rest/*`

**Purpose**: Main proxy endpoint for TegasFX API requests

**Request Format**:

```http
POST /rest/v1/accounts
Authorization: Bearer {"encrypted":"...","iv":"...","authTag":"..."}
Content-Type: application/json

{
  "account_data": "..."
}
```

**Response**: Identical to TegasFX API response with additional proxy headers

#### `GET /health`

**Purpose**: Service health check

**Response**:

```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "service": "tegasfx-proxy"
}
```

#### `GET /ip`

**Purpose**: Debug endpoint to check client IP address and headers

**Response**:

```json
{
  "ip": "client-ip-address",
  "headers": {
    // all request headers
  }
}
```

#### `POST /encrypt-key`

**Purpose**: Utility endpoint for encrypting API keys (testing/setup)

**Request**:

```json
{
  "apiKey": "your-tegasfx-api-key"
}
```

**Response**:

```json
{
  "encryptedApiKey": "{\"encrypted\":\"...\",\"iv\":\"...\",\"authTag\":\"...\"}",
  "message": "API key encrypted successfully"
}
```

## Request/Response Fidelity

### ✅ Complete Fidelity Maintained

1. **HTTP Methods**: All methods (GET, POST, PUT, DELETE, etc.) supported
2. **Request Bodies**: All content types preserved (JSON, form data, binary)
3. **Query Parameters**: Fully preserved in target URL
4. **Response Status**: Original HTTP status codes maintained
5. **Response Headers**: All headers including cookies forwarded
6. **Response Body**: Raw response body forwarded unchanged

### Processing Details

**Request Processing** (server.js:159-167):

- JSON bodies are re-serialized to ensure valid JSON
- Non-JSON bodies are forwarded as-is (binary, text, etc.)
- Content-Type header determines body handling

**Response Processing** (server.js:178-202):

- Response body read as text and forwarded unchanged
- All response headers copied to client response
- Original HTTP status code preserved
- Response timing added as custom header

## Performance Characteristics

- **Timeout**: 30-second timeout for TegasFX API requests
- **Concurrency**: Node.js async handling supports multiple concurrent requests
- **Memory**: Request/response bodies loaded into memory (10MB limit)
- **Latency**: Adds ~10-50ms overhead for encryption/decryption operations

## Deployment Security

### Environment Variables

```bash
ENCRYPTION_KEY=your32characterencryptionkeyhere  # Required: 32+ chars
ALLOWED_ORIGINS=https://yourdomain.com           # Recommended: Specific origins
NODE_ENV=production                              # Recommended: Production mode
PORT=3001                                        # Optional: Custom port
```

### Production Recommendations

1. Use strong, unique ENCRYPTION_KEY (32+ characters)
2. Configure specific ALLOWED_ORIGINS (not wildcard)
3. Deploy behind HTTPS-terminating load balancer
4. Monitor logs for failed decryption attempts
5. Consider additional rate limiting for production workloads
6. Implement health check monitoring
7. Set up log aggregation for request tracking

## Error Handling

### Client Errors (4xx)

- `401`: Missing/invalid Authorization header or decryption failure
- `400`: Invalid request format (missing apiKey in /encrypt-key)
- `404`: Unsupported endpoint (only /rest/* supported)

### Server Errors (5xx)

- `502`: Proxy gateway error (TegasFX API unreachable/timeout)
- `500`: Internal server error (unexpected exceptions)

All errors include correlation IDs and timestamps for debugging while protecting sensitive information.