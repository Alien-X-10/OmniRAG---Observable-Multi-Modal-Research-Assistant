// File: src/config/db.js
import dns from 'node:dns';
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

// Force Google & Cloudflare DNS so Windows/ISP routers don't fail on mongodb+srv:// SRV lookups
dns.setServers(['8.8.8.8', '1.1.1.1']);

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
 * Connects to MongoDB Atlas using a singleton connection pool.
 */
export async function connectDB() {
  if (dbInstance) {
    return dbInstance;
  }

  client = new MongoClient(uri, {
    maxPoolSize: 10,
    minPoolSize: 2,
    serverSelectionTimeoutMS: 5000,
  });

  await client.connect();
  dbInstance = client.db(dbName);
  console.log(`[MongoDB] Connected to database: ${dbName}`);
  return dbInstance;
}

/**
 * Returns the target collection for storing video transcript chunks and vectors.
 */
export async function getChunksCollection() {
  const db = await connectDB();
  return db.collection(collectionName);
}

/**
 * Creates standard B-Tree indexes to guarantee idempotent upserts
 * and fast filtering by video_id.
 */
export async function ensureStandardIndexes() {
  const collection = await getChunksCollection();

  await collection.createIndex({ chunk_id: 1 }, { unique: true });
  await collection.createIndex({ 'video_metadata.video_id': 1 });

  console.log(`[MongoDB] Verified unique index on chunk_id in "${collectionName}"`);
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