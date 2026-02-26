import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

/**
 * Serviço de criptografia simétrica (AES-256-GCM) para dados sensíveis.
 * Usado para criptografar API keys armazenadas no banco de dados.
 *
 * A chave de criptografia é derivada de ENCRYPTION_KEY (env) via scrypt.
 * Se ENCRYPTION_KEY não estiver definida, cai em modo plaintext com warning.
 */
@Injectable()
export class CryptoService {
  private readonly logger = new Logger(CryptoService.name);
  private readonly algorithm = 'aes-256-gcm';
  private readonly key: Buffer | null;

  constructor(private readonly configService: ConfigService) {
    const secret = this.configService.get<string>('ENCRYPTION_KEY');
    if (secret) {
      // Derivar chave de 32 bytes via scrypt
      this.key = scryptSync(secret, 'gastocerto-salt', 32);
      this.logger.log('🔒 CryptoService inicializado com ENCRYPTION_KEY');
    } else {
      this.key = null;
      this.logger.warn(
        '⚠️  ENCRYPTION_KEY não definida — dados sensíveis serão armazenados em plaintext',
      );
    }
  }

  /**
   * Criptografa um texto. Retorna "enc:<iv>:<authTag>:<ciphertext>" (hex).
   * Se ENCRYPTION_KEY não estiver definida, retorna o texto original.
   */
  encrypt(plaintext: string): string {
    if (!this.key) return plaintext;

    const iv = randomBytes(12);
    const cipher = createCipheriv(this.algorithm, this.key, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');

    return `enc:${iv.toString('hex')}:${authTag}:${encrypted}`;
  }

  /**
   * Descriptografa um texto previamente criptografado com encrypt().
   * Se o texto não começar com "enc:", retorna como está (plaintext legado).
   */
  decrypt(ciphertext: string): string {
    if (!this.key) return ciphertext;
    if (!ciphertext.startsWith('enc:')) return ciphertext; // plaintext legado

    const parts = ciphertext.split(':');
    if (parts.length !== 4) {
      this.logger.warn('⚠️  Formato de ciphertext inválido, retornando como está');
      return ciphertext;
    }

    const [, ivHex, authTagHex, encrypted] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = createDecipheriv(this.algorithm, this.key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  /**
   * Verifica se um texto já está criptografado.
   */
  isEncrypted(text: string): boolean {
    return text.startsWith('enc:');
  }
}
