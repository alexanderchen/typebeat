import {
  layoutNextLine,
  prepareWithSegments,
  type LayoutCursor,
} from '@chenglou/pretext';
import * as Tone from 'tone';

// --- Types ---
type InstrumentKey = 'KICK' | 'SNARE' | 'HI_HAT_CLOSED' | 'HI_HAT_OPEN' | 'RIM' | 'HIGH_TOM' | 'LOW_TOM' | 'WOODBLOCK' | 'CLAP' | 'COWBELL' | 'CRASH';

interface PadConfig {
    key: InstrumentKey;
    label: string;
    word: string;
}

interface Particle {
    element: HTMLElement;
    originX: number;
    originY: number;
    x: number;
    y: number;
    vx: number;
    vy: number;
    customSpringK?: number;
}

function cursorsMatch(a: LayoutCursor, b: LayoutCursor): boolean {
  return a.segmentIndex === b.segmentIndex && a.graphemeIndex === b.graphemeIndex;
}

// --- Configuration ---
const PADS_CONFIG: PadConfig[] = [
    { key: 'KICK', label: 'KICK', word: 'KICK' },
    { key: 'SNARE', label: 'SNARE', word: 'SNARE' },
    { key: 'HI_HAT_CLOSED', label: 'HIHAT', word: 'HIHAT' },
    { key: 'HI_HAT_OPEN', label: 'OPEN HAT', word: 'OPENHAT' },
    { key: 'HIGH_TOM', label: 'HI TOM', word: 'HITOM' },
    { key: 'MID_TOM', label: 'MID TOM', word: 'MIDTOM' },
    { key: 'LOW_TOM', label: 'LO TOM', word: 'LOTOM' },
    { key: 'CLAP', label: 'CLAP', word: 'CLAP' },
    { key: 'RIM', label: 'RIMSHOT', word: 'RIMSHOT' },
    { key: 'WOODBLOCK', label: 'WOODBLOCK', word: 'WOODBLOCK' },
    { key: 'COWBELL', label: 'COWBELL', word: 'COWBELL' },
    { key: 'CRASH', label: 'CRASH', word: 'CRASH' }
];

const STEPS = 16;
const ROWS = 12;

// --- State ---
const sequencerState: string[][] = Array(ROWS).fill(0).map(() => Array(STEPS).fill('-'));
let isDrawing = false;
let drawMode: 'draw' | 'erase' | null = null;
let activePadIndex: string | null = null; // To prevent double triggers on pads
let justClicked: boolean = false;
// Pre-populate with a basic 4/4 house beat
sequencerState[0][0] = 'X'; // Kick
sequencerState[0][10] = 'X';
sequencerState[0][13] = 'X';
sequencerState[1][4] = 'X'; // Snare
sequencerState[1][12] = 'X';
for (let i = 0; i < 14; i += 2) {
    sequencerState[2][i] = 'X'; // Closed Hat
}
sequencerState[3][14] = 'X'; // open hat

let currentStep = 0;
let isPlaying = false;
const particles: Particle[] = [];

// --- Audio Setup (Synthesis) ---
const synths: CustomGridSynths = {} as any;

