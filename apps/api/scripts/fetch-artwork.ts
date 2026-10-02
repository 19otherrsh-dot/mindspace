import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/db/pool.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '../public/artwork');

// A list of high-quality, calm, royalty-free Unsplash images to use as placeholders.
const UNSPLASH_IMAGES = [
  'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800&q=80', // Beach
  'https://images.unsplash.com/photo-1518173946687-a4c8892bbd9f?w=800&q=80', // Nature
  'https://images.unsplash.com/photo-1472214103451-9374bd1c798e?w=800&q=80', // Hills
  'https://images.unsplash.com/photo-1444084316824-dc26d6657664?w=800&q=80', // Calm water
  'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=800&q=80', // Mountains
  'https://images.unsplash.com/photo-1470071131384-001b85755536?w=800&q=80', // Forest
  'https://images.unsplash.com/photo-1426604966848-d7adac402bff?w=800&q=80', // Beautiful view
  'https://images.unsplash.com/photo-1475924156734-496f6cac6ec1?w=800&q=80', // Sunrise
];

async function downloadImage(url: string, destPath: string) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch: ${response.statusText}`);
    const arrayBuffer = await response.arrayBuffer();
    await fs.writeFile(destPath, Buffer.from(arrayBuffer));
  } catch (err) {
    console.error(`Failed to download ${url} to ${destPath}`, err);
  }
}

async function main() {
  console.log('Fetching artwork placeholders...');
  
  // Ensure the public/artwork directory exists
  await fs.mkdir(PUBLIC_DIR, { recursive: true });

  // Gather all unique artwork URLs from the database
  const resSessions = await pool.query<{ artwork_url: string }>('SELECT DISTINCT artwork_url FROM sessions WHERE artwork_url IS NOT NULL');
  const resCourses = await pool.query<{ artwork_url: string }>('SELECT DISTINCT artwork_url FROM courses WHERE artwork_url IS NOT NULL');
  const resCollections = await pool.query<{ hero_artwork_url: string }>('SELECT DISTINCT hero_artwork_url FROM collections WHERE hero_artwork_url IS NOT NULL');

  const allUrls = [
    ...resSessions.rows.map(r => r.artwork_url),
    ...resCourses.rows.map(r => r.artwork_url),
    ...resCollections.rows.map(r => r.hero_artwork_url),
  ];

  const uniqueUrls = Array.from(new Set(allUrls));
  console.log(`Found ${uniqueUrls.length} unique artwork URLs in the database.`);

  let i = 0;
  for (const dbUrl of uniqueUrls) {
    // dbUrl is like https://cdn.mindspace.example.com/artwork/slug-color.jpg
    // or http://localhost:4000/public/artwork/slug-color.jpg
    const urlObj = new URL(dbUrl);
    const filename = path.basename(urlObj.pathname);
    const destPath = path.join(PUBLIC_DIR, filename);

    // Skip if already exists
    try {
      await fs.access(destPath);
      continue;
    } catch {
      // File doesn't exist, proceed to download
    }

    const sourceUrl = UNSPLASH_IMAGES[i % UNSPLASH_IMAGES.length];
    console.log(`Downloading ${filename} from Unsplash...`);
    await downloadImage(sourceUrl, destPath);
    
    // Add a small delay to avoid rate-limiting if using a real API
    await new Promise(r => setTimeout(r, 100));
    i++;
  }

  console.log('Finished fetching artwork.');
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
