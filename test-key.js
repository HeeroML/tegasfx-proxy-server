#!/usr/bin/env node

import crypto from 'crypto';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

class ApiKeyEncryption {
  constructor(encryptionKey) {
    this.algorithm = 'aes-256-gcm';
    this.secretKey = encryptionKey;
    this.key = crypto.scryptSync(this.secretKey, 'salt', 32);
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
      throw new Error(`Decryption failed: ${error.message}`);
    }
  }
}

async function testApiKey() {
  const encryptionKey = process.env.ENCRYPTION_KEY;
  
  if (!encryptionKey) {
    console.log('❌ ENCRYPTION_KEY not found in .env file');
    return;
  }

  console.log('🔐 Testing API Key Decryption\n');

  const encryptedApiKey = {"encrypted":"1cde1cc5980c7bf45f26f1d37b95b408e0c706a5fd355dd81d37ab588165c483016119699cf2fe23dd79f32e5fffd0c4461a7487a03dbe6974ef7ca91f7a32346da41da8523ceff2089534ef87d964e46756e32e475ee0367ce5decce4d3dd17c31ef4b16538e868bef2b839e941d5da657a012024ddb210","iv":"2965a52c0443521a1e8033fd020442cb","authTag":"2750994117195d3daabb3657c48cb3f2"};

  try {
    const encryption = new ApiKeyEncryption(encryptionKey);
    const decryptedKey = encryption.decrypt(encryptedApiKey);
    
    console.log('✅ Decryption successful!');
    console.log(`🔑 Decrypted API Key: ${decryptedKey.substring(0, 10)}...${decryptedKey.substring(decryptedKey.length - 4)}`);
    
    // Test API call to TegasFX
    console.log('\n🌐 Testing API call to TegasFX...');
    
    const response = await fetch('https://secure.tegasfx.com/rest/v1/account/balance', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${decryptedKey}`,
        'Content-Type': 'application/json'
      }
    });

    console.log(`📡 Response Status: ${response.status} ${response.statusText}`);
    
    if (response.ok) {
      const data = await response.json();
      console.log('✅ API call successful!');
      console.log('📊 Response:', JSON.stringify(data, null, 2));
    } else {
      const errorText = await response.text();
      console.log('❌ API call failed');
      console.log('📄 Error response:', errorText);
    }

  } catch (error) {
    console.log('❌ Test failed:', error.message);
  }
}

testApiKey().catch(console.error);