function initAudio() {
    // 1. Kick (k)
    const kick = new Tone.MembraneSynth({
        pitchDecay: 0.02,
        octaves: 3,
        oscillator: { type: 'sine' },
        envelope: { attack: 0.001, decay: 0.6, sustain: 0.6, release: 1.0 }
    }).toDestination();
    kick.volume.value = -9;

    // 2. Snare (s)
    const snareNoiseFilter = new Tone.Filter(1500, "bandpass").toDestination();
    snareNoiseFilter.Q.value = 1;
    
    const snareNoise = new Tone.NoiseSynth({
        noise: { type: 'white' },
        envelope: { attack: 0.001, decay: 0.15, sustain: 0 }
    }).connect(snareNoiseFilter);

    const snareBody = new Tone.MembraneSynth({
        pitchDecay: 0.02,
        octaves: 0.8,
        oscillator: { type: 'sine' },
        envelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.1 }
    }).toDestination();

    snareNoise.volume.value = -13;
    snareBody.volume.value = -13;

    const snare = {
        triggerAttackRelease: (time: any) => {
            snareNoise.triggerAttack(time);
            snareBody.triggerAttackRelease(150, '16n', time);
        }
    };

    // 3 & 4. HiHats (Closed & Open)
    const hihatFilter = new Tone.Filter(10000, "highpass").toDestination();
    const hihat = new Tone.NoiseSynth({
        noise: { type: 'white' },
        envelope: { attack: 0.001, decay: 0.03, sustain: 0 }
    }).connect(hihatFilter);
    hihat.volume.value = -18;

    // 5. Rimshot (r)
    const rimFilter = new Tone.Filter(2100, "bandpass").toDestination();
    rimFilter.Q.value = 1;
    const rimNoise = new Tone.NoiseSynth({
        noise: { type: 'white' },
        envelope: { attack: 0.001, decay: 0.03, sustain: 0 }
    }).connect(rimFilter);
    rimNoise.volume.value = -2;

    const rimBody = new Tone.MembraneSynth({
        pitchDecay: 0.002,
        octaves: 0.8,
        oscillator: { type: 'sine' },
        envelope: { attack: 0.001, decay: 0.05, sustain: 0 }
    }).toDestination();
    rimBody.volume.value = -2;

    const rim = {
        triggerAttackRelease: (time: any) => {
            rimNoise.triggerAttack(time);
            rimBody.triggerAttackRelease(850, '16n', time);
        }
    };

    // 6. High Tom (t)
    const highTom = new Tone.MembraneSynth({
        pitchDecay: 0.25,
        octaves: 1.5,
        oscillator: { type: 'sine' },
        envelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.3 }
    }).toDestination();
    highTom.volume.value = -9;

    // 7. Mid Tom
    const midTom = new Tone.MembraneSynth({
        pitchDecay: 0.25,
        octaves: 1.5,
        oscillator: { type: 'sine' },
        envelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.3 }
    }).toDestination();
    midTom.volume.value = -9;

    // 8. Low Tom (o)
    const lowTom = new Tone.MembraneSynth({
        pitchDecay: 0.25,
        octaves: 1.5,
        oscillator: { type: 'sine' },
        envelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.3 }
    }).toDestination();
    lowTom.volume.value = -9;

    // 8. Woodblock (w)
    const woodblock = new Tone.MembraneSynth({
        pitchDecay: 0.001,
        octaves: 0.8,
        oscillator: { type: 'sine' },
        envelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.1 }
    }).toDestination();
    woodblock.volume.value = -11;

    // 9. Clap (h)
    const clapFilter = new Tone.Filter(1000, "bandpass").toDestination();
    clapFilter.Q.value = 1;
    const clap = new Tone.NoiseSynth({
        noise: { type: 'white' },
        envelope: { attack: 0.001, decay: 0.22, sustain: 0 }
    }).connect(clapFilter);
    clap.volume.value = -13;

    // 10. Cowbell (x)
    const cowbellFilter = new Tone.Filter(800, "bandpass").toDestination();
    const cowbell = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'square' },
        envelope: { attack: 0.001, decay: 0.4, sustain: 0, release: 0.4 }
    }).connect(cowbellFilter);
    cowbell.volume.value = -11;

    // 11. Crash (*)
    const crashFilter = new Tone.Filter(3000, "highpass").toDestination();
    const crash = new Tone.NoiseSynth({
        noise: { type: 'white' },
        envelope: { attack: 0.01, decay: 1.0, sustain: 0, release: 1.0 }
    }).connect(crashFilter);
    crash.volume.value = -11;

    synths['KICK'] = kick;
    synths['SNARE'] = snare;
    synths['HI_HAT_CLOSED'] = hihat;
    synths['HI_HAT_OPEN'] = hihat;
    synths['RIM'] = rim;
    synths['HIGH_TOM'] = highTom;
    synths['MID_TOM'] = midTom;
    synths['LOW_TOM'] = lowTom;
    synths['WOODBLOCK'] = woodblock;
    synths['CLAP'] = clap;
    synths['COWBELL'] = cowbell;
    synths['CRASH'] = crash;
}

type CustomGridSynths = {
    [key in InstrumentKey]: any;
};

let lastToneTime = 0;

