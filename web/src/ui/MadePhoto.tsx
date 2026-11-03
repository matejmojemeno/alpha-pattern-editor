/**
 * The photo of what was made from a pattern (made.jpg; app/madePhoto.ts): added from a
 * finished card in the Library or from the Work stage once every row is done, and shown
 * as the card's thumbnail from then on.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { MADE_PHOTO_ACCEPT, madePhotoBlob, madePhotoErrorText, prepareMadePhoto } from '../app/madePhoto.ts'
import type { ProjectRepo } from '../storage/repo.ts'
import { ConfirmDialog, ImportButton, Modal } from './components.tsx'
import { useBlobImage } from './hooks.ts'

/**
 * One project's photo: `photo` is undefined while it's read, null when there is none.
 * `add` and `remove` store the change; each resolves to an error text or null.
 */
function useMadePhoto(repo: ProjectRepo, id: string) {
  const [photo, setPhoto] = useState<Blob | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let live = true
    repo.madePhoto(id).then(
      (bytes) => live && setPhoto(bytes ? madePhotoBlob(bytes) : null),
      () => live && setPhoto(null),
    )
    return () => {
      live = false
    }
  }, [repo, id])

  const store = useCallback(
    async (file: Blob | null): Promise<string | null> => {
      setBusy(true)
      try {
        const bytes = file ? await prepareMadePhoto(file) : null
        await repo.setMadePhoto(id, bytes)
        setPhoto(bytes ? madePhotoBlob(bytes) : null)
        return null
      } catch (e) {
        return madePhotoErrorText(e)
      } finally {
        setBusy(false)
      }
    },
    [repo, id],
  )
  return { photo, busy, add: (file: Blob) => store(file), remove: () => store(null) }
}

/** A button that picks one photo. */
export function PhotoButton({
  onFile,
  disabled,
  className = 'button',
  children,
}: {
  onFile: (file: File) => void
  disabled?: boolean
  className?: string
  children: string
}) {
  return (
    <ImportButton
      className={className}
      accept={MADE_PHOTO_ACCEPT}
      multiple={false}
      label="Choose a photo of what you made"
      disabled={disabled}
      onFiles={(files) => files[0] && onFile(files[0])}
    >
      {children}
    </ImportButton>
  )
}

export function MadePhotoImage({ blob, name, className }: { blob: Blob; name: string; className?: string }) {
  const img = useBlobImage(blob)
  return <img ref={img} className={className} alt={`What you made from “${name}”`} draggable={false} />
}

/**
 * The photo, large, with Replace and Remove. Remove asks first in place (the photo may
 * be the only copy left), rather than opening a second dialog over this one.
 */
export function MadePhotoDialog({ repo, id, name, onClose }: { repo: ProjectRepo; id: string; name: string; onClose: () => void }) {
  const { photo, busy, add, remove } = useMadePhoto(repo, id)
  const [error, setError] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)
  const close = useRef<HTMLButtonElement>(null)
  const keep = useRef<HTMLButtonElement>(null)
  const done = (e: string | null) => setError(e)
  // The button pressed is replaced by the question: focus goes to the safe answer.
  useEffect(() => {
    if (removing) keep.current?.focus()
  }, [removing])

  return (
    <Modal
      title={name}
      onClose={onClose}
      initialFocus={close}
      className="made-photo"
      buttons={
        removing ? (
          <>
            <span className="made-photo__ask">Remove this photo from the pattern?</span>
            <button ref={keep} type="button" className="button" onClick={() => setRemoving(false)}>
              Keep it
            </button>
            <button
              type="button"
              className="button button--danger"
              disabled={busy}
              onClick={() => {
                setRemoving(false)
                void remove().then((e) => (e ? done(e) : onClose()))
              }}
            >
              Remove
            </button>
          </>
        ) : (
          <>
            {photo && (
              <button type="button" className="button" disabled={busy} onClick={() => setRemoving(true)}>
                Remove
              </button>
            )}
            <PhotoButton disabled={busy || photo === undefined} onFile={(f) => void add(f).then(done)}>
              {photo ? 'Replace…' : 'Add photo…'}
            </PhotoButton>
            <button ref={close} type="button" className="button button--primary" onClick={onClose}>
              Close
            </button>
          </>
        )
      }
    >
      <div className="made-photo__frame">
        {photo ? (
          <MadePhotoImage blob={photo} name={name} className="made-photo__img" />
        ) : (
          <p className="muted">{photo === undefined || busy ? 'Loading…' : 'No photo yet.'}</p>
        )}
      </div>
      {error && (
        <p className="made-photo__error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  )
}

/**
 * For the Work stage once every row is done: a button to add a photo of what you made,
 * or the photo, with Replace and Remove.
 */
export function MadePhotoPanel({ repo, id, name }: { repo: ProjectRepo; id: string; name: string }) {
  const { photo, busy, add, remove } = useMadePhoto(repo, id)
  const [error, setError] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)
  if (photo === undefined) return null
  return (
    <div className="made-panel">
      {photo ? (
        <>
          <MadePhotoImage blob={photo} name={name} className="made-panel__img" />
          <div className="made-panel__buttons">
            <PhotoButton disabled={busy} className="button button--small" onFile={(f) => void add(f).then(setError)}>
              Replace…
            </PhotoButton>
            <button type="button" className="button button--small" disabled={busy} onClick={() => setRemoving(true)}>
              Remove
            </button>
          </div>
        </>
      ) : (
        <PhotoButton disabled={busy} className="button button--primary" onFile={(f) => void add(f).then(setError)}>
          {busy ? 'Adding the photo…' : 'Add a photo of what you made…'}
        </PhotoButton>
      )}
      {error && (
        <p className="made-photo__error" role="alert">
          {error}
        </p>
      )}
      {removing && (
        <ConfirmDialog
          title="Remove the photo?"
          confirmLabel="Remove"
          danger
          onCancel={() => setRemoving(false)}
          onConfirm={() => {
            setRemoving(false)
            void remove().then(setError)
          }}
        >
          <p>This browser keeps no other copy of it.</p>
        </ConfirmDialog>
      )}
    </div>
  )
}
