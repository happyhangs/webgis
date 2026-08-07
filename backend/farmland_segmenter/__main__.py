"""Entry point: python -m farmland_segmenter [image] [options]

Use `python -m farmland_segmenter.train` for training.
"""

import sys

# Check if the user invoked `python -m farmland_segmenter.train`
if len(sys.argv) >= 2 and sys.argv[1] == "train":
    from .train import main as train_main
    raise SystemExit(train_main(sys.argv[2:]))

from .cli import main

if __name__ == "__main__":
    raise SystemExit(main())
