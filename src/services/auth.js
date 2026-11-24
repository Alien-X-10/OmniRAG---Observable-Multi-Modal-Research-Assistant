// File: src/services/auth.js
import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import {
  connectDB,
  getChunksCollection,
  getTelemetryCollection,
} from '../config/db.js';

dotenv.config({ quiet: true });

const USERS_COLLECTION = 'users';
const SALT_ROUNDS = 10;
const JWT_SECRET = process.env.JWT_SECRET || 'omnirag-super-secret-jwt-key-2026';
const JWT_EXPIRES_IN = '24h';
const GUEST_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Returns the MongoDB "users" collection and ensures a unique index on email.
 */
export async function getUsersCollection() {
  const db = await connectDB();
  const collection = db.collection(USERS_COLLECTION);
  await collection.createIndex({ email: 1 }, { unique: true });
  return collection;
}

/**
 * 1. Register a New User
 * Checks for duplicates, salts + hashes the password, stores the user in MongoDB,
 * and returns a signed JWT.
 */
// export async function registerUser(email, password) {
//   const normalizedEmail = email.toLowerCase().trim();
//   const users = await getUsersCollection();

//   const existingUser = await users.findOne({ email: normalizedEmail });
//   if (existingUser) {
//     throw new Error('An account with this email already exists.');
//   }

//   // Automatically generates a unique random salt and hashes the password
//   const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

//   const newUserDoc = {
//     email: normalizedEmail,
//     password_hash: passwordHash,
//     auth_provider: 'local',
//     created_at: new Date(),
//   };

//   const result = await users.insertOne(newUserDoc);

//   const token = jwt.sign(
//     { userId: result.insertedId.toString(), email: normalizedEmail },
//     JWT_SECRET,
//     { expiresIn: JWT_EXPIRES_IN }
//   );

  

//   return {
//     email: normalizedEmail,
//     token,
//   };
// }

export async function registerUser(email, password, username = '') {
  const normalizedEmail = email.toLowerCase().trim();
  const users = await getUsersCollection();

  const existingUser = await users.findOne({ email: normalizedEmail });
  if (existingUser) {
    throw new Error('An account with this email already exists.');
  }

  // Automatically generates a unique random salt and hashes the password
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  // 👈 NEW: Create a clean username (fallback to the part before the '@' if empty)
  const cleanUsername = username.trim() || normalizedEmail.split('@')[0];

  const newUserDoc = {
    username: cleanUsername, // 👈 NEW: Save it to the database
    email: normalizedEmail,
    password_hash: passwordHash,
    auth_provider: 'local', // (Kept your original field)
    created_at: new Date(),
  };

  const result = await users.insertOne(newUserDoc);
  const userId = result.insertedId.toString();

  // 👈 NEW: Add username to the JWT payload
  const token = jwt.sign(
    { userId: userId, email: normalizedEmail, username: cleanUsername },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN } // (Kept your original variable)
  );

  return {
    email: normalizedEmail,
    username: cleanUsername, // 👈 NEW: Return it to the frontend
    token,
  };
}

/**
 * 2. Authenticate an Existing User
 * Verifies the password against the stored Bcrypt hash and returns a signed JWT.
 */
// export async function loginUser(email, password) {
//   const normalizedEmail = email.toLowerCase().trim();
//   const users = await getUsersCollection();

//   const user = await users.findOne({ email: normalizedEmail });
//   if (!user) {
//     throw new Error('Invalid email or security key.');
//   }

//   const isPasswordValid = await bcrypt.compare(password, user.password_hash);
//   if (!isPasswordValid) {
//     throw new Error('Invalid email or security key.');
//   }

//   const token = jwt.sign(
//     { userId: user._id.toString(), email: user.email },
//     JWT_SECRET,
//     { expiresIn: JWT_EXPIRES_IN }
//   );

//   return {
//     email: user.email,
//     token,
//   };
// }
export async function loginUser(email, password) {
  const normalizedEmail = email.toLowerCase().trim();
  const users = await getUsersCollection();

  const user = await users.findOne({ email: normalizedEmail });
  if (!user) {
    throw new Error('Invalid email or security key.');
  }

  const isPasswordValid = await bcrypt.compare(password, user.password_hash);
  if (!isPasswordValid) {
    throw new Error('Invalid email or security key.');
  }

  // 👈 NEW: Resolve the username (fallback to email prefix if it's missing)
  const resolvedUsername = user.username || normalizedEmail.split('@')[0];

  const token = jwt.sign(
    // 👈 NEW: Added username to the token payload
    { userId: user._id.toString(), email: normalizedEmail, username: resolvedUsername }, 
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );

  return {
    email: user.email,
    username: resolvedUsername, // 👈 NEW: Send it to the frontend
    token,
  };
}

/**
 * 2B. Create an Isolated Ephemeral Guest Session
 * Mints a signed JWT with a unique guest_<uuid> tenant ID without writing to users.
 */
export function createGuestSession() {
  const guestId = `guest_${crypto.randomUUID()}`;
  const guestUsername = `guest_${guestId.slice(-6)}`;
  const email = `${guestId}@guest.omnirag.internal`;

  const token = jwt.sign(
    {
      userId: guestId,
      email,
      username: guestUsername,
      isGuest: true,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );

  const decoded = jwt.decode(token);
  const expiresAt =
    typeof decoded?.exp === 'number'
      ? new Date(decoded.exp * 1000)
      : new Date(Date.now() + GUEST_TTL_MS);

  return {
    email,
    username: guestUsername,
    token,
    isGuest: true,
    expiresAt: expiresAt.toISOString(),
  };
}

/**
 * Returns the 24h BSON Date expiration for guest sessions, or null for registered accounts.
 */
export function resolveTokenExpiresAt(user) {
  if (!user?.isGuest) {
    return null;
  }
  if (typeof user.exp === 'number') {
    return new Date(user.exp * 1000);
  }
  return new Date(Date.now() + GUEST_TTL_MS);
}

/**
 * Immediately removes all MongoDB chunks and telemetry traces owned by a guest session.
 */
export async function cleanupGuestSession(userId) {
  const ownerId = typeof userId === 'string' ? userId.trim() : '';
  if (!ownerId || !ownerId.startsWith('guest_')) {
    throw new Error('Invalid guest session identifier.');
  }

  const [chunksCollection, telemetryCollection] = await Promise.all([
    getChunksCollection(),
    getTelemetryCollection(),
  ]);

  const [chunksResult, telemetryResult] = await Promise.all([
    chunksCollection.deleteMany({ user_id: ownerId }),
    telemetryCollection.deleteMany({ user_id: ownerId }),
  ]);

  return {
    deleted_chunks: chunksResult.deletedCount || 0,
    deleted_traces: telemetryResult.deletedCount || 0,
  };
}

/**
 * 3. Express Middleware: Verify JWT Token
 * Protects backend RAG and telemetry routes from unauthenticated access.
 */
export function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: Missing security token.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (
      !decoded ||
      typeof decoded.userId !== 'string' ||
      decoded.userId.trim().length === 0
    ) {
      return res.status(401).json({ error: 'Unauthorized: Invalid or expired security token.' });
    }
    req.user = decoded; // Attaches { userId, email, username, isGuest } to the request
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or expired security token.' });
  }
}