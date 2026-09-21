"""Periodicity-first lattice recovery.

The older path (`mask.py` + `lattice.py`) assumes gridlines are *dark*: it thresholds
luminance, keeps rows/columns whose longest dark run is within 0.6x of the longest run in
the image, and estimates pitch from the gaps between those bands. That chain breaks on
ordinary charts in three independent ways:

  * gridlines that aren't near-black (pink, light green, grey, or blue-on-blue) never
    enter the mask at all, so the "bands" that survive are the artwork's own outlines;
  * a global `0.6 * max` threshold is set by the single strongest edge in the picture
    (page border, heavy every-10th rule), which discards ordinary gridlines wholesale;
  * pitch taken from *adjacent* band gaps locks onto gridline thickness when a line is
    thick enough to yield two edges (a 3px rule reads as pitch 3, not pitch 23).

This module instead treats the grid as what it is: the dominant *periodic* structure of
the image. Nothing here thresholds the profile globally, and nothing infers pitch from
neighbouring-gap statistics, so all three failure modes are gone by construction rather
than by tuning.

The chain is: colour-difference edge profile -> autocorrelation *candidates* -> per
candidate, snap profile peaks to a lattice and least-squares refit -> pick the candidate
whose lattice best explains the whole profile under a matched filter.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from ._nd import uniform_filter1d
from ._nd import find_peaks

from ..model import DetectionError

MIN_PITCH = 6.0            # §4.7: below this the chart is refused, not guessed at
_MAX_SUBHARMONIC = 12       # deepest submultiple of an ACF peak we will consider
_ACF_CANDIDATES = 6         # strongest ACF peaks used to seed the search
_CONFORM = 0.25             # a peak fits a lattice within this fraction of the pitch
_SEARCH_FLOOR = 3.0         # search this fine, so an under-resolved chart is identified
_SMOOTH = 3                 # profile smoothing, in px; must stay under half of MIN_PITCH
_EVIDENCE_THR = 12.0        # per-pixel edge magnitude counted as gridline evidence
_SUPPORT_FRAC = 0.15        # outer line needs at least this share of the median line height


def edge_maps(img: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """2D adjacent-pixel colour distance, per axis. This is the single most expensive step
    in detection, so callers that need profiles *and* evidence compute it once and pass the
    result to `profiles_from_maps` / `evidence_from_maps`."""
    a = img[..., :3].astype(np.float32)
    return (np.abs(np.diff(a, axis=0)).max(axis=2),      # edges between rows
            np.abs(np.diff(a, axis=1)).max(axis=2))      # edges between columns


def profiles_from_maps(horizontal: np.ndarray, vertical: np.ndarray,
                       row_span: tuple[int, int] | None = None,
                       col_span: tuple[int, int] | None = None
                       ) -> tuple[np.ndarray, np.ndarray]:
    """Project precomputed edge maps onto each axis (see `edge_profiles`)."""
    if col_span is not None:
        c0, c1 = col_span
        horizontal = horizontal[:, max(0, c0):max(c0 + 1, c1)]
    if row_span is not None:
        r0, r1 = row_span
        vertical = vertical[max(0, r0):max(r0 + 1, r1), :]
    return horizontal.sum(axis=1), vertical.sum(axis=0)


def edge_profiles(img: np.ndarray,
                  row_span: tuple[int, int] | None = None,
                  col_span: tuple[int, int] | None = None) -> tuple[np.ndarray, np.ndarray]:
    """Per-axis edge-strength profiles from adjacent-pixel colour distance.

    Uses the max absolute difference across R/G/B rather than luminance, so a gridline
    that differs from its cells mainly in hue (pink on white, blue on blue) responds as
    strongly as a black one. Polarity-independent: lighter-than-cell gridlines score the
    same as darker ones.

    `row_span` / `col_span` restrict which pixels contribute, so a second pass can project
    each axis over only the *other* axis's detected grid extent. That matters because
    row/column numbering in the margin is drawn at the grid's own pitch, making it a
    genuine periodic signal: glyph edges land a fraction of a pitch from each gridline and
    can outscore the real lattice. Excluding the margins removes the distractor at source
    rather than trying to out-vote it.

    Returns (row_profile, col_profile); note each is one shorter than its image axis,
    since element i measures the boundary between samples i and i+1.
    """
    dh, dv = edge_maps(img)
    return profiles_from_maps(dh, dv, row_span=row_span, col_span=col_span)


def _smooth(prof: np.ndarray, width: int = _SMOOTH) -> np.ndarray:
    """Merge each gridline into a single peak at its centre.

    A line more than one pixel thick registers as *two* edges in the difference profile,
    one per side. Fitting a lattice to those raw edges puts the line at whichever edge won
    the peak contest — inconsistently, since which side is stronger varies along the chart
    — and the least-squares compromise lands midway between them, where the profile is
    zero. The true pitch then scores worse than a phase-locked half-pitch. Smoothing by
    less than half the minimum pitch fixes the phase without merging distinct lines.
    """
    return uniform_filter1d(prof.astype(np.float64), size=width, mode="nearest")


def _normalized(prof: np.ndarray) -> np.ndarray:
    """Clip dominant outliers, then mean-subtract.

    Clipping stops one very strong edge (the page border, a heavy every-10th rule) from
    setting the scale for every ordinary gridline. Mean-subtraction is what makes the
    matched filter discriminate: positions that land on cell interiors contribute
    *negatively*, so a too-fine lattice is penalised instead of rewarded.
    """
    p = np.clip(prof, 0, np.percentile(prof, 98))
    return p - p.mean()


def _autocorr(w: np.ndarray) -> np.ndarray:
    n = w.size
    f = np.fft.rfft(w, 2 * n)
    a = np.fft.irfft(f * np.conj(f))[:n]
    return a / (a[0] + 1e-9)


def _candidate_pitches(w: np.ndarray, pmin: float, pmax: float) -> list[float]:
    """Rough pitches worth testing, from autocorrelation peaks and their submultiples.

    Autocorrelation alone is not a reliable *fundamental* detector here: when the true
    pitch is non-integer, an integer multiple of it can align better with the sample grid
    than the fundamental does (bunny.jpg peaks at lag 27 for a true pitch of 8.96). So we
    only harvest candidates and let the matched filter decide, rather than trusting the
    tallest ACF peak.
    """
    n = w.size
    a = _autocorr(w)
    lo, hi = int(np.floor(pmin)), int(np.ceil(min(pmax, n / 2)))
    if hi <= lo + 2:
        return []
    peaks, _ = find_peaks(a[lo:hi])
    if peaks.size == 0:
        return []
    strongest = (peaks + lo)[np.argsort(a[lo:hi][peaks])[::-1]][:_ACF_CANDIDATES]
    out: set[float] = set()
    for lag in strongest:
        for m in range(1, _MAX_SUBHARMONIC + 1):
            cand = float(lag) / m
            if pmin <= cand <= pmax:
                out.add(round(cand, 3))
    return sorted(out)


def _dedupe(cands: list[float], rel: float = 0.01) -> list[float]:
    """Drop candidates within `rel` of one they'd converge to anyway (keeps the search
    cheap without changing which pitches are reachable)."""
    out: list[float] = []
    for c in cands:
        if not out or (c - out[-1]) / c > rel:
            out.append(c)
    return out


def _profile_peaks(prof: np.ndarray, pitch: float) -> np.ndarray:
    """Candidate gridline positions: local maxima of the profile.

    Local maxima are scale-free — a faint gridline next to the page border registers just
    as well as a strong one, which a global `> 0.6 * max` threshold cannot do. Requiring
    peaks to be at least 0.6*pitch apart collapses the two edges of a thick gridline into
    a single candidate, which is what stops thickness from being read as pitch.
    """
    med = np.median(prof)
    mad = np.median(np.abs(prof - med)) + 1e-9
    spacing = max(2, int(round(0.6 * pitch)))
    # Pad with the profile floor so a gridline sitting flush against the image edge is a
    # detectable local maximum. Without this, charts cropped tight to the grid silently
    # lose their outermost line on each axis (and so a whole row/column of cells).
    pad = spacing + 1
    padded = np.concatenate([np.full(pad, prof.min()), prof, np.full(pad, prof.min())])
    peaks, _ = find_peaks(padded, distance=spacing, prominence=1.5 * mad)
    peaks = peaks - pad
    return peaks[(peaks >= 0) & (peaks < prof.size)].astype(np.float64)


def _fit_lattice(centers: np.ndarray, pitch: float) -> tuple[float, float] | None:
    """Snap peaks to a lattice of roughly `pitch` and least-squares refit (x0, pitch).

    Peaks that don't conform are dropped each iteration, so the artwork's own edges --
    which are aperiodic and land between lattice positions -- cannot drag the fit. The
    refit recovers a non-integer pitch exactly, which the coarse ACF lag cannot.
    """
    if centers.size < 3:
        return None
    # Phase search, all candidate phases at once.
    phases = np.linspace(0, pitch, 60, endpoint=False)
    resid = centers[None, :] - phases[:, None]
    resid -= np.round(resid / pitch) * pitch
    best_phase = float(phases[np.argmax((np.abs(resid) < _CONFORM * pitch).sum(axis=1))])

    x0, p = best_phase, pitch
    for _ in range(10):
        k = np.round((centers - x0) / p)
        good = np.abs(centers - (x0 + k * p)) < _CONFORM * p
        if good.sum() < 3:
            return None
        kg, cg = k[good], centers[good]
        # Closed-form least squares for centers ~= x0 + k*pitch (np.polyfit is far heavier
        # and this sits in the inner loop over every candidate pitch).
        km, cm = kg.mean(), cg.mean()
        var = float(((kg - km) ** 2).sum())
        if var <= 0:
            return None
        p_new = float(((kg - km) * (cg - cm)).sum() / var)
        x0_new = float(cm - p_new * km)
        converged = abs(p_new - p) < 1e-7 and abs(x0_new - x0) < 1e-7
        x0, p = x0_new, p_new
        if converged:
            break
    return (float(x0), float(p)) if p > 0 else None


def _comb_score(w: np.ndarray, x0: float, pitch: float) -> float:
    """Matched-filter score: how well a lattice explains the whole profile.

    Sums the mean-subtracted profile over every lattice position across the image and
    divides by sqrt(count). Both ways of being wrong lose: a too-fine lattice spends half
    its positions on cell interiors (negative contributions), and a too-coarse one (an
    integer multiple of the true pitch) explains proportionally fewer lines and is docked
    by the sqrt(count) normalisation.
    """
    n = w.size
    k0 = int(np.ceil((0 - x0) / pitch))
    k1 = int(np.floor((n - 1 - x0) / pitch))
    if k1 - k0 + 1 < 4:
        return -np.inf
    pos = np.clip(x0 + np.arange(k0, k1 + 1) * pitch, 0, n - 1.001)
    i = pos.astype(int)
    frac = pos - i
    val = w[i] * (1 - frac) + w[np.minimum(i + 1, n - 1)] * frac
    return float(val.sum() / np.sqrt(val.size))


def _peak_agreement(peaks: np.ndarray, x0: float, pitch: float, n: int) -> float:
    """Fraction of this lattice's positions that coincide with a detected line."""
    k0 = int(np.ceil(-x0 / pitch))
    k1 = int(np.floor((n - 1 - x0) / pitch))
    if k1 < k0 or peaks.size == 0:
        return 0.0
    pos = x0 + np.arange(k0, k1 + 1) * pitch
    nearest = np.abs(pos[:, None] - peaks[None, :]).min(axis=1)
    return float(np.count_nonzero(nearest < _CONFORM * pitch) / pos.size)


