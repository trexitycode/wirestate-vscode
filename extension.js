const vscode = require('vscode')
const fs = require('fs')
const path = require('path')
const WireState = require('@trexitycode/wirestate/lib/index')

const MACHINE_ONLY_STATE_NAME = 'index'
const CALLBACKS_DIRECTORY_NAME = 'callbacks'
const CALLBACK_FILENAME_EXTENSION = '.js'
const CALLBACKS_INDEX_FILENAME = 'index.js'
const DEFAULT_CALLBACK_CONTENTS_CURSOR_START_POSITION = [4, 4]
const DEFAULT_CALLBACK_CONTENTS_CURSOR_END_POSITION = [4, 18]

const DEFAULT_CALLBACK_CONTENTS = (machineId, callbackId) => [
  `// eslint-disable-next-line camelcase`,
  `export default function ${machineId.replace(/ /gu, '_')}__${callbackId.replace(/ /gu, '_')} (evt, send, data) {`,
  `  try {`,
  `    // send('...')`,
  `  } catch (error) {`,
  `    console.error(error)`,
  `    send({ type: 'error', error })`,
  `  }`,
  `}`,
  ``
].join('\n')

const getCallbacksRelativePathFromStatecharts = (statechartsPath) => {
  const dotdots = []
  const max = 10
  let count = 0
  let testPath = ''

  do {
    if (count++ > max) throw new Error('Unable to find callbacks path')
    dotdots.push('..')
    testPath = path.join(statechartsPath, ...dotdots, CALLBACKS_DIRECTORY_NAME)
  } while (!fs.existsSync(testPath))

  return path.resolve(testPath)
}

let disposables = []

let visualizerInstance
const visualizerViewType = 'visualizer'

const outputChannel = vscode.window.createOutputChannel('WireState')

const logger = {
  info: (...args) => {
    console.log(...args)
    outputChannel.appendLine(
      [
        `[${new Date().toISOString()}]`,
        ...args.map((arg) => JSON.stringify(arg, null, 2))
      ].join(' ')
    )
  }
}

function activate (context) {
  logger.info('extension activated')

  // Set the wordPattern to the best approximation we can achieve to consider
  // whole state names/event names etc as single words. This makes extracting
  // what the user intends to target as a "callback" much easier.
  // Must register wordPattern via setLanguageConfiguration due to the following issue:
  // https://github.com/Microsoft/vscode/issues/42649
  vscode.languages.setLanguageConfiguration('wirestate', {
    // wordPattern: /[@a-zA-Z0-9"]+(\s+[a-zA-Z0-9"]+)*/
    wordPattern: /[@a-zA-Z0-9"]+[@a-zA-Z0-9" ]*/
  })

	context.subscriptions.push(
    vscode.commands.registerCommand('wirestate.manageCallback', function () {
      logger.info('extension invoked')

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
          logger.info('manage machine from @machine')
          const machine = word.replace('@machine ', '').replace(/^"/, '').replace(/"$/, '')
          manageId(editor, machine)
        } else if (word.startsWith('@use ')) {
          logger.info('manage machine from @use')
          const machine = word.replace('@use ', '').replace(/^"/, '').replace(/"$/, '')
          manageId(editor, machine)
        } else if (line.startsWith('@import {')) {
          logger.info('switch to file from @import')
          const file = line.replace('@import ', '').replace(/{[^}]+/, '').replace('} from ', '').replace(/^['"]/, '').replace(/['"]$/, '')
          manageFile(editor, file, word)
        } else {
          const lineNo = editor.selection.active.line
          const textLine = editor.document.lineAt(lineNo)
          const line = textLine.text.trim()
          const wordPosition = line.indexOf(word)
          const arrowPosition = line.indexOf('->')

          if (arrowPosition === -1 || arrowPosition < wordPosition) {
            logger.info('manage ID')
            const machine = findMachine(editor, lineNo, word)
            manageId(editor, machine, word)
          } else {
            logger.info('manage event')
            const machine = findMachine(editor, lineNo, word)
            manageEvent(editor, machine, word)
          }
        }
      } catch (error) {
        vscode.window.showErrorMessage(error.message)
      }
    })
  )

  // Register the WireState visualizer preview
	context.subscriptions.push(
    vscode.commands.registerCommand('wirestate.visualize', async () => {
      try {
        logger.info('visualizer invoked')

        const editor = vscode.window.activeTextEditor

        const statechartPath = editor.document.fileName
        const statechartText = editor.document.getText()
        const isUntitled = editor.document.isUntitled

        await showVisualizer(context.extensionPath, statechartPath, statechartText, isUntitled)
      } catch (error) {
        vscode.window.showErrorMessage(error.message)
      }
    })
  )

  // Watch for callback files being changed, so as to auto-update the index file
  const documentUri = vscode.window.activeTextEditor.document.uri
  const workspaceFolder = (
    vscode.workspace.getWorkspaceFolder(documentUri) ||
    // In case you are not using a Workspace, the fallback assumes structure of
    // statecharts/[documentUri here], where callbacks is a sibling to statecharts
    vscode.Uri.file(path.resolve(path.dirname(documentUri.fsPath), '..')).fsPath
  )

  if (workspaceFolder) {
    logger.info('watching workspace folder:', workspaceFolder)

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
    logger.info('no workspace folder could be determined, cannot watch for deleted callback files')
  }
}