function triggerSound(key: InstrumentKey, time?: any) {
    let activeTime = time || Tone.now();
    if (activeTime <= lastToneTime) {
        activeTime = lastToneTime + 0.005;
    }
    lastToneTime = activeTime;
    const t = activeTime;
    
    switch (key) {
        case 'KICK': synths['KICK'].triggerAttackRelease(55, '8n', t); break;
        case 'SNARE': synths['SNARE'].triggerAttackRelease(t); break;
        case 'HI_HAT_CLOSED': 
            synths['HI_HAT_CLOSED'].envelope.decay = 0.03;
            synths['HI_HAT_CLOSED'].triggerAttackRelease('32n', t); 
            break;
        case 'HI_HAT_OPEN': 
            synths['HI_HAT_OPEN'].envelope.decay = 0.7;
            synths['HI_HAT_OPEN'].triggerAttackRelease('8n', t); 
            break;
        case 'CLAP': synths['CLAP'].triggerAttackRelease('16n', t); break;
        case 'COWBELL': synths['COWBELL'].triggerAttackRelease([540, 800], '16n', t); break;
        case 'RIM': synths['RIM'].triggerAttackRelease(t); break;
        case 'HIGH_TOM': synths['HIGH_TOM'].triggerAttackRelease(125, '16n', t); break;
        case 'MID_TOM': synths['MID_TOM'].triggerAttackRelease(100, '16n', t); break;
        case 'LOW_TOM': synths['LOW_TOM'].triggerAttackRelease(70, '16n', t); break;
        case 'WOODBLOCK': synths['WOODBLOCK'].triggerAttackRelease(1200, '16n', t); break;
        case 'CRASH': synths['CRASH'].triggerAttackRelease('1m', t); break;
    }
}

