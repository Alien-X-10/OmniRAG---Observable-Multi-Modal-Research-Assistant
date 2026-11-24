// File: src/config/db.js
import dns from 'node:dns';
import net from 'node:net';
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

// Force Google & Cloudflare DNS and IPv4 so Windows/mobile NAT routers don't stall
dns.setServers(['8.8.8.8', '1.1.1.1']);
if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
}
if (typeof net.setDefaultAutoSelectFamily === 'function') {
  net.setDefaultAutoSelectFamily(false);
}

dotenv.config({ quiet: true });

const uri = process.env.MONGODB_URI;
const dbName = process.env.DB_NAME || 'omnirag';
const collectionName = process.env.COLLECTION_NAME || 'video_chunks';
const telemetryCollectionName = 'telemetry_logs';

if (!uri) {
  throw new Error('Missing MONGODB_URI in .env file.');
}

let client = null;
let dbInstance = null;

/**
 * Connects to MongoDB Atlas using an idle-safe IPv4 connection pool.
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
        minPoolSize: 0,              // Avoid holding idle sockets open across NAT drops
        maxIdleTimeMS: 20000,        // Recycle idle sockets after 20s
        heartbeatFrequencyMS: 10000, // Detect dropped connections faster
        serverSelectionTimeoutMS: 20000,
        connectTimeoutMS: 15000,
        socketTimeoutMS: 20000,      // Fail fast instead of hanging 45s on a dead socket
        retryReads: true,
        retryWrites: true,
        family: 4,                   // Force IPv4 sockets on Node v24
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
 * Returns the target collection for storing per-request RAG telemetry traces.
 */
export async function getTelemetryCollection() {
  const db = await connectDB();
  return db.collection(telemetryCollectionName);
}

/**
 * Creates per-user B-Tree compound indexes and 24h guest TTL index on video_chunks.
 */
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

  // Automatically purge expired guest documents (registered user docs omit expires_at)
  await collection.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 });

  console.log(`[MongoDB] Verified per-user compound & TTL indexes in "${collectionName}"`);
}

/**
 * Creates per-user query history index and 24h guest TTL index on telemetry_logs.
 */
export async function ensureTelemetryIndexes() {
  const collection = await getTelemetryCollection();

  await collection.createIndex({ user_id: 1, timestamp: -1 });
  await collection.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 });

  console.log(`[MongoDB] Verified query & TTL indexes in "${telemetryCollectionName}"`);
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