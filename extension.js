const vscode = require('vscode')
const fs = require('fs')
const path = require('path')

const MACHINE_ONLY_STATE_NAME = 'index'
const CALLBACKS_DIRECTORY_NAME = 'callbacks'
const CALLBACK_FILENAME_EXTENSION = '.js'
const CALLBACKS_INDEX_FILENAME = 'index.js'
const CALLBACKS_RELATIVE_PATH_FROM_STATECHARTS = `../${CALLBACKS_DIRECTORY_NAME}`
const DEFAULT_CALLBACK_CONTENTS_CURSOR_START_POSITION = [4, 4]
const DEFAULT_CALLBACK_CONTENTS_CURSOR_END_POSITION = [4, 18]
const DEFAULT_CALLBACK_CONTENTS = [
  `import { data } from '../../data'`,
  ``,
  `export default (evt, send) => {`,
  `  try {`,
  `    // send('...')`,
  `  } catch (error) {`,
  `    console.error(error)`,
  `    send({ type: 'error', error })`,
  `  }`,
  `}`,
  ``
].join('\n')

let disposables = []

function activate (context) {
  console.log('[wirestate] extension activated')

  // Set the wordPattern to the best approximation we can achieve to consider
  // whole state names/event names etc as single words. This makes extracting
  // what the user intends to target as a "callback" much easier.
  // Must register wordPattern via setLanguageConfiguration due to the following issue:
  // https://github.com/Microsoft/vscode/issues/42649
  vscode.languages.setLanguageConfiguration('wirestate', {
    // wordPattern: /[@a-zA-Z0-9"]+(\s+[a-zA-Z0-9"]+)*/
    wordPattern: /[@a-zA-Z0-9"]+[@a-zA-Z0-9" ]*/
  })

	context.subscriptions.push(vscode.commands.registerCommand('extension.manageCallback', function () {
    console.log('[wirestate] extension invoked')

    const editor = vscode.window.activeTextEditor

    try {
      const range = editor.document.getWordRangeAtPosition(editor.selection.active)

      if (!range) {
        throw new Error('Could not determine target state ID')
      }

      const text = editor.document.getText(range)
      const word = text.trim()
      const line = editor.document.lineAt(range.start.line).text

      if (word.startsWith('@machine ')) {
        console.log('[wirestate] manage machine from @machine')
        const machine = word.replace('@machine ', '').replace(/^"/, '').replace(/"$/, '')
        manageId(editor, machine)
      } else if (word.startsWith('@use ')) {
        console.log('[wirestate] manage machine from @use')
        const machine = word.replace('@use ', '').replace(/^"/, '').replace(/"$/, '')
        manageId(editor, machine)
      } else if (line.startsWith('import {')) {
        console.log('[wirestate] switch to file from import')
        const file = line.replace('import ', '').replace(/{[^}]+/, '').replace('} from ', '').replace(/^['"]/, '').replace(/['"]$/, '')
        manageFile(editor, file, word)
      } else {
        const lineNo = editor.selection.active.line
        const textLine = editor.document.lineAt(lineNo)
        const line = textLine.text.trim()
        const wordPosition = line.indexOf(word)
        const arrowPosition = line.indexOf('->')

        if (arrowPosition === -1 || arrowPosition < wordPosition) {
          console.log('[wirestate] manage ID')
          const machine = findMachine(editor, lineNo, word)
          manageId(editor, machine, word)
        } else {
          console.log('[wirestate] manage event')
          manageEvent(editor, word)
        }
      }
    } catch (error) {
      vscode.window.showErrorMessage(error.message)
    }
  }))

  // // Watch for callback files being saved, so as to auto-update the index file
  // // with the appropriate require statement
  // disposables.push(vscode.workspace.onDidSaveTextDocument(document => {
  //   rebuildIndexFile(document.fileName, 'add')
  // }))

  // Watch for callback files being changed, so as to auto-update the index file
  const documentUri = vscode.window.activeTextEditor.document.uri
  const workspaceFolder = (
    vscode.workspace.getWorkspaceFolder(documentUri) ||
    // In case you are not using a Workspace, the fallback assumes structure of
    // statecharts/[documentUri here], where callbacks is a sibling to statecharts
    vscode.Uri.file(path.resolve(path.dirname(documentUri.fsPath), '..')).fsPath
  )

  if (workspaceFolder) {
    console.log('[wirestate] watching workspace folder:', workspaceFolder)

    const pattern = new vscode.RelativePattern(
      workspaceFolder,
      `**/${CALLBACKS_DIRECTORY_NAME}/**/*${CALLBACK_FILENAME_EXTENSION}`
    )
    
    const watcher = vscode.workspace.createFileSystemWatcher(pattern)
    let rebuildDebounceId
    
    disposables.push(watcher.onDidChange(uri => {
      clearTimeout(rebuildDebounceId)
      rebuildDebounceId = setTimeout(() => rebuildIndexFile(uri.fsPath), 1000)
    }))

    disposables.push(watcher.onDidCreate(uri => {
      clearTimeout(rebuildDebounceId)
      rebuildDebounceId = setTimeout(() => rebuildIndexFile(uri.fsPath), 1000)
    }))

    disposables.push(watcher.onDidDelete(uri => {
      clearTimeout(rebuildDebounceId)
      rebuildDebounceId = setTimeout(() => rebuildIndexFile(uri.fsPath), 1000)
    }))
  } else {
    console.log('[wirestate] no workspace folder could be determined, cannot watch for deleted callback files')
  }
}

function manageId (editor, machine, id = MACHINE_ONLY_STATE_NAME) {
  console.log(`[wirestate] managing callback for ID [${id}] for machine [${machine}]`)

  const statechartsPath = path.dirname(editor.document.fileName)
  const callbacksPath = path.resolve(statechartsPath, CALLBACKS_RELATIVE_PATH_FROM_STATECHARTS)
  const callbacksIndexFile = path.join(callbacksPath, CALLBACKS_INDEX_FILENAME)
  const callbackFilename = `${id}${CALLBACK_FILENAME_EXTENSION}`
  const callbackFile = path.join(callbacksPath, machine, callbackFilename)

  // Make sure callbacks/index.js exists
  if (!fs.existsSync(callbacksPath)) {
    fs.mkdirSync(callbacksPath, { recursive: true })
  }
  if (!fs.existsSync(callbacksIndexFile)) {
    fs.writeFileSync(callbacksIndexFile, `export const callbacks = {}`)
  }

  if (fs.existsSync(callbackFile)) {
    console.log('[wirestate] open existing', callbackFile)

    vscode.workspace.openTextDocument(callbackFile)
      .then(doc => {
        return vscode.window.showTextDocument(doc)
      })
  } else {
    console.log('[wirestate] open untitled', callbackFile)

    let newEditor = null

    // Unfortunately it doesn't seem possible to open an "untitled" file with
    // *both* a specific filename AND initial contents. So, we create an
    // "untitled" file with specific filename, then use editor commands to
    // insert the initial content. Additionally, we then move the cursor to a
    // desired initial location.
    vscode.workspace.openTextDocument(vscode.Uri.parse(`untitled:${callbackFile}`, true))
      .then(doc => {
        return vscode.window.showTextDocument(doc)
      })
      .then(editor => {
        newEditor = editor
        return
      })
      .then(() => {
        return newEditor.edit(edit => {
          edit.insert(new vscode.Position(0, 0), DEFAULT_CALLBACK_CONTENTS)
        })
      })
      .then(() => {
        const cursor = newEditor.selection.active
        const nextCursorStart = cursor.with(...DEFAULT_CALLBACK_CONTENTS_CURSOR_START_POSITION)
        const nextCursorEnd = cursor.with(...DEFAULT_CALLBACK_CONTENTS_CURSOR_END_POSITION)
        newEditor.selection = new vscode.Selection(nextCursorStart, nextCursorEnd)
      })
  }
}

function manageFile (editor, file, target) {
  console.log('[wirestate] managing file', file, 'target', target)

  const statechartsPath = path.dirname(editor.document.fileName)
  const wsFileRaw = path.resolve(statechartsPath, file)
  const wsFile = fs.existsSync(wsFileRaw) ? wsFileRaw : `${wsFileRaw}.wirestate`

  if (fs.existsSync(wsFile)) {
    console.log('[wirestate] open existing', wsFile)

    vscode.workspace.openTextDocument(wsFile)
      .then(doc => {
        return vscode.window.showTextDocument(doc)
      })
  }
}

function manageEvent (editor, event) {
  console.log('[wirestate] managing event', event)
  throw new Error(`No support yet for managing events (${event})`)
}

function findMachine (editor, lineNo, id) {
  // Look for the nearest @machine above
  let machine = null

  for (let n = lineNo; n >= 0; n--) {
    const textLine = editor.document.lineAt(n)
    const line = textLine.text.trim()
    if (line.startsWith('@machine ')) {
      machine = line.replace('@machine ', '').replace(/^"/, '').replace(/"$/, '')
      break
    }
  }

  if (!machine) {
    throw new Error('Could not determine machine for ID: ' + id)
  }

  return machine
}

function rebuildIndexFile (filename) {
  const pathParts = filename.split(path.sep)

  // [..., 'src', 'callbacks', 'Machine Name', 'State Name.js']
  //                   ^---- we are interested in this being exactly here
  const FROM_END = 3
  const isCallbacksDirectoryAsExpected = (
    pathParts.length >= FROM_END &&
    pathParts[pathParts.length - FROM_END] === CALLBACKS_DIRECTORY_NAME
  )

  if (!isCallbacksDirectoryAsExpected) {
    return
  }

  const callbacksPath = path.join(...pathParts.slice(0, pathParts.length - FROM_END + 1))
  const callbacksIndexFile = path.join(callbacksPath, CALLBACKS_INDEX_FILENAME)

  // Read all directories in the callbacks/ folder (machine names)
  vscode.workspace.fs.readDirectory(vscode.Uri.file(callbacksPath))
    .then(machineEntries => {
      return Promise.all(machineEntries
        // Make sure to only keep directories (not files)
        .filter(([, fileType]) => fileType === vscode.FileType.Directory)
        .map(([machineName]) => {
          // Read all files in this machine's folder
          return vscode.workspace.fs.readDirectory(vscode.Uri.file(path.join(callbacksPath, machineName)))
            .then(callbackEntires => {
              return callbackEntires
                // Make sure to only keep files (callback js files)
                .filter(([, fileType]) => fileType === vscode.FileType.File)
                // Make sure we only keep the .js files
                .filter(([fileName]) => fileName.endsWith('.js'))
                // Map each entry to its callback key and require path
                .map(([filename]) => {
                  const pathParts = filename.split(path.sep)
                  const stateId = path.basename(pathParts.pop(), '.js')

                  const key = stateId === MACHINE_ONLY_STATE_NAME
                    ? `${machineName}`
                    : `${machineName}/${stateId}`

                  const requirePath = stateId === MACHINE_ONLY_STATE_NAME
                    ? `./${machineName}`
                    : `./${machineName}/${stateId}`

                  return { key, requirePath }
                })
            })
        })
      )
    })
    .then(callbackList => {
      const indexFileContents = fs.readFileSync(callbacksIndexFile).toString()
      const updatedIndexFileContents = rebuildIndexFileContents(callbackList)
  
      if (indexFileContents !== updatedIndexFileContents) {
        console.log('[wirestate] saved rebuilt callbacks index file', callbacksIndexFile)
        fs.writeFileSync(callbacksIndexFile, updatedIndexFileContents)
      } else {
        console.log('[wirestate] no changes to callbacks index file', callbacksIndexFile)
      }
    })
}

function rebuildIndexFileContents (callbackList) {
  return `export const callbacks = {
${callbackList.flat().map(({ key, requirePath }) => {
  return `  '${key}': require('${requirePath}').default`
}).join(',\n')}
}
`
}

exports.activate = activate

function deactivate () {
  console.log('[wirestate] extension deactivated')
  disposables.forEach(disposable => disposable.dispose())
  disposables = []
}

module.exports = {
	activate,
	deactivate
}
