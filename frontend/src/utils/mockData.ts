import { ColumnMeta } from '../types/domain';

const FIRST_NAMES = [
  // Indonesian Male & Female Names
  'Andi', 'Budi', 'Citra', 'Dewi', 'Eko', 'Fajar', 'Gita', 'Hadi',
  'Indah', 'Joko', 'Kartika', 'Lukman', 'Maya', 'Nugroho', 'Putri', 'Rahmat',
  'Rina', 'Sari', 'Taufik', 'Wahyu', 'Yuni', 'Zaki', 'Dian', 'Reza',
  'Alya', 'Bagas', 'Nadia', 'Rizky', 'Tari', 'Ilham', 'Siti', 'Arif',
  'Agus', 'Bambang', 'Cahya', 'Dedi', 'Endah', 'Farhan', 'Galih', 'Hendra',
  'Irfan', 'Jihan', 'Kurnia', 'Laras', 'Mulyadi', 'Nanda', 'Oki', 'Pandu',
  'Qori', 'Rangga', 'Shinta', 'Teguh', 'Umar', 'Vina', 'Wulan', 'Yoga',
  'Zahra', 'Aditya', 'Bayu', 'Chandra', 'Dimas', 'Erlangga', 'Febri', 'Gilang',
  'Hafiz', 'Ikhsan', 'Kiki', 'Lutfi', 'Mega', 'Naufal', 'Priska', 'Radit',
  'Satria', 'Tiara', 'Vicky', 'Wira', 'Yusuf', 'Zulfa', 'Anisa', 'Bella',
  'Cindy', 'Desi', 'Elsa', 'Fitri', 'Hana', 'Intan', 'Karina', 'Lia',
  'Melati', 'Nisa', 'Olivia', 'Puspita', 'Ratna', 'Salma', 'Tania', 'Utari',
  'Widya', 'Yasmin', 'Zaskia', 'Akbar', 'Bima', 'Daffa', 'Fikri', 'Guntur',
  'Haris', 'Imam', 'Wildan', 'Rafi', 'Salman', 'Rizal', 'Surya', 'Danu',
  'Wisnu', 'Seno', 'Panji', 'Arya', 'Damar', 'Raka', 'Faris', 'Nabil',
  'Syifa', 'Aulia', 'Nabila', 'Kirana', 'Ayu', 'Lestari', 'Safira', 'Mutia',
  'nadira', 'Amira', 'Hasna', 'Kayla', ' Keisya', 'Talitha', 'almira', 'Kezia',
  // International Names
  'Alex', 'Daniel', 'Elena', 'Hannah', 'Kevin', 'Liam', 'Oliver', 'Rachel',
  'Ryan', 'Sofia', 'Thomas', 'Chloe', 'Lucas', 'Noah', 'Emma', 'Aiden',
  'Benjamin', 'Charlotte', 'David', 'Ethan', 'Grace', 'Henry', 'Isabella', 'Jack',
  'James', 'Lily', 'Mason', 'Mia', 'Nathan', 'Owen', 'Penelope', 'Samuel',
  'Scarlett', 'Sebastian', 'Stella', 'Victoria', 'William', 'Zoe', 'Adrian', 'Arthur',
  'Beatrice', 'Caleb', 'Clara', 'Dominic', 'Eleanor', 'Felix', 'Gabriel', 'Hazel',
  'Isaac', 'Julian', 'Leo', 'Matteo', 'Nora', 'Oscar', 'Ruby', 'Theo',
  'Violet', 'Xavier', 'Zachary', 'Aaron', 'Abigail', 'Adam', 'Alice', 'Amelia',
  'Andrew', 'Anna', 'Anthony', 'Aria', 'Asher', 'Audrey', 'Aurora', 'Austin',
  'Ava', 'Axel', 'Bella', 'Brandon', 'Brooks', 'Camila', 'Carlos', 'Caroline',
  'Carson', 'Christian', 'Christopher', 'Claire', 'Colton', 'Connor', 'Cooper', 'Cora',
  'Declan', 'Delilah', 'Dylan', 'Easton', 'Eli', 'Elias', 'Elijah', 'Elizabeth',
  'Ella', 'Ellie', 'Eloise', 'Emery', 'Emily', 'Eva', 'Evan', 'Evelyn',
  'Everett', 'Ezra', 'Gianna', 'Greyson', 'Hailey', 'Harper', 'Harrison', 'Hudson',
  'Hunter', 'Ian', 'iris', 'Ivy', 'Jackson', 'Jacob', 'Jade', 'Jaxon',
  'Jeremiah', 'John', 'Jonathan', 'Jordan', 'Jose', 'Joseph', 'Joshua', 'Josiah',
  'Julia', 'Kai', 'Kennedy', 'Landon', 'Layla', 'Leah', 'Leonardo', 'Levi',
  'Lincoln', 'Logan', 'Luca', 'Lucy', 'Luke', 'Lydia', 'Madeline', 'Madison',
  'averick', 'Mila', 'Miles', 'Naomi', 'Natalie', 'Nolan', 'Paisley', 'Parker',
  'Piper', 'Quinn', 'Reagan', 'Riley', 'Robert', 'Roman', 'Sadie', 'Samantha',
  'Santiago', 'Sarah', 'Savannah', 'Sawyer', 'Silas', 'Skylar', 'Sophie', 'valentina',
  'Vivian', 'Waylon', 'Wesley', 'Weston', 'Willow', 'Wyatt',
].map((s) => s.trim()).filter(Boolean).map((s) => s.charAt(0).toUpperCase() + s.slice(1));

