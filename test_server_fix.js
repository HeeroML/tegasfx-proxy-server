const crypto = require('crypto');

// Copy the FIXED ApiKeyEncryption class from server.js
class ApiKeyEncryption {
    constructor() {
        this.algorithm = 'aes-256-gcm';
        this.secretKey = 'test-key-32-characters-long-here';

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
            const {encrypted, iv, authTag} = typeof encryptedData === 'string'
                ? JSON.parse(encryptedData)
                : encryptedData;

            // FIXED: Using createDecipheriv instead of createDecipherGCM
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

// Test the fixed implementation
const testApiKey = 'my-tegasfx-api-key-12345';
const encryption = new ApiKeyEncryption();

console.log('Testing FIXED server implementation...');
console.log('Original API Key:', testApiKey);

// Test multiple rounds to ensure consistency
for (let i = 1; i <= 3; i++) {
    console.log(`\n--- Test Round ${i} ---`);

    try {
        // Encrypt the API key
        const encrypted = encryption.encrypt(testApiKey);
        console.log('Encrypted successfully');

        // Decrypt the API key
        const decrypted = encryption.decrypt(encrypted);
        console.log('Decrypted successfully');

        // Verify the result
        const success = decrypted === testApiKey;
        console.log('Verification:', success ? 'PASS' : 'FAIL');

        if (!success) {
            console.log('Expected:', testApiKey);
            console.log('Got:', decrypted);
        }
    } catch (error) {
        console.log('Test FAILED:', error.message);
    }
}

// Test with JSON string format (as used in the proxy)
console.log('\n--- Testing JSON string format ---');
try {
    const encrypted = encryption.encrypt(testApiKey);
    const encryptedJson = JSON.stringify(encrypted);
    console.log('Encrypted as JSON string');

    const decrypted = encryption.decrypt(encryptedJson);
    console.log('Decrypted from JSON string successfully');

    const success = decrypted === testApiKey;
    console.log('JSON format verification:', success ? 'PASS' : 'FAIL');
} catch (error) {
    console.log('JSON format test FAILED:', error.message);
}

console.log('\n🎉 All tests completed! The server fix should now work correctly.');