def _sample(w: np.ndarray, pos: np.ndarray) -> np.ndarray:
    pos = np.clip(pos, 0, w.size - 1.001)
    i = pos.astype(int)
    frac = pos - i
    return w[i] * (1 - frac) + w[np.minimum(i + 1, w.size - 1)] * frac


def _extra_lines_supported(w: np.ndarray, fine: "PeriodicFit", coarse: "PeriodicFit") -> bool:
    """Does the finer lattice's *extra* half (or third, ...) sit on real gridlines?

    Comparing whole-lattice scores can't separate "the coarse fit skipped every other real
    line" from "the fine fit invented lines through cell interiors" — both score similarly
    when lines are thick. Testing only the positions the two lattices *disagree* about
    answers it directly: on a genuine octave error those positions carry gridline-strength
    evidence, and on a spurious subdivision they carry cell-interior evidence (negative,
    since the profile is mean-subtracted).
    """
    n = w.size
    k0 = int(np.ceil(-fine.x0 / fine.pitch))
    k1 = int(np.floor((n - 1 - fine.x0) / fine.pitch))
    if k1 - k0 + 1 < 4:
        return False
    pos = fine.x0 + np.arange(k0, k1 + 1) * fine.pitch
    # Split by proximity to the coarse lattice.
    off = np.abs(((pos - coarse.x0) / coarse.pitch + 0.5) % 1.0 - 0.5) * coarse.pitch
    shared = off < 0.25 * fine.pitch
    if shared.sum() < 2 or (~shared).sum() < 2:
        return False
    vals = _sample(w, pos)
    shared_mean = float(vals[shared].mean())
    extra_mean = float(vals[~shared].mean())
    return extra_mean > 0 and extra_mean >= 0.5 * shared_mean


