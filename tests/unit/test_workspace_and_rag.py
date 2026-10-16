"""Unit tests for workspace invites, document RAG extraction, and universal project creation."""

from __future__ import annotations

import uuid
import pytest
from unittest.mock import AsyncMock, patch

from app.models import Product, User, Workspace, WorkspaceMember
from app.routers.products import _chunk_text, _fallback_extract_spec


def test_chunk_text_splitting():
    text = "Sentence one. " * 50 + "\n\n" + "Sentence two. " * 50
    chunks = _chunk_text(text, chunk_size=300, overlap=50)
    assert len(chunks) > 1
    for chunk in chunks:
        assert len(chunk) <= 400


def test_fallback_extract_spec():
    doc_text = """
    # Cloud Telemetry Ingestion Service
    High throughput distributed telemetry ingest for microservices.
    
    Features:
    - Real-time gRPC stream ingestion
    - Automated pgvector semantic indexing
    - Multi-tenant workspace isolation
    - Strict schema verification
    
    Tech Stack: TypeScript, Python, FastAPI, PostgreSQL, Docker
    """
    spec = _fallback_extract_spec(doc_text, "telemetry_service.md")
    assert "Cloud Telemetry" in spec.name
    assert spec.code != ""
    assert len(spec.key_features) >= 3
    assert "FastAPI" in spec.tech_stack or "Python" in spec.tech_stack
    assert len(spec.target_personas) > 0
