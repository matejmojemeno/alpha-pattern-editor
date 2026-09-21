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
from .. import theme


class RunChip(QFrame):
    """One run: a colour swatch + '<count> <name>'. States: done / active / pending."""

    clicked = Signal(int)

    def _style(self, state: str, src) -> str:
        """Colours are resolved to literals against `src` (the window), not left as QSS
        `palette(...)` functions: chips live inside a scroll area whose viewport carries
        its own palette, so `palette(base)` there ignores a palette set on the window and
        the chips stayed light in High contrast mode."""
        r = theme.RADIUS_LG
        if state == "current":
            return (f"#runChip {{ background:{theme.base_hex(src)}; "
                    f"border:2px solid {theme.ACCENT}; border-radius:{r}px; }}")
        bg = theme.raised_hex(src) if state == "done" else theme.base_hex(src)
        return (f"#runChip {{ background:{bg}; border:1px solid {theme.border_hex(src)}; "
                f"border-radius:{r}px; }}")

    def __init__(self, index: int, entry: PaletteEntry, count: int, state: str,
                 done_stitches: int = 0, parent=None):
        # Parented at construction so the chip inherits the window's palette (which the
        # High contrast toggle replaces) before its stylesheet is derived from it.
        super().__init__(parent)
        self.index = index
        src = self.window()
        self.setObjectName("runChip")
        self.setCursor(Qt.PointingHandCursor)
        self.setToolTip("Tap to record how much of this colour you've done")
        self.setStyleSheet(self._style(state, src))
        lay = QHBoxLayout(self)
        lay.setContentsMargins(*theme.CHIP_PAD)
        lay.setSpacing(10)

        r, g, b = (int(v) for v in hex_to_rgb(entry.hex))
        swatch = QLabel()
        swatch.setFixedSize(28, 28)
        # Outline the swatch against the chip: dark border for pale yarns, pale for dark.
        border = "#888" if (r + g + b) > 180 else "#ccc"
        swatch.setStyleSheet(f"background:{entry.hex}; border:1px solid {border}; "
                             f"border-radius:{theme.RADIUS_SM}px;")
        lay.addWidget(swatch)

        # "23 Baby Blue", with a ✓ when done or "· 12/23" when partway through.
        label = f"{count}  {entry.name}"
        if state == "done":
            label += "  ✓"
        elif state == "current" and 0 < done_stitches < count:
            label += f"   · {done_stitches}/{count}"
        text = QLabel(label)
        colour = (theme.muted_css(src) if state == "done"
                  else f"color:{src.palette().text().color().name()};")
        text.setStyleSheet(theme.font_css(18, 600) + colour)
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

    def set_runs(self, runs: list[Run], palette: list[PaletteEntry],
                 current_index: int, current_stitches: int = 0):
        # Remove existing chips (everything except the trailing stretch).
        while self._layout.count() > 1:
            item = self._layout.takeAt(0)
            w = item.widget()
            if w is not None:
                w.setParent(None)
                w.deleteLater()
        for i, run in enumerate(runs):
            # Segments before the cursor are done; the cursor segment may be partway
            # through (shows n/count); the rest are pending.
            if i < current_index:
                state, done = "done", run.count
            elif i == current_index and current_stitches > 0:
                state, done = "current", current_stitches
            else:
                state, done = "pending", 0
            entry = palette[run.palette_index] if run.palette_index < len(palette) else \
                PaletteEntry(id="?", hex="#dddddd", name="skip")
            chip = RunChip(i, entry, run.count, state, done, parent=self)
            chip.clicked.connect(self.chipClicked)
            self._layout.insertWidget(self._layout.count() - 1, chip)
