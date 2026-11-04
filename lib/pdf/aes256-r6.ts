import { createCipheriv, createHash, randomBytes } from 'crypto';

const HASH_BY_REMAINDER = ['sha256', 'sha384', 'sha512'] as const;
const SALT_BYTES = 8;

/** ISO 32000-2 Algorithm 2.B: the iterated hash behind every AES-256 R6 password entry. */
export function hashR6Password(password: Buffer, salt: Buffer, userEntry: Buffer = Buffer.alloc(0)): Buffer {
  let k = createHash('sha256').update(password).update(salt).update(userEntry).digest();
  let e = Buffer.alloc(0);
  for (let round = 0; round < 64 || e[e.length - 1] > round - 32; round++) {
    const k1 = Buffer.concat([password, k, userEntry]);
    const cipher = createCipheriv('aes-128-cbc', k.subarray(0, 16), k.subarray(16, 32)).setAutoPadding(false);
    e = Buffer.concat([cipher.update(Buffer.concat(new Array(64).fill(k1))), cipher.final()]);
    // The first 16 bytes of E as a big-endian integer, mod 3; 256 = 1 (mod 3), so the byte sum has the same remainder.
    let remainder = 0;
    for (let i = 0; i < 16; i++) {
      remainder += e[i];
    }
    k = createHash(HASH_BY_REMAINDER[remainder % 3]).update(e).digest();
  }
  return k.subarray(0, 32);
}

function wrapFileKey(fileKey: Buffer, keyEncryptionKey: Buffer): Buffer {
  const cipher = createCipheriv('aes-256-cbc', keyEncryptionKey, Buffer.alloc(16)).setAutoPadding(false);
  return Buffer.concat([cipher.update(fileKey), cipher.final()]);
}

export interface R6PasswordEntries {
  U: Buffer;
  UE: Buffer;
  O: Buffer;
  OE: Buffer;
}

/** The /U, /UE, /O and /OE entries (ISO 32000-2 Algorithms 8 and 9) that unlock `fileKey`. */
export function r6PasswordEntries(userPassword: Buffer, ownerPassword: Buffer, fileKey: Buffer): R6PasswordEntries {
  const [userValidationSalt, userKeySalt, ownerValidationSalt, ownerKeySalt] = [0, 1, 2, 3].map(() => randomBytes(SALT_BYTES));

  const U = Buffer.concat([hashR6Password(userPassword, userValidationSalt), userValidationSalt, userKeySalt]);
  const UE = wrapFileKey(fileKey, hashR6Password(userPassword, userKeySalt));
  const O = Buffer.concat([hashR6Password(ownerPassword, ownerValidationSalt, U), ownerValidationSalt, ownerKeySalt]);
  const OE = wrapFileKey(fileKey, hashR6Password(ownerPassword, ownerKeySalt, U));

  return { U, UE, O, OE };
}
