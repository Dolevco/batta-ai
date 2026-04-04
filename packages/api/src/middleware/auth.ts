import { Request, Response, NextFunction } from 'express';
import jwt, { JwtPayload } from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';

export interface AuthContext {
  userId: string;
  tenantId: string;
  email?: string;
  name?: string;
}

// Extend Express Request to include auth context
declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

// Configuration for JWT validation
interface JWTConfig {
  issuer?: string;
  audience?: string;
  jwksUri?: string;
  entraEnabled?: boolean;
  entraTenantId?: string;
}

// Load configuration from environment variables
const jwtConfig: JWTConfig = {
  issuer: process.env.JWT_ISSUER,
  audience: process.env.JWT_AUDIENCE,
  jwksUri: process.env.JWKS_URI,
  entraEnabled: process.env.ENTRA_ENABLED === 'true',
  entraTenantId: process.env.ENTRA_TENANT_ID,
};

// Cache for JWKS clients (one per issuer)
const jwksClients = new Map<string, jwksClient.JwksClient>();

/**
 * Get or create a JWKS client for the given issuer
 */
export function getJwksClient(jwksUri: string): jwksClient.JwksClient {
  if (!jwksClients.has(jwksUri)) {
    const client = jwksClient({
      jwksUri,
      cache: true,
      cacheMaxAge: 600000, // 10 minutes
      rateLimit: true,
      jwksRequestsPerMinute: 10,
    });
    jwksClients.set(jwksUri, client);
  }
  return jwksClients.get(jwksUri)!;
}

/**
 * Verify and decode JWT token with signature validation.
 * Returns the verified payload, or null if validation fails.
 */
export async function verifyJWT(token: string): Promise<JwtPayload | null> {
  try {
    // Decode token to get header and issuer
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded || typeof decoded === 'string') {
      return null;
    }
    const { header, payload } = decoded;
    if (!payload || typeof payload === 'string') {
      return null;
    }
    const issuer = payload.iss as string;
    if (!issuer) {
      console.error('JWT missing issuer claim');
      return null;
    }
    // Determine JWKS URI and issuer for validation
    let jwksUri: string;
    let issuerToValidate = issuer;
    if (issuer.includes('login.microsoftonline.com')) {
      const tenantMatch = issuer.match(/\/([a-f0-9-]+)\/?$/);
      const tenantId = tenantMatch ? tenantMatch[1] : jwtConfig.entraTenantId || 'common';
      jwksUri = `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`;
    } else if (jwtConfig.jwksUri) {
      jwksUri = jwtConfig.jwksUri;
    } else {
      jwksUri = `${issuer}/.well-known/jwks.json`;
    }
    const client = getJwksClient(jwksUri);
    // Use callback-based getKey for jwt.verify
    function getKey(header: any, callback: any) {
      client.getSigningKey(header.kid, function (err: any, key: any) {
        if (err) {
          callback(err, null);
        } else {
          const signingKey = key.getPublicKey();
          callback(null, signingKey);
        }
      });
    }
    
    const alg = header.alg || 'RS256';
    const verifyOptions: jwt.VerifyOptions = {
      algorithms: [alg as jwt.Algorithm],
      issuer: issuerToValidate,
      //audience:
    };

    // Wrap jwt.verify in a Promise
    return await new Promise((resolve, reject) => {
      jwt.verify(token, getKey, verifyOptions, (err: any, decoded: any) => {
        if (err) {
          console.error('JWT verification failed:', err);
          resolve(null);
        } else {
          resolve(decoded);
        }
      });
    });
  } catch (error) {
    console.error('JWT verification failed:', error);
    return null;
  }
}

/**
 * Decode JWT without verification (for development/testing only)
 * WARNING: This should only be used in development environments
 */
function decodeJWTUnsafe(token: string): any {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }
    
    const payload = parts[1];
    const decoded = Buffer.from(payload, 'base64').toString('utf8');
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

/**
 * Authentication middleware that extracts user and tenant information from JWT bearer token
 * Validates JWT signature using JWKS
 * 
 * Expected JWT payload structure:
 * {
 *   "sub": "user-id" or "oid": "user-id" (for Entra),
 *   "tid": "tenant-id" (for Entra) or "org_id": "org-id" or "tenantId": "tenant-id",
 *   "email": "user@example.com",
 *   "name": "User Name"
 * }
 */
export async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid authorization header' });
    return;
  }

  const token = authHeader.substring(7); // Remove 'Bearer ' prefix
  
  if (!token) {
    res.status(401).json({ error: 'Missing token' });
    return;
  }

  // Check if we should skip validation (dev/testing only)
  const skipValidation = process.env.JWT_SKIP_VALIDATION === 'true';
  
  let payload: any;
  
  if (skipValidation) {
    console.warn('WARNING: JWT signature validation is disabled. This should only be used in development!');
    payload = decodeJWTUnsafe(token);
  } else {
    // Verify JWT with signature validation
    payload = await verifyJWT(token);
  }

  if (!payload) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  // Extract user ID - support both standard 'sub' and Entra's 'oid'
  const userId = payload.oid || payload.sub;
  if (!userId) {
    res.status(401).json({ error: 'Token missing user ID (sub or oid claim)' });
    return;
  }

  // Extract tenant/org ID - support multiple claim names
  // 'tid' is used by Microsoft Entra ID
  const tenantId = payload.tid || payload.org_id || payload.tenantId || payload.orgId;
  if (!tenantId) {
    res.status(401).json({ error: 'Token missing tenant ID' });
    return;
  }

  // Attach auth context to request
  // Cast via unknown: the REST middleware uses AuthContext (userId, tenantId, email, name)
  // while the MCP bearer middleware sets the full AuthInfo shape. Both are stored on
  // req.auth; REST controllers access only the AuthContext subset.
  (req as unknown as { auth: AuthContext }).auth = {
    userId,
    tenantId,
    email: payload.email || payload.preferred_username || payload.upn,
    name: payload.name,
  };

  next();
}