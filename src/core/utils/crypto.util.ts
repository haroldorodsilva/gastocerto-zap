import * as crypto from 'crypto';

/**
 * Utilitário para operações criptográficas
 */
export class CryptoUtil {
  /**
   * Gera assinatura HMAC-SHA256 para validação de requests
   * @param payload - Dados a serem assinados
   * @param secret - Chave secreta
   * @returns Assinatura em hexadecimal
   */
  static signRequest(payload: string | object, secret: string): string {
    const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return crypto.createHmac('sha256', secret).update(data).digest('hex');
  }

  /**
   * Verifica assinatura HMAC
   * @param payload - Dados a serem verificados
   * @param signature - Assinatura recebida
   * @param secret - Chave secreta
   * @returns true se assinatura é válida
   */
  static verifySignature(payload: string | object, signature: string, secret: string): boolean {
    const expectedSignature = this.signRequest(payload, secret);
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
  }

  /**
   * Gera hash SHA256
   * @param data - Dados a serem hasheados
   * @returns Hash em hexadecimal
   */
  static hash(data: string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * Gera token aleatório
   * @param length - Tamanho em bytes (padrão: 32)
   * @returns Token em hexadecimal
   */
  static generateToken(length = 32): string {
    return crypto.randomBytes(length).toString('hex');
  }

  /**
   * Encripta dados com AES-256-GCM
   * @param data - Dados a serem encriptados
   * @param key - Chave de encriptação (32 bytes)
   * @returns Objeto com iv, encryptedData e authTag
   */
  static encrypt(
    data: string,
    key: string,
  ): { iv: string; encryptedData: string; authTag: string } {
    // Garantir que a chave tenha 32 bytes
    const keyBuffer = crypto.createHash('sha256').update(key).digest();

    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', keyBuffer, iv);

    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    return {
      iv: iv.toString('hex'),
      encryptedData: encrypted,
      authTag: authTag.toString('hex'),
    };
  }

  /**
   * Decripta dados encriptados com AES-256-GCM
   * @param encryptedData - Dados encriptados
   * @param iv - Vetor de inicialização
   * @param authTag - Tag de autenticação
   * @param key - Chave de decriptação
   * @returns Dados decriptados
   */
  static decrypt(encryptedData: string, iv: string, authTag: string, key: string): string {
    const keyBuffer = crypto.createHash('sha256').update(key).digest();

    const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuffer, Buffer.from(iv, 'hex'));

    decipher.setAuthTag(Buffer.from(authTag, 'hex'));

    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  /**
   * Gera par de chaves RSA
   * @returns Objeto com publicKey e privateKey
   */
  static generateKeyPair(): { publicKey: string; privateKey: string } {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem',
      },
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem',
      },
    });

    return { publicKey, privateKey };
  }

  /**
   * Cria timestamp com tolerância para validação de requests
   * @param toleranceSeconds - Tolerância em segundos (padrão: 300 = 5 minutos)
   * @returns Timestamp atual
   */
  static createTimestamp(): number {
    return Math.floor(Date.now() / 1000);
  }

  /**
   * Valida timestamp contra replay attacks
   * @param timestamp - Timestamp recebido
   * @param toleranceSeconds - Tolerância em segundos
   * @returns true se timestamp é válido
   */
  static validateTimestamp(timestamp: number, toleranceSeconds = 300): boolean {
    const now = this.createTimestamp();
    const diff = Math.abs(now - timestamp);
    return diff <= toleranceSeconds;
  }
}
