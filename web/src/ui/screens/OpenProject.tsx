/**
 * #/open/<id>: where a Library card leads. Opens the project in the stage it belongs in
 * (§6.4: Work if there is progress, otherwise the stage it was last in) and replaces
 * this address with that stage's, so Back goes to the Library, not here.
 */
import { useEffect } from 'react'

import { paths, redirect } from '../../app/router.ts'
import { openingStage } from '../../app/stages.ts'
import type { Project } from '../../model/types.ts'
import { ProjectGate } from '../ProjectGate.tsx'

export function OpenProject({ id }: { id: string }) {
  return <ProjectGate id={id}>{(_, { project }) => <Redirect project={project} />}</ProjectGate>
}

function Redirect({ project }: { project: Project }) {
  useEffect(() => {
    const id = project.pattern.id
    redirect(openingStage(project) === 'work' ? paths.work(id) : paths.design(id))
  }, [project])
  return null
}
