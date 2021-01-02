import GameContext from "./contexts/GameContext"
import SettingsContext from "./contexts/SettingsContext"
import { TYPE_DIGITS, TYPE_SELECTION, ACTION_CLEAR, ACTION_SET, ACTION_PUSH, ACTION_REMOVE } from "./lib/Actions"
import { xytok } from "./lib/utils"
import Color from "color"
import polygonClipping from "polygon-clipping"
import styles from "./Grid.scss"
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { flatten } from "lodash"

const SCALE_FACTOR = 1.2

let PIXI
if (typeof window !== "undefined") {
  PIXI = require("pixi.js-legacy")
}

function unionCells(cells) {
  let polys = cells.map(cell => {
    let y = cell[0]
    let x = cell[1]
    return [[
      [x + 0, y + 0],
      [x + 1, y + 0],
      [x + 1, y + 1],
      [x + 0, y + 1]
    ]]
  })
  let unions = polygonClipping.union(polys)
  for (let u of unions) {
    for (let p of u) {
      let f = p[0]
      let l = p[p.length - 1]
      if (f[0] === l[0] && f[1] === l[1]) {
        p.splice(p.length - 1, 1)
      }
    }
  }
  return flatten(flatten(flatten(unions)))
}

function hasCageValue(x, y, cages) {
  for (let cage of cages) {
    if (cage.topleft[0] === y && cage.topleft[1] === x) {
      return true
    }
  }
  return false
}

function hasGivenCornerMarks(cell) {
  if (cell.pencilMarks === undefined) {
    return false
  }
  if (Array.isArray(cell.pencilMarks) && cell.pencilMarks.length === 0) {
    return false
  }
  return cell.pencilMarks !== ""
}

// shrink polygon inwards by distance `d`
function shrinkPolygon(points, d) {
  let result = []

  for (let i = 0; i < points.length; i += 2) {
    let p1x = points[(i - 2 + points.length) % points.length]
    let p1y = points[(i - 1 + points.length) % points.length]
    let p2x = points[(i + 0) % points.length]
    let p2y = points[(i + 1) % points.length]
    let p3x = points[(i + 2) % points.length]
    let p3y = points[(i + 3) % points.length]

    let ax = p2x - p1x
    let ay = p2y - p1y
    let anx = -ay
    let any = ax
    let al = Math.sqrt(anx * anx + any * any)
    anx /= al
    any /= al

    let bx = p3x - p2x
    let by = p3y - p2y
    let bnx = -by
    let bny = bx
    let bl = Math.sqrt(bnx * bnx + bny * bny)
    bnx /= bl
    bny /= bl

    let nx = anx + bnx
    let ny = any + bny

    result.push(p2x + nx * d)
    result.push(p2y + ny * d)
  }

  return result
}

// dispose edges of given polygon by distance `d` whenever they lie on an
// edge of one of the other given polygons
function disposePolygon(points, otherPolygons, d) {
  let result = [...points]
  for (let i = 0; i < points.length; i += 2) {
    let p1x = points[i]
    let p1y = points[i + 1]
    let p2x = points[(i + 2) % points.length]
    let p2y = points[(i + 3) % points.length]

    let sx = p1y < p2y ? -1 : 1
    let sy = p1x > p2x ? -1 : 1

    for (let otherPoints of otherPolygons) {
      let disposed = false
      for (let j = 0; j < otherPoints.length; j += 2) {
        let o1x = otherPoints[j]
        let o1y = otherPoints[j + 1]
        let o2x = otherPoints[(j + 2) % otherPoints.length]
        let o2y = otherPoints[(j + 3) % otherPoints.length]

        if (o1x > o2x) {
          let x = o2x
          o2x = o1x
          o1x = x
        }
        if (o1y > o2y) {
          let y = o2y
          o2y = o1y
          o1y = y
        }

        // simplified because we know edges are always vertical or horizontal
        if (o1x === o2x && p1x === o1x && p2x === o2x &&
            ((o1y <= p1y && o2y >= p1y) || (o1y <= p2y && o2y >= p2y))) {
          result[i] = p1x + d * sx
          result[(i + 2) % points.length] = p2x + d * sx
          disposed = true
          break
        }
        if (o1y === o2y && p1y === o1y && p2y === o2y &&
            ((o1x <= p1x && o2x >= p1x) || (o1x <= p2x && o2x >= p2x))) {
          result[i + 1] = p1y + d * sy
          result[(i + 3) % points.length] = p2y + d * sy
          disposed = true
          break
        }
      }
      if (disposed) {
        break
      }
    }
  }
  return result
}

