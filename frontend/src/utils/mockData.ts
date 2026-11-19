import { ColumnMeta } from '../types/domain';

const FIRST_NAMES = [
  'Andi', 'Budi', 'Citra', 'Dewi', 'Eko', 'Fajar', 'Gita', 'Hadi',
  'Indah', 'Joko', 'Kartika', 'Lukman', 'Maya', 'Nugroho', 'Putri', 'Rahmat',
  'Rina', 'Sari', 'Taufik', 'Wahyu', 'Yuni', 'Zaki', 'Dian', 'Reza',
  'Alya', 'Bagas', 'Nadia', 'Rizky', 'Tari', 'Ilham', 'Siti', 'Arif',
  'Alex', 'Daniel', 'Elena', 'Hannah', 'Kevin', 'Liam', 'Oliver', 'Rachel',
  'Ryan', 'Sofia', 'Thomas', 'Chloe', 'Lucas', 'Maya', 'Noah', 'Emma',
];

const LAST_NAMES = [
  'Pratama', 'Santoso', 'Wijaya', 'Kusuma', 'Saputra', 'Hidayat', 'Nugraha', 'Rahayu',
  'Permata', 'Lestari', 'Hakim', 'Siregar', 'Nasution', 'Mahendra', 'Wibowo', 'Utami',
  'Fauzi', 'Ramadhan', 'Setiawan', 'Susanto', 'Hartono', 'Kurniawan', 'Gunawan', 'Putra',
  'Suryadi', 'Prabowo', 'Wulandari', 'Anggraini', 'Purnama', 'Firmansyah', 'Halim', 'Tanjung',
  'Anderson', 'Bennett', 'Carter', 'Davis', 'Evans', 'Foster', 'Garcia', 'Hayes',
  'Johnson', 'Kim', 'Lee', 'Martin', 'Nguyen', 'Patel', 'Rivera', 'Wilson',
];

const EMAIL_DOMAINS = ['gmail.com', 'outlook.com', 'yahoo.com', 'proton.me'];

export interface RowIdentity {
  firstName: string;
  lastName: string;
  fullName: string;
  username: string;
  email: string;
}

function pickRandom<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function slugifyPart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function makeUnique(base: string, suffixPool: (attempt: number) => string, used: Set<string>): string {
  let candidate = base;
  let attempt = 0;
  while (used.has(candidate)) {
    attempt += 1;
    candidate = suffixPool(attempt);
  }
  used.add(candidate);
  return candidate;
}

/**
 * Creates a per-batch identity generator so that `name`, `first_name`, `last_name`,
 * `username`, and `email` in the same row belong to the same natural person and
 * remain unique within the generated batch.
 */
export function createIdentityGenerator(): () => RowIdentity {
  const usedUsernames = new Set<string>();
  const usedEmails = new Set<string>();

  return () => {
    const firstName = pickRandom(FIRST_NAMES);
    const lastName = pickRandom(LAST_NAMES);
    const fullName = `${firstName} ${lastName}`;

    const firstSlug = slugifyPart(firstName);
    const lastSlug = slugifyPart(lastName);
    const sep = Math.random() < 0.5 ? '.' : '_';
    const baseHandle = `${firstSlug}${sep}${lastSlug}`;

    const username = makeUnique(
      baseHandle,
      (attempt) => `${baseHandle}${attempt === 1 ? Math.floor(Math.random() * 90 + 10) : attempt}`,
      usedUsernames
    );

    const domain = pickRandom(EMAIL_DOMAINS);
    const emailLocal = `${firstSlug}.${lastSlug}`;
    const email = makeUnique(
      `${emailLocal}@${domain}`,
      (attempt) => `${emailLocal}${attempt === 1 ? Math.floor(Math.random() * 90 + 10) : attempt}@${domain}`,
      usedEmails
    );

    return { firstName, lastName, fullName, username, email };
  };
}

export function generateMockValue(
  col: ColumnMeta,
  rowIdx: number,
  identity?: RowIdentity
): any {
  const name = col.name.toLowerCase();
  const t = (col.dataType || col.rawType || '').toLowerCase();

  if (t.includes('bool')) {
    return rowIdx % 2 === 0;
  }
  if (t.includes('uuid')) {
    return crypto.randomUUID
      ? crypto.randomUUID()
      : `00000000-0000-4000-8000-${String(rowIdx).padStart(12, '0')}`;
  }
  if (
    t.includes('int') ||
    t.includes('serial') ||
    t.includes('number') ||
    t.includes('numeric') ||
    t.includes('decimal') ||
    t.includes('float') ||
    t.includes('double')
  ) {
    if (name.includes('age')) return 18 + (rowIdx % 50);
    if (name.includes('price') || name.includes('amount')) return Number(((rowIdx + 1) * 12.5).toFixed(2));
    return Math.floor(Math.random() * 10000) + rowIdx;
  }
  if (t.includes('timestamp') || t.includes('datetime')) {
    return new Date(Date.now() - rowIdx * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  }
  if (t.includes('date')) {
    return new Date(Date.now() - rowIdx * 86400 * 1000).toISOString().slice(0, 10);
  }
  if (t.includes('json')) {
    return JSON.stringify({ sample: true, index: rowIdx + 1 });
  }

  const id = identity ?? createIdentityGenerator()();
  if (name.includes('email') || name.includes('e_mail')) return id.email;
  if (name.includes('username') || name.includes('user_name')) return id.username;
  if (name.includes('first') && name.includes('name')) return id.firstName;
  if (name.includes('last') && name.includes('name')) return id.lastName;
  if (name.includes('name') || name === 'nama') return id.fullName;
  if (name.includes('phone')) return `+62812${String(10000000 + rowIdx).slice(0, 8)}`;
  if (name.includes('status')) return ['active', 'pending', 'completed'][rowIdx % 3];
  return `sample_${col.name}_${rowIdx + 1}`;
}
