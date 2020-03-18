/* eslint-disable no-unused-vars, no-undef */
// @ts-nocheck

function getChildren (machine) {
  if (!machine.states) return []

  return Object.keys(machine.states).map(key => {
    return machine.states[key]
  })
}

function getLinks (stateNode, current) {
  const stateNodePath = stateNode.path.join('.')
  const active = current.matches(stateNodePath)

  const childNodes = getChildren(stateNode)
  const stateNodeId = stateNode.id.replace(/\s/g, '_')
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
            from: `${stateNodeId}:${event.replace(/\s/g, '_')}`,
            to: target
          }))
      )
    ]
  }, [])

  const childLinks = childNodes.map(childNode => getLinks(childNode, current)).flat()

  return [...(active ? localLinks : []), ...childLinks]
}

const MachineContext = React.createContext(null)

let scrollBlocked = false

function StateNodeViz ({ stateNode }) {
  const childNodes = React.useMemo(() => {
    return getChildren(stateNode)
  }, [])

  const { current, send } = React.useContext(MachineContext)
  const stateNodePath = stateNode.path.join('.')
  const stateNodeId = stateNode.id.replace(/\s/g, '_')
  const active = current.matches(stateNodePath)
  const events = Object.keys(stateNode.config && stateNode.config.on || {})

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

function ServiceViz ({ service, name }) {
  const machine = useMachine(
    service,
    XState.interpret,
    {},
    service.id
  )

  const onMessage = React.useMemo(() => {
    return (evt) => {
      const { send: event, machine: key } = evt.data
      if (key === machine.service.id && event) {
        machine.send(event)
      }
    }
  }, [machine.send])

  React.useEffect(() => {
    window.addEventListener('message', onMessage, false)
    return () => window.removeEventListener('message', onMessage)
  }, [onMessage])

  const plumb = React.useMemo(() => {
    const container = document.getElementById(`machine-container-${name}`)

    return jsPlumb.getInstance({
      Anchors: [['Right'], ['Top', 'Bottom']],
      Container: container
    })
  }, [name])

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
      connectionsRef.current = links.map(link => {
        return plumb.connect({
          source: link.from,
          target: link.to,
          paintStyle: {
            strokeWidth: 3,
            stroke: 'rgba(200, 50, 0, 0.5)'
          },
          connector: ['Flowchart', {
            cornerRadius: 8,
            stub: 16,
            midpoint: 0.5
          }],
          endpoints: ['Blank', 'Blank'],
          overlays: [['Arrow', { location: 1, width: 10, length: 10 }]],
        })
      })
    })

    plumb.repaintEverything()

    console.warn('---links', links)
  }, [machine.current.value, plumb, connectionsRef])

  return (
    React.createElement(
      MachineContext.Provider,
      { value: machine },
      React.createElement(
        'div',
        { id: `machine-container-${name}`, className: 'machine-container' },
        React.createElement(
          StateNodeViz,
          { stateNode: machine.service.machine }
        )
      )
    )
  )
}