// --- UI Generation ---
function initUI() {
    const padsContainer = document.getElementById('pads');
    const seqContainer = document.getElementById('sequencer');

    if (!padsContainer || !seqContainer) return;

    window.addEventListener('pointerdown', () => { isDrawing = true; });
    window.addEventListener('pointerup', () => { 
        isDrawing = false; 
        drawMode = null;
        activePadIndex = null; // Clear cached drum pad for state gates
    });

    const padsWrapper = document.getElementById('pads-wrapper');
    const onResize = () => {
        if (padsWrapper && window.innerWidth < 1000) {
             const scale = window.innerWidth / 750;
             const pads = document.getElementById('pads');
             if (pads) {
                  pads.style.transform = `scale(${scale})`;
                  pads.style.transformOrigin = 'top left';
                  padsWrapper.style.height = `${560 * scale}px`;
             }
        } else if (padsWrapper) {
             const pads = document.getElementById('pads');
             if (pads) {
                  pads.style.transform = '';
                  pads.style.transformOrigin = '';
             }
             padsWrapper.style.height = '';
        }
    };
    window.addEventListener('resize', onResize);
    setTimeout(onResize, 50);

    // Generate Pads
    PADS_CONFIG.forEach((config, index) => {
        const pad = document.createElement('div');
        pad.className = 'pad';
        pad.dataset.key = config.key;
        pad.dataset.index = index.toString();

        const padText = document.createElement('div');
        padText.className = 'pad-text';
        // Fill pad with repeating word without spaces
        const word = config.word;

        const hue = Math.round(190 - (150 * index) / 11); // Lerp from 190 (Teal) to 40 (Orange) over 12 pads
        const padColor = `hsl(${hue}, 100%, 55%)`;
        padText.style.color = padColor;
        
        // Add extra space to specific words to prevent alignment bugs
        const extraSpace = (config.key === 'KICK' || config.key === 'HI_HAT_CLOSED') ? '  ' : ' ';
        const padLabel = (config.key === 'WOODBLOCK') ? 'WOOD BLOCK' : config.label;
        const fullWord = padLabel + extraSpace;
        // Infinite generation to fill 15 full rows instead of clamping at 225 letters!
        const textContent = fullWord.repeat(200); 
        
        // Use Pretext to calculate line splits! 
        // We substitute spaces with non-breaking spaces so Pretext ignores word bounds and forced breaks at the edge.
        const pretextString = textContent.replace(/ /g, '\u00A0');
        const prepared = prepareWithSegments(pretextString, '12px "Rubik"');
        let cursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 };
        const lines: string[] = [];
        const requestedWidth = (config.key === 'LOW_TOM') ? 160 : 155; // Padded width inside 180px container
        
        // Loop until we have exactly 15 full rows!
        while (lines.length < 15) {
            const result = layoutNextLine(prepared, cursor, requestedWidth);
            if (!result) break;
            lines.push(result.text);
            
            if (cursorsMatch(cursor, result.end)) {
                break; // Prevent infinite loop if cursor doesn't advance
            }
            cursor = result.end;
        }

        // Dynamically compute custom spring stiffness per track
        let customSpringK = 0.02; // Default
        if (config.key === 'HI_HAT_OPEN' || config.key === 'CRASH') {
            customSpringK = 0.005; // Extreme slow!
        } else if (config.key === 'KICK' || config.key === 'HIGH_TOM' || config.key === 'MID_TOM' || config.key === 'LOW_TOM') {
            customSpringK = 0.01; // Slower!
        }

        // Output lines as flex rows to justify letters to left/right margins!
        lines.forEach((lineText) => {
            const lineDiv = document.createElement('div');
            lineDiv.style.display = 'flex';
            lineDiv.style.justifyContent = 'space-between';
            lineDiv.style.width = '100%';
            
            for (let c = 0; c < lineText.length; c++) {
                const char = lineText[c];
                const span = document.createElement('span');
                span.textContent = char;
                span.style.display = 'inline-block';
                span.style.whiteSpace = 'pre';
                
                lineDiv.appendChild(span);

                // Register particle directly here!
                particles.push({
                    element: span as HTMLElement,
                    originX: 0,
                    originY: 0,
                    x: 0,
                    y: 0,
                    vx: 0,
                    vy: 0,
                    customSpringK
                });
            }
            padText.appendChild(lineDiv);
        });

        pad.appendChild(padText);
        padsContainer.appendChild(pad);
    });

    // Generate Sequencer
    for (let rowIndex = 0; rowIndex < 12; rowIndex++) {
        const config = PADS_CONFIG[rowIndex];
        const rowDiv = document.createElement('div');
        rowDiv.className = 'seq-row';
        
        const hue = Math.round(190 - (150 * rowIndex) / 11);
        rowDiv.style.setProperty('--row-color', `hsl(${hue}, 100%, 55%)`);
        rowDiv.style.setProperty('--row-bg-color', `hsl(${hue}, 100%, 15%)`);

        const label = document.createElement('div');
        label.className = 'label';
        label.textContent = config.label;
        label.style.color = `hsl(${hue}, 100%, 55%)`;
        rowDiv.appendChild(label);

        const stepsDiv = document.createElement('div');
        stepsDiv.className = 'steps';

        for (let i = 0; i < STEPS; i++) {
            const step = document.createElement('span');
            const isSet = sequencerState[rowIndex][i] === 'X';
            
            step.textContent = sequencerState[rowIndex][i];
            step.className = 'step ' + (isSet ? 'active' : 'inactive');
            if (i % 4 === 0) {
                step.classList.add('bar-start');
            }
            step.dataset.row = rowIndex.toString();
            step.dataset.step = i.toString();
            
            const toggleCell = (active: boolean) => {
                 sequencerState[rowIndex][i] = active ? 'X' : '-';
                 step.textContent = sequencerState[rowIndex][i];
                 step.className = 'step ' + (sequencerState[rowIndex][i] === 'X' ? 'active' : 'inactive');
                 if (i % 4 === 0) step.classList.add('bar-start');
                 
                 if (sequencerState[rowIndex][i] === 'X') {
                     step.style.color = `hsl(${hue}, 100%, 55%)`;
                 } else {
                     step.style.color = ''; // Reset
                 }
            };
            
            if (isSet) {
                const hue = Math.round(190 - (150 * rowIndex) / 11);
                step.style.color = `hsl(${hue}, 100%, 55%)`;
            }
            
            step.addEventListener('pointerdown', () => {
                 const current = sequencerState[rowIndex][i];
                 drawMode = current === 'X' ? 'erase' : 'draw';
                 
                 toggleCell(drawMode === 'draw');
                 
                 if (sequencerState[rowIndex][i] === 'X') {
                     Tone.start();
                     triggerSound(PADS_CONFIG[rowIndex].key);
                     applyImpact(rowIndex);
                 }
            });
            
            step.addEventListener('mouseover', () => {
                  if (isDrawing && drawMode) {
                       const current = sequencerState[rowIndex][i];
                       if (drawMode === 'draw' && current !== 'X') {
                           toggleCell(true);
                       } else if (drawMode === 'erase' && current === 'X') {
                           toggleCell(false);
                       }
                  }
            });

            step.addEventListener('pointermove', (e: PointerEvent) => {
                  if (isDrawing && drawMode && e.pointerType === 'touch') {
                       const element = document.elementFromPoint(e.clientX, e.clientY);
                       if (element && element.classList.contains('step')) {
                            const row = parseInt(element.getAttribute('data-row') || '0');
                            const stepIdx = parseInt(element.getAttribute('data-step') || '0');
                            const current = sequencerState[row][stepIdx];
                            
                            if (drawMode === 'draw' && current !== 'X') {
                                 sequencerState[row][stepIdx] = 'X';
                                 element.textContent = 'X';
                                 element.classList.add('active');
                                 element.classList.remove('inactive');
                                 const hue = Math.round(190 - (150 * row) / 11);
                                 (element as HTMLElement).style.color = `hsl(${hue}, 100%, 55%)`;
                            } else if (drawMode === 'erase' && current === 'X') {
                                 sequencerState[row][stepIdx] = '-';
                                 element.textContent = '-';
                                 element.classList.add('inactive');
                                 element.classList.remove('active');
                                 (element as HTMLElement).style.color = '';
                            }
                       }
                  }
            });
            
            stepsDiv.appendChild(step);
        }

        rowDiv.appendChild(stepsDiv);
        seqContainer.appendChild(rowDiv);
    }

    // Measure initial positions after DOM is painted
    setTimeout(measureParticles, 100);
}

