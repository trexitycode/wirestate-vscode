/* eslint-disable no-unused-vars, no-undef */
// @ts-nocheck
function scrollIntoViewIfOutOfView (el, options) {
  var topOfPage = window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop
  var heightOfPage = window.innerHeight || document.documentElement.clientHeight || document.body.clientHeight
  var elY = 0
  var elH = 0

  if (document.layers) {
    elY = el.y
    elH = el.height
  } else {
    for (var p = el; p && p.tagName != 'BODY'; p = p.offsetParent) {
      elY += p.offsetTop;
    }
    elH = el.offsetHeight;
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
  }
}
