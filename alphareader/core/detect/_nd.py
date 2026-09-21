"""NumPy replacements for the handful of SciPy routines detection used to import.

SciPy is ~14MB of the ~23MB the browser build has to download to import a chart — 61% of
the payload for five call sites. These shims replicate the SciPy functions *exactly* for
the argument shapes this package actually uses, which is a far narrower contract than the
general routines: flat one-axis structuring elements, `mode="nearest"`, and complete
linkage cut at a distance threshold.

Each is validated against SciPy itself by `alphareader/tests/test_nd.py` over randomised
inputs, and end-to-end by `scripts/parity/check.py`. If you widen a call site's arguments
beyond what is documented here, check the shim still covers it.
"""
from __future__ import annotations

import numpy as np
from numpy.lib.stride_tricks import sliding_window_view

# --- morphology -----------------------------------------------------------------

def _window(a: np.ndarray, size: int, axis: int, left: int, right: int,
            fill) -> np.ndarray:
    pad = [(0, 0)] * a.ndim
    pad[axis] = (left, right)
    if fill == "edge":
        p = np.pad(a, pad, mode="edge")
    else:
        p = np.pad(a, pad, mode="constant", constant_values=fill)
    return sliding_window_view(p, size, axis=axis)


def binary_closing(mask: np.ndarray, structure: np.ndarray) -> np.ndarray:
    """`scipy.ndimage.binary_closing` for a flat structure that is a line on one axis.

    Closing is dilation then erosion. For an all-True structuring element of length n the
    element's origin sits at n // 2, which is what fixes the asymmetric window offsets
    below for even n; both passes use SciPy's default border_value=0.
    """
    structure = np.asarray(structure, dtype=bool)
    if structure.ndim != mask.ndim or not structure.all():
        raise ValueError("only flat, all-True structuring elements are supported")
    shape = structure.shape
    axes = [i for i, s in enumerate(shape) if s > 1]
    if len(axes) > 1:
        raise ValueError("structure must extend along at most one axis")
    if not axes:
        return mask.astype(bool)
    axis = axes[0]
    n = shape[axis]
    c = n // 2
    m = mask.astype(bool)
    # Dilation: out[i] = any(in[i - (n-1-c) : i + c + 1])
    d = _window(m, n, axis, n - 1 - c, c, False).any(axis=-1)
    # Erosion: out[i] = all(in[i - c : i + (n-1-c) + 1])
    return _window(d, n, axis, c, n - 1 - c, False).all(axis=-1)


# --- smoothing ------------------------------------------------------------------

def uniform_filter1d(x: np.ndarray, size: int, mode: str = "nearest") -> np.ndarray:
    """`scipy.ndimage.uniform_filter1d` for 1-D input with `mode="nearest"`, origin 0."""
    if mode != "nearest":
        raise ValueError("only mode='nearest' is supported")
    a = np.asarray(x, dtype=np.float64)
    if a.ndim != 1:
        raise ValueError("only 1-D input is supported")
    if size <= 1:
        return a.copy()
    c = size // 2
    return _window(a, size, 0, c, size - 1 - c, "edge").mean(axis=-1)


# --- peak finding ---------------------------------------------------------------