@dataclass
class PeriodicFit:
    x0: float
    pitch: float
    score: float
    peaks: np.ndarray          # profile peak positions (for the extent walk / diagnostics)


def fit_periodic_axis(prof: np.ndarray, dim: int, min_pitch: float = MIN_PITCH) -> PeriodicFit:
    """Recover (phase, pitch) for one axis. Raises DetectionError if nothing periodic."""
    prof = _smooth(prof)
    w = _normalized(prof)
    pmax = dim / 4.0
    if pmax <= min_pitch:
        raise DetectionError("NO_GRIDLINES", "Image is too small to contain a grid.")

    # Search below `min_pitch` deliberately. A chart finer than we can sample still has a
    # findable pitch, and identifying it lets us refuse the image as under-resolved (§4.7)
    # instead of silently reporting whichever coarse harmonic happened to fit.
    evaluated: list[PeriodicFit] = []
    peak_cache: dict[int, np.ndarray] = {}
    for cand in _dedupe(_candidate_pitches(w, _SEARCH_FLOOR, pmax)):
        # Peak extraction depends on the candidate only through the integer spacing, so
        # candidates that round to the same spacing share one find_peaks call.
        spacing = max(2, int(round(0.6 * cand)))
        if spacing not in peak_cache:
            peak_cache[spacing] = _profile_peaks(prof, cand)
        peaks = peak_cache[spacing]
        fit = _fit_lattice(peaks, cand)
        if fit is None:
            continue
        x0, pitch = fit
        if not (_SEARCH_FLOOR <= pitch <= pmax):
            continue
        # Weight the matched filter by how many lattice positions are backed by an actual
        # detected line. Profile mass alone can favour a half-pitch lattice on a chart with
        # very few columns, where the handful of real lines carry enough energy that the
        # invented positions between them are not penalised sufficiently; requiring a line
        # at each position makes a lattice that posits twice as many lines pay for them.
        score = _comb_score(w, x0, pitch) * _peak_agreement(peaks, x0, pitch, w.size)
        evaluated.append(PeriodicFit(x0=x0, pitch=pitch, score=score, peaks=peaks))

    best = max(evaluated, key=lambda f: f.score) if evaluated else None
    if best is not None:
        # Prefer the fundamental over an integer multiple of it: a chart whose gridlines
        # alternate in strength (or whose lines are thick) can let the octave edge ahead on
        # raw score. Only step down when the lines the finer lattice adds are themselves
        # supported, so a real subdivision is taken and a spurious one is not.
        for m in range(2, 7):
            target = best.pitch / m
            if target < _SEARCH_FLOOR:
                break
            near = [f for f in evaluated if abs(f.pitch - target) / target < 0.03]
            if near:
                cand = max(near, key=lambda f: f.score)
                if _extra_lines_supported(w, cand, best):
                    best = cand
                    break

    if best is None:
        raise DetectionError("NO_GRIDLINES", "Couldn't find a regular grid in this image.")
    if best.pitch < min_pitch:
        raise DetectionError(
            "LOW_RESOLUTION",
            "Image resolution too low — need at least ~6 pixels per square.")
    return best


