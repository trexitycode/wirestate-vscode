function stateValueLeafIds (obj, paths = []) {
  if (typeof obj === 'string') {
    paths.push(obj)
  } else {
    Object.keys(obj).forEach(key => {
      paths = stateValueLeafIds(obj[key], paths)
    })
  }

  return paths
}
