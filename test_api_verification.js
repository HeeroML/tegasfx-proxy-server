const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { URL } = require('url');

// Helper function to make HTTP requests (replacement for fetch)
function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    const client = isHttps ? https : http;

    const requestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    };

    const req = client.request(requestOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          text: () => Promise.resolve(data),
          json: () => Promise.resolve(JSON.parse(data))
        });
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    if (options.body) {
      req.write(options.body);
    }

    req.end();
  });
}

// Use the same encryption class as the server
class ApiKeyEncryption {
  constructor() {
    this.algorithm = 'aes-256-gcm';
    this.secretKey = process.env.ENCRYPTION_KEY || 'test-key-32-characters-long-here';

    if (!process.env.ENCRYPTION_KEY) {
      console.warn('⚠️  WARNING: ENCRYPTION_KEY environment variable not set!');
      console.warn('⚠️  Using test key:', this.secretKey);
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

async function testApiKeyVerification() {
  console.log('=== TegasFX API Key Verification Test ===\n');

  // The provided API key
  const apiKey = '64a9b9cb1d167dac153a127ee28a1a59309275ed82aea2d7832f498533c6f1a2876bb5d467344cc382f7befe4af35166ed6d0539943dd842664ddac1';
  console.log('Testing API Key:', apiKey);
  console.log('API Key Length:', apiKey.length, 'characters\n');

  const encryption = new ApiKeyEncryption();

  // Step 1: Test encryption/decryption
  console.log('--- Step 1: Testing Encryption/Decryption ---');
  try {
    const encrypted = encryption.encrypt(apiKey);
    console.log('✓ Encryption successful');
    console.log('Encrypted data structure:', {
      encrypted: encrypted.encrypted.substring(0, 20) + '...',
      iv: encrypted.iv,
      authTag: encrypted.authTag
    });

    const decrypted = encryption.decrypt(encrypted);
    console.log('✓ Decryption successful');
    console.log('Decryption matches original:', decrypted === apiKey);

    if (decrypted !== apiKey) {
      console.error('❌ CRITICAL: Decrypted key does not match original!');
      console.log('Original :', apiKey);
      console.log('Decrypted:', decrypted);
      return;
    }
    console.log('');
  } catch (error) {
    console.error('❌ Encryption/Decryption failed:', error.message);
    return;
  }

  // Step 2: Test proxy server health
  console.log('--- Step 2: Testing Proxy Server Health ---');
  const proxyUrl = process.env.PROXY_BASE_URL || 'http://localhost:3001';
  console.log('Proxy URL:', proxyUrl);

  try {
    const healthResponse = await makeRequest(`${proxyUrl}/health`);
    const healthData = await healthResponse.json();
    console.log('✓ Proxy server is healthy');
    console.log('Health response:', healthData);
    console.log('');
  } catch (error) {
    console.error('❌ Proxy server health check failed:', error.message);
    console.log('Make sure the proxy server is running on', proxyUrl);
    console.log('');
  }

  // Step 3: Test API call through proxy
  console.log('--- Step 3: Testing API Call Through Proxy ---');
  try {
    const encrypted = encryption.encrypt(apiKey);
    const encryptedApiKeyString = JSON.stringify(encrypted);

    // Test with a simple endpoint - let's try user info or similar
    const testEndpoint = '/rest/user/info'; // Common endpoint for user information
    const testUrl = `${proxyUrl}${testEndpoint}`;

    console.log('Making request to:', testUrl);
    console.log('Using encrypted API key in Authorization header');

    const response = await makeRequest(testUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${encryptedApiKeyString}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });

    console.log('Response status:', response.status);
    console.log('Response headers:', response.headers);

    const responseText = await response.text();
    console.log('Response body:', responseText);

    if (response.status === 200) {
      console.log('✓ API call successful!');
      try {
        const responseJson = JSON.parse(responseText);
        console.log('✓ Valid JSON response received');
      } catch (e) {
        console.log('ℹ️  Response is not JSON (might be HTML or plain text)');
      }
    } else if (response.status === 401) {
      console.log('⚠️  Authentication failed - API key might be invalid or expired');
    } else if (response.status === 404) {
      console.log('⚠️  Endpoint not found - trying different endpoint');

      // Try a different endpoint
      const altEndpoint = '/rest/user/profile';
      const altUrl = `${proxyUrl}${altEndpoint}`;
      console.log('Trying alternative endpoint:', altUrl);

      const altResponse = await makeRequest(altUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${encryptedApiKeyString}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      });

      console.log('Alternative endpoint status:', altResponse.status);
      const altResponseText = await altResponse.text();
      console.log('Alternative endpoint response:', altResponseText);
    } else {
      console.log('⚠️  Unexpected response status');
    }

  } catch (error) {
    console.error('❌ API call failed:', error.message);
  }

  console.log('\n=== Test Complete ===');
}

// Run the test
if (require.main === module) {
  testApiKeyVerification().catch(console.error);
}

module.exports = { ApiKeyEncryption, testApiKeyVerification };
