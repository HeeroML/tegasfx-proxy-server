const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;
const SERVICE_NAME = 'tegasfx-api-gateway';

app.set('trust proxy', 1);

function allowedOrigins() {
  return (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, false);
    callback(null, allowedOrigins().includes(origin));
  },
  credentials: false
}));

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'rate_limited',
    message: 'Too many requests, please try again later.'
  }
}));

app.use(express.json({ limit: '64kb' }));
app.use(express.text({ type: 'text/*', limit: '64kb' }));

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: SERVICE_NAME,
    crmProxyEnabled: false
  });
});

app.get('/ip', (req, res) => {
  res.json({ ip: req.ip });
});

app.get('/', (req, res) => {
  res.json({
    service: SERVICE_NAME,
    status: 'online',
    crmProxyEnabled: false
  });
});

function crmProxyDisabled(req, res) {
  console.warn('Blocked disabled CRM proxy request', {
    method: req.method,
    path: req.originalUrl,
    ip: req.ip,
    timestamp: new Date().toISOString()
  });

  res.status(410).json({
    error: 'crm_proxy_disabled',
    message: 'The TegasFX CRM REST proxy has been permanently disabled.'
  });
}

app.all('/rest', crmProxyDisabled);
app.all('/rest/*', crmProxyDisabled);
app.all('/encrypt-key', crmProxyDisabled);

app.all('*', (req, res) => {
  res.status(404).json({
    error: 'endpoint_not_found',
    message: 'This service no longer exposes TegasFX CRM REST proxy endpoints.',
    supportedPaths: ['/health', '/ip']
  });
});

app.use((error, req, res, next) => {
  console.error('Unhandled error:', {
    message: error.message,
    path: req.originalUrl,
    method: req.method,
    timestamp: new Date().toISOString()
  });

  res.status(500).json({
    error: 'internal_server_error',
    message: 'An unexpected error occurred.'
  });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`${SERVICE_NAME} running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
    console.log('CRM REST proxy endpoints are disabled.');
  });
}

module.exports = app;
