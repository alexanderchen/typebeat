import {
  layoutNextLine,
  prepareWithSegments,
  walkLineRanges,
  type LayoutCursor,
  type PreparedTextWithSegments,
} from '@chenglou/pretext'
import * as Tone from 'tone'

// Tone.js Audio Setup
const synth = new Tone.Synth().toDestination()
const polySynth = new Tone.PolySynth(Tone.Synth).toDestination()
const meter = new Tone.Meter()
synth.connect(meter)
polySynth.connect(meter)

type TextStyleName = 'body' | 'interactive'

type RichInlineSpec =
  | { kind: 'text'; text: string; style: TextStyleName; note?: string; chord?: string[] }
  | { kind: 'svg'; type: 'sine' | 'sawtooth' | 'square'; width: 44 }
  | { kind: 'paragraph_break' }

type TextStyleModel = {
  className: string
  chromeWidth: number
  font: string
}

type TextInlineItem = {
  kind: 'text'
  className: string
  chromeWidth: number
  endCursor: LayoutCursor
  fullText: string
  fullWidth: number
  leadingGap: number
  prepared: PreparedTextWithSegments
  note?: string
  chord?: string[]
}

type SvgInlineItem = {
  kind: 'svg'
  className: string
  leadingGap: number
  type: 'sine' | 'sawtooth' | 'square'
  width: number
}

type ParagraphBreakItem = { kind: 'paragraph_break' }

type InlineItem = TextInlineItem | SvgInlineItem | ParagraphBreakItem

type LineFragment = {
  className: string
  leadingGap: number
  text: string
  isSVG?: boolean
  svgType?: 'sine' | 'sawtooth' | 'square'
  note?: string
  chord?: string[]
}

type RichLine = {
  fragments: LineFragment[]
}

type State = {
  requestedWidth: number
}

const BODY_FONT = '400 22px "Times New Roman", Times, Georgia, serif'

const TEXT_STYLES = {
  body: {
    className: 'frag',
    chromeWidth: 0,
    font: BODY_FONT,
  },
  interactive: {
    className: 'frag frag--interactive',
    chromeWidth: 0,
    font: BODY_FONT,
  },
} satisfies Record<TextStyleName, TextStyleModel>

const LINE_START_CURSOR: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 }

const LINE_HEIGHT = 38
const LAST_LINE_BLOCK_HEIGHT = 38
const BODY_DEFAULT_WIDTH = 900
const UNBOUNDED_WIDTH = 100_000

const collapsedSpaceWidthCache = new Map<string, number>()
const INLINE_BOUNDARY_GAP = measureCollapsedSpaceWidth(BODY_FONT)

const SINE_SVG = `<svg class="svg-visual" width="40" height="20" viewBox="0 0 40 20"><path d="M 0 10 Q 10 0, 20 10 T 40 10" stroke-width="1.5"/></svg>`
const SAWTOOTH_SVG = `<svg class="svg-visual" width="40" height="20" viewBox="0 0 40 20"><path d="M 0 10 L 20 0 L 20 20 L 40 10" stroke-width="1.5"/></svg>`
const SQUARE_SVG = `<svg class="svg-visual" width="40" height="20" viewBox="0 0 40 20"><path d="M 0 10 L 0 0 L 20 0 L 20 20 L 40 20 L 40 10" stroke-width="1.5"/></svg>`

const SVG_MAP = {
  sine: SINE_SVG,
  sawtooth: SAWTOOTH_SVG,
  square: SQUARE_SVG,
}

const TEXT_CONTENT = 
  "Sound is vibration. It pushes air particles into waves of high and low pressure. " +
  "Frequency determines pitch: fast waves are high, slow waves are low. " +
  "\n\n" +
  "Mapping sound over time reveals base geometric shapes. " +
  "The smooth [[sine wave]] {{SVG:sine}}, buzzy [[sawtooth wave]] {{SVG:sawtooth}}, " +
  "and hollow [[square wave]] {{SVG:square}}. " +
  "\n\n" +
  "In nature, pure waves rarely exist alone. Instruments produce a fundamental pitch plus " +
  "a series or stack of overtones that whisper inside a note. For instance, the pitch [[C4]] " +
  "carries quieter harmonics like [[C5]], [[G5]], and [[C6]]. " +
  "\n\n" +
  "Harmony blends highly related frequencies into stable states, like a simple [[C major chord]]."

const domCache = {
  noteBody: getRequiredDiv('note-body'),
}

const INLINE_SPECS = parseTextToSpecs(TEXT_CONTENT)
const items = prepareInlineItems(INLINE_SPECS)

