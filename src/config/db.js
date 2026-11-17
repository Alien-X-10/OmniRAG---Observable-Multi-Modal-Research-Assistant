// File: src/config/db.js
import dns from 'node:dns';
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

// Force Google & Cloudflare DNS and prioritize IPv4 so Windows/ISP routers don't stall on SRV/IPv6 lookups
dns.setServers(['8.8.8.8', '1.1.1.1']);
if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
}

dotenv.config({ quiet: true });

const uri = process.env.MONGODB_URI;
const dbName = process.env.DB_NAME || 'omnirag';
const collectionName = process.env.COLLECTION_NAME || 'video_chunks';

if (!uri) {
  throw new Error('Missing MONGODB_URI in .env file.');
}

let client = null;
let dbInstance = null;

/**
 * Connects to MongoDB Atlas using a singleton connection pool with IPv4 & retry resilience.
 */
export async function connectDB(retries = 3) {
  if (dbInstance) {
    return dbInstance;
  }

  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      client = new MongoClient(uri, {
        maxPoolSize: 10,
        minPoolSize: 1,
        serverSelectionTimeoutMS: 30000,
        connectTimeoutMS: 30000,
        socketTimeoutMS: 45000,
        family: 4, // Force IPv4 sockets to avoid Node v24 dual-stack handshake timeouts
      });

      await client.connect();
      dbInstance = client.db(dbName);
      console.log(`[MongoDB] Connected to database: ${dbName}`);
      return dbInstance;
    } catch (err) {
      lastErr = err;
      console.warn(
        `[MongoDB] Connection attempt ${attempt}/${retries} timed out, retrying...`
      );
      if (client) {
        await client.close().catch(() => {});
        client = null;
      }
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
  }

  throw lastErr;
}

/**
 * Returns the target collection for storing video transcript and PDF chunks.
 */
export async function getChunksCollection() {
  const db = await connectDB();
  return db.collection(collectionName);
}

/**
 * Creates standard B-Tree indexes to guarantee idempotent upserts
 * and fast filtering by video_id.
 */
// export async function ensureStandardIndexes() {
//   const collection = await getChunksCollection();

//   await collection.createIndex({ chunk_id: 1 }, { unique: true });
//   await collection.createIndex({ 'video_metadata.video_id': 1 });

//   console.log(`[MongoDB] Verified unique index on chunk_id in "${collectionName}"`);
// }
export async function ensureStandardIndexes() {
  const collection = await getChunksCollection();

  // Drop legacy global unique index so different users can ingest the same video/PDF independently
  try {
    await collection.dropIndex('chunk_id_1');
  } catch {
    // Ignore if already removed
  }

  // Enforce per-user uniqueness on (user_id, chunk_id)
  await collection.createIndex({ user_id: 1, chunk_id: 1 }, { unique: true });

  // Speed up per-user corpus listing, retrieval filtering, and deletion
  await collection.createIndex({ user_id: 1, 'video_metadata.video_id': 1 });

  console.log(`[MongoDB] Verified per-user compound indexes in "${collectionName}"`);
}

/**
 * Gracefully closes the database connection.
 */
export async function closeDB() {
  if (client) {
    await client.close();
    client = null;
    dbInstance = null;
    console.log('[MongoDB] Connection closed.');
  }
}