function manageId (editor, machine, id = MACHINE_ONLY_STATE_NAME) {
  logger.info(`managing callback for ID [${id}] for machine [${machine}]`)

  const statechartsPath = path.dirname(editor.document.fileName)
  const callbacksPath = getCallbacksRelativePathFromStatecharts(statechartsPath)
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
    logger.info('open existing', callbackFile)

    vscode.workspace.openTextDocument(callbackFile)
      .then(doc => {
        return vscode.window.showTextDocument(doc)
      })
  } else {
    logger.info('open untitled', callbackFile)

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
          edit.insert(new vscode.Position(0, 0), DEFAULT_CALLBACK_CONTENTS(machine, id))
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
  logger.info('managing file', file, 'target', target)

  const statechartsPath = path.dirname(editor.document.fileName)
  const wsFileRaw = path.resolve(statechartsPath, file)
  const wsFile = fs.existsSync(wsFileRaw) ? wsFileRaw : `${wsFileRaw}.wirestate`

  if (fs.existsSync(wsFile)) {
    logger.info('open existing', wsFile)

    vscode.workspace.openTextDocument(wsFile)
      .then(doc => {
        return vscode.window.showTextDocument(doc)
      })
  }
}

function manageEvent (editor, machine, event) {
  logger.info('managing event:', event)
  if (!visualizerInstance) {
    throw new Error(`No visualizer instance found to send event: ${event}`)
  }

  visualizerInstance.webview.postMessage({ send: event, machine })
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
                // Make sure to exclude .test.js files
                .filter(([fileName]) => !fileName.endsWith('.test.js'))
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
      const updatedIndexFileContents = rebuildIndexFileContents(callbacksIndexFile, callbackList)

      if (indexFileContents !== updatedIndexFileContents) {
        logger.info('saved rebuilt callbacks index file', callbacksIndexFile)
        fs.writeFileSync(callbacksIndexFile, updatedIndexFileContents)
      } else {
        logger.info('no changes to callbacks index file', callbacksIndexFile)
      }
    })
}

const toSimpleJSID = (str) => {
  return str
    .replace(/^\d/, '_$&') // leading digits are not allowed
    .replace(/ /gu, '_') // spaces are not allowed
    .replace(/-/gu, '_') // dashes are not allowed
    .replace(/[^a-zA-Z0-9]/gu, '_') // any non-alphanumeric is not allowed
}

function rebuildIndexFileContents (callbacksIndexFile, callbackList) {
  const list = callbackList
    .flat()
    .map(({ key, requirePath }) => {
      const filename = path.resolve(path.dirname(callbacksIndexFile), `${requirePath}.js`)
      const indexFilename = path.resolve(path.dirname(callbacksIndexFile), requirePath, 'index.js')

      if (fs.existsSync(filename)) {
        return { key, requirePath }
      } else if (fs.existsSync(indexFilename)) {
        return { key, requirePath: `${requirePath}/index` }
      } else {
        return null
      }
    })
    .filter(Boolean)

  const imports = list.map(({ key, requirePath }) => {
    return `import ${toSimpleJSID(key)} from '${requirePath}.js'`
  }).join('\n')

  return `${imports}

export const callbacks = {
${list.map(({ key }) => {
  return `  '${key}': ${toSimpleJSID(key)}`
}).join(',\n')}
}
`
}

// -----------------------------------------------------------------------------
// Visualizer
// -----------------------------------------------------------------------------

async function generate (statechartPath, statechartText, isUntitled) {
  // @ts-ignore
  const cache = new WireState.MemoryCache()

  if (isUntitled) {
    logger.info('compiling wirestate from text', { statechartPath, srcDir: './' })

    // @ts-ignore
    return WireState.compileFromText(statechartText, statechartPath, {
      srcDir: './',
      generatorName: 'xstate',
      cache,
      disableCallbacks: true
    })
  } else {
    const srcDir = path.dirname(statechartPath)

    logger.info('compiling wirestate', { statechartPath, srcDir })

    // @ts-ignore
    return WireState.compile(statechartPath, {
      srcDir,
      generatorName: 'xstate',
      cache,
      disableCallbacks: true
    })
  }
}

