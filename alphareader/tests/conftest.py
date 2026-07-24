"""Force Qt to run headless so UI tests work in CI / without a display."""
import os

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