const st: State = {
  requestedWidth: BODY_DEFAULT_WIDTH,
}

// Interaction States for animation calculations
let spanElements: HTMLElement[] = []
let spanPositions: { x: number; y: number }[] = []
let interactionOrigin: { x: number; y: number } | null = null
let activeClickedElement: HTMLElement | null = null
let animationStartTime = 0
let animationFrameId: number | null = null

render()

function getRequiredDiv(id: string): HTMLDivElement {
  const element = document.getElementById(id)
  if (!(element instanceof HTMLDivElement)) throw new Error(`#${id} not found`)
  return element
}

function measureSingleLineWidth(prepared: PreparedTextWithSegments): number {
  let maxWidth = 0
  walkLineRanges(prepared, UNBOUNDED_WIDTH, line => {
    if (line.width > maxWidth) maxWidth = line.width
  })
  return maxWidth
}

function measureCollapsedSpaceWidth(font: string): number {
  const cached = collapsedSpaceWidthCache.get(font)
  if (cached !== undefined) return cached

  const joinedWidth = measureSingleLineWidth(prepareWithSegments('A A', font))
  const compactWidth = measureSingleLineWidth(prepareWithSegments('AA', font))
  const collapsedWidth = Math.max(0, joinedWidth - compactWidth)
  collapsedSpaceWidthCache.set(font, collapsedWidth)
  return collapsedWidth
}

function parseTextToSpecs(text: string): RichInlineSpec[] {
  const result: RichInlineSpec[] = []
  const paragraphs = text.split('\n\n')
  
  for (let i = 0; i < paragraphs.length; i++) {
    const paragraph = paragraphs[i]!
    const parts = paragraph.split(/(\{\{SVG:\w+\}\}|\[\[.*?\]\])/g)
    
    for (const part of parts) {
      if (part.startsWith('{{SVG:') && part.endsWith('}}')) {
        const type = part.substring(6, part.length - 2) as 'sine' | 'sawtooth' | 'square'
        result.push({ kind: 'svg', type, width: 44 })
      } else if (part.startsWith('[[') && part.endsWith(']]')) {
        const label = part.substring(2, part.length - 2)
        
        let note: string | undefined
        let chord: string[] | undefined
        
        switch(label) {
          case 'sine wave': note = 'C4'; break
          case 'sawtooth wave': note = 'E4'; break
          case 'square wave': note = 'G4'; break
          case 'C4': note = 'C4'; break
          case 'C5': note = 'C5'; break
          case 'G5': note = 'G5'; break
          case 'C6': note = 'C6'; break
          case 'C major chord': chord = ['C4', 'E4', 'G4']; break
          default: note = 'A4'
        }
        
        result.push({ kind: 'text', text: label + ' ', style: 'interactive', note, chord })
      } else {
        const words = part.split(/\s+/)
        for (const word of words) {
          if (word.length > 0) {
            result.push({ kind: 'text', text: word + ' ', style: 'body' })
          }
        }
      }
    }
    
    if (i < paragraphs.length - 1) {
      result.push({ kind: 'paragraph_break' })
    }
  }
  return result
}

function prepareInlineItems(specs: RichInlineSpec[]): InlineItem[] {
  const items: InlineItem[] = []
  let pendingGap = 0

  for (let index = 0; index < specs.length; index++) {
    const spec = specs[index]!

    switch (spec.kind) {
      case 'paragraph_break': {
        items.push({ kind: 'paragraph_break' })
        pendingGap = 0
        break
      }
      case 'svg': {
        items.push({
          kind: 'svg',
          className: 'frag frag--svg',
          leadingGap: pendingGap,
          type: spec.type,
          width: spec.width,
        })
        pendingGap = 0
        break
      }

      case 'text': {
        const carryGap = pendingGap
        const hasLeadingWhitespace = /^\s/.test(spec.text)
        const hasTrailingWhitespace = /\s$/.test(spec.text)
        const trimmedText = spec.text.trim()
        pendingGap = hasTrailingWhitespace ? INLINE_BOUNDARY_GAP : 0
        if (trimmedText.length === 0) break

        const style = TEXT_STYLES[spec.style]
        const prepared = prepareWithSegments(trimmedText, style.font)
        const wholeLine = layoutNextLine(prepared, LINE_START_CURSOR, UNBOUNDED_WIDTH)
        if (wholeLine === null) break

        items.push({
          kind: 'text',
          className: style.className,
          chromeWidth: style.chromeWidth,
          endCursor: wholeLine.end,
          fullText: wholeLine.text,
          fullWidth: wholeLine.width,
          leadingGap: carryGap > 0 || hasLeadingWhitespace ? INLINE_BOUNDARY_GAP : 0,
          prepared,
          note: spec.note,
          chord: spec.chord,
        })
        break
      }
    }
  }

  return items
}

