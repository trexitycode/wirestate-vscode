/* eslint-disable no-unused-vars, no-undef */
// @ts-nocheck
function scrollIntoViewIfOutOfView (el, options) {
  var topOfPage = window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop
  var heightOfPage = window.innerHeight || document.documentElement.clientHeight || document.body.clientHeight
  var leftOfPage = window.pageXOffset || document.documentElement.scrollLeft || document.body.scrollLeft
  var widthOfPage = window.innerWidth || document.documentElement.clientWidth || document.body.clientWidth
  var elY = 0
  var elH = 0
  var elX = 0
  var elW = 0

  if (document.layers) {
    elY = el.y
    elH = el.height
    elX = el.x
    elW = el.width
  } else {
    for (var p = el; p && p.tagName != 'BODY'; p = p.offsetParent) {
      elY += p.offsetTop
      elX += p.offsetLeft
    }
    elH = el.offsetHeight
    elW = el.offsetWidth
  }

  if ((topOfPage + heightOfPage) < (elY + elH)) {
    el.scrollIntoView(Object.assign({
      block: 'end',
      inline: 'nearest',
    }, options))
  } else if (elY < topOfPage) {
    el.scrollIntoView(Object.assign({
      block: 'start',
      inline: 'nearest',
    }, options))
  } else if ((leftOfPage + widthOfPage) < (elX + elW)) {
    el.scrollIntoView(Object.assign({
      block: 'nearest',
      inline: 'start',
    }, options))
  } else if (elX < leftOfPage) {
    el.scrollIntoView(Object.assign({
      block: 'nearest',
      inline: 'start',
    }, options))
  }
}
