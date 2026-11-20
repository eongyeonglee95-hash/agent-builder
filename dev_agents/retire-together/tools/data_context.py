"""Request-scoped financial workspace; never change process-global data paths."""
from contextvars import ContextVar
from pathlib import Path

workspace: ContextVar[Path | None] = ContextVar('financial_workspace', default=None)


def resolve(name: str, fallback: Path) -> Path:
    root = workspace.get()
    return root / name if root is not None else fallback
