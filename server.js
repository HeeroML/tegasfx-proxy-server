const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // limit each IP to 1000 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use(limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.raw({ type: 'application/octet-stream', limit: '10mb' }));
app.use(express.text({ type: 'text/*', limit: '10mb' }));

// Encryption/Decryption utilities
class ApiKeyEncryption {
  constructor() {
    this.algorithm = 'aes-256-gcm';
    this.secretKey = process.env.ENCRYPTION_KEY;

    if (!this.secretKey) {
      // Generate a random 32-character key if not provided
      this.secretKey = crypto.randomBytes(16).toString('hex');
      console.warn('⚠️  WARNING: ENCRYPTION_KEY environment variable not set!');
      console.warn('⚠️  Generated temporary key:', this.secretKey);
      console.warn('⚠️  For production, set ENCRYPTION_KEY environment variable to a secure 32-character key');
      console.warn('⚠️  This key must match PROXY_ENCRYPTION_KEY in your Convex deployment');
    }

    // Ensure key is 32 bytes for AES-256
    this.key = crypto.scryptSync(this.secretKey, 'salt', 32);
  }

  encrypt(text) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);
    cipher.setAAD(Buffer.from('tegasfx-proxy', 'utf8'));

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    return {
      encrypted,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex')
    };
  }

  decrypt(encryptedData) {
    try {
      const { encrypted, iv, authTag } = typeof encryptedData === 'string' 
        ? JSON.parse(encryptedData) 
        : encryptedData;

      const decipher = crypto.createDecipheriv(this.algorithm, this.key, Buffer.from(iv, 'hex'));
      decipher.setAAD(Buffer.from('tegasfx-proxy', 'utf8'));
      decipher.setAuthTag(Buffer.from(authTag, 'hex'));

      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      console.error('Decryption error:', error);
      throw new Error('Failed to decrypt API key');
    }
  }
}

const encryption = new ApiKeyEncryption();

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    service: 'tegasfx-proxy'
  });
});

// Main proxy handler for /rest/ endpoints
app.all('/rest/*', async (req, res) => {
  const startTime = Date.now();

  try {
    // Extract encrypted API key from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Missing or invalid authorization header',
        message: 'Expected format: Authorization: Bearer <encrypted-api-key>'
      });
    }

    const encryptedApiKey = authHeader.substring(7);

    // Decrypt the API key
    let decryptedApiKey;
    try {
      decryptedApiKey = encryption.decrypt(encryptedApiKey);
    } catch (error) {
      return res.status(401).json({
        error: 'Invalid encrypted API key',
        message: 'Failed to decrypt the provided API key'
      });
    }

    // Build target URL
    const targetPath = req.path;
    const queryString = req.url.includes('?') ? req.url.split('?')[1] : '';
    const targetUrl = `https://secure.tegasfx.com${targetPath}${queryString ? '?' + queryString : ''}`;

    // Prepare headers for the target API
    const forwardHeaders = {
      'Content-Type': req.headers['content-type'] || 'application/json',
      'Authorization': `Bearer ${decryptedApiKey}`,
      'Accept': req.headers.accept || 'application/json, text/plain, */*',
      'Accept-Language': req.headers['accept-language'] || 'en-US,en;q=0.9',
      'User-Agent': req.headers['user-agent'] || 'TegasFX-Proxy/1.0.0'
    };

    // Forward cookies from client to TegasFX API
    if (req.headers.cookie) {
      forwardHeaders['Cookie'] = req.headers.cookie;
    }

    // Remove proxy-specific headers
    delete forwardHeaders['host'];
    delete forwardHeaders['x-forwarded-for'];
    delete forwardHeaders['x-forwarded-proto'];
    delete forwardHeaders['content-length'];

    // Prepare request body
    let requestBody = null;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      if (req.headers['content-type']?.includes('application/json')) {
        requestBody = JSON.stringify(req.body);
      } else {
        requestBody = req.body;
      }
    }

    // Make the request to TegasFX API
    const fetch = (await import('node-fetch')).default;
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: forwardHeaders,
      body: requestBody,
      timeout: 30000 // 30 second timeout
    });

    // Get response body
    const responseBody = await response.text();
    const responseTime = Date.now() - startTime;

    // Log the request (without sensitive data)
    console.log(`${new Date().toISOString()} - ${req.method} ${targetPath} - ${response.status} - ${responseTime}ms`);

    // Forward all response headers
    const responseHeaders = {};
    response.headers.forEach((value, key) => {
      // Forward all headers including cookies
      responseHeaders[key] = value;
    });

    // Add proxy-specific headers
    responseHeaders['X-Proxy-Response-Time'] = `${responseTime}ms`;
    responseHeaders['X-Proxy-Service'] = 'tegasfx-proxy';

    // Set response headers
    Object.entries(responseHeaders).forEach(([key, value]) => {
      res.set(key, value);
    });

    // Send response with original status and body
    res.status(response.status).send(responseBody);

  } catch (error) {
    const responseTime = Date.now() - startTime;

    console.error('Proxy error:', {
      error: error.message,
      path: req.path,
      method: req.method,
      responseTime: `${responseTime}ms`,
      timestamp: new Date().toISOString()
    });

    res.status(502).json({
      error: 'Proxy Gateway Error',
      message: 'Failed to forward request to TegasFX API',
      timestamp: new Date().toISOString(),
      requestId: crypto.randomBytes(8).toString('hex')
    });
  }
});

// Encryption utility endpoint (for testing/setup)
app.post('/encrypt-key', (req, res) => {
  try {
    const { apiKey } = req.body;

    if (!apiKey) {
      return res.status(400).json({
        error: 'Missing API key',
        message: 'Provide apiKey in request body'
      });
    }

    const encrypted = encryption.encrypt(apiKey);

    res.json({
      encryptedApiKey: JSON.stringify(encrypted),
      message: 'API key encrypted successfully'
    });
  } catch (error) {
    res.status(500).json({
      error: 'Encryption failed',
      message: error.message
    });
  }
});

// Catch-all for unsupported endpoints
app.all('*', (req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    message: 'This proxy only supports /rest/* endpoints',
    supportedPaths: ['/rest/*', '/health', '/encrypt-key']
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({
    error: 'Internal Server Error',
    message: 'An unexpected error occurred',
    timestamp: new Date().toISOString()
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`TegasFX Proxy Server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
