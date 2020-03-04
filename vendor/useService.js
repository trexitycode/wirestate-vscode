const ANY_STATE = []

function anyStatesMatch (state, states = ANY_STATE) {
  if (states === ANY_STATE) {
    return true
  } else {
    return states.some(s => state.matches(s))
  }
}

function useService (service, states = ANY_STATE) {
  const [current, setCurrent] = React.useState(service.state)

  React.useEffect(
    () => {
      if (states.length && !anyStatesMatch(service.state, states)) {
        throw new Error('[useService] When specifying which states to match, the current service state must be included: "' + service.state.toStrings() + '" not found in ["' + states.join('", "') + '"]')
      }

      // Set to current service state as there is a possibility
      // of a transition occurring between the initial useState()
      // initialization and useEffect() commit.
      console.log('[useService] initial state:\n', service.state.value)
      setCurrent(service.state)

      const listener = state => {
        if (state.changed) {
          if (anyStatesMatch(state, states)) {
            console.log('[useService] state:\n', state.value)
            setCurrent(state)
          }
        }
      }

      service.onTransition(listener)
      service.onSend((...args) => console.log('[useService] send:', ...args))

      return () => {
        service.off(listener)
      }
    },
    [service, states]
  )

  return [
    current,
    service.send,
    service
  ]
}
