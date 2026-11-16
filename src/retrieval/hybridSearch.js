// File: src/retrieval/hybridSearch.js
import { getChunksCollection, closeDB } from '../config/db.js';
import { embedSearchQuery } from '../services/embedder.js';

const VECTOR_INDEX_NAME = 'vector_index';
const BM25_INDEX_NAME = 'bm25_index';
const RRF_K = 60; // Standard Reciprocal Rank Fusion constant

/**
 * Automatically creates the Atlas Vector Search and BM25 Search indexes
 * if they do not exist yet, dynamically matching your stored embedding dimension (3072).
 */
export async function ensureSearchIndexes() {
  const collection = await getChunksCollection();
  const sampleDoc = await collection.findOne({
    embedding: { $exists: true, $not: { $size: 0 } },
  });

  if (!sampleDoc) {
    throw new Error('No documents with embeddings found in video_chunks. Run ingestion first.');
  }

  const numDimensions = sampleDoc.embedding.length;

  try {
    const existing = await collection.listSearchIndexes().toArray();
    const existingNames = new Set(existing.map((idx) => idx.name));

    const indexesToCreate = [];

    if (!existingNames.has(VECTOR_INDEX_NAME)) {
      indexesToCreate.push({
        name: VECTOR_INDEX_NAME,
        type: 'vectorSearch',
        definition: {
          fields: [
            {
              type: 'vector',
              path: 'embedding',
              numDimensions,
              similarity: 'cosine',
            },
            {
              type: 'filter',
              path: 'video_metadata.video_id',
            },
          ],
        },
      });
    }

    if (!existingNames.has(BM25_INDEX_NAME)) {
      indexesToCreate.push({
        name: BM25_INDEX_NAME,
        type: 'search',
        definition: {
          mappings: {
            dynamic: false,
            fields: {
              content: { type: 'string', analyzer: 'lucene.standard' },
              chunk_id: { type: 'token' },
            },
          },
        },
      });
    }

    if (indexesToCreate.length > 0) {
      await collection.createSearchIndexes(indexesToCreate);
      console.log(
        `[Atlas Search] Triggered creation for indexes: ${indexesToCreate
          .map((i) => i.name)
          .join(', ')} (Dimensions: ${numDimensions})`
      );
    }
  } catch (err) {
    console.warn(
      `[Atlas Search] Note: Automatic search index check skipped (${err.message}). Using fallback if index is still building.`
    );
  }
}

/**
 * Cosine similarity helper (used as an instant fallback while Atlas finishes building vector_index).
 */
function cosineSimilarity(vecA, vecB) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(vecA.length, vecB.length);
  for (let i = 0; i < len; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
}

/**
 * 1. Dense Vector Search ($vectorSearch with instant exact-knn fallback if index is still building)
 */
async function runDenseVectorSearch(collection, queryVector, topK = 10) {
  try {
    const results = await collection
      .aggregate([
        {
          $vectorSearch: {
            index: VECTOR_INDEX_NAME,
            path: 'embedding',
            queryVector,
            numCandidates: topK * 10,
            limit: topK,
          },
        },
        {
          $project: {
            _id: 0,
            chunk_id: 1,
            content: 1,
            video_metadata: 1,
            time_bounds: 1,
            token_count: 1,
            vectorScore: { $meta: 'vectorSearchScore' },
          },
        },
      ])
      .toArray();

    if (results.length > 0) return results;
  } catch {
    // Fallback if Atlas vector_index is still in INITIAL_SYNC state
  }

  const allDocs = await collection.find({}).toArray();
  return allDocs
    .map((doc) => ({
      chunk_id: doc.chunk_id,
      content: doc.content,
      video_metadata: doc.video_metadata,
      time_bounds: doc.time_bounds,
      token_count: doc.token_count,
      vectorScore: cosineSimilarity(queryVector, doc.embedding || []),
    }))
    .sort((a, b) => b.vectorScore - a.vectorScore)
    .slice(0, topK);
}

/**
 * 2. BM25 Lexical Search ($search with instant lexical fallback if index is still building)
 */
