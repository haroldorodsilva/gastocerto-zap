/**
 * Payload decodificado do JWT
 */
export interface JwtPayload {
  sub: string; // userId
  email: string;
  role: 'USER' | 'ADMIN' | 'MASTER';
  iat: number;
  exp: number;
}

/**
 * Resposta da validação de JWT
 */
export interface JwtValidationResponse {
  valid: boolean;
  payload?: JwtPayload;
  error?: string;
}

/**
 * User info retornado pela API após validação
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  role: 'USER' | 'ADMIN' | 'MASTER';
}
