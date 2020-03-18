/* eslint-disable no-unused-vars, no-undef */
// @ts-nocheck

function getChildren (machine) {
  if (!machine.states) return []

  return Object.keys(machine.states).map(key => {
    return machine.states[key]
  })
}

function getLinks (stateNode, current) {
  const machineId = stateNode.machine.id
  const stateNodePath = stateNode.path.join('.')
  const active = !stateNodePath || current.matches(stateNodePath)

  const childNodes = getChildren(stateNode)
  const stateNodeId = `${machineId}:${stateNode.id.replace(/\s/g, '_')}`
  const on = stateNode.config && stateNode.config.on || {}
  const events = Object.keys(on)

  const localLinks = events.reduce((memo, event) => {
    const targets = on[event].target || []

    return [
      ...memo,
      ...(
        targets
          .map(target => target.replace(/^#/, '').replace(/\s/g, '_'))
          .map(target => ({
            source: `${stateNodeId}:${event.replace(/\s/g, '_')}`,
            target: `${machineId}:${target}`,
            active
          }))
      )
    ]
  }, [])

  const childLinks = childNodes.map(childNode => getLinks(childNode, current)).flat()

  return [...localLinks, ...childLinks]
}

const MachineContext = React.createContext(null)

let scrollBlocked = false

function StateNodeViz ({ stateNode }) {
  const machineId = stateNode.machine.id

  const { current, send } = React.useContext(MachineContext)
  const stateNodePath = stateNode.path.join('.')
  const stateNodeId = `${machineId}:${stateNode.id.replace(/\s/g, '_')}`
  const active = current.matches(stateNodePath)
  const events = Object.keys(stateNode.config && stateNode.config.on || {})

  const childNodes = React.useMemo(() => {
    return getChildren(stateNode)
  }, [])

  React.useEffect(() => {
    if (active) {
      const el = document.getElementById(stateNodeId)
      if (el) {
        if (!scrollBlocked) {
          scrollBlocked = true
          scrollIntoViewIfOutOfView(el, { behavior: 'smooth' })
          setTimeout(() => (scrollBlocked = false), 0)
        }
      }
    }
  }, [active])

  return (
    React.createElement(
      'div',
      {
        className: 'node state-node sn',
        id: stateNodeId,
        'data-active': active || undefined,
        'data-type': stateNode.type
      },
      React.createElement(
        'span',
        { className: 'state-key' },
        stateNode.key
      ),
      React.createElement(
        'ul',
        { className: 'event-container' },
        ...events.map(event => (
          React.createElement(
            'li',
            {
              key: event,
              className: 'event-container'
            },
            React.createElement(
              'span',
              {
                id: `${stateNodeId}:${event.replace(/\s/g, '_')}`,
                className: 'node event',
                onClick: () => send(event)
              },
              event
            )
          )
        ))
      ),
      React.createElement(
        'div',
        { className: 'state-node-children' },
        ...childNodes.map(childNode => (
          React.createElement(
            StateNodeViz,
            { stateNode: childNode, key: childNode.id }
          )
        ))
      )
    )
  )
}

function ServiceViz ({ service }) {
  const machine = useMachine(
    service,
    XState.interpret,
    {},
    service.id
  )

  const machineId = service.id

  const onMessage = React.useMemo(() => {
    return (evt) => {
      const { send: event, machine: key } = evt.data
      if (key === machine.service.id && event) {
        machine.send(event)
      }
    }
  }, [machine.send])

  const [showInactiveLines, setShowInactiveLines] = React.useState(false)

  React.useEffect(() => {
    window.addEventListener('message', onMessage, false)
    return () => window.removeEventListener('message', onMessage)
  }, [onMessage])

  const plumb = React.useMemo(() => {
    const container = document.getElementById(`machine-container-${machineId}`)

    return jsPlumb.getInstance({
      Anchors: [['Right', 'Left'], ['Perimeter', { shape: 'Rectangle', anchorCount: 250 }]],
      Container: container
    })
  }, [machineId])

  const connectionsRef = React.useRef([])

  React.useEffect(() => {
    if (!plumb) return

    const links = getLinks(machine.service.machine, machine.current)

    plumb.batch(() => {
      connectionsRef.current.forEach(conn => {
        plumb.deleteConnection(conn)
      })
    })

    plumb.batch(() => {
      connectionsRef.current = links
        .filter(({ active }) => showInactiveLines || active)
        .map(({ source, target, active }) => {
          return plumb.connect({
            source,
            target,
            paintStyle: {
              strokeWidth: active ? 3 : 2,
              stroke: active ? 'rgba(200, 50, 0, 0.5)' : 'rgba(0, 0, 0, 0.1)'
            },
            connector: ['Flowchart', {
              cornerRadius: 8,
              stub: 16,
              midpoint: 0.5
            }],
            endpoints: ['Blank', 'Blank'],
            overlays: [['Arrow', { location: 1, width: 8, length: 8 }]],
          })
        })
      })

    plumb.repaintEverything()
  }, [machine.current.value, plumb, connectionsRef, showInactiveLines])

  return (
    React.createElement(
      MachineContext.Provider,
      { value: machine },
      React.createElement(
        'div',
        { id: `machine-container-${machineId}`, className: 'machine-container' },
        React.createElement(
          StateNodeViz,
          { stateNode: machine.service.machine }
        ),
        React.createElement(
          'button',
          {
            className: 'active-lines-toggle',
            onClick: () => setShowInactiveLines(!showInactiveLines)
          },
          showInactiveLines ? 'Hide inactive lines' : 'Show inactive lines'
        )
      )
    )
  )
}
