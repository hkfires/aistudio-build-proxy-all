from functools import lru_cache
from pathlib import Path


@lru_cache(maxsize=1)
def project_root() -> Path:
    """
    Return the repository root so callers can build absolute paths that do not
    depend on the current working directory.
    """
    return Path(__file__).resolve().parents[2]


def logs_dir() -> Path:
    """Root-level directory that stores log files and screenshots."""
    return project_root() / "logs"


def cookies_dir() -> Path:
    """Root-level directory that stores persistent cookie JSON files."""
    return project_root() / "cookies"