function cursorsMatch(a: LayoutCursor, b: LayoutCursor): boolean {
  return a.segmentIndex === b.segmentIndex && a.graphemeIndex === b.graphemeIndex
}

function layoutInlineItems(items: InlineItem[], maxWidth: number): RichLine[] {
  const lines: RichLine[] = []
  const safeWidth = Math.max(1, maxWidth)

  let itemIndex = 0
  let textCursor: LayoutCursor | null = null

  while (itemIndex < items.length) {
    const fragments: LineFragment[] = []
    let lineWidth = 0
    let remainingWidth = safeWidth

    lineLoop:
    while (itemIndex < items.length) {
      const item = items[itemIndex]!

      switch (item.kind) {
        case 'paragraph_break': {
          itemIndex++
          if (fragments.length > 0) {
            lines.push({ fragments })
            fragments.splice(0, fragments.length)
          }
          lines.push({ fragments: [] })
          break lineLoop
        }
        
        case 'svg': {
          const leadingGap = fragments.length === 0 ? 0 : item.leadingGap
          if (fragments.length > 0 && leadingGap + item.width > remainingWidth) break lineLoop

          fragments.push({
            className: item.className,
            leadingGap,
            text: '',
            isSVG: true,
            svgType: item.type,
          })
          lineWidth += leadingGap + item.width
          remainingWidth = Math.max(0, safeWidth - lineWidth)
          itemIndex++
          textCursor = null
          continue
        }

        case 'text': {
          if (textCursor !== null && cursorsMatch(textCursor, item.endCursor)) {
            itemIndex++
            textCursor = null
            continue
          }

          const leadingGap = fragments.length === 0 ? 0 : item.leadingGap
          const reservedWidth = leadingGap + item.chromeWidth
          if (fragments.length > 0 && reservedWidth >= remainingWidth) break lineLoop

          if (textCursor === null) {
            const fullWidth = leadingGap + item.fullWidth + item.chromeWidth
            if (fullWidth <= remainingWidth) {
              fragments.push({
                className: item.className,
                leadingGap,
                text: item.fullText,
                note: item.note,
                chord: item.chord,
              })
              lineWidth += fullWidth
              remainingWidth = Math.max(0, safeWidth - lineWidth)
              itemIndex++
              continue
            } else if (fragments.length > 0) {
              break lineLoop
            }
          }

          const startCursor = textCursor ?? LINE_START_CURSOR
          const line = layoutNextLine(
            item.prepared,
            startCursor,
            Math.max(1, remainingWidth - reservedWidth),
          )
          if (line === null) {
            itemIndex++
            textCursor = null
            continue
          }
          if (cursorsMatch(startCursor, line.end)) {
            itemIndex++
            textCursor = null
            continue
          }

          fragments.push({
            className: item.className,
            leadingGap,
            text: line.text,
            note: item.note,
            chord: item.chord,
          })
          lineWidth += leadingGap + line.width + item.chromeWidth
          remainingWidth = Math.max(0, safeWidth - lineWidth)

          if (cursorsMatch(line.end, item.endCursor)) {
            itemIndex++
            textCursor = null
            continue
          }

          textCursor = line.end
          break lineLoop
        }
      }
    }

    if (fragments.length > 0) {
      lines.push({ fragments })
    }
  }

  return lines
}

