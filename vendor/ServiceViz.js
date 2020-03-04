/* eslint-disable no-unused-vars, no-undef */
// @ts-nocheck

function getChildren (machine) {
  if (!machine.states) return []

  return Object.keys(machine.states).map(key => {
    return machine.states[key]
  });
}

const Context = React.createContext(null)

function StateNodeViz ({ stateNode }) {
  const childNodes = React.useMemo(() => {
    return getChildren(stateNode)
  }, [])

  const { current, send } = React.useContext(Context)
  const stateNodePath = stateNode.path.join('.')
  const active = current.matches(stateNodePath)
  const events = Object.keys(stateNode.config && stateNode.config.on || {})

  React.useEffect(() => {
    if (active) {
      const el = document.getElementById(stateNodePath)
      el && scrollIntoViewIfOutOfView(el, { behavior: 'smooth' })
    }
  }, [active])

  return (
    React.createElement(
      'div',
      {
        className: 'state-node sn',
        id: stateNodePath,
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
            { key: event, className: 'event', onClick: () => send(event) },
            event
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

  return (
    React.createElement(
      Context.Provider,
      { value: machine },
      React.createElement(
        StateNodeViz,
        { stateNode: machine.service.machine }
      )
    )
  )
}
