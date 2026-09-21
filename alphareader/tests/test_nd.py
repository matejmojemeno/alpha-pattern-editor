"""The NumPy shims in core/detect/_nd.py must match SciPy exactly.

SciPy is still installed on the desktop, so these compare against the real thing over
randomised inputs. That is the only way the shims are trustworthy: detection is tuned
against SciPy's precise behaviour (plateau handling, the order find_peaks applies its
filters, the origin of an even-length structuring element), and a shim that is merely
*reasonable* would shift results silently.

If SciPy is ever uninstalled these skip rather than fail — at that point
scripts/parity/check.py is the backstop.
"""
from __future__ import annotations

import numpy as np
import pytest

from alphareader.core.detect import _nd

scipy_ndimage = pytest.importorskip("scipy.ndimage")
scipy_signal = pytest.importorskip("scipy.signal")
scipy_cluster = pytest.importorskip("scipy.cluster.hierarchy")


@pytest.mark.parametrize("n", [2, 3, 4, 5, 7])
@pytest.mark.parametrize("axis", [0, 1])
def test_binary_closing_matches_scipy(n, axis):
    rng = np.random.default_rng(n * 10 + axis)
    for _ in range(25):
        m = rng.random((rng.integers(4, 40), rng.integers(4, 40))) < rng.uniform(0.2, 0.8)
        shape = (1, n) if axis == 1 else (n, 1)
        structure = np.ones(shape, dtype=bool)
        assert np.array_equal(_nd.binary_closing(m, structure),
                              scipy_ndimage.binary_closing(m, structure=structure))


def test_binary_closing_handles_all_true_and_all_false():
    structure = np.ones((1, 3), dtype=bool)
    for m in (np.ones((5, 9), dtype=bool), np.zeros((5, 9), dtype=bool)):
        assert np.array_equal(_nd.binary_closing(m, structure),
                              scipy_ndimage.binary_closing(m, structure=structure))


@pytest.mark.parametrize("size", [2, 3, 4, 5, 9])
def test_uniform_filter1d_matches_scipy(size):
    rng = np.random.default_rng(size)
    for _ in range(40):
        x = rng.normal(size=int(rng.integers(size + 1, 300))) * rng.uniform(0.1, 1000)
        got = _nd.uniform_filter1d(x, size=size, mode="nearest")
        want = scipy_ndimage.uniform_filter1d(x.astype(np.float64), size=size,
                                              mode="nearest")
        # Summation order differs, so exact equality is not guaranteed; detection only
        # needs this to be stable well below the profile's own noise floor.
        assert np.allclose(got, want, rtol=1e-12, atol=1e-12)


def _peaky(rng, n):
    """A profile shaped like a real edge profile: periodic spikes, noise, plateaus."""
    x = rng.normal(0, 0.3, size=n)
    pitch = rng.integers(4, 25)
    x[:: int(pitch)] += rng.uniform(2, 12)
    if rng.random() < 0.5:                      # flat tops, to exercise plateau handling
        x = np.round(x, 1)
    return x


def test_find_peaks_plain_matches_scipy():
    rng = np.random.default_rng(0)
    for _ in range(300):
        x = _peaky(rng, int(rng.integers(10, 400)))
        got, _ = _nd.find_peaks(x)
        want, _ = scipy_signal.find_peaks(x)
        assert np.array_equal(got, want)


def test_find_peaks_distance_and_prominence_match_scipy():
    rng = np.random.default_rng(1)
    for _ in range(300):
        x = _peaky(rng, int(rng.integers(20, 400)))
        distance = float(rng.integers(2, 12))
        prominence = float(rng.uniform(0.1, 4.0))
        got, _ = _nd.find_peaks(x, distance=distance, prominence=prominence)
        want, _ = scipy_signal.find_peaks(x, distance=distance, prominence=prominence)
        assert np.array_equal(got, want), f"distance={distance} prominence={prominence}"


def test_find_peaks_matches_on_degenerate_input():
    for x in (np.zeros(10), np.ones(3), np.arange(10.0), np.arange(10.0)[::-1],
              np.array([0.0, 1.0, 1.0, 0.0]), np.array([5.0])):
        x = np.ascontiguousarray(x, dtype=np.float64)
        got, _ = _nd.find_peaks(x, distance=2, prominence=0.5)
        want, _ = scipy_signal.find_peaks(x, distance=2, prominence=0.5)
        assert np.array_equal(got, want)


def _same_partition(a: np.ndarray, b: np.ndarray) -> bool:
    """Compare clusterings as partitions — label *numbers* are not part of the contract."""
    if a.size != b.size:
        return False
    return {frozenset(np.flatnonzero(a == k).tolist()) for k in np.unique(a)} == \
           {frozenset(np.flatnonzero(b == k).tolist()) for k in np.unique(b)}


def test_complete_linkage_matches_scipy():
    rng = np.random.default_rng(2)
    for _ in range(200):
        n = int(rng.integers(1, 60))
        pts = rng.normal(0, 30, size=(n, 3))
        t = float(rng.uniform(1, 60))
        got = _nd.complete_linkage_labels(pts, t)
        if n == 1:
            want = np.ones(1, dtype=int)
        else:
            z = scipy_cluster.linkage(pts, method="complete", metric="euclidean")
            want = scipy_cluster.fcluster(z, t=t, criterion="distance")
        assert _same_partition(got, want), f"n={n} t={t}"


def test_complete_linkage_clusters_are_within_threshold():
    """The property the ΔE slider actually exposes: no cluster wider than the threshold."""
    rng = np.random.default_rng(3)
    for _ in range(100):
        pts = rng.normal(0, 25, size=(int(rng.integers(2, 50)), 3))
        t = float(rng.uniform(5, 40))
        labels = _nd.complete_linkage_labels(pts, t)
        for k in np.unique(labels):
            members = pts[labels == k]
            if len(members) < 2:
                continue
            diff = members[:, None, :] - members[None, :, :]
            assert np.sqrt((diff * diff).sum(-1)).max() <= t + 1e-9