function renderBody(lines: RichLine[]): void {
  domCache.noteBody.textContent = ''
  spanElements = []
  spanPositions = []
  const fragment = document.createDocumentFragment()

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex]!
    const row = document.createElement('div')
    row.className = 'line-row'
    row.style.top = `${lineIndex * LINE_HEIGHT}px`
    
    if (lineIndex < lines.length - 1 && line.fragments.length > 1) {
      const nextLine = lines[lineIndex + 1];
      if (nextLine && nextLine.fragments.length > 0) {
        row.classList.add('line-row--justified')
      }
    }

    for (let fragmentIndex = 0; fragmentIndex < line.fragments.length; fragmentIndex++) {
      const part = line.fragments[fragmentIndex]!
      const element = document.createElement('span')
      element.className = part.className
      
      if (part.isSVG && part.svgType) {
        element.innerHTML = SVG_MAP[part.svgType]
      } else {
        // Split text into individual letters wrapped in spans
        const chars = part.text.split('')
        for (const char of chars) {
          const charSpan = document.createElement('span')
          charSpan.className = 'char'
          charSpan.style.display = 'inline-block'
          charSpan.textContent = char
          element.appendChild(charSpan)
        }
      }
      
      if (!row.classList.contains('line-row--justified') && part.leadingGap > 0) {
        element.style.marginLeft = `${part.leadingGap}px`
      }
      
      // Wire up interactions on the fragment level
      if (part.svgType || part.note || part.chord) {
        element.addEventListener('click', async () => {
          await Tone.start()
          
          const containerRect = domCache.noteBody.getBoundingClientRect()
          const rect = element.getBoundingClientRect()
          interactionOrigin = {
            x: rect.left - containerRect.left + rect.width / 2,
            y: rect.top - containerRect.top + rect.height / 2,
          }
          activeClickedElement = element
          animationStartTime = Date.now()
          
          if (part.svgType) {
            synth.oscillator.type = part.svgType as any
            synth.triggerAttackRelease('C4', '8n')
          } else if (part.chord) {
            polySynth.triggerAttackRelease(part.chord, '4n')
          } else if (part.note) {
            synth.oscillator.type = 'sine'
            synth.triggerAttackRelease(part.note, '4n')
          }
          
          startInteractiveSimulation()
        })
      }
      
      row.appendChild(element)
    }

    fragment.appendChild(row)
  }

  domCache.noteBody.appendChild(fragment)
  
  // Measure exact initial positions on a letter/object level
  const containerRect = domCache.noteBody.getBoundingClientRect()
  
  const partSpans = domCache.noteBody.querySelectorAll('.frag')
  partSpans.forEach(partSpan => {
    const charSpans = partSpan.querySelectorAll('.char')
    if (charSpans.length > 0) {
      charSpans.forEach(charSpan => {
        const spanEl = charSpan as HTMLElement
        const rect = spanEl.getBoundingClientRect()
        const x = rect.left - containerRect.left + rect.width / 2
        const y = rect.top - containerRect.top + rect.height / 2
        spanElements.push(spanEl)
        spanPositions.push({ x, y })
      })
    } else {
      // It's a non-text fragment (SVG)
      const spanEl = partSpan as HTMLElement
      const rect = spanEl.getBoundingClientRect()
      const x = rect.left - containerRect.left + rect.width / 2
      const y = rect.top - containerRect.top + rect.height / 2
      spanElements.push(spanEl)
      spanPositions.push({ x, y })
    }
  })
}

function startInteractiveSimulation() {
  if (animationFrameId !== null) cancelAnimationFrame(animationFrameId)
  
  function step() {
    const elapsed = (Date.now() - animationStartTime) / 1000
    const rawDb = meter.getValue() as number
    
    // Smooth 0-1 linear amplitude scale
    const amp = Math.max(0, (rawDb + 80) / 80)
    
    const maxDisplacement = 120 // Max push in pixels
    const duration = 1.2 // Duration of the full push/decay
    
    if (elapsed > duration || !interactionOrigin) {
      spanElements.forEach(s => s.style.transform = '')
      animationFrameId = null
      interactionOrigin = null
      return
    }

    const timeFalloff = 1 - elapsed / duration
    
    for (let i = 0; i < spanElements.length; i++) {
      const span = spanElements[i]!
      const pos = spanPositions[i]!
      
      if (span.parentElement === activeClickedElement || span === activeClickedElement) {
        span.style.transform = 'translate(0px, 0px)'
        continue
      }
      
      const dx = pos.x - interactionOrigin.x
      const dy = pos.y - interactionOrigin.y
      const dist = Math.sqrt(dx*dx + dy*dy)
      
      const angle = Math.atan2(dy, dx)
      
      // Falloff exponentially (or inverse linear) with distance from click
      const distanceFalloff = 1 / (1 + dist / 60)
      
      // Strong repel algorithm: we push the letter in that direction directly
      const factor = distanceFalloff * timeFalloff * amp
      const tx = Math.cos(angle) * factor * maxDisplacement
      const ty = Math.sin(angle) * factor * maxDisplacement
      
      span.style.transform = `translate(${tx}px, ${ty}px)`
    }
    
    animationFrameId = requestAnimationFrame(step)
  }
  
  animationFrameId = requestAnimationFrame(step)
}

function render(): void {
  const bodyWidth = st.requestedWidth
  const lines = layoutInlineItems(items, bodyWidth)
  const lineCount = lines.length
  const noteBodyHeight =
    lineCount === 0 ? LAST_LINE_BLOCK_HEIGHT : (lineCount - 1) * LINE_HEIGHT + LAST_LINE_BLOCK_HEIGHT

  domCache.noteBody.style.height = `${noteBodyHeight}px`
  renderBody(lines)
}
