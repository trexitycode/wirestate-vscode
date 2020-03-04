let memoKey = ''

const debouncedConsoleLog = (key, ...args) => {
  if (key !== memoKey) {
    console.log(...args)
    memoKey = key
  }
}

const defaultOptions = {
  immediate: true
}

function useMachine (
  machine,
  interpret,
  context,
  refId,
  options = defaultOptions
) {
  // Reference the service
  const serviceRef = React.useRef(null)

  // Create the service only once
  // See https://reactjs.org/docs/hooks-faq.html#how-to-create-expensive-objects-lazily
  if (serviceRef.current === null) {
    const { guards, actions, activities, services, delays } = options
    const customMachine = machine.withConfig({
      guards,
      actions,
      activities,
      services,
      delays
    }).withContext(context)

    serviceRef.current = interpret(customMachine, options)

    const listener = state => {
      // Update the current machine state when a transition occurs
      if (state.changed) {
        const tree = Treeify.asTree(state.value, true)
        debouncedConsoleLog(refId + tree, `[useMachine] [${refId}] state:\n`, tree)
        setCurrent(state)
      }
    }

    serviceRef.current.onTransition(listener)

    const send = serviceRef.current.send
    serviceRef.current.send = (...args) => {
      console.log(`[useMachine] [${refId}] send:`, ...args)
      send(...args)
    }

    // @ts-ignore
    window.service = {
      // @ts-ignore
      ...window.service,
      [refId]: {
        current: serviceRef.current,
        data: context
      }
    }
  }

  const service = serviceRef.current

  // Start service immediately (before mount) if specified in options
  if (options && options.immediate) {
    service.start()
  }

  // Keep track of the current machine state
  const [current, setCurrent] = React.useState(service.initialState)

  React.useEffect(() => {
    // Start the service when the component mounts.
    // Note: the service will start only if it hasn't started already.
    service.start()

    const tree = Treeify.asTree(service.state.value, true)
    debouncedConsoleLog(refId + tree, `[useMachine] [${refId}] initial state:\n`, tree)

    return () => {
      // Stop the service when the component unmounts
      service.stop()
    }
  }, [])

  return {
    data: context,
    current: {
      ...current,
      matches: matches => (
        Array.isArray(matches)
          ? matches.some(value => current.matches(value))
          : current.matches(matches)
      ),
      is: id => (
        Array.isArray(id)
          ? id.some(value => stateValueLeafIds(current.value).includes(value))
          : stateValueLeafIds(current.value).includes(id)
      ),
      within: id => {
        const states = current.toStrings()
        if (Array.isArray(id)) {
          return id.some(value => {
            const count = value.split('.').length
            return states.some(state => state.split('.').slice(-count).join('.') === value)
          })
        } else {
          const count = id.split('.').length
          return states.some(state => state.split('.').slice(-count).join('.') === id)
        }
      }
    },
    send: service.send,
    service
  }
}
