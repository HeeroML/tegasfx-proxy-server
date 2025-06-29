#!/usr/bin/env node

import crypto from 'crypto';
import readline from 'readline';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

class ApiKeyEncryption {
  constructor(encryptionKey) {
    this.algorithm = 'aes-256-gcm';
    this.secretKey = encryptionKey;
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
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

async function main() {
  console.log('🔐 TegasFX API Key Encryption Utility\n');
  
  // Get encryption key from environment
  const encryptionKey = process.env.ENCRYPTION_KEY;
  
  if (!encryptionKey) {
    console.log('❌ ENCRYPTION_KEY not found in environment variables.');
    console.log('Please set your ENCRYPTION_KEY first (must be 32 characters).');
    console.log('Example: export ENCRYPTION_KEY="your-32-character-key-here"');
    rl.close();
    return;
  }

  console.log('✅ Using ENCRYPTION_KEY from environment\n');
  const encryption = new ApiKeyEncryption(encryptionKey);

  // Get API key to encrypt
  const apiKey = await question('Enter your TegasFX API key to encrypt: ');
  
  if (!apiKey.trim()) {
    console.log('❌ No API key provided');
    rl.close();
    return;
  }

  // Encrypt the API key
  const encrypted = encryption.encrypt(apiKey);
  const encryptedString = JSON.stringify(encrypted);

  console.log('\n🎉 API Key encrypted successfully!\n');
  console.log('Add this to your environment variables:');
  console.log('=====================================');
  console.log(`ENCRYPTED_API_KEY='${encryptedString}'`);
  console.log('=====================================\n');
  
  console.log('Or add to your .env file:');
  console.log(`ENCRYPTED_API_KEY='${encryptedString}'`);

  rl.close();
}

main().catch(console.error);