// based on https://codepen.io/unrealnl/pen/aYaxBW by Erik
// published under the MIT license
function drawDashedPolygon(points, dash, gap, graphics) {
  let dashLeft = 0
  let gapLeft = 0

  for (let i = 0; i < points.length; i += 2) {
    let p1x = points[i]
    let p1y = points[i + 1]
    let p2x = points[(i + 2) % points.length]
    let p2y = points[(i + 3) % points.length]

    let dx = p2x - p1x
    let dy = p2y - p1y

    let len = Math.sqrt(dx * dx + dy * dy)
    let normalx = dx / len
    let normaly = dy / len
    let progressOnLine = 0

    graphics.moveTo(p1x + gapLeft * normalx, p1y + gapLeft * normaly)

    while (progressOnLine <= len) {
      progressOnLine += gapLeft

      if (dashLeft > 0) {
        progressOnLine += dashLeft
      } else {
        progressOnLine += dash
      }

      if (progressOnLine > len) {
        dashLeft = progressOnLine - len
        progressOnLine = len
      } else {
        dashLeft = 0
      }

      graphics.lineTo(p1x + progressOnLine * normalx, p1y + progressOnLine * normaly)

      progressOnLine += gap

      if (progressOnLine > len && dashLeft === 0) {
        gapLeft = progressOnLine - len
      } else {
        gapLeft = 0
        graphics.moveTo(p1x + progressOnLine * normalx, p1y + progressOnLine * normaly)
      }
    }
  }
}

function isGrey(nColour) {
  let r = (nColour >> 16) & 0xff
  let g = (nColour >> 8) & 0xff
  let b = nColour & 0xff
  return r === g && r === b
}

// PIXI makes lines with round cap slightly longer. This function shortens them.
function shortenLine(points) {
  if (points.length <= 2) {
    return points
  }

  let firstPointX = points[0]
  let firstPointY = points[1]
  let secondPointX = points[2]
  let secondPointY = points[3]
  let lastPointX = points[points.length - 2]
  let lastPointY = points[points.length - 1]
  let secondToLastX = points[points.length - 4]
  let secondToLastY = points[points.length - 3]

  let dx = secondPointX - firstPointX
  let dy = secondPointY - firstPointY
  let l = Math.sqrt(dx * dx + dy * dy)
  dx /= l
  dy /= l
  firstPointX = firstPointX + dx * 3
  firstPointY = firstPointY + dy * 3

  dx = secondToLastX - lastPointX
  dy = secondToLastY - lastPointY
  l = Math.sqrt(dx * dx + dy * dy)
  dx /= l
  dy /= l
  lastPointX = lastPointX + dx * 3
  lastPointY = lastPointY + dy * 3

  return [firstPointX, firstPointY, ...points.slice(2, points.length - 2),
    lastPointX, lastPointY]
}

function makeCornerMarks(x, y, cellSize, fontSize, leaveRoom, n = 10, fontWeight = "normal") {
  let result = []

  for (let i = 0; i < n; ++i) {
    let text = new PIXI.Text("", {
      fontFamily: "Tahoma, Verdana, sans-serif",
      fontSize,
      fontWeight
    })

    let cx = x * cellSize + cellSize / 2
    let cy = y * cellSize + cellSize / 2 - 0.5
    let mx = cellSize / 3.2
    let my = cellSize / 3.4

    switch (i) {
      case 0:
        if (leaveRoom) {
          text.x = cx - mx / 3
          text.y = cy - my
        } else {
          text.x = cx - mx
          text.y = cy - my
        }
        break
      case 4:
        if (leaveRoom) {
          text.x = cx + mx / 3
          text.y = cy - my
        } else {
          text.x = cx
          text.y = cy - my
        }
        break
      case 1:
        text.x = cx + mx
        text.y = cy - my
        break
      case 6:
        text.x = cx - mx
        text.y = cy
        break
      case 7:
        text.x = cx + mx
        text.y = cy
        break
      case 2:
        text.x = cx - mx
        text.y = cy + my
        break
      case 5:
        text.x = cx
        text.y = cy + my
        break
      case 3:
        text.x = cx + mx
        text.y = cy + my
        break
      case 8:
        text.x = cx - mx / 3
        text.y = cy + my
        break
      case 9:
        text.x = cx + mx / 3
        text.y = cy + my
        break
    }

    text.anchor.set(0.5)
    text.scale.x = 0.5
    text.scale.y = 0.5

    result.push(text)
  }

  return result
}