function measureParticles() {
    particles.forEach(p => {
        const rect = p.element.getBoundingClientRect();
        // Store initial position relative to its parent or grid
        // For simplicity, we track transform x/y from 0,0
        p.originX = 0;
        p.originY = 0;
        p.x = 0;
        p.y = 0;
        p.vx = 0;
        p.vy = 0;
    });
}

// --- Physics Engine ---
const SPRING_K = 0.02;
const DAMPING = 0.82;
const IMPACT_FORCE = 50;

function applyImpact(padIndex: number, clickX?: number, clickY?: number) {
    const padElements = document.querySelectorAll('.pad');
    const pad = padElements[padIndex] as HTMLElement;
    if (!pad) return;

    const padRect = pad.getBoundingClientRect();
    const centerX = clickX !== undefined ? clickX : padRect.left + padRect.width / 2;
    const centerY = clickY !== undefined ? clickY : padRect.top + padRect.height / 2;

    particles.forEach(p => {
        // Only affect particles in this pad
        if (p.element.closest('.pad') === pad) {
            const rect = p.element.getBoundingClientRect();
            const pX = rect.left + rect.width / 2;
            const pY = rect.top + rect.height / 2;

            const dx = pX - centerX;
            const dy = pY - centerY;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;

            // Blast radius effect: push away from center
            const force = (IMPACT_FORCE * 100) / (dist + 50);
            
            if (force > 0.5) {
                p.vx += (dx / dist) * force + (Math.random() - 0.5) * 5;
                p.vy += (dy / dist) * force + (Math.random() - 0.5) * 5;
            }
        }
    });
}

function updatePhysics() {
    particles.forEach(p => {
        // Spring force pulling back to origin (0,0)
        const k = p.customSpringK || SPRING_K;
        const fx = -k * p.x;
        const fy = -k * p.y;

        p.vx += fx;
        p.vy += fy;

        p.vx *= DAMPING;
        p.vy *= DAMPING;

        p.x += p.vx;
        p.y += p.vy;

        // Apply transform
        if (Math.abs(p.x) > 0.01 || Math.abs(p.y) > 0.01) {
            p.element.style.transform = `translate(${p.x}px, ${p.y}px)`;
        } else {
            p.element.style.transform = '';
            p.x = 0;
            p.y = 0;
            p.vx = 0;
            p.vy = 0;
        }
    });

    requestAnimationFrame(updatePhysics);
}

// --- Song Serialization ---
function serializeSong(): string {
    const bpm = Math.round(Tone.Transport.bpm.value);
    const dotsPerBeat = 4;
    const beatsPerBar = 4;
    let song = `[${bpm}:${dotsPerBeat}:${beatsPerBar}]`;
    
    for (let r = 0; r < ROWS; r++) {
        const label = PADS_CONFIG[r].label.replace(/ /g, '_');
        let sequence = '';
        for (let s = 0; s < STEPS; s++) {
            sequence += sequencerState[r][s] === 'X' ? 'X' : '.';
        }
        song += `[${label}:${sequence}]`;
    }
    return song;
}

