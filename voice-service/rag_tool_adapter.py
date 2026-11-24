# File: voice-service/rag_tool_adapter.py
from __future__ import annotations

import asyncio
from typing import Any

import httpx
from google.genai import types


def build_live_tools() -> list[types.Tool]:
    """Declares OmniRAG retrieval tools for Gemini 3.8 Live."""
    return [
        types.Tool(
            function_declarations=[
                types.FunctionDeclaration(
                    name="search_knowledge_base",
                    description=(
                        "Searches the user's indexed OmniRAG knowledge base "
                        "(YouTube lectures and PDF documents) using Hybrid Vector + BM25 RRF "
                        "and a Cross-Encoder relevance filter. "
                        "You MUST call this for EVERY factual, historical, biographical, "
                        "general-knowledge, or technical question before responding."
                    ),
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={
                            "query": types.Schema(
                                type=types.Type.STRING,
                                description="Concise search query capturing the user's question.",
                            ),
                            "top_k": types.Schema(
                                type=types.Type.INTEGER,
                                description="Maximum candidate chunks to retrieve (default 5, max 10).",
                            ),
                        },
                        required=["query"],
                    ),
                ),
                types.FunctionDeclaration(
                    name="list_indexed_sources",
                    description=(
                        "Lists all YouTube videos and PDF documents currently indexed "
                        "in the user's OmniRAG knowledge base along with chunk counts."
                    ),
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={},
                    ),
                ),
            ]
        )
    ]


class OmniRAGToolAdapter:
    """Async adapter calling the existing Node.js OmniRAG Express API with JWT isolation."""

    def __init__(
        self,
        backend_base_url: str = "http://localhost:3000",
        auth_token: str = "",
        timeout_sec: float = 25.0,
    ) -> None:
        self.backend_base_url = backend_base_url.rstrip("/")
        self.auth_token = auth_token
        self.timeout_sec = timeout_sec

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.auth_token:
            headers["Authorization"] = f"Bearer {self.auth_token}"
        return headers

    async def execute_tool(self, name: str, args: dict[str, Any] | None) -> dict[str, Any]:
        safe_args = args or {}
        try:
            if name == "search_knowledge_base":
                query = str(safe_args.get("query", "")).strip()
                top_k = int(safe_args.get("top_k", 5) or 5)
                return await self.search_knowledge_base(query=query, top_k=top_k)

            if name == "list_indexed_sources":
                return await self.list_indexed_sources()

            return {
                "status": "error",
                "retryable": False,
                "message": f"Unknown tool requested: {name}",
                "passages": [],
                "citations": [],
            }
        except asyncio.CancelledError:
            # Propagate cancellation immediately on barge-in
            raise
        except Exception as exc:
            return {
                "status": "error",
                "retryable": False,
                "message": f"Tool execution failed: {exc}",
                "passages": [],
                "citations": [],
            }

    async def search_knowledge_base(self, query: str, top_k: int = 5) -> dict[str, Any]:
        if not query:
            return {
                "status": "error",
                "retryable": False,
                "message": "Query string cannot be empty.",
                "passages": [],
                "citations": [],
            }

        async with httpx.AsyncClient(timeout=self.timeout_sec) as client:
            resp = await client.post(
                f"{self.backend_base_url}/api/retrieval/search",
                headers=self._headers(),
                json={"query": query, "topK": max(1, min(top_k, 10))},
            )

        if resp.status_code == 401:
            return {
                "status": "error",
                "retryable": False,
                "message": "Authentication expired. Please sign in to OmniRAG again.",
                "passages": [],
                "citations": [],
            }

        resp.raise_for_status()
        data = resp.json()
        passages = data.get("passages") or []

        if not passages:
            return {
                "status": "no_results",
                "is_abstained": True,
                "retryable": False,
                "instruction": (
                    "STOP. Zero relevant chunks were found in the user's indexed corpus. "
                    "Do NOT use general knowledge or explain this topic. "
                    "Only reply: 'I cannot answer that because it is not covered in your indexed sources.'"
                ),
                "message": (
                    "STOP. Zero chunks passed the OmniRAG Cross-Encoder relevance gate (>= 0.50). "
                    "Do NOT answer from general knowledge. Only tell the user this topic is not covered in their indexed sources."
                ),
                "passages": [],
                "citations": [],
            }

        citations = [
            {
                "chunk_id": p.get("chunk_id", ""),
                "video_id": p.get("video_id", ""),
                "title": p.get("title", "Untitled Source"),
                "url": p.get("url", ""),
                "timestamp": p.get("timestamp", "00:00"),
                "score": p.get("cross_encoder_score", 0.0),
                "excerpt": (p.get("text") or "")[:240],
            }
            for p in passages
        ]

        return {
            "status": "ok",
            "retryable": False,
            "message": f"Found {len(passages)} grounded passage(s) passing the Cross-Encoder gate.",
            "passages": passages,
            "citations": citations,
        }

    async def list_indexed_sources(self) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=self.timeout_sec) as client:
            resp = await client.get(
                f"{self.backend_base_url}/api/resources",
                headers=self._headers(),
            )

        if resp.status_code == 401:
            return {
                "status": "error",
                "retryable": False,
                "message": "Authentication expired. Please sign in to OmniRAG again.",
                "passages": [],
                "citations": [],
            }

        resp.raise_for_status()
        videos = resp.json().get("videos") or []

        if not videos:
            return {
                "status": "no_results",
                "retryable": False,
                "message": "No YouTube lectures or PDFs are currently indexed in this workspace.",
                "passages": [],
                "citations": [],
            }

        sources = [
            {
                "video_id": v.get("video_id", ""),
                "title": v.get("title", "Untitled Source"),
                "url": v.get("url", ""),
                "chunk_count": v.get("chunk_count", 0),
            }
            for v in videos
        ]

        return {
            "status": "ok",
            "retryable": False,
            "message": f"User workspace contains {len(sources)} indexed source(s).",
            "passages": sources,
            "citations": [],
        }