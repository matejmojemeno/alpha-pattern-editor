import { APP_COMMIT, APP_VERSION } from './build.ts'

/**
 * There is no backend to send feedback to, so it is an email: crocheters rarely have a
 * GitHub account, which an issue needs. A placeholder until the app's own domain and
 * its address exist (example.com is reserved, so nothing goes to a stranger).
 */
export const FEEDBACK_EMAIL = 'feedback@example.com'

/** The email starts with what a bug report needs: the version, and a line asking for the browser and device. */
export const FEEDBACK_URL =
  `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent('Alpha Pattern Editor feedback')}` +
  `&body=${encodeURIComponent(
    `\n\n\nBrowser and device (for example Safari on an iPad): \nVersion: ${APP_VERSION}${APP_COMMIT ? ` (${APP_COMMIT})` : ''}\n`,
  )}`
