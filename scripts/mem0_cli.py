"""JSON-in / JSON-out bridge to mem0. Runs inside the mem0 virtualenv, not the API's.

stdin:  {"op": "add"|"search", "config": {...}, "user_id": ..., ...}
stdout: one JSON line, {"results": [...]} or {"error": "..."}.
"""

import json
import sys


def build(cfg: dict):
    """Creates a mem0 Memory wired to Ollama and the chosen vector store."""
    from mem0 import Memory

    dims = 768  # nomic-embed-text
    if cfg["store"] == "pgvector":
        store = {
            "provider": "pgvector",
            "config": {
                "connection_string": cfg["dsn"],
                "collection_name": "agent_memory",
                "embedding_model_dims": dims,
            },
        }
    else:
        store = {
            "provider": "qdrant",
            "config": {
                "path": cfg["path"],
                "collection_name": "agent_memory",
                "embedding_model_dims": dims,
                "on_disk": True,
            },
        }
    return Memory.from_config(
        {
            "llm": {
                "provider": "ollama",
                "config": {
                    "model": cfg["llm_model"],
                    "ollama_base_url": cfg["ollama_url"],
                    "temperature": 0,
                },
            },
            "embedder": {
                "provider": "ollama",
                "config": {
                    "model": cfg["embed_model"],
                    "ollama_base_url": cfg["ollama_url"],
                    "embedding_dims": dims,
                },
            },
            "vector_store": store,
            "history_db_path": cfg["path"].rstrip("/") + "_history.db",
        }
    )


def main() -> None:
    """Reads one request from stdin and prints one JSON response."""
    req = json.load(sys.stdin)
    try:
        mem = build(req["config"])
        if req["op"] == "add":
            out = mem.add(
                [{"role": "user", "content": req["text"]}],
                user_id=req["user_id"],
                agent_id=req.get("agent_id"),
            )
        else:
            filters = {"user_id": req["user_id"]}
            if req.get("agent_id"):
                filters["agent_id"] = req["agent_id"]
            out = mem.search(req["query"], filters=filters, limit=req.get("limit", 5))
        print(json.dumps(out, default=str))
    except Exception as exc:  # The caller treats any error as "no memory".
        print(json.dumps({"error": str(exc)}))


if __name__ == "__main__":
    main()
