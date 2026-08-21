import assert from 'node:assert/strict'
import test from 'node:test'
import { centerPan, dragPan, gridBackground, isCanvasBlankTarget, layoutTree, wheelPan, zoomAtPoint } from './layout.ts'
import { NODE_WIDTH } from './nodeDimensions.ts'

test('places parents midway between ordered children', () => {
  const positions = layoutTree(
    [
      { id: 'root', parentId: null, sortOrder: 0 },
      { id: 'second', parentId: 'root', sortOrder: 1 },
      { id: 'first', parentId: 'root', sortOrder: 0 },
    ],
    'root',
    200,
    18,
  )

  assert.deepEqual(positions.get('first'), { x: 200, y: 0 })
  assert.deepEqual(positions.get('second'), { x: 200, y: 60 })
  assert.deepEqual(positions.get('root'), { x: 0, y: 30 })
})

test('expanded node height reflows the tree without overlapping siblings', () => {
  const positions = layoutTree(
    [
      { id: 'root', parentId: null, sortOrder: 0 },
      { id: 'first', parentId: 'root', sortOrder: 0 },
      { id: 'second', parentId: 'root', sortOrder: 1 },
    ],
    'root',
    200,
    18,
    new Map([['first', 120]]),
  )

  assert.deepEqual(positions.get('first'), { x: 200, y: 0 })
  assert.deepEqual(positions.get('second'), { x: 200, y: 138 })
  assert.deepEqual(positions.get('root'), { x: 0, y: 69 })
})

test('expanded node width matches collapsed width and keeps descendants aligned', () => {
  const nodes = [
    { id: 'root', parentId: null, sortOrder: 0 },
    { id: 'child', parentId: 'root', sortOrder: 0 },
    { id: 'leaf', parentId: 'child', sortOrder: 0 },
  ]
  const normal = layoutTree(nodes, 'root', 320, 18)
  const expanded = layoutTree(nodes, 'root', 320, 18, new Map(), new Map([['child', NODE_WIDTH]]))

  assert.equal(normal.get('child')?.x, 320)
  assert.equal(normal.get('leaf')?.x, 640)
  assert.equal(expanded.get('child')?.x, 320)
  assert.equal(expanded.get('leaf')?.x, 640)
})

test('lays out more than 40 nodes without overlapping leaves', () => {
  const nodes = [
    { id: 'root', parentId: null, sortOrder: 0 },
    ...Array.from({ length: 48 }, (_, index) => ({ id: `leaf-${index}`, parentId: 'root', sortOrder: index })),
  ]
  const positions = layoutTree(nodes, 'root')
  const leafRows = nodes.slice(1).map((node) => positions.get(node.id)?.y)
  assert.equal(new Set(leafRows).size, 48)
})

test('centering and dragging keep the canvas pan unbounded', () => {
  assert.deepEqual(centerPan(1000, 600, 400, 200, 1), { x: 300, y: 200 })
  assert.deepEqual(
    dragPan({ x: -1200, y: 900 }, { x: 10, y: 10 }, { x: -500, y: 800 }),
    { x: -1710, y: 1690 },
  )
})

test('trackpad pinch zoom keeps the point under the cursor anchored', () => {
  assert.deepEqual(
    zoomAtPoint({ x: 100, y: 50 }, 1, 2, { x: 300, y: 200 }),
    { x: -100, y: -100 },
  )
  assert.deepEqual(gridBackground({ x: -100, y: -100 }, 2), { position: '-100px -100px', size: '40px 40px' })
})

test('two-finger trackpad scrolling pans the mindmap', () => {
  assert.deepEqual(wheelPan({ x: 120, y: -40 }, { x: 25, y: -60 }), { x: 95, y: 20 })
})

test('blank canvas targets collapse expanded mindmap nodes but node controls do not', () => {
  assert.equal(isCanvasBlankTarget('canvas is-panning', 'canvas is-panning'), true)
  assert.equal(isCanvasBlankTarget('stage-shell', 'canvas'), true)
  assert.equal(isCanvasBlankTarget('graph-stage', 'canvas'), true)
  assert.equal(isCanvasBlankTarget('map-node is-expanded', 'canvas'), false)
  assert.equal(isCanvasBlankTarget('node-add-action', 'canvas'), false)
})
