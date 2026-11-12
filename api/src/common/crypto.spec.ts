import { randomBytes } from 'node:crypto';
import { CryptoService } from './common.module';

describe('CryptoService', () => {
  beforeAll(() => {
    process.env.DATA_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  });

  it('round-trips and uses a fresh IV each time', () => {
    const c = new CryptoService();
    const a = c.encrypt('Paracetamol 500mg');
    const b = c.encrypt('Paracetamol 500mg');
    expect(a).not.toEqual(b);
    expect(c.decrypt(a)).toBe('Paracetamol 500mg');
    expect(c.decryptJson(c.encryptJson({ x: 1 }))).toEqual({ x: 1 });
  });

  it('detects tampering', () => {
    const c = new CryptoService();
    const parts = c.encrypt('secret').split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => c.decrypt(parts.join('.'))).toThrow();
  });

  it('refuses a bad key', () => {
    process.env.DATA_ENCRYPTION_KEY = 'short';
    expect(() => new CryptoService()).toThrow();
    process.env.DATA_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  });
});
