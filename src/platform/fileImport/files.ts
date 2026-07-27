/**
 * Getting a file's *text* into the app.
 *
 * One picker, used by both import flows — plugin source and price data. They differ
 * only in which extensions they accept, and the awkward parts (a cancelled picker, a
 * promise that must not hang) are identical, so there is one implementation of them.
 *
 * A hidden `<input type="file">` rather than the File System Access API: the latter
 * isn't available in Firefox or Safari, and this needs no write access or directory
 * handles — only bytes, once.
 */

export interface TextFile {
  /** The filename as chosen, including extension. */
  name: string
  text: string
}

/**
 * Open a picker and read what was chosen. Resolves empty if the player cancelled.
 *
 * `accept` is a comma-separated list in the form the `accept` attribute takes.
 */
export function pickTextFiles(accept: string): Promise<TextFile[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.accept = accept

    // A cancelled picker fires no `change` event in most browsers, so the promise
    // would hang forever without this. `cancel` is not universal either, which is
    // why the resolve is idempotent.
    let settled = false
    const finish = (files: TextFile[]): void => {
      if (settled) return
      settled = true
      resolve(files)
    }

    input.addEventListener('cancel', () => finish([]))
    input.addEventListener('change', () => {
      const chosen = [...(input.files ?? [])]
      void Promise.all(
        chosen.map(async (file) => ({ name: file.name, text: await file.text() }))
      ).then(finish, () => finish([]))
    })

    input.click()
  })
}

/** What the price-data import accepts. Text either way; the format is sniffed. */
export const SERIES_FILE_ACCEPT = '.csv,.json,.txt,text/csv,application/json,text/plain'
