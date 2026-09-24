import { useCallback, useEffect, useRef, useState, type DragEvent, type RefObject } from 'react'

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

/** Set the document title for as long as a screen is shown. */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = title ? `${title} · Alpha Pattern Editor` : 'Alpha Pattern Editor'
  }, [title])
}
