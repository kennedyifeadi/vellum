import { createDecipheriv } from 'crypto';
import { hashR6Password, r6PasswordEntries } from '../lib/pdf/aes256-r6';

// Generated once with pikepdf 10.13.0 (libqpdf 12.3.2), independent of this code:
//   pdf = pikepdf.new(); pdf.add_blank_page()
//   pdf.save(out, encryption=pikepdf.Encryption(user=pw, owner=pw, R=6))
// /U, /O, /UE and /OE were read from the saved file, and fileKey from
// pikepdf.open(out, password=pw).encryption.encryption_key.
const QPDF_VECTORS = [
  {
    password: 'correct horse battery',
    U: '2e492eb7b876da4f4bd4c8e067c26edf30f00a818d2a1c3a4b009225711ee2b54a3c54b44d58032fdf85bbc01e6c6b0e',
    O: '3ee17f90d6aa023b55ade6ec391045fa38ca0d94ab563b1b1e71f961b81ada2ba9b518b4648c6c4337f7775073cf8083',
    UE: '5eb6a369f0937ef5c1b349aefe4f72665997117b974cdf45e16c48bcfba5db7d',
    OE: '7e0659cc5167475f9283c3d6499bbb65d2aa4b32708ca3121e44d29fefb49daf',
    fileKey: 'be65e28e571d25367b6fee3434b6037854db85ac0f81493f338ca70736ed7832',
  },
  {
    password: 'pässwörd-é\u{1F600}',
    U: '1ad9591f97cc194bc17ba45bb3e28b370277642c6838e734be1b14e3dd1a4a9d10f75f47218cad9dabef32f715a4f646',
    O: 'd29c3df38b6394a8d85fc58d907e35e3fbe6a9f310526c84048d3ab6d045416d3aced73c2f5644e8ba44e0435afaa97c',
    UE: 'e5e21ee7f823b96b526a1aef506d521d81d69c79b0c19d48342453f0b5f1fb20',
    OE: '15cd9eaf32bfba879a5b0d0774dcf0dbfa0b191b62a3c6eb9290985bf000e861',
    fileKey: '92e034994e5d87c2afbb7b5dfb7c0360dca79e6d5fa0cde6bd4c570281467c01',
  },
];

function unwrapFileKey(wrapped: Buffer, keyEncryptionKey: Buffer): Buffer {
  const decipher = createDecipheriv('aes-256-cbc', keyEncryptionKey, Buffer.alloc(16)).setAutoPadding(false);
  return Buffer.concat([decipher.update(wrapped), decipher.final()]);
}

// What a reader does with a password: check it against /U (or /O), then unwrap the file
// key from /UE (or /OE) with the key-salt hash.
function unlock(entries: { U: Buffer; O: Buffer; UE: Buffer; OE: Buffer }, password: Buffer) {
  const { U, O } = entries;
  const user = hashR6Password(password, U.subarray(32, 40)).equals(U.subarray(0, 32))
    ? unwrapFileKey(entries.UE, hashR6Password(password, U.subarray(40, 48)))
    : null;
  const owner = hashR6Password(password, O.subarray(32, 40), U).equals(O.subarray(0, 32))
    ? unwrapFileKey(entries.OE, hashR6Password(password, O.subarray(40, 48), U))
    : null;
  return { user, owner };
}

const hex = (value: string) => Buffer.from(value, 'hex');

describe('hashR6Password (ISO 32000-2 Algorithm 2.B)', () => {
  it.each(QPDF_VECTORS)('reproduces the entries qpdf wrote for $password', (vector) => {
    const entries = { U: hex(vector.U), O: hex(vector.O), UE: hex(vector.UE), OE: hex(vector.OE) };

    const { user, owner } = unlock(entries, Buffer.from(vector.password, 'utf8'));

    expect(user?.toString('hex')).toBe(vector.fileKey);
    expect(owner?.toString('hex')).toBe(vector.fileKey);
  });

  it('does not accept a wrong password against qpdf entries', () => {
    const [vector] = QPDF_VECTORS;
    const entries = { U: hex(vector.U), O: hex(vector.O), UE: hex(vector.UE), OE: hex(vector.OE) };

    expect(unlock(entries, Buffer.from('correct horse batterz'))).toEqual({ user: null, owner: null });
  });
});

describe('r6PasswordEntries', () => {
  const fileKey = hex(QPDF_VECTORS[0].fileKey);

  it('builds entries that unlock the file key with the user and owner passwords', () => {
    const entries = r6PasswordEntries(Buffer.from('user secret'), Buffer.from('owner secret'), fileKey);

    expect(entries.U).toHaveLength(48);
    expect(entries.O).toHaveLength(48);
    expect(entries.UE).toHaveLength(32);
    expect(entries.OE).toHaveLength(32);
    expect(unlock(entries, Buffer.from('user secret'))).toEqual({ user: fileKey, owner: null });
    expect(unlock(entries, Buffer.from('owner secret'))).toEqual({ user: null, owner: fileKey });
  });

  it('salts every call, so the same password never gives the same entries twice', () => {
    const password = Buffer.from('same password');

    const first = r6PasswordEntries(password, password, fileKey);
    const second = r6PasswordEntries(password, password, fileKey);

    expect(first.U.equals(second.U)).toBe(false);
    expect(first.O.equals(second.O)).toBe(false);
  });
});