async function runBM25KeywordSearch(collection, queryText, topK = 10) {
  try {
    const results = await collection
      .aggregate([
        {
          $search: {
            index: BM25_INDEX_NAME,
            text: {
              query: queryText,
              path: 'content',
            },
          },
        },
        { $limit: topK },
        {
          $project: {
            _id: 0,
            chunk_id: 1,
            content: 1,
            video_metadata: 1,
            time_bounds: 1,
            token_count: 1,
            bm25Score: { $meta: 'searchScore' },
          },
        },
      ])
      .toArray();

    if (results.length > 0) return results;
  } catch {
    // Fallback if Atlas bm25_index is still in INITIAL_SYNC state
  }

  const terms = queryText
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((t) => t.length > 2);

  const allDocs = await collection.find({}).toArray();
  return allDocs
    .map((doc) => {
      const lowerContent = doc.content.toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (lowerContent.includes(term)) score += 1;
      }
      return {
        chunk_id: doc.chunk_id,
        content: doc.content,
        video_metadata: doc.video_metadata,
        time_bounds: doc.time_bounds,
        token_count: doc.token_count,
        bm25Score: score,
      };
    })
    .filter((d) => d.bm25Score > 0)
    .sort((a, b) => b.bm25Score - a.bm25Score)
    .slice(0, topK);
}

/**
 * 3. Reciprocal Rank Fusion (RRF) Mathematical Merger
 * Combines Dense Vector ranks and BM25 Keyword ranks into a single deterministic ranking.
 */
export function computeReciprocalRankFusion(vectorResults, bm25Results, k = RRF_K) {
  const fusedMap = new Map();

  vectorResults.forEach((doc, idx) => {
    const rank = idx + 1;
    const rrfContribution = 1 / (k + rank);
    fusedMap.set(doc.chunk_id, {
      ...doc,
      vector_rank: rank,
      bm25_rank: null,
      rrf_score: rrfContribution,
    });
  });

  bm25Results.forEach((doc, idx) => {
    const rank = idx + 1;
    const rrfContribution = 1 / (k + rank);

    if (fusedMap.has(doc.chunk_id)) {
      const existing = fusedMap.get(doc.chunk_id);
      existing.bm25_rank = rank;
      existing.bm25Score = doc.bm25Score;
      existing.rrf_score += rrfContribution;
    } else {
      fusedMap.set(doc.chunk_id, {
        ...doc,
        vector_rank: null,
        bm25_rank: rank,
        rrf_score: rrfContribution,
      });
    }
  });

  return Array.from(fusedMap.values()).sort((a, b) => b.rrf_score - a.rrf_score);
}

/**
 * Main Hybrid Retrieval Pipeline
 */
export async function hybridRetrieve(queryText, topK = 5) {
  const collection = await getChunksCollection();
  const queryVector = await embedSearchQuery(queryText);

  // Execute Dense Vector Search and BM25 Search in parallel
  const [vectorResults, bm25Results] = await Promise.all([
    runDenseVectorSearch(collection, queryVector, topK * 2),
    runBM25KeywordSearch(collection, queryText, topK * 2),
  ]);

  const fusedResults = computeReciprocalRankFusion(vectorResults, bm25Results);
  return fusedResults.slice(0, topK);
}

// CLI Test Runner: `node src/retrieval/hybridSearch.js`
if (process.argv[1] && process.argv[1].endsWith('hybridSearch.js')) {
  const testQuery =
    process.argv[2] ||
    'How does adding jitter prevent the thundering herd problem during service retries?';

  (async () => {
    await ensureSearchIndexes();
    console.log(`\n[Hybrid Search] Query: "${testQuery}"`);
    const results = await hybridRetrieve(testQuery, 5);

    console.log('\n[RRF Ranked Results]:');
    for (const r of results) {
      console.log(
        ` -> ${r.chunk_id} | RRF Score: ${r.rrf_score.toFixed(6)} (Vector Rank: ${
          r.vector_rank ?? 'N/A'
        }, BM25 Rank: ${r.bm25_rank ?? 'N/A'})`
      );
    }
  })()
    .catch((err) => {
      console.error('[Hybrid Search Error]:', err.message);
      process.exitCode = 1;
    })
    .finally(() => closeDB());
}