const MIDDLE_NAMES = [
  'Adi', 'Tri', 'Dwi', 'Eka', 'Sri', 'Nur', 'Putra', 'Putri',
  'Agung', 'Bakti', 'Cipta', 'Dharma', 'Fajar', 'Gemilang', 'Harapan', 'Indra',
  'Jaya', 'Kusuma', 'Laksana', 'Mandala', 'Nusa', 'Pratama', 'Perdana', 'Raya',
  'Satya', 'Tirta', 'Utama', 'Wira', 'Yudha', 'Zain', 'Bagus', 'Candra',
  'Darma', 'Gilang', 'Hakim', 'Iman', 'Jati', 'Karsa', 'Mulya', 'Nata',
  'Panca', 'Rizki', 'Surya', 'Tama', 'Abdi', 'Budi', 'Citra', 'Dewanto',
  'Fadli', 'Gading', 'Hasan', 'Ikhsan', 'Kemal', 'Luhur', 'Mahardika', 'Nugraha',
  'Pramudya', 'Ridwan', 'Sulaiman', 'Taufiq', 'Wahid', 'Yunus', 'Zulkifli', 'Arief',
  'Bayu', 'Danang', 'Farid', 'Ghani', 'Hidayat', 'Ibrahim', 'Jamal', 'Khalid',
  'Malik', 'Nasir', 'Omar', 'Qasim', 'Rashid', 'Saeed', 'Tariq', 'Usman',
  'Alexander', 'James', 'Marie', 'Rose', 'Lee', 'Anne', 'Grace', 'Ray',
  'Lynn', 'Mae', 'Jean', 'Claire', 'Louise', 'Jane', 'Elizabeth', 'Hope',
  'Faith', 'Joy', 'Skye', 'Jude', 'Cole', 'Dean', 'Paul', 'Mark',
  'Luke', 'John', 'Scott', 'Reid', 'Blake', 'Grant', 'Clark', 'Wayne',
];

