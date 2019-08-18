const vscode = require('vscode')
const fs = require('fs')
const path = require('path')
const recast = require('recast')

const CALLBACKS_DIRECTORY_NAME = 'callbacks'
const CALLBACKS_INDEX_FILENAME = 'index.js'
const CALLBACKS_RELATIVE_PATH_FROM_STATECHARTS = `../${CALLBACKS_DIRECTORY_NAME}`
const DEFAULT_CALLBACK_CONTENTS_CURSOR_POSITION = [1, 2]
const DEFAULT_CALLBACK_CONTENTS = [
  `export default function (evt, send) {`,
  `  `,
  `}`,
  ``
].join('\n')

let disposables = []

function activate (context) {
  console.log('[wirestate] extension activated')

  // Must register wordPattern via setLanguageConfiguration due to the following issue:
  // https://github.com/Microsoft/vscode/issues/42649
  vscode.languages.setLanguageConfiguration('wirestate', {
    wordPattern: /[@a-zA-Z0-9"]+(\s+[a-zA-Z0-9"]+)*/
  })

	let disposable = vscode.commands.registerCommand('extension.manageCallback', function () {
    console.log('[wirestate] extension invoked')

    const editor = vscode.window.activeTextEditor

    try {
      const range = editor.document.getWordRangeAtPosition(editor.selection.active)

      if (!range) {
        throw new Error('Could not determine target state ID')
      }

      const text = editor.document.getText(range)
      const word = text

      if (word.startsWith('@machine ')) {
        console.log('[wirestate] manage machine from @machine')
        const machine = word.replace('@machine ', '').replace(/^"/, '').replace(/"$/, '')
        manageId(editor, machine)
      } else if (word.startsWith('@use ')) {
        console.log('[wirestate] manage machine from @use')
        const machine = word.replace('@use ', '').replace(/^"/, '').replace(/"$/, '')
        manageId(editor, machine)
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
  })

  context.subscriptions.push(disposable)
    
  disposables.push(vscode.workspace.onDidSaveTextDocument(document => {
    rebuildIndexFile(document.fileName, 'add')
  }))

  const documentUri = vscode.window.activeTextEditor.document.uri
  const workspaceFolder = (
    vscode.workspace.getWorkspaceFolder(documentUri) ||
    vscode.Uri.file(path.resolve(path.dirname(documentUri.fsPath), '..')).fsPath // fallback assumes structure of statecharts/[documentUri here], where callbacks is a sibling to statecharts
  )

  if (workspaceFolder) {
    console.log('[wirestate] watching workspace folder:', workspaceFolder)

    const pattern = new vscode.RelativePattern(
      workspaceFolder,
      `**/${CALLBACKS_DIRECTORY_NAME}/**/*.js`
    )
    
    const watcher = vscode.workspace.createFileSystemWatcher(pattern)
    
    disposables.push(watcher.onDidDelete(uri => {
      rebuildIndexFile(uri.fsPath, 'remove')
    }))
  } else {
    console.log('[wirestate] no workspace folder could be determined, cannot watch for deleted callback files')
  }
}

function manageId (editor, machine, id = 'index') {
  console.log(`[wirestate] managing callback for ID [${id}] for machine [${machine}]`)

  const statechartsPath = path.dirname(editor.document.fileName)
  const callbacksPath = path.resolve(statechartsPath, CALLBACKS_RELATIVE_PATH_FROM_STATECHARTS)
  const callbacksIndexFile = path.join(callbacksPath, CALLBACKS_INDEX_FILENAME)
  const callbackFilename = `${id}.js`
  const callbackFile = path.join(callbacksPath, machine, callbackFilename)

  // Make sure callbacks/index.js exists
  if (!fs.existsSync(callbacksIndexFile)) {
    fs.mkdirSync(callbacksPath, { recursive: true })
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
        const nextCursor = cursor.with(...DEFAULT_CALLBACK_CONTENTS_CURSOR_POSITION)
        newEditor.selection = new vscode.Selection(nextCursor, nextCursor)
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

function rebuildIndexFile (filename, mode = 'add') {
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

  const stateId = path.basename(pathParts.pop(), '.js')
  const machineName = pathParts.pop()
  const key = stateId === 'index'
    ? `${machineName}`
    : `${machineName}/${stateId}`
  const requirePath = stateId === 'index'
    ? `./${machineName}`
    : `./${machineName}/${stateId}`

  const callbacksPath = path.join(...pathParts.slice(0, pathParts.length))
  const callbacksIndexFile = path.join(callbacksPath, CALLBACKS_INDEX_FILENAME)

  console.log('[wirestate] key:', key)
  console.log('[wirestate] require path:', requirePath)
  console.log('[wirestate] rebuild mode:', mode)

  const indexFileContents = fs.readFileSync(callbacksIndexFile).toString()
  const updatedIndexFileContents = rebuildIndexFileContents(indexFileContents, key, requirePath, mode)

  if (indexFileContents !== updatedIndexFileContents) {
    console.log('[wirestate] saved rebuilt callbacks index file', callbacksIndexFile)
    fs.writeFileSync(callbacksIndexFile, updatedIndexFileContents)
  } else {
    console.log('[wirestate] no changes to callbacks index file', callbacksIndexFile)
  }
}

function rebuildIndexFileContents (contents, key, requirePath, mode) {
  const ast = recast.parse(contents)
  const b = recast.types.builders

  const callbacksNamedExport = ast.program.body[0]
  if (callbacksNamedExport.type !== 'ExportNamedDeclaration') return

  const callbacksConst = callbacksNamedExport.declaration
  if (callbacksConst.type !== 'VariableDeclaration') return
  if (callbacksConst.kind !== 'const') return

  const callbacksVar = callbacksConst.declarations[0]
  if (callbacksVar.type !== 'VariableDeclarator') return
  if (callbacksVar.id.name !== 'callbacks') return

  const callbacksObject = callbacksVar.init
  if (callbacksObject.type !== 'ObjectExpression') return

  const callbacksObjectProps = callbacksObject.properties

  const index = callbacksObjectProps.findIndex(prop => {
    return prop.key.value === key
  })

  if (mode === 'add') {
    if (index === -1) {
      callbacksObjectProps.push(
        b.property(
          'init',
          b.literal(key),
          b.memberExpression(
            b.callExpression(
              b.identifier('require'),
              [b.literal(requirePath)]
            ),
            b.identifier('default')
          )
        )
      )
    }
  } else if (mode === 'remove') {
    if (index >= 0) {
      callbacksObjectProps.splice(index, 1)
    }
  } else {
    throw new Error('Invalid mode: ' + mode)
  }

  return recast.print(ast, { quote: 'single' }).code
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
