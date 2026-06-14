/**
 * Secret Sanitizer Utility
 * 
 * Detects and removes secrets from text evidence to prevent storage of sensitive data.
 * This is critical for security compliance - we must never store secrets in our database.
 */

/**
 * Patterns that indicate potential secrets
 */
const SECRET_PATTERNS = [
  // API Keys and Tokens
  /api[_-]?key[_-]?[:=]\s*['"']?([a-zA-Z0-9_\-]{20,})['"']?/gi,
  /api[_-]?token[_-]?[:=]\s*['"']?([a-zA-Z0-9_\-]{20,})['"']?/gi,
  /access[_-]?key[_-]?[:=]\s*['"']?([a-zA-Z0-9_\-]{20,})['"']?/gi,
  /secret[_-]?key[_-]?[:=]\s*['"']?([a-zA-Z0-9_\-]{20,})['"']?/gi,
  /auth[_-]?token[_-]?[:=]\s*['"']?([a-zA-Z0-9_\-]{20,})['"']?/gi,
  
  // Passwords
  /password[_-]?[:=]\s*['"']?([^\s'"]{6,})['"']?/gi,
  /passwd[_-]?[:=]\s*['"']?([^\s'"]{6,})['"']?/gi,
  /pwd[_-]?[:=]\s*['"']?([^\s'"]{6,})['"']?/gi,
  
  // Connection Strings
  /(?:postgres|mysql|mongodb|redis|sqlserver):\/\/[^:]+:([^@]+)@/gi,
  /Server=[^;]+;.*Password=([^;]+)/gi,
  /connectionstring[_-]?[:=]\s*['"']?([^\s'"]+)['"']?/gi,
  
  // AWS Keys
  /AKIA[0-9A-Z]{16}/gi,
  /aws[_-]?secret[_-]?access[_-]?key[_-]?[:=]\s*['"']?([a-zA-Z0-9/+=]{40})['"']?/gi,
  
  // GitHub Tokens
  /gh[ps]_[a-zA-Z0-9]{36,}/gi,
  /github[_-]?token[_-]?[:=]\s*['"']?([a-zA-Z0-9_\-]{20,})['"']?/gi,
  
  // Azure Keys
  /DefaultEndpointsProtocol=https;.*AccountKey=([^;]+)/gi,
  
  // JWT Tokens (eyJ prefix is base64 encoded {"alg"...)
  /eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}/gi,
  
  // Private Keys
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/gi,
  
  // Generic secrets (key-value pairs with "secret" in key)
  /[a-zA-Z0-9_-]*secret[a-zA-Z0-9_-]*[_-]?[:=]\s*['"']?([^\s'"]{10,})['"']?/gi,
  /[a-zA-Z0-9_-]*token[a-zA-Z0-9_-]*[_-]?[:=]\s*['"']?([^\s'"]{20,})['"']?/gi,
  
  // Environment variable secrets
  /export\s+[A-Z_]*(?:SECRET|PASSWORD|TOKEN|KEY)[A-Z_]*=[^\s]+/gi,
  /process\.env\.[A-Z_]*(?:SECRET|PASSWORD|TOKEN|KEY)[A-Z_]*/gi,
];

/**
 * Redaction marker
 */
const REDACTED = '[REDACTED_SECRET]';

/**
 * Sanitize text by removing or redacting secrets
 * 
 * @param text - The text to sanitize
 * @returns Sanitized text with secrets removed/redacted
 */
function sanitizeSecrets(text: string | undefined | null): string {
  if (!text) {
    return '';
  }

  let sanitized = text;

  // Apply all secret patterns
  for (const pattern of SECRET_PATTERNS) {
    sanitized = sanitized.replace(pattern, (match) => {
      // Keep the key name but redact the value
      const colonIndex = match.indexOf(':');
      const equalsIndex = match.indexOf('=');
      const separatorIndex = colonIndex > -1 && colonIndex < equalsIndex ? colonIndex : equalsIndex;
      
      if (separatorIndex > -1) {
        const keyPart = match.substring(0, separatorIndex + 1);
        return `${keyPart} ${REDACTED}`;
      }
      
      return REDACTED;
    });
  }

  return sanitized;
}

/**
 * Sanitize metadata object by recursively removing secrets from all string values
 * 
 * @param metadata - Metadata object with potential secrets
 * @returns Sanitized metadata object
 */
export function sanitizeMetadata(metadata: Record<string, any>): Record<string, any> {
  const sanitized: Record<string, any> = {};

  for (const [key, value] of Object.entries(metadata)) {
    if (typeof value === 'string') {
      sanitized[key] = sanitizeSecrets(value);
    } else if (Array.isArray(value)) {
      sanitized[key] = value.map(item => 
        typeof item === 'string' ? sanitizeSecrets(item) : item
      );
    } else if (value && typeof value === 'object') {
      sanitized[key] = sanitizeMetadata(value);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}
