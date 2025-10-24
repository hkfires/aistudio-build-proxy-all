import os
from functools import lru_cache
from pathlib import Path


@lru_cache(maxsize=1)
def project_root() -> Path:
    """
    Return the repository root so callers can build absolute paths that do not
    depend on the current working directory.
    """
    env_root = os.getenv("CAMOUFOX_PROJECT_ROOT")
    if env_root:
        return Path(env_root).expanduser().resolve()

    current = Path(__file__).resolve()
    for parent in current.parents:
        if (parent / "cookies").exists():
            return parent

    # Fallback to the original behaviour if the marker directory is missing.
    return current.parents[min(2, len(current.parents) - 1)]


def logs_dir() -> Path:
    """Root-level directory that stores log files and screenshots."""
    return project_root() / "logs"


def cookies_dir() -> Path:
    """Root-level directory that stores persistent cookie JSON files."""
    return project_root() / "cookies"
