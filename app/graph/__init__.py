"""app.graph — Engineering Intelligence Graph layer.

This package provides a thin abstraction over a graph database backend.
The interface is defined in `base.py`; the FalkorDB implementation is in
`falkordb_backend.py`.

To swap backends later, change `_BACKEND_CLASS` in `factory.py` and update
the dependency in `pyproject.toml`.  Nothing else in the codebase touches the
backend directly — all callers go through `get_graph()`.
"""
from app.graph.factory import get_graph, reset_graph

__all__ = ["get_graph", "reset_graph"]