async function getHtmlForWebview (webview, extensionPath, statechartPath, statechartText, isUntitled) {
  let output = await generate(statechartPath, statechartText, isUntitled)

  logger.info('generated visualizer output', output)

  // Until we have support for the following in WireState, strip out the empty actions
  output = output.replace(/,\n\s+"actions": function \(\) \{\}/gm, '')

  // Replace "import" statement with web style
  output = output.replace(
    "import { Machine, StateNode } from 'xstate'",
    "var Machine = XState.Machine"
  )

  // Replace "export" with web style
  output = output.replace(
    "export function wirestate",
    "function wirestate"
  )

  // Fix empty machines to at least have one state
  output = output.replace(
    /([ ]*)machines\['([^']+)'\] = Machine\({\n\s*"id": "([^"]+)"\n\s*}\)/gm,
    '$1machines[\'$2\'] = Machine({\n$1$1"id": "$3",\n$1$1"initial": "<no state>",\n$1$1"states": {\n$1$1$1"<no state>": {}\n$1$1}\n$1})'
  )

  const scripts = [
    'node_modules/react/umd/react.production.min.js',
    'node_modules/react-dom/umd/react-dom.production.min.js',
    'vendor/xstate.web.js',
    'vendor/jsplumb.min.js',
    'vendor/Treeify.js',
    'vendor/stateValueLeafIds.js',
    'vendor/useMachine.js',
    'vendor/ServiceViz.js',
    'vendor/scrollIntoViewIfOutOfView.js'
  ]
    .map(script => vscode.Uri.file(path.join(extensionPath, script)))
    .map(script => webview.asWebviewUri(script))

  const styles = [
    'visualizer.css'
  ]
    .map(script => vscode.Uri.file(path.join(extensionPath, script)))
    .map(script => webview.asWebviewUri(script))

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https:; script-src 'unsafe-inline' ${webview.cspSource}; style-src 'unsafe-inline' ${webview.cspSource};" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>WireState Visualizer</title>
<script>process = { env: 'production' }</script>
${scripts.map(script => `<script src="${script}"></script>`).join('\n')}
${styles.map(style => `<link href="${style}" rel="stylesheet" />`).join('\n')}
<script>
${output}
</script>
</head>
<body>
<div id="root">Loading</div>
<script>
  const machines = wirestate({ callbacks: {} })
  ReactDOM.render(
    React.createElement(
      'div',
      { className: 'container' },
      ...Object.keys(machines).map(key => (
        React.createElement(
          'div',
          { key, className: 'machine machine-' + key },
          React.createElement(
            'h2',
            null,
            key
          ),
          React.createElement(
            ServiceViz,
            { service: machines[key] }
          )
        )
      ))
    ),
    document.getElementById('root')
  )
</script>
</body>
</html>`

  return html
}

async function createVisualizerInstance (panel, extensionPath, statechartPath, statechartText, isUntitled) {
  const disposables = []

  const update = async function () {
    logger.info('updating visualizer', {
      extensionPath,
      statechartPath,
      statechartText,
      isUntitled
    })

    panel.title = 'Visualizer'
		panel.webview.html = await getHtmlForWebview(
      panel.webview,
      extensionPath,
      statechartPath,
      statechartText,
      isUntitled
    )
  }

  const dispose = function () {
    visualizerInstance = undefined

    panel.dispose()

    while (disposables.length) {
      const handle = disposables.pop()
      if (handle) {
        handle.dispose()
      }
    }
  }

  // Set the webview's initial html content
  await update()

  // Listen for when the panel is disposed
  // This happens when the user closes the panel or when the panel is closed programatically
  panel.onDidDispose(() => dispose(), null, disposables);

  // Update the content based on view changes
  panel.onDidChangeViewState(async () => {
    if (panel.visible) {
      await update()
    }
  }, null, disposables)

  // Handle messages from the webview
  // TODO: whatever we want to send back, handle it here
  panel.webview.onDidReceiveMessage(message => {
    switch (message.command) {
      case 'alert':
        vscode.window.showErrorMessage(message.text)
        return
    }
  }, null, disposables)

  return panel
}

async function showVisualizer (extensionPath, statechartPath, statechartText, isUntitled) {
  const column = vscode.window.activeTextEditor
    ? vscode.window.activeTextEditor.viewColumn
    : undefined

  // Instance already available, reveal and return it
  if (visualizerInstance) {
    visualizerInstance.reveal(column)
    return visualizerInstance
  }

  const panel = vscode.window.createWebviewPanel(
    visualizerViewType,
    'Visualizer',
    column || vscode.ViewColumn.One,
    {
      // Enable javascript in the webview
      enableScripts: true
    }
  );

  // Create and memoize the instance
  visualizerInstance = await createVisualizerInstance(panel, extensionPath, statechartPath, statechartText, isUntitled)

  return visualizerInstance
}

// -----------------------------------------------------------------------------
// Exports / cleanup
// -----------------------------------------------------------------------------

function deactivate () {
  logger.info('extension deactivated')
  disposables.forEach(disposable => disposable.dispose())
  disposables = []
}

exports.activate = activate
exports.deactivate = deactivate