def _drop_stranded_ends(run: np.ndarray) -> np.ndarray:
    """Drop a handful of lines stranded beyond a gap of dead positions at either end.

    Bridging gaps is necessary — a real gridline can be invisible where it crosses a large
    block of one colour — but it also lets the run reach an unrelated edge outside the grid
    (a page boundary, a caption rule) and swallow the dead positions in between. A real
    grid ends where its lines are contiguous with their neighbours, so a trailing group no
    larger than the gap that separates it is not part of the grid.
    """
    while run.size > 3:
        d = np.diff(run)
        gaps = np.flatnonzero(d > 1)
        if gaps.size == 0:
            break
        last = int(gaps[-1])
        if run.size - last - 1 <= d[last] - 1:
            run = run[:last + 1]
            continue
        first = int(gaps[0])
        if first + 1 <= d[first] - 1:
            run = run[first + 1:]
            continue
        break
    return run


def extent_from_peaks(fit: PeriodicFit, prof: np.ndarray, max_gap: int = 4) -> tuple[int, int]:
    """Lattice index range spanned by the grid, from the peaks that fit the lattice.

    Deliberately *not* a per-line coverage test against the 2D image: inside a large block
    of one colour a gridline produces no edge at all, so coverage collapses mid-grid and
    the extent stops short (shizuku.jpg's hair, lisa.jpg's sweater). The projected profile
    still sees those lines, because they remain visible everywhere else along their span.

    Peaks from margins, captions and edge numbering are aperiodic, so they fail the
    lattice-conformance test and cannot extend the grid; a run is only broken by more than
    `max_gap` consecutive unsupported lines.
    """
    k = np.round((fit.peaks - fit.x0) / fit.pitch)
    resid = np.abs(fit.peaks - (fit.x0 + k * fit.pitch))
    k = np.unique(k[resid < _CONFORM * fit.pitch]).astype(int)
    if k.size < 3:
        raise DetectionError("NO_GRIDLINES", "Couldn't find a regular grid in this image.")

    splits = np.flatnonzero(np.diff(k) > max_gap + 1) + 1
    run = max(np.split(k, splits), key=lambda r: int(r[-1]) - int(r[0]))
    run = _drop_stranded_ends(run)
    k_min, k_max = int(run[0]), int(run[-1])

    # `max_gap` lets the run bridge legitimately-missing lines, but it can also bridge to a
    # lone spurious peak beyond the grid, dragging in rows of pure margin. Drop outer lines
    # with essentially no profile support of their own. The bar is deliberately low: a real
    # border line, faded by anti-aliasing, can sit at ~0.35 of the median line height, which
    # overlaps the weaker impostors — so this only removes positions with nothing there at
    # all, and `_trim_unsupported` separates the rest by whether a line spans the grid.
    sm = _smooth(prof)
    heights = np.array([sm[int(round(np.clip(fit.x0 + k * fit.pitch, 0, sm.size - 1)))]
                        for k in range(k_min, k_max + 1)])
    ref = float(np.median(heights))
    if ref > 0:
        thr = _SUPPORT_FRAC * ref
        while k_max - k_min > 2 and heights[0] < thr:
            heights = heights[1:]
            k_min += 1
        while k_max - k_min > 2 and heights[-1] < thr:
            heights = heights[:-1]
            k_max -= 1

    # No extension past the outermost supported line: `_profile_peaks` pads the profile so
    # a gridline flush against the image edge is already detectable, and guessing beyond
    # that only invents a row of cells from the margin.
    return k_min, k_max


def evidence_from_maps(dh: np.ndarray, dv: np.ndarray, shape: tuple[int, int]
                       ) -> tuple[np.ndarray, np.ndarray]:
    """Boolean maps of horizontal / vertical edge pixels, for the span-coverage tests.

    The threshold is a fixed floor just above JPEG/resampling noise, deliberately *not*
    derived from the image's own edge distribution: scaling it by a high percentile sets
    the bar by the artwork's hard edges, so a grey gridline crossing white falls under it
    (monkeys.png), while scaling by the median fails on clean renders, where every
    non-zero edge is already a real one.

    Each map is padded back to the full image size so positions index directly.
    """
    H, W = shape
    eh = np.zeros((H, W), dtype=bool)
    eh[1:, :] = dh > _EVIDENCE_THR
    ev = np.zeros((H, W), dtype=bool)
    ev[:, 1:] = dv > _EVIDENCE_THR
    return eh, ev
