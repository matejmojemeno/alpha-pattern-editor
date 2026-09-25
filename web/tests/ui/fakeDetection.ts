/**
 * What the component tests use in place of app/detection.ts: the real DetectClient,
 * talking to a fake worker (jsdom has no Worker, and no Pyodide).
 */
import { vi } from 'vitest'

import { DetectClient } from '../../src/detect/client.ts'
import { detectingWorker, type FakeWorker } from '../detect/fakeWorker.ts'

export const detection = {
  worker: detectingWorker() as FakeWorker,
  client: null as DetectClient | null,
  preload: vi.fn(),
  release: vi.fn(),
  /** Start over with a fresh client on `worker`. */
  reset(worker: FakeWorker = detectingWorker()) {
    this.worker = worker
    this.client = new DetectClient(() => this.worker)
    this.preload.mockClear()
    this.release.mockClear()
  },
}
detection.reset()

export const fakeDetectionModule = {
  loadDetection: () =>
    Promise.resolve({
      // As the real detector(): a fresh client once the last was disposed (the watchdog).
      detector: () => {
        if (!detection.client || detection.client.disposed) detection.client = new DetectClient(() => detection.worker)
        return detection.client
      },
      preload: () => {},
      release: () => {},
    }),
  preloadDetection: () => detection.preload(),
  releaseDetection: () => detection.release(),
}
