#!/usr/bin/env python3
"""Launch OUTBREAK straight from a checkout (no install needed)."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "src"))

from outbreak.cli import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main())
