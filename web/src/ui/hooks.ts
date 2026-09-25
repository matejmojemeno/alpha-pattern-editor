import { useCallback, useEffect, useRef, useState, type DragEvent, type RefObject } from 'react'

import type { ProjectRepo, ProjectSummary } from '../storage/repo.ts'

/**
 * Show a Blob in an <img>: returns a ref for the image. The object URL is set on the
 * element directly and revoked when the Blob changes or the image unmounts.
 */
export function useBlobImage(blob: Blob | null | undefined): RefObject<HTMLImageElement | null> {
  const img = useRef<HTMLImageElement>(null)
  useEffect(() => {
    const el = img.current
    if (!el || !blob || typeof URL.createObjectURL !== 'function') return
    const url = URL.createObjectURL(blob)
    el.src = url
    return () => {
      el.removeAttribute('src')
      URL.revokeObjectURL(url)
    }
  }, [blob])
  return img
}

const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files')

/**
 * Drag-and-drop of files onto an element. `over` is true while files are dragged over
 * it. A counter tracks enter/leave, because dragging across child elements fires a
 * leave for the parent before the enter for the child.
 */
export function useFileDrop(onFiles: (files: File[]) => void) {
  const [over, setOver] = useState(false)
  const depth = useRef(0)
  const onDragEnter = useCallback((e: DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    depth.current++
    setOver(true)
  }, [])
  const onDragOver = useCallback((e: DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [])
  const onDragLeave = useCallback(() => {
    depth.current = Math.max(0, depth.current - 1)
    if (depth.current === 0) setOver(false)
  }, [])
  const onDrop = useCallback(
    (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth.current = 0
      setOver(false)
      onFiles([...e.dataTransfer.files])
    },
    [onFiles],
  )
  return { over, handlers: { onDragEnter, onDragOver, onDragLeave, onDrop } }
}

/**
 * An image pasted anywhere on the screen, as a File. Pastes into a text field are left
 * alone, as are pastes with no image in them.
 */
export function usePastedImage(onImage: (file: File) => void): void {
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target instanceof Element ? e.target : null
      if (target?.closest('input, textarea, [contenteditable]:not([contenteditable="false"])')) return
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'))
      if (!file) return
      e.preventDefault()
      onImage(file)
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [onImage])
}

/** Set the document title for as long as a screen is shown. */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = title ? `${title} · Alpha Pattern Editor` : 'Alpha Pattern Editor'
  }, [title])
}

/**
 * The Library listing, kept current: listed when `repo` is ready, and again after every
 * save, import or delete, from whichever screen made it. A slow listing that finishes
 * after a newer one is ignored. null until the first listing arrives.
 */
export function useProjects(repo: ProjectRepo | null): ProjectSummary[] | null {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null)
  useEffect(() => {
    if (!repo) return
    let live = true
    let latest = 0
    const relist = () => {
      const seq = ++latest
      repo.list().then(
        (l) => live && seq === latest && setProjects(l),
        () => {},
      )
    }
    const unsubscribe = repo.subscribe(relist)
    relist()
    return () => {
      live = false
      unsubscribe()
    }
  }, [repo])
  return projects
}

/** An element's content size, kept current by a ResizeObserver. Zero until measured
 *  (and in jsdom, which lays nothing out). */
export function useElementSize<T extends HTMLElement>(): [RefObject<T | null>, { width: number; height: number }] {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () =>
      setSize((s) => (s.width === el.clientWidth && s.height === el.clientHeight ? s : { width: el.clientWidth, height: el.clientHeight }))
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, size]
}

/** Whether a media query matches, kept current. `fallback` where matchMedia is missing. */
export function useMediaQuery(query: string, fallback = false): boolean {
  const get = () => (typeof matchMedia === 'function' ? matchMedia(query).matches : fallback)
  const [matches, setMatches] = useState(get)
  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    const mq = matchMedia(query)
    const change = () => setMatches(mq.matches)
    change()
    mq.addEventListener('change', change)
    return () => mq.removeEventListener('change', change)
  }, [query])
  return matches
}

/** True once `active` has stayed true for `ms`; false again as soon as it isn't. For
 *  dimming a result only when an update is slow enough to notice. */
export function useDelayedFlag(active: boolean, ms: number): boolean {
  const [on, setOn] = useState(false)
  useEffect(() => {
    if (!active) return
    const t = setTimeout(() => setOn(true), ms)
    return () => {
      clearTimeout(t)
      setOn(false)
    }
  }, [active, ms])
  return on && active
}