const LAST_NAMES = [
  // Indonesian Surnames / Family Names
  'Pratama', 'Santoso', 'Wijaya', 'Kusuma', 'Saputra', 'Hidayat', 'Nugraha', 'Rahayu',
  'Permata', 'Lestari', 'Hakim', 'Siregar', 'Nasution', 'Mahendra', 'Wibowo', 'Utami',
  'Fauzi', 'Ramadhan', 'Setiawan', 'Susanto', 'Hartono', 'Kurniawan', 'Gunawan', 'Putra',
  'Suryadi', 'Prabowo', 'Wulandari', 'Anggraini', 'Purnama', 'Firmansyah', 'Halim', 'Tanjung',
  'Adriansyah', 'Budiman', 'Cahyadi', 'Darmawan', 'Effendi', 'Ferdinand', 'Ginting', 'Hardiansyah',
  'Iskandar', 'Jaya', 'Kartawijaya', 'Laksono', 'Mulyono', 'Natsir', 'Oktaviani', 'Pamungkas',
  'Qodir', 'Rajasa', 'Simanjuntak', 'Tampubolon', 'Utomo', 'Wardhana', 'Yudhoyono', 'Zulkarnain',
  'Alamsyah', 'Bachtiar', 'Chaniago', 'Damanik', 'Ernawati', 'Fathurrahman', 'Goldi', 'Handoko',
  'Irawan', 'Jatmiko', 'Kurniasih', 'Lubis', 'Manullang', 'Novanto', 'Pangestu', 'Rahardjo',
  'Sihombing', 'Tobing', 'Wahono', 'Yulianto', 'Zainuddin', 'Abdullah', 'Basri', 'Chairul',
  'Djajadi', 'Fachrudin', 'Ghozali', 'Hamzah', 'Indrawan', 'Junaedi', 'Kusnadi', 'Lesmana',
  'Marpaung', 'Nurhadi', 'Prasetyo', 'Riyadi', 'Subagyo', 'Tarigan', 'Widodo', 'Yuwono',
  'Zuhri', 'Anwar', 'Bakrie', 'Cokro', 'Darwis', 'Fadillah', 'Gumelar', 'Hermawan',
  'Ismail', 'Julianto', 'Kadir', 'Latief', 'Mustafa', 'Nugroho', 'Panjaitan', 'Rustam',
  'Sinaga', 'Thamrin', 'Wicaksono', 'Yacob', 'Zakaria', 'Ardiansyah', 'Hutapea', 'Siahaan',
  'Situmorang', 'Pasaribu', 'Saragih', 'Purba', 'Sembiring', 'Sitepu', 'Barus', 'Harahap',
  'Daulay', 'Hasibuan', 'Ritonga', 'Pohan', 'pane', 'Mandailing', 'Sikumbang', 'Piliang',
  'Koto', 'Guci', 'Caniago', 'Jambak', 'Malayu', 'Bendang', 'Kampai', 'Domo',
  // International Surnames
  'Anderson', 'Bennett', 'Carter', 'Davis', 'Evans', 'Foster', 'Garcia', 'Hayes',
  'Johnson', 'Kim', 'Lee', 'Martin', 'Nguyen', 'Patel', 'Rivera', 'Wilson',
  'Adams', 'Allen', 'Baker', 'Bell', 'Brooks', 'Brown', 'Butler', 'Campbell',
  'Clark', 'Coleman', 'Collins', 'Cook', 'Cooper', 'Cox', 'Cruz', 'Diaz',
  'Edwards', 'Flores', 'Gomez', 'Gonzalez', 'Gray', 'Green', 'Hall', 'Harris',
  'Hernandez', 'Hill', 'Howard', 'Hughes', 'Jackson', 'James', 'Jenkins', 'Jones',
  'Kelly', 'King', 'Lewis', 'Long', 'Lopez', 'Mitchell', 'Moore', 'Morgan',
  'Morris', 'Murphy', 'Nelson', 'Ortiz', 'Parker', 'Perez', 'Perry', 'Peterson',
  'Phillips', 'Powell', 'Price', 'Ramirez', 'Reed', 'Reyes', 'Richardson', 'Roberts',
  'Robinson', 'Rodriguez', 'Rogers', 'Ross', 'Russell', 'Sanchez', 'Sanders', 'Scott',
  'Simmons', 'Smith', 'Stewart', 'Taylor', 'Thomas', 'Thompson', 'Torres', 'Turner',
  'Walker', 'Ward', 'Washington', 'Watson', 'White', 'Williams', 'Wood', 'Wright',
  'Young', 'Zhang', 'Wang', 'Li', 'Liu', 'Chen', 'Yang', 'Huang',
  'Zhao', 'Wu', 'Zhou', 'Sato', 'Suzuki', 'Takahashi', 'Tanaka', 'Watanabe',
  'Ito', 'Yamamoto', 'Nakamura', 'Kobayashi', 'Kato', 'Muller', 'Schmidt', 'Schneider',
  'Fischer', 'Weber', 'Meyer', 'Wagner', 'Becker', 'Schulz', 'Hoffmann', 'Dubois',
].map((s) => s.trim()).filter(Boolean).map((s) => s.charAt(0).toUpperCase() + s.slice(1));

