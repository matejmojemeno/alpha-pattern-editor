"""Run-length chips for the Work stage (§6.3).

Laid out vertically (one run per line) inside a scroll area, so a row with many colour
switches scrolls instead of shrinking the chart. Dimming/among states is done purely
with stylesheets — no QGraphicsOpacityEffect and no custom QLayout, both of which are
crash-prone when widgets are rebuilt on every action (notably on macOS)."""
from __future__ import annotations

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import QFrame, QHBoxLayout, QLabel, QVBoxLayout, QWidget

from ...core.detect.palette import hex_to_rgb
from ...core.model import PaletteEntry
from ...core.readout import Run


class RunChip(QFrame):
    """One run: a colour swatch + '<count> <name>'. States: done / active / pending."""

    clicked = Signal(int)

    _STYLES = {
        "done":   "#runChip { background:palette(window); border:1px solid #666; border-radius:10px; }",
        "pending": "#runChip { background:palette(base); border:1px solid #999; border-radius:10px; }",
    }

    def __init__(self, index: int, entry: PaletteEntry, count: int, state: str):
        super().__init__()
        self.index = index
        self.setObjectName("runChip")
        self.setCursor(Qt.PointingHandCursor)
        self.setStyleSheet(self._STYLES.get(state, self._STYLES["pending"]))
        lay = QHBoxLayout(self)
        lay.setContentsMargins(12, 8, 14, 8)
        lay.setSpacing(10)

        r, g, b = (int(v) for v in hex_to_rgb(entry.hex))
        swatch = QLabel()
        swatch.setFixedSize(28, 28)
        border = "#888" if (r + g + b) > 180 else "#ccc"
        swatch.setStyleSheet(f"background:{entry.hex}; border:1px solid {border}; border-radius:4px;")
        lay.addWidget(swatch)

        faded = "color:#aaa;" if state == "done" else ""
        text = QLabel(f"{count}  {entry.name}")
        text.setStyleSheet(f"font-size:18px; font-weight:600; {faded}")
        lay.addWidget(text)
        lay.addStretch(1)

    def mousePressEvent(self, _e):
        self.clicked.emit(self.index)


class ChipsBar(QWidget):
    """A vertical stack of RunChips for the current row."""

    chipClicked = Signal(int)

    def __init__(self):
        super().__init__()
        self._layout = QVBoxLayout(self)
        self._layout.setContentsMargins(0, 0, 0, 0)
        self._layout.setSpacing(8)
        self._layout.addStretch(1)

    def set_runs(self, runs: list[Run], palette: list[PaletteEntry], active_index: int):
        # Remove existing chips (everything except the trailing stretch).
        while self._layout.count() > 1:
            item = self._layout.takeAt(0)
            w = item.widget()
            if w is not None:
                w.setParent(None)
                w.deleteLater()
        for i, run in enumerate(runs):
            # No active-run highlight: whole rows are completed at once, so a per-run
            # cursor highlight isn't needed (and read poorly against dark-mode text).
            state = "done" if i < active_index else "pending"
            entry = palette[run.palette_index] if run.palette_index < len(palette) else \
                PaletteEntry(id="?", hex="#dddddd", name="skip")
            chip = RunChip(i, entry, run.count, state)
            chip.clicked.connect(self.chipClicked)
            self._layout.insertWidget(self._layout.count() - 1, chip)
