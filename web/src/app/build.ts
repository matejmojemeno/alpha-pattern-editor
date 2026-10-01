/**
 * Which build this is, for Settings' About section, so a bug report can say which
 * version it's about. Both are written in by vite.config.ts at build time.
 */

declare const __APP_VERSION__: string
declare const __APP_COMMIT__: string

/** The version in web/package.json. */
export const APP_VERSION: string = __APP_VERSION__

/** The commit the build was made from, shortened to 7 characters; '' when it isn't known
 *  (a build from a folder that isn't a git checkout). */
export const APP_COMMIT: string = __APP_COMMIT__