def _local_maxima(x: np.ndarray) -> np.ndarray:
    """Indices of local maxima, plateaus reported at their midpoint.

    Mirrors SciPy's `_local_maxima_1d`, including that a plateau running into the final
    sample is not a peak.
    """
    peaks: list[int] = []
    i, i_max = 1, x.size - 1
    while i < i_max:
        if x[i - 1] < x[i]:
            ahead = i + 1
            while ahead < i_max and x[ahead] == x[i]:
                ahead += 1
            if x[ahead] < x[i]:
                peaks.append((i + ahead - 1) // 2)
                i = ahead
        i += 1
    return np.asarray(peaks, dtype=np.intp)


def _prominences(x: np.ndarray, peaks: np.ndarray) -> np.ndarray:
    """Mirrors SciPy's `_peak_prominences` with `wlen=None`.

    SciPy walks outwards from each peak one sample at a time until it meets a higher
    one. Same definition here, but the walk is a vectorised search for that boundary
    rather than a Python loop over samples — stepping in Python made this the single
    slowest thing in detection.
    """
    out = np.empty(peaks.size, dtype=np.float64)
    for k, peak in enumerate(peaks):
        height = x[peak]
        # Walk left until a sample exceeds the peak; the base is the lowest point in
        # between, the peak itself included.
        higher = np.flatnonzero(x[:peak] > height)
        lo = higher[-1] + 1 if higher.size else 0
        left_min = x[lo:peak + 1].min()
        higher = np.flatnonzero(x[peak + 1:] > height)
        hi = peak + 1 + higher[0] if higher.size else x.size
        right_min = x[peak:hi].min()
        out[k] = height - max(left_min, right_min)
    return out


def _select_by_distance(peaks: np.ndarray, priority: np.ndarray,
                        distance: float) -> np.ndarray:
    """Mirrors SciPy's `_select_by_peak_distance`: keep the tallest, suppress neighbours."""
    n = peaks.size
    keep = np.ones(n, dtype=bool)
    d = int(np.ceil(distance))
    # SciPy orders by ascending priority and walks backwards, so the tallest peak wins
    # and equal heights resolve the same way argsort happens to order them.
    for i in np.argsort(priority)[::-1]:
        if not keep[i]:
            continue
        j = i - 1
        while j >= 0 and peaks[i] - peaks[j] < d:
            keep[j] = False
            j -= 1
        j = i + 1
        while j < n and peaks[j] - peaks[i] < d:
            keep[j] = False
            j += 1
    return keep


def find_peaks(x: np.ndarray, distance: float | None = None,
               prominence: float | None = None) -> tuple[np.ndarray, dict]:
    """`scipy.signal.find_peaks` for the `distance`/`prominence` subset used here.

    SciPy applies `distance` *before* `prominence`, so prominence is only evaluated for
    the peaks that survived suppression. Getting that order backwards changes which peaks
    come out, so it is replicated rather than tidied.
    """
    x = np.asarray(x, dtype=np.float64)
    peaks = _local_maxima(x)
    if distance is not None and peaks.size:
        peaks = peaks[_select_by_distance(peaks, x[peaks], distance)]
    props: dict = {}
    if prominence is not None and peaks.size:
        prom = _prominences(x, peaks)
        keep = prom >= prominence
        peaks = peaks[keep]
        props["prominences"] = prom[keep]
    return peaks, props


# --- clustering -----------------------------------------------------------------

def complete_linkage_labels(points: np.ndarray, threshold: float) -> np.ndarray:
    """Complete-linkage agglomerative clustering, cut so no cluster spans > `threshold`.

    Equivalent to `fcluster(linkage(points, method="complete"), t=threshold,
    criterion="distance")`: under complete linkage the merge distance is the cluster's
    diameter and increases monotonically, so cutting the dendrogram at `threshold` is the
    same as merging greedily while the closest pair's diameter stays within it.

    Labels are 1-based to match `fcluster`. Cluster *numbering* differs from SciPy's —
    which depends on dendrogram traversal order — so callers must not depend on it; the
    caller here (`build_palette`) re-derives centroids per label and sorts independently.
    """
    n = points.shape[0]
    if n == 0:
        return np.zeros(0, dtype=np.intp)
    if n == 1:
        return np.ones(1, dtype=np.intp)

    # Full pairwise distances; n is the number of *unique* cell colours, so this stays
    # small even for large charts.
    diff = points[:, None, :] - points[None, :, :]
    dist = np.sqrt((diff * diff).sum(axis=-1))

    # d[a, b] is the complete-linkage distance (max over members) between live clusters.
    d = dist.copy()
    np.fill_diagonal(d, np.inf)
    alive = np.ones(n, dtype=bool)
    members: list[list[int]] = [[i] for i in range(n)]

    # Cache each row's nearest neighbour. Without this the obvious implementation
    # re-scans a shrinking submatrix on every merge, which is O(n^3) in array copies —
    # ~23s for a JPEG-noised chart with a few thousand unique colours, against ~1s for
    # SciPy. Maintaining the cache makes the whole clustering O(n^2).
    nn_d = d.min(axis=1)
    nn_i = d.argmin(axis=1)

    live_count = n
    while live_count > 1:
        cand = np.where(alive, nn_d, np.inf)
        i = int(np.argmin(cand))
        if cand[i] > threshold:
            break
        j = int(nn_i[i])

        members[i].extend(members[j])
        members[j] = []
        alive[j] = False
        live_count -= 1

        # Complete linkage: the merged cluster's distance to every other is the max.
        row = np.maximum(d[i], d[j])
        row[~alive] = np.inf
        row[i] = np.inf
        d[i, :] = row
        d[:, i] = row
        d[j, :] = np.inf
        d[:, j] = np.inf

        nn_d[i], nn_i[i] = d[i].min(), d[i].argmin()
        nn_d[j] = np.inf
        # Merging can only *raise* distances, so rows that pointed at i or j need a
        # fresh scan; everything else keeps its cached neighbour.
        stale = np.flatnonzero(alive & ((nn_i == i) | (nn_i == j)))
        stale = stale[stale != i]
        if stale.size:
            sub = d[stale]
            nn_d[stale] = sub.min(axis=1)
            nn_i[stale] = sub.argmin(axis=1)

    labels = np.zeros(n, dtype=np.intp)
    for label, root in enumerate(np.flatnonzero(alive), start=1):
        labels[members[root]] = label
    return labels