const EMAIL_DOMAINS = [
  'gmail.com',
  'outlook.com',
  'yahoo.com',
  'proton.me',
  'icloud.com',
  'hotmail.com',
  'live.com',
  'zoho.com',
  'fastmail.com',
  'gmx.com',
  'yandex.com',
  'mail.com',
  'aol.com',
  'hey.com',
  'tutanota.com',
  'pm.me',
  'msn.com',
  'me.com',
  'rocketmail.com',
  'inbox.com',
];

export interface RowIdentity {
  firstName: string;
  middleName?: string;
  lastName: string;
  fullName: string;
  username: string;
  email: string;
  phone: string;
}

function pickRandom<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function slugifyPart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function randomDigits(len: number): string {
  let out = '';
  for (let i = 0; i < len; i++) {
    out += Math.floor(Math.random() * 10);
  }
  return out;
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
 * `username`, `email`, and `phone` in the same row belong to the same natural person
 * and remain unique across rows.
 *
 * Combination capacity:
 * - Names: ~260 first * ~112 middle (optional) * ~280 last => > 8.2 million unique full name combinations.
 * - Emails & Usernames: varied separators, middle initials, random numeric tags, and 20 domains => tens of millions of combinations.
 */
export function createIdentityGenerator(): () => RowIdentity {
  const usedFullNames = new Set<string>();
  const usedUsernames = new Set<string>();
  const usedEmails = new Set<string>();
  const usedPhones = new Set<string>();

  const idPrefixes = ['811', '812', '813', '821', '822', '852', '853', '814', '815', '816', '855', '856', '857', '858', '817', '818', '819', '859', '877', '878', '838', '895', '896', '897', '898', '899', '881', '882', '888'];

  return () => {
    let firstName = pickRandom(FIRST_NAMES);
    let lastName = pickRandom(LAST_NAMES);
    // 65% chance to include a middle name from the start so 3-part names are common and provide ~8.2M combinations
    let middleName: string | undefined = Math.random() < 0.65 ? pickRandom(MIDDLE_NAMES) : undefined;
    if (middleName === firstName || middleName === lastName) {
      middleName = pickRandom(MIDDLE_NAMES);
    }

    let baseFullName = middleName ? `${firstName} ${middleName} ${lastName}` : `${firstName} ${lastName}`;

    const fullName = makeUnique(
      baseFullName,
      (attempt) => {
        if (attempt <= 15) {
          firstName = pickRandom(FIRST_NAMES);
          middleName = pickRandom(MIDDLE_NAMES);
          lastName = pickRandom(LAST_NAMES);
          baseFullName = `${firstName} ${middleName} ${lastName}`;
          return baseFullName;
        }
        const extraMiddle = pickRandom(MIDDLE_NAMES);
        return `${firstName} ${middleName || extraMiddle} ${lastName} ${attempt}`;
      },
      usedFullNames
    );

    const firstSlug = slugifyPart(firstName);
    const middleSlug = middleName ? slugifyPart(middleName) : '';
    const lastSlug = slugifyPart(lastName);

    const seps = ['.', '_', ''];
    const sep = pickRandom(seps);
    const numTag = Math.random() < 0.7 ? randomDigits(Math.floor(Math.random() * 3) + 2) : '';
    const midPart = middleSlug && Math.random() < 0.5 ? `${sep}${middleSlug.charAt(0)}` : '';
    const baseHandle = `${firstSlug}${midPart}${sep}${lastSlug}${numTag}`;

    const username = makeUnique(
      baseHandle,
      (attempt) => `${firstSlug}${sep}${lastSlug}${randomDigits(3)}${attempt > 3 ? attempt : ''}`,
      usedUsernames
    );

    const domain = pickRandom(EMAIL_DOMAINS);
    const emailSep = pickRandom(['.', '_', '']);
    const emailMid = middleSlug ? (Math.random() < 0.6 ? `${emailSep}${middleSlug.charAt(0)}` : `${emailSep}${middleSlug}`) : '';
    const emailTag = Math.random() < 0.65 ? randomDigits(Math.floor(Math.random() * 4) + 1) : '';
    const emailLocal = `${firstSlug}${emailMid}${emailSep}${lastSlug}${emailTag}`;

    const email = makeUnique(
      `${emailLocal}@${domain}`,
      (attempt) => `${firstSlug}.${lastSlug}${randomDigits(4)}${attempt > 3 ? attempt : ''}@${pickRandom(EMAIL_DOMAINS)}`,
      usedEmails
    );

    const prefix = pickRandom(idPrefixes);
    const phone = makeUnique(
      `+62${prefix}${randomDigits(8)}`,
      () => `+62${pickRandom(idPrefixes)}${randomDigits(8)}`,
      usedPhones
    );

    return { firstName, middleName, lastName, fullName, username, email, phone };
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
  if (t === 'objectid' || t === 'oid') {
    const ts = Math.floor(Date.now() / 1000).toString(16).padStart(8, '0');
    const rand = Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    return `${ts}${rand}`;
  }
  if (t === 'point_id' || t.includes('uuid')) {
    return crypto.randomUUID
      ? crypto.randomUUID()
      : `00000000-0000-4000-8000-${String(rowIdx + 1).padStart(12, '0')}`;
  }
  if (t === 'sparse_vector' || t.includes('sparse')) {
    const indices = Array.from({ length: 4 }, (_, i) => (rowIdx * 7 + i * 13 + 1) % 1000);
    const values = indices.map(() => Number((Math.random() * 0.9 + 0.1).toFixed(4)));
    return JSON.stringify({ indices, values });
  }
  if (t.startsWith('vector') || (col.rawType || '').toLowerCase() === 'vector') {
    const dimMatch = t.match(/vector\s*\(\s*(\d+)/);
    const dims = dimMatch ? Math.max(1, Number(dimMatch[1])) : 4;
    const genNormVec = () => {
      if (t.includes('uint8')) {
        return Array.from({ length: dims }, () => Math.floor(Math.random() * 256));
      }
      const raw = Array.from({ length: dims }, () => Number((Math.random() * 2 - 1).toFixed(4)));
      const norm = Math.sqrt(raw.reduce((acc, v) => acc + v * v, 0)) || 1;
      return raw.map((v) => Number((v / norm).toFixed(4)));
    };
    if (t.includes('multi')) {
      return JSON.stringify([genNormVec(), genNormVec()]);
    }
    return JSON.stringify(genNormVec());
  }
  if (
    t.includes('int') ||
    t.includes('serial') ||
    t.includes('number') ||
    t.includes('numeric') ||
    t.includes('decimal') ||
    t.includes('float') ||
    t.includes('double') ||
    t === 'long' ||
    t === 'unsigned_long' ||
    t === 'short' ||
    t === 'byte'
  ) {
    if (name.includes('age')) return 18 + (rowIdx % 50);
    if (name.includes('price') || name.includes('amount')) return Number(((rowIdx + 1) * 12.5).toFixed(2));
    return Math.floor(Math.random() * 10000) + rowIdx;
  }
  if (t === 'geo_point') {
    return JSON.stringify({
      lat: Number((37.7749 + (rowIdx % 50) * 0.01).toFixed(4)),
      lon: Number((-122.4194 + (rowIdx % 50) * 0.01).toFixed(4)),
    });
  }
  if (t === 'ip') {
    return `192.168.${(rowIdx % 254) + 1}.${((rowIdx * 7) % 253) + 1}`;
  }
  if (t === 'decimal128') {
    return Number(((rowIdx + 1) * 12.5).toFixed(2));
  }
  if (t === 'array') {
    return [`tag_${(rowIdx % 5) + 1}`, `item_${rowIdx + 1}`];
  }
  if (t === 'object') {
    return { sample: true, index: rowIdx + 1 };
  }
  if (t === 'date') {
    return new Date(Date.now() - rowIdx * 3600 * 1000).toISOString();
  }
  if (t.includes('timestamp') || t.includes('datetime')) {
    const jitterMs = Math.floor(Math.random() * 3600 * 1000);
    return new Date(Date.now() - rowIdx * 3600 * 1000 - jitterMs).toISOString().slice(0, 19).replace('T', ' ');
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
  if (name.includes('middle') && name.includes('name')) return id.middleName || '';
  if (name.includes('last') && name.includes('name')) return id.lastName;
  if (name.includes('name') || name === 'nama') return id.fullName;
  if (name.includes('phone') || name.includes('telp') || name.includes('hp') || name.includes('mobile')) return id.phone;
  if (name.includes('status')) return ['active', 'pending', 'completed'][rowIdx % 3];
  return `sample_${col.name}_${rowIdx + 1}_${randomDigits(4)}`;
}
