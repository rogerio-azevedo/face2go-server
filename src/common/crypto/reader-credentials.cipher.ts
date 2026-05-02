import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
/** Chave AES-256: 32 bytes = 64 caracteres hex. */
export const READER_ENCRYPTION_KEY_HEX_LENGTH = 64;

/**
 * Valida formato da chave de ambiente; não reter chave em instância longa se preferir só ConfigService.
 */
export function assertReaderEncryptionKeyHex(keyHex: string | undefined): void {
  if (keyHex == null || keyHex.trim() === '') {
    throw new Error('READER_ENCRYPTION_KEY é obrigatória.');
  }
  if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) {
    throw new Error(
      'READER_ENCRYPTION_KEY deve ter exatamente 64 caracteres hexadecimais (32 bytes).',
    );
  }
}

function keyBufferFromHex(keyHex: string): Buffer {
  assertReaderEncryptionKeyHex(keyHex);
  return Buffer.from(keyHex, 'hex');
}

export type ReaderCredentialsCipher = {
  encrypt(plaintext: string): string;
  decrypt(stored: string): string;
};

/**
 * AES-256-GCM. Formato persistido: `ivHex:authTagHex:ciphertextHex` (cada parte em hex).
 */
export function createReaderCredentialsCipher(
  encryptionKeyHex: string,
): ReaderCredentialsCipher {
  const key = keyBufferFromHex(encryptionKeyHex);

  return {
    encrypt(plaintext: string): string {
      const iv = randomBytes(IV_LENGTH);
      const cipher = createCipheriv(ALGORITHM, key, iv, {
        authTagLength: AUTH_TAG_LENGTH,
      });
      const ciphertext = Buffer.concat([
        cipher.update(plaintext, 'utf8'),
        cipher.final(),
      ]);
      const authTag = cipher.getAuthTag();
      return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
    },

    decrypt(stored: string): string {
      const parts = stored.split(':');
      if (parts.length !== 3) {
        throw new Error('Payload criptografado inválido (formato esperado iv:tag:data).');
      }
      const [ivHex, tagHex, dataHex] = parts;
      const iv = Buffer.from(ivHex, 'hex');
      const authTag = Buffer.from(tagHex, 'hex');
      const data = Buffer.from(dataHex, 'hex');
      const decipher = createDecipheriv(ALGORITHM, key, iv, {
        authTagLength: AUTH_TAG_LENGTH,
      });
      decipher.setAuthTag(authTag);
      return Buffer.concat([decipher.update(data), decipher.final()]).toString(
        'utf8',
      );
    },
  };
}
