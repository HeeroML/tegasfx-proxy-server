const crypto = require('crypto');

// Test the current buggy implementation
class BuggyApiKeyEncryption {
    constructor() {
        this.algorithm = 'aes-256-gcm';
        this.secretKey = 'test-key-32-characters-long-here';
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

    // BUGGY decrypt method (using createDecipherGCM)
    decryptBuggy(encryptedData) {
        try {
            const {encrypted, iv, authTag} = typeof encryptedData === 'string'
                ? JSON.parse(encryptedData)
                : encryptedData;

            // BUG: createDecipherGCM doesn't exist!
            const decipher = crypto.createDecipherGCM(this.algorithm, this.key, Buffer.from(iv, 'hex'));
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

    // FIXED decrypt method (using createDecipheriv)
    decryptFixed(encryptedData) {
        try {
            const {encrypted, iv, authTag} = typeof encryptedData === 'string'
                ? JSON.parse(encryptedData)
                : encryptedData;

            // FIX: Use createDecipheriv instead
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

// Test the encryption/decryption
const testApiKey = 'test-api-key-12345';
const encryption = new BuggyApiKeyEncryption();

console.log('Testing encryption/decryption...');
console.log('Original API Key:', testApiKey);

// Encrypt the API key
const encrypted = encryption.encrypt(testApiKey);
console.log('Encrypted data:', encrypted);

// Test buggy decryption
console.log('\n--- Testing BUGGY decryption (createDecipherGCM) ---');
try {
    const decryptedBuggy = encryption.decryptBuggy(encrypted);
    console.log('Buggy decryption result:', decryptedBuggy);
} catch (error) {
    console.log('Buggy decryption FAILED:', error.message);
}

// Test fixed decryption
console.log('\n--- Testing FIXED decryption (createDecipheriv) ---');
try {
    const decryptedFixed = encryption.decryptFixed(encrypted);
    console.log('Fixed decryption result:', decryptedFixed);
    console.log('Decryption successful:', decryptedFixed === testApiKey);
} catch (error) {
    console.log('Fixed decryption FAILED:', error.message);
}