function deserializeSong(songStr: string) {
    const matches = songStr.match(/\[(.*?)\]/g);
    if (!matches) return;
    
    matches.forEach(segment => {
         const clean = segment.substring(1, segment.length - 1);
         const parts = clean.split(':');
         
         // If header
         if (parts.length === 3 && !isNaN(parseInt(parts[0]))) {
              const bpm = parseInt(parts[0]);
              Tone.Transport.bpm.value = bpm;
              const bpmVal = document.getElementById('bpm-val') as HTMLInputElement;
              if (bpmVal) bpmVal.value = bpm.toString();
         } else if (parts.length === 2) {
              const label = parts[0];
              const sequence = parts[1];
              
              const rowIndex = PADS_CONFIG.findIndex(c => c.label.replace(/ /g, '_') === label || c.label === label);
              if (rowIndex !== -1) {
                   for (let s = 0; s < STEPS; s++) {
                        if (s < sequence.length) {
                             const char = sequence[s];
                             sequencerState[rowIndex][s] = char === 'X' ? 'X' : '-';
                             
                             const stepElement = document.querySelector(`.step[data-row="${rowIndex}"][data-step="${s}"]`) as HTMLElement;
                             if (stepElement) {
                                  stepElement.textContent = char === 'X' ? 'X' : '-';
                                  if (char === 'X') {
                                       stepElement.classList.add('active');
                                       stepElement.classList.remove('inactive');
                                       const hue = Math.round(190 - (150 * rowIndex) / 11);
                                       stepElement.style.color = `hsl(${hue}, 100%, 55%)`;
                                  } else {
                                       stepElement.classList.remove('active');
                                       stepElement.classList.add('inactive');
                                       stepElement.style.color = '';
                                  }
                             }
                        }
                   }
              }
         }
    });
}

function loadFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const song = params.get('song');
    if (song) {
        deserializeSong(song);
    }
}

// --- Sequencer Logic ---
function setupSequencer() {
    Tone.Transport.scheduleRepeat((time) => {
        for (let r = 0; r < ROWS; r++) {
            const state = sequencerState[r][currentStep];
            if (state === 'X') {
                const key = PADS_CONFIG[r].key;
                
                // Avoid double triggering the same shared hihat synth on the exact same tick!
                if (key === 'HI_HAT_OPEN') {
                     const closedHatIndex = PADS_CONFIG.findIndex(c => c.key === 'HI_HAT_CLOSED');
                     if (sequencerState[closedHatIndex][currentStep] === 'X') {
                          continue; // Skip the open hat if closed hat takes precedence on this tick!
                     }
                }
                
                triggerSound(key, time);
                
                // Trigger visual explosion on the pad
                Tone.Draw.schedule(() => {
                    applyImpact(r);
                    const pad = document.querySelector(`.pad[data-key="${key}"]`);
                    if (pad) {
                        pad.classList.add('active');
                        setTimeout(() => pad.classList.remove('active'), 100);
                    }
                }, time);
            }
        }

        // Update UI playhead
        const stepToDraw = currentStep;
        Tone.Draw.schedule(() => {
            updatePlayhead(stepToDraw);
        }, time);

        currentStep = (currentStep + 1) % STEPS;
    }, '16n');

    Tone.Transport.bpm.value = 120;
}

function updatePlayhead(step: number) {
    const allSteps = document.querySelectorAll('.step');
    allSteps.forEach(s => {
        const stepIdx = parseInt((s as HTMLElement).dataset.step || '0');
        if (stepIdx === step) {
            s.style.opacity = '1';
            s.style.textDecoration = 'underline';
        } else {
            s.style.opacity = '';
            s.style.textDecoration = '';
        }
    });
}