const Grid = ({ maxWidth, maxHeight, portrait, onFinishRender }) => {
  const ref = useRef()
  const app = useRef()
  const gridElement = useRef()
  const cellsElement = useRef()
  const allElement = useRef()
  const gridBounds = useRef()
  const allBounds = useRef()
  const cellElements = useRef([])
  const digitElements = useRef([])
  const centreMarkElements = useRef([])
  const cornerMarkElements = useRef([])
  const colourElements = useRef([])
  const selectionElements = useRef([])
  const errorElements = useRef([])
  const [foregroundColor, setForegroundColor] = useState()
  const [digitColor, setDigitColor] = useState()

  const game = useContext(GameContext.State)
  const updateGame = useContext(GameContext.Dispatch)
  const settings = useContext(SettingsContext.State)

  const cellSize = game.data.cellSize * SCALE_FACTOR

  const regions = useMemo(() => game.data.regions.map(region => {
    return unionCells(region).map(v => v * cellSize)
  }), [game.data, cellSize])

  const cages = useMemo(() => game.data.cages
    .filter(cage => cage.cells?.length)
    .map(cage => {
      let union = unionCells(cage.cells).map(v => v * cellSize)

      // find top-left cell
      let topleft = cage.cells[0]
      for (let cell of cage.cells) {
        if (cell[0] < topleft[0]) {
          topleft = cell
        } else if (cell[0] === topleft[0] && cell[1] < topleft[1]) {
          topleft = cell
        }
      }

      return {
        outline: union,
        value: cage.value,
        topleft
      }
    }), [game.data, cellSize])

  const cellToScreenCoords = useCallback((cell, mx, my) => {
    return [cell[1] * cellSize + mx, cell[0] * cellSize + my]
  }, [cellSize])

  const drawOverlay = useCallback((overlay, mx, my, zIndex = -1) => {
    let r = new PIXI.Graphics()

    if (overlay.text !== undefined) {
      let fontSize = overlay.fontSize || 20
      fontSize *= SCALE_FACTOR * (1 / 0.75)
      let text = new PIXI.Text(overlay.text, {
        fontFamily: "Tahoma, Verdana, sans-serif",
        fontSize
      })
      text.anchor.set(0.5)
      text.scale.x = 0.75
      text.scale.y = 0.75
      r.addChild(text)
    }

    let center = cellToScreenCoords(overlay.center, mx, my)
    r.x = center[0]
    r.y = center[1]

    if (overlay.backgroundColor !== undefined || overlay.borderColor !== undefined) {
      let nBackgroundColour
      if (overlay.backgroundColor !== undefined) {
        nBackgroundColour = Color(overlay.backgroundColor).rgbNumber()
        r.beginFill(nBackgroundColour, isGrey(nBackgroundColour) ? 1 : 0.5)
      }
      if (overlay.borderColor !== undefined) {
        let nBorderColour = Color(overlay.borderColor).rgbNumber()
        if (nBorderColour !== nBackgroundColour &&
            !(overlay.width === 1 && overlay.height === 1 && isGrey(nBorderColour))) {
          r.lineStyle({
            width: 2,
            color: nBorderColour,
            alpha: isGrey(nBorderColour) ? 1 : 0.5,
            alignment: 0
          })
        }
      }
      let w = overlay.width * cellSize
      let h = overlay.height * cellSize
      if (overlay.rounded) {
        if (w === h) {
          r.drawEllipse(0, 0, w / 2, h / 2)
        } else {
          r.drawRoundedRect(-w / 2, -h / 2, w, h, Math.min(w, h) / 2 - 1)
        }
      } else {
        r.drawRect(-w / 2, -h / 2, w, h)
      }
      if (overlay.backgroundColor !== undefined) {
        r.endFill()
      }
    }

    r.zIndex = zIndex

    return r
  }, [cellSize, cellToScreenCoords])

  const selectCell = useCallback((cell, evt, append = false) => {
    let action = append ? ACTION_PUSH : ACTION_SET
    let oe = evt?.data?.originalEvent
    if (oe?.metaKey || oe?.ctrlKey) {
      if (oe?.shiftKey) {
        action = ACTION_REMOVE
      } else {
        action = ACTION_PUSH
      }
    }
    updateGame({
      type: TYPE_SELECTION,
      action,
      k: cell.data.k
    })
  }, [updateGame])

  const onKeyDown = useCallback(e => {
    let digit = e.code.match("Digit([1-9])")
    if (digit) {
      updateGame({
        type: TYPE_DIGITS,
        action: ACTION_SET,
        digit: +digit[1]
      })
      e.preventDefault()
    }

    let numpad = e.code.match("Numpad([1-9])")
    if (numpad && +e.key === +numpad[1]) {
      updateGame({
        type: TYPE_DIGITS,
        action: ACTION_SET,
        digit: +numpad[1]
      })
      e.preventDefault()
    }

    if (e.key === "Backspace" || e.key === "Delete" || e.key === "Clear") {
      updateGame({
        type: TYPE_DIGITS,
        action: ACTION_REMOVE
      })
    }
  }, [updateGame])

  function onBackgroundClick(e) {
    e.stopPropagation()
  }

  function onDoubleClick(e) {
    if (game.selection.size === 0 || !e.altKey) {
      return
    }

    // get color of last cell clicked
    let last = [...game.selection].pop()
    let colour = game.colours.get(last)

    if (colour !== undefined) {
      // find all cells with the same colour
      let allCells = []
      for (let [k, c] of game.colours) {
        if (c.colour === colour.colour) {
          allCells.push(k)
        }
      }

      let action = (e.metaKey || e.ctrlKey) ? ACTION_PUSH : ACTION_SET
      updateGame({
        type: TYPE_SELECTION,
        action,
        k: allCells
      })
    }
  }

  const onResize = useCallback(() => {
    let marginTop = gridBounds.current.y - allBounds.current.y
    let marginBottom = allBounds.current.y + allBounds.current.height -
      (gridBounds.current.y + gridBounds.current.height)
    let marginLeft = gridBounds.current.x - allBounds.current.x
    let marginRight = allBounds.current.x + allBounds.current.width -
      (gridBounds.current.x + gridBounds.current.width)
    let additionalMarginX = 0
    let additionalMarginY = 0
    if (portrait) {
      additionalMarginX = Math.abs(marginLeft - marginRight)
    } else {
      additionalMarginY = Math.abs(marginTop - marginBottom)
    }

    let w = allBounds.current.width
    let h = allBounds.current.height
    let wWithM = w + additionalMarginX
    let hWithM = h + additionalMarginY
    let scale = 1
    if (wWithM > maxWidth || hWithM > maxHeight) {
      let scaleX = maxWidth / wWithM
      let scaleY = maxHeight / hWithM
      scale = scaleX < scaleY ? scaleX : scaleY
      w *= scale
      h *= scale
    }

    if (w < 0 || h < 0) {
      return
    }

    app.current.renderer.resize(w, h)
    allElement.current.x = -allBounds.current.x * scale
    allElement.current.y = -allBounds.current.y * scale
    allElement.current.scale.x = scale
    allElement.current.scale.y = scale

    if (marginTop > marginBottom) {
      ref.current.style.marginTop = "0"
      ref.current.style.marginBottom = `${additionalMarginY * scale}px`
    } else {
      ref.current.style.marginTop = `${additionalMarginY * scale}px`
      ref.current.style.marginBottom = "0"
    }
    if (marginLeft > marginRight) {
      ref.current.style.marginLeft = "0"
      ref.current.style.marginRight = `${additionalMarginX * scale}px`
    } else {
      ref.current.style.marginLeft = `${additionalMarginX * scale}px`
      ref.current.style.marginRight = "0"
    }

    app.current.render()
  }, [maxWidth, maxHeight, portrait])

  const onTouchMove = useCallback((e) => {
    let touch = e.touches[0]
    let x = touch.pageX
    let y = touch.pageY
    let interactionManager = app.current.renderer.plugins.interaction
    let p = {}
    interactionManager.mapPositionToPoint(p, x, y)
    let hit = interactionManager.hitTest(p, cellsElement.current)
    if (hit?.data?.k !== undefined) {
      selectCell(hit, e, true)
    }
  }, [selectCell])

  useEffect(() => {
    // optimised resolution for different screens
    let resolution = Math.min(window.devicePixelRatio,
      window.devicePixelRatio === 2 ? 3 : 2.5)

    // create PixiJS app
    let newApp = new PIXI.Application({
      resolution,
      antialias: true,
      transparent: false,
      autoDensity: true,
      autoStart: false
    })
    ref.current.appendChild(newApp.view)
    app.current = newApp

    // register touch handler
    newApp.view.addEventListener("touchmove", onTouchMove)

    return () => {
      newApp.view.removeEventListener("touchmove", onTouchMove)
      newApp.destroy(true, true)
      app.current = undefined
    }
  }, [settings.theme, onTouchMove])

  useEffect(() => {
    app.current.stage.removeChildren()

    let rootStyle = getComputedStyle(ref.current)
    let backgroundColor = Color(rootStyle.getPropertyValue("--bg")).rgbNumber()
    let foregroundColor = Color(rootStyle.getPropertyValue("--fg")).rgbNumber()
    let digitColor = Color(rootStyle.getPropertyValue("--digit")).rgbNumber()
    setForegroundColor(foregroundColor)
    setDigitColor(digitColor)

    // optimised font sizes for different screens
    let fontSizeCornerMarks = window.devicePixelRatio >= 2 ? 27 : 28
    let fontSizeCentreMarks = window.devicePixelRatio >= 2 ? 28 : 29

    // create grid
    let all = new PIXI.Container()
    allElement.current = all
    let grid = new PIXI.Container()
    gridElement.current = grid
    let cells = new PIXI.Container()
    cellsElement.current = cells

    all.sortableChildren = true
    grid.sortableChildren = true

    // ***************** Layers and zIndexes:

    // all                            sortable
    //   background            -1000
    //   lines and arrows         -1
    //   arrow heads              -1
    //   underlays                -1
    //   colour                    0
    //   errors                   10
    //   selection                20
    //   grid                     30  sortable
    //     region                 10
    //     cage outline            1
    //     cage label              3
    //     cage label background   2
    //     cells
    //       cell                  0
    //   overlays                 40
    //   given corner marks       41
    //   digit                    50
    //   corner marks             50
    //   centre marks             50

    // ***************** render everything that could contribute to bounds

    // render cells
    game.data.cells.forEach((row, y) => {
      row.forEach((col, x) => {
        let cell = new PIXI.Graphics()
        cell.interactive = true
        cell.buttonMode = true

        cell.data = {
          k: xytok(x, y)
        }

        cell.lineStyle({ width: 1, color: foregroundColor })
        cell.drawRect(0, 0, cellSize, cellSize)

        cell.x = x * cellSize
        cell.y = y * cellSize

        // since our cells have a transparent background, we need to
        // define a hit area
        cell.hitArea = new PIXI.Rectangle(0, 0, cellSize, cellSize)

        cell.on("pointerdown", function (e) {
          selectCell(this, e)
          e.stopPropagation()
          e.data.originalEvent.preventDefault()
        })

        cell.on("pointerover", function (e) {
          if (e.data.buttons === 1) {
            selectCell(this, e, true)
          }
          e.stopPropagation()
        })

        cells.addChild(cell)
        cellElements.current.push(cell)
      })
    })

    // render regions
    for (let r of regions) {
      let poly = new PIXI.Graphics()
      poly.lineStyle({ width: 3, color: foregroundColor })
      poly.drawPolygon(r)
      poly.zIndex = 10
      grid.addChild(poly)
    }

    // render cages
    for (let cage of cages) {
      // draw outline
      let poly = new PIXI.Graphics()
      let disposedOutline = disposePolygon(cage.outline, regions, 1)
      let shrunkenOutline = shrinkPolygon(disposedOutline, 3)
      poly.lineStyle({ width: 1, color: foregroundColor })
      drawDashedPolygon(shrunkenOutline, 3, 2, poly)
      poly.zIndex = 1
      grid.addChild(poly)

      if (cage.value !== undefined && cage.value.trim() !== "") {
        // create cage label
        // use larger font and scale down afterwards to improve text rendering
        let topleftText = new PIXI.Text(cage.value, {
          fontFamily: "Tahoma, Verdana, sans-serif",
          fontSize: 26
        })
        topleftText.zIndex = 3
        topleftText.x = cage.topleft[1] * cellSize + cellSize / 20
        topleftText.y = cage.topleft[0] * cellSize + cellSize / 60
        topleftText.scale.x = 0.5
        topleftText.scale.y = 0.5
        grid.addChild(topleftText)

        let topleftBg = new PIXI.Graphics()
        topleftBg.beginFill(0xffffff)
        topleftBg.drawRect(0, 0, topleftText.width + cellSize / 10 - 1, topleftText.height + cellSize / 60)
        topleftBg.endFill()
        topleftBg.zIndex = 2
        topleftBg.x = cage.topleft[1] * cellSize + 0.5
        topleftBg.y = cage.topleft[0] * cellSize + 0.5
        grid.addChild(topleftBg)
      }
    }

    grid.addChild(cells)
    grid.zIndex = 30
    all.addChild(grid)

    // add lines and arrows
    game.data.lines.concat(game.data.arrows).forEach(line => {
      let poly = new PIXI.Graphics()
      let points = shortenLine(flatten(line.wayPoints.map(wp => cellToScreenCoords(wp, grid.x, grid.y))))
      poly.lineStyle({
        width: line.thickness * SCALE_FACTOR,
        color: Color(line.color).rgbNumber(),
        cap: PIXI.LINE_CAP.ROUND,
        join: PIXI.LINE_JOIN.ROUND
      })
      poly.moveTo(points[0], points[1])
      for (let i = 2; i < points.length; i += 2) {
        poly.lineTo(points[i], points[i + 1])
      }
      poly.zIndex = -1
      all.addChild(poly)
    })

    // add arrow heads
    game.data.arrows.forEach(arrow => {
      if (arrow.wayPoints.length <= 1) {
        return
      }
      let poly = new PIXI.Graphics()
      let points = shortenLine(flatten(arrow.wayPoints.map(wp => cellToScreenCoords(wp, grid.x, grid.y))))
      let lastPointX = points[points.length - 2]
      let lastPointY = points[points.length - 1]
      let secondToLastX = points[points.length - 4]
      let secondToLastY = points[points.length - 3]
      let dx = lastPointX - secondToLastX
      let dy = lastPointY - secondToLastY
      let l = Math.sqrt(dx * dx + dy * dy)
      dx /= l
      dy /= l
      let f = arrow.headLength * cellSize * 0.7
      let ex = lastPointX - dx * f
      let ey = lastPointY - dy * f
      let ex1 = ex - dy * f
      let ey1 = ey + dx * f
      let ex2 = ex + dy * f
      let ey2 = ey - dx * f
      poly.lineStyle({
        width: arrow.thickness * SCALE_FACTOR,
        color: Color(arrow.color).rgbNumber(),
        cap: PIXI.LINE_CAP.ROUND,
        join: PIXI.LINE_JOIN.ROUND
      })
      poly.moveTo(lastPointX, lastPointY)
      poly.lineTo(ex1, ey1)
      poly.moveTo(lastPointX, lastPointY)
      poly.lineTo(ex2, ey2)
      poly.zIndex = -1
      all.addChild(poly)
    })

    // add underlays and overlays
    game.data.underlays.forEach(underlay => {
      all.addChild(drawOverlay(underlay, grid.x, grid.y))
    })
    game.data.overlays.forEach(overlay => {
      all.addChild(drawOverlay(overlay, grid.x, grid.y, 40))
    })

    // calculating bounds is expensive, so do it now after we've rendered
    // all elements that could contribute to the bounds
    gridBounds.current = grid.getBounds()
    allBounds.current = all.getBounds()

    // Align bounds to half pixel. This makes sure the grid is always sharp
    // and lines to not sit between pixels.
    allBounds.current.x = Math.floor(allBounds.current.x * 2) / 2
    allBounds.current.y = Math.floor(allBounds.current.y * 2) / 2
    allBounds.current.width = Math.ceil(allBounds.current.width * 2) / 2
    allBounds.current.height = Math.ceil(allBounds.current.height * 2) / 2

    // draw a background that covers all elements
    let background = new PIXI.Graphics()
    background.hitArea = new PIXI.Rectangle(allBounds.current.x, allBounds.current.y,
      allBounds.current.width, allBounds.current.height)
    background.beginFill(backgroundColor)
    background.drawRect(allBounds.current.x, allBounds.current.y,
      allBounds.current.width, allBounds.current.height)
    background.endFill()
    background.interactive = true
    background.zIndex = -1000
    background.on("pointerdown", () => {
      updateGame({
        type: TYPE_SELECTION,
        action: ACTION_CLEAR
      })
    })

    all.addChild(background)
    allBounds.current = all.getBounds()
    app.current.stage.addChild(all)
    app.current.render()

    // ***************** draw other elements that don't contribute to the bounds

    // create text elements for given corner marks
    game.data.cells.forEach((row, y) => {
      row.forEach((col, x) => {
        let arr = col.pencilMarks
        if (arr === undefined) {
          return
        }
        if (!Array.isArray(arr)) {
          arr = [arr]
        }

        let hcv = hasCageValue(x, y, cages)
        let cms = makeCornerMarks(x, y, cellSize, fontSizeCornerMarks, hcv,
            arr.length, "bold")
        cms.forEach((cm, i) => {
          cm.zIndex = 41
          cm.style.fill = foregroundColor
          cm.text = arr[i]
          all.addChild(cm)
        })
      })
    })

    // ***************** draw invisible elements but don't call render() again!

    // create empty text elements for all digits
    game.data.cells.forEach((row, y) => {
      row.forEach((col, x) => {
        let text = new PIXI.Text("", {
          fontFamily: "Tahoma, Verdana, sans-serif",
          fontSize: 40
        })
        text.zIndex = 50
        text.x = x * cellSize + cellSize / 2
        text.y = y * cellSize + cellSize / 2 - 0.5
        text.anchor.set(0.5)
        text.data = {
          k: xytok(x, y)
        }
        all.addChild(text)
        digitElements.current.push(text)
      })
    })

    // create empty text elements for corner marks
    game.data.cells.forEach((row, y) => {
      row.forEach((col, x) => {
        let cell = {
          data: {
            k: xytok(x, y)
          },
          elements: []
        }

        let leaveRoom = hasCageValue(x, y, cages) || hasGivenCornerMarks(col)
        let cms = makeCornerMarks(x, y, cellSize, fontSizeCornerMarks, leaveRoom, 10)
        for (let cm of cms) {
          cm.zIndex = 50
          cm.style.fill = digitColor
          all.addChild(cm)
          cell.elements.push(cm)
        }

        cornerMarkElements.current.push(cell)
      })
    })

    // create empty text elements for centre marks
    game.data.cells.forEach((row, y) => {
      row.forEach((col, x) => {
        let text = new PIXI.Text("", {
          fontFamily: "Tahoma, Verdana, sans-serif",
          fontSize: fontSizeCentreMarks
        })
        text.zIndex = 50
        text.x = x * cellSize + cellSize / 2
        text.y = y * cellSize + cellSize / 2 - 0.5
        text.anchor.set(0.5)
        text.style.fill = digitColor
        text.scale.x = 0.5
        text.scale.y = 0.5
        text.data = {
          k: xytok(x, y)
        }
        all.addChild(text)
        centreMarkElements.current.push(text)
      })
    })

    // create invisible rectangles for colours
    game.data.cells.forEach((row, y) => {
      row.forEach((col, x) => {
        let rect = new PIXI.Graphics()
        rect.x = x * cellSize
        rect.y = y * cellSize
        rect.alpha = 0
        rect.zIndex = 0
        rect.data = {
          k: xytok(x, y)
        }
        all.addChild(rect)
        colourElements.current.push(rect)
      })
    })

    // create invisible rectangles for selection
    game.data.cells.forEach((row, y) => {
      row.forEach((col, x) => {
        let rect = new PIXI.Graphics()
        rect.beginFill(0xffde2a, 0.5)
        rect.drawRect(0.5, 0.5, cellSize - 1, cellSize - 1)
        rect.endFill()
        rect.x = x * cellSize
        rect.y = y * cellSize
        rect.alpha = 0
        rect.zIndex = 20
        rect.data = {
          k: xytok(x, y)
        }
        all.addChild(rect)
        selectionElements.current.push(rect)
      })
    })

    // create invisible rectangles for errors
    game.data.cells.forEach((row, y) => {
      row.forEach((col, x) => {
        let rect = new PIXI.Graphics()
        rect.beginFill(0xb33a3a, 0.5)
        rect.drawRect(0.5, 0.5, cellSize - 1, cellSize - 1)
        rect.endFill()
        rect.x = x * cellSize
        rect.y = y * cellSize
        rect.alpha = 0
        rect.zIndex = 10
        rect.data = {
          k: xytok(x, y)
        }
        all.addChild(rect)
        errorElements.current.push(rect)
      })
    })

    if (onFinishRender) {
      onFinishRender()
    }

    return () => {
      allElement.current = undefined
      gridElement.current = undefined
      cellsElement.current = undefined
      gridBounds.current = undefined
      allBounds.current = undefined
      cellElements.current = []
      digitElements.current = []
      centreMarkElements.current = []
      cornerMarkElements.current = []
      colourElements.current = []
      selectionElements.current = []
      errorElements.current = []
    }
  }, [game.data, settings.theme, cellSize, regions, cages, cellToScreenCoords,
      drawOverlay, selectCell, updateGame, onFinishRender])

  useEffect(() => {
    onResize()
  }, [onResize, settings.theme])

  // register keyboard handlers
  useEffect(() => {
    window.addEventListener("keydown", onKeyDown)

    return () => {
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [onKeyDown])

  useEffect(() => {
    selectionElements.current.forEach(s => {
      s.alpha = !game.selection.has(s.data.k) ? 0 : 1
    })
    app.current.render()
  }, [game.selection])

  useEffect(() => {
    let cornerMarks = new Map()
    let centreMarks = new Map()

    for (let e of cornerMarkElements.current) {
      let digits = game.cornerMarks.get(e.data.k)
      for (let ce of e.elements) {
        ce.alpha = 0
      }
      if (digits !== undefined) {
        [...digits].sort().forEach((d, i) => {
          let n = i
          if (digits.size > 8 && n > 4) {
            n++
          }
          e.elements[n].text = d
          e.elements[n].alpha = 1
        })
        cornerMarks.set(e.data.k, e)
      }
    }

    for (let e of centreMarkElements.current) {
      let digits = game.centreMarks.get(e.data.k)
      if (digits !== undefined) {
        e.text = [...digits].sort().join("")
        e.alpha = 1
        centreMarks.set(e.data.k, e)
      } else {
        e.alpha = 0
      }
    }

    for (let e of digitElements.current) {
      let digit = game.digits.get(e.data.k)
      if (digit !== undefined) {
        e.text = digit.digit
        e.style.fill = digit.given ? foregroundColor : digitColor
        e.alpha = 1

        let com = cornerMarks.get(e.data.k)
        if (com !== undefined) {
          for (let ce of com.elements) {
            ce.alpha = 0
          }
        }

        let cem = centreMarks.get(e.data.k)
        if (cem !== undefined) {
          cem.alpha = 0
        }
      } else {
        e.alpha = 0
      }
    }

    let computedStyle = getComputedStyle(ref.current)
    let nColours = +computedStyle.getPropertyValue("--colors")
    let colours = []
    for (let i = 0; i < nColours; ++i) {
      colours[i] = computedStyle.getPropertyValue(`--color-${i + 1}`)
    }
    for (let e of colourElements.current) {
      let colour = game.colours.get(e.data.k)
      if (colour !== undefined) {
        let palCol = colours[colour.colour - 1]
        if (palCol === undefined) {
          palCol = colours[1]
        }
        let colourNumber = Color(palCol).rgbNumber()
        e.clear()
        e.beginFill(colourNumber)
        e.drawRect(0.5, 0.5, cellSize - 1, cellSize - 1)
        e.endFill()
        if (colourNumber === 0xffffff) {
          e.alpha = 1.0
        } else {
          e.alpha = 0.5
        }
      } else {
        e.alpha = 0
      }
    }

    for (let e of errorElements.current) {
      e.alpha = game.errors.has(e.data.k) ? 1 : 0
    }

    app.current.render()
  }, [cellSize, game.digits, game.cornerMarks, game.centreMarks, game.colours,
      game.errors, settings.colourPalette, foregroundColor, digitColor])

  return (
    <div ref={ref} className="grid" onClick={onBackgroundClick} onDoubleClick={onDoubleClick}>
      <style jsx>{styles}</style>
    </div>
  )
}

export default Grid
