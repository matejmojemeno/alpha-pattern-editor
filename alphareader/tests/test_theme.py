"""The theme helpers must adapt to the widget's palette, not assume a light desktop."""
from __future__ import annotations

import pytest

pytest.importorskip("PySide6")
from PySide6.QtGui import QColor, QPalette      # noqa: E402
from PySide6.QtWidgets import QApplication, QWidget      # noqa: E402

from ..ui import theme                          # noqa: E402


@pytest.fixture(scope="module")
def qapp():
    yield QApplication.instance() or QApplication([])


def _widget(base: str) -> QWidget:
    w = QWidget()
    pal = QPalette(w.palette())
    pal.setColor(QPalette.Base, QColor(base))
    pal.setColor(QPalette.Text, QColor("#ffffff" if base == "#111111" else "#000000"))
    w.setPalette(pal)
    return w


def test_is_dark_follows_the_base_colour(qapp):
    assert theme.is_dark(_widget("#111111"))
    assert not theme.is_dark(_widget("#ffffff"))


def test_done_wash_fades_pale_and_dark_yarn_alike(qapp):
    """The wash sits on top of pattern colours, not on the page, so it must desaturate
    whatever it covers rather than push toward one end of the range."""
    wash = theme.done_wash(_widget("#ffffff"))
    assert 0 < wash.alpha() < 255                        # translucent
    assert 100 < wash.lightness() < 160                  # neutral, not white or black
    for yarn in (QColor("#ffffff"), QColor("#000000")):
        blended = _over(wash, yarn)
        assert abs(blended.lightness() - wash.lightness()) < abs(
            yarn.lightness() - wash.lightness())         # every yarn moves toward neutral


def test_chart_ink_does_not_follow_the_desktop_theme(qapp):
    """Gridlines and the strike-through overlay pattern colours, which are theme-
    independent — deriving them from the palette would make them wrong half the time."""
    for fn in (theme.grid_color, theme.done_wash, theme.done_strike):
        assert fn(_widget("#ffffff")) == fn(_widget("#111111"))


def _over(top: QColor, bottom: QColor) -> QColor:
    a = top.alpha() / 255
    return QColor(*(int(t * a + b * (1 - a)) for t, b in
                    ((top.red(), bottom.red()), (top.green(), bottom.green()),
                     (top.blue(), bottom.blue()))))


def test_muted_and_border_sit_between_text_and_background(qapp):
    for base in ("#ffffff", "#111111"):
        w = _widget(base)
        bg = w.palette().base().color().lightness()
        fg = w.palette().text().color().lightness()
        muted = QColor(theme.muted_hex(w)).lightness()
        border = QColor(theme.border_hex(w)).lightness()
        lo, hi = sorted((bg, fg))
        assert lo <= muted <= hi and lo <= border <= hi


def test_font_css_scales_with_the_app_font(qapp):
    """Sizes are emitted in points relative to the app font, so the OS text-size setting
    actually does something."""
    font = qapp.font()
    original = font.pointSizeF()
    try:
        font.setPointSizeF(13.0)
        qapp.setFont(font)
        small = theme.font_css(22)
        font.setPointSizeF(26.0)
        qapp.setFont(font)
        big = theme.font_css(22)
        assert _pt(big) == pytest.approx(_pt(small) * 2, rel=0.02)
    finally:
        font.setPointSizeF(original)
        qapp.setFont(font)


def _pt(css: str) -> float:
    return float(css.split("font-size:")[1].split("pt")[0])