// --- Event Listeners ---
function setupEventListeners() {
    // Pads
    const pads = document.querySelectorAll('.pad');
    pads.forEach(pad => {
        pad.addEventListener('pointerdown', (e: PointerEvent) => {
            const indexStr = pad.getAttribute('data-index') || '0';
            activePadIndex = indexStr; // Set state gate
            
            const index = parseInt(indexStr);
            const key = pad.getAttribute('data-key') as InstrumentKey;
            
            Tone.start();
            triggerSound(key);
            applyImpact(index, e.clientX, e.clientY);
            
            pad.classList.add('active');
            setTimeout(() => pad.classList.remove('active'), 100);
        });
    });

    const padsContainer = document.getElementById('pads');
    if (padsContainer) {
        padsContainer.addEventListener('pointermove', (e: PointerEvent) => {
            if (isDrawing) {
                const element = document.elementFromPoint(e.clientX, e.clientY);
                const pad = element?.closest('.pad');
                if (pad) {
                     const indexStr = pad.getAttribute('data-index') || '0';
                     
                     // State gate! Only trigger if we moved onto a NEW pad
                     if (indexStr !== activePadIndex) {
                          activePadIndex = indexStr;
                          
                          const index = parseInt(indexStr);
                          const key = pad.getAttribute('data-key') as InstrumentKey;
                          
                          Tone.start();
                          triggerSound(key);
                          applyImpact(index, e.clientX, e.clientY);
                          
                          pad.classList.add('active');
                          setTimeout(() => pad.classList.remove('active'), 100);
                     }
                }
            }
        });
    }



    // Play button
    const playBtn = document.getElementById('play-btn');
    if (playBtn) {
        playBtn.addEventListener('click', async () => {
            await Tone.start();
            if (isPlaying) {
                Tone.Transport.stop();
                playBtn.textContent = '▶ PLAY';
                currentStep = 0;
                updatePlayhead(-1);
            } else {
                Tone.Transport.start();
                playBtn.textContent = '■ STOP';
            }
            isPlaying = !isPlaying;
        });
    }

    // Clear button
    const clearBtn = document.getElementById('clear-btn');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            for (let r = 0; r < ROWS; r++) {
                for (let s = 0; s < STEPS; s++) {
                    sequencerState[r][s] = '-';
                }
            }
            const steps = document.querySelectorAll('.step');
            steps.forEach(s => {
                const stepEl = s as HTMLElement;
                stepEl.textContent = '-';
                stepEl.classList.remove('active');
                stepEl.classList.add('inactive');
                stepEl.style.color = ''; // Remove inline color styles applied by interactions!
            });
        });
    }

    // BPM Minus
    const bpmMinus = document.getElementById('bpm-minus');
    if (bpmMinus) {
        bpmMinus.addEventListener('click', () => {
             const currentBpm = Tone.Transport.bpm.value;
             const newBpm = Math.max(20, currentBpm - 5); // Don't go below 20!
             Tone.Transport.bpm.value = newBpm;
             const bpmVal = document.getElementById('bpm-val') as HTMLInputElement;
             if (bpmVal) bpmVal.value = Math.round(newBpm).toString();
        });
    }

    // BPM Plus
    const bpmPlus = document.getElementById('bpm-plus');
    if (bpmPlus) {
        bpmPlus.addEventListener('click', () => {
             const currentBpm = Tone.Transport.bpm.value;
             const newBpm = Math.min(300, currentBpm + 5); // Don't go above 300!
             Tone.Transport.bpm.value = newBpm;
             const bpmVal = document.getElementById('bpm-val') as HTMLInputElement;
             if (bpmVal) bpmVal.value = Math.round(newBpm).toString();
        });
    }

    // Direct BPM Input
    const bpmInput = document.getElementById('bpm-val') as HTMLInputElement;
    if (bpmInput) {
        bpmInput.addEventListener('change', () => {
             const value = parseInt(bpmInput.value);
             if (!isNaN(value) && value >= 20 && value <= 300) {
                  Tone.Transport.bpm.value = value;
             } else {
                  bpmInput.value = Math.round(Tone.Transport.bpm.value).toString(); // Fall back!
             }
        });
        bpmInput.addEventListener('keydown', (e) => {
             if (e.key === 'Enter') {
                  bpmInput.blur();
             }
        });
    }

    const statusMessage = document.getElementById('status-message');

    // Copy button
    const copyBtn = document.getElementById('copy-btn');
    if (copyBtn) {
        copyBtn.addEventListener('click', () => {
             const songStr = serializeSong();
             navigator.clipboard.writeText(songStr);
             const statusText = document.getElementById('status-text');
             if (statusMessage && statusText) {
                  statusText.textContent = 'Song copied to clipboard.';
                  statusMessage.style.display = 'flex';
                  if (pasteContainer) pasteContainer.style.display = 'none';
                  if (helpContainer) helpContainer.style.display = 'none';
                  if (pasteBtn) pasteBtn.textContent = 'LOAD';
                  
                  setTimeout(() => {
                       statusMessage.style.display = 'none';
                  }, 2000);
             }
        });
    }

    // Share button
    const shareBtn = document.getElementById('share-btn');
    if (shareBtn) {
        shareBtn.addEventListener('click', () => {
             const songStr = serializeSong();
             const url = new URL(window.location.href);
             url.searchParams.set('song', songStr);
             navigator.clipboard.writeText(url.toString());
             const statusText = document.getElementById('status-text');
             if (statusMessage && statusText) {
                  statusText.textContent = 'Link copied to clipboard.';
                  statusMessage.style.display = 'flex';
                  if (pasteContainer) pasteContainer.style.display = 'none';
                  if (helpContainer) helpContainer.style.display = 'none';
                  if (pasteBtn) pasteBtn.textContent = 'LOAD';
                  
                  setTimeout(() => {
                       statusMessage.style.display = 'none';
                  }, 2000);
             }
        });
    }

    // Paste button
    const pasteBtn = document.getElementById('paste-btn');
    const pasteContainer = document.getElementById('paste-container');
    const pasteInput = document.getElementById('paste-input') as HTMLInputElement;
    const helpContainer = document.getElementById('help-container');
    const helpBtn = document.getElementById('help-btn');
    if (pasteBtn && pasteContainer && helpContainer && helpBtn) {
        pasteBtn.addEventListener('click', () => {
             if (pasteContainer.style.display === 'none' || pasteContainer.style.display === '') {
                  pasteContainer.style.display = 'flex';
                  helpContainer.style.display = 'none'; // Closes help text if open!
                  if (statusMessage) {
                       statusMessage.style.display = 'none';
                  }
                  pasteInput.focus();
             } else {
                  pasteContainer.style.display = 'none';
                  pasteInput.value = '';
             }
        });
        
        helpBtn.addEventListener('click', () => {
             if (helpContainer.style.display === 'none' || helpContainer.style.display === '') {
                  helpContainer.style.display = 'block';
                  pasteContainer.style.display = 'none'; // Closes load box if open!
                  if (statusMessage) {
                       statusMessage.style.display = 'none';
                  }
                  pasteInput.value = '';
             } else {
                  helpContainer.style.display = 'none';
             }
        });
    }

    const cancelPasteBtn = document.getElementById('cancel-paste-btn');
    if (cancelPasteBtn && pasteContainer && pasteInput) {
        cancelPasteBtn.addEventListener('click', () => {
             pasteContainer.style.display = 'none';
             pasteInput.value = '';
        });
    }    // Load button
    const loadBtn = document.getElementById('load-btn');
    if (loadBtn && pasteInput && pasteContainer && pasteBtn) {
        loadBtn.addEventListener('click', () => {
             if (pasteInput.value.trim() !== '') {
                  deserializeSong(pasteInput.value.trim());
                  pasteContainer.style.display = 'none';
                  pasteBtn.textContent = 'LOAD';
                  pasteInput.value = '';
             }
        });
        pasteInput.addEventListener('keydown', (e) => {
             if (e.key === 'Enter' && pasteInput.value.trim() !== '') {
                  deserializeSong(pasteInput.value.trim());
                  pasteContainer.style.display = 'none';
                  pasteBtn.textContent = 'LOAD';
                  pasteInput.value = '';
             }
        });
    }

    // Keyboard triggers
    const keyMap: { [key: string]: number } = {
        '1': 0, '2': 1, '3': 2, '4': 3, '5': 4,
        '6': 5, '7': 6, '8': 7, '9': 8, '0': 9,
        '-': 10, '=': 11
    };

    window.addEventListener('keydown', async (e) => {
        // Ignore if typing in an input!
        if (document.activeElement && document.activeElement.tagName === 'INPUT') {
             return;
        }

        if (e.key === ' ') {
            e.preventDefault(); // Prevent space bar scrolling
            await Tone.start();
            const playBtn = document.getElementById('play-btn');
            if (isPlaying) {
                Tone.Transport.stop();
                if (playBtn) playBtn.textContent = '▶ PLAY';
                currentStep = 0;
                updatePlayhead(-1);
            } else {
                Tone.Transport.start();
                if (playBtn) playBtn.textContent = '■ STOP';
            }
            isPlaying = !isPlaying;
            return;
        }

        const index = keyMap[e.key];
        if (index !== undefined && index < PADS_CONFIG.length) {
            const key = PADS_CONFIG[index].key;
            Tone.start();
            triggerSound(key);
            applyImpact(index);
            
            const pad = document.querySelector(`.pad[data-key="${key}"]`);
            if (pad) {
                pad.classList.add('active');
                setTimeout(() => pad.classList.remove('active'), 100);
            }
        }
    });
}

// --- Init ---
window.addEventListener('DOMContentLoaded', () => {
    initAudio();
    initUI();
    setupSequencer();
    setupEventListeners();
    loadFromUrl();
    updatePhysics();
});
