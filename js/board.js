// Chessground wrapper: one place for rendering, move plumbing, promotion and feedback.
import { Chessground } from '../lib/chessground.min.js';

export class Board {
  /**
   * @param {HTMLElement} el  container element
   * @param {{onMove:Function, onIllegal?:Function}} handlers
   */
  constructor(el, handlers = {}) {
    this.el = el;
    this.frame = el.closest('.board-frame') || el;
    this.handlers = handlers;
    this.orientation = 'white';
    this.flipped = false;
    this.cg = Chessground(el, {
      fen: undefined,
      orientation: this.orientation,
      coordinates: true,
      animation: { enabled: true, duration: 220 },
      highlight: { lastMove: true, check: true },
      draggable: { enabled: true, showGhost: true },
      selectable: { enabled: true },
      premovable: { enabled: false },
      drawable: { enabled: true, visible: true, defaultSnapToValidMove: false },
      movable: {
        free: false,
        color: undefined,
        dests: new Map(),
        showDests: true,
        events: {
          after: (orig, dest) => this.handleUserMove(orig, dest),
        },
      },
    });
    this.el.classList.add('wp-board-el');
  }

  static promotionNeeded(fen, from, to) {
    const piece = fen.split(' ')[0];
    // rank of destination for the moving pawn
    const white = fen.split(' ')[1] === 'w';
    return (white && to[1] === '8') || (!white && to[1] === '1');
  }

  handleUserMove(orig, dest) {
    if (this.busy) return;
    if (!this.handlers.onMove) return;
    this.handlers.onMove(orig, dest);
  }

  /**
   * Render a position.
   * @param {{fen:string, orientation?:string, dests?:Map, lastMove?:[string,string]|null,
   *          playerTurn?:boolean, check?:boolean}} state
   */
  /** Force the board orientation (used when a new puzzle is loaded). */
  setOrientation(color) {
    this.orientation = color === 'black' || color === 'b' ? 'black' : 'white';
    this.cg.set({ orientation: this.orientation });
  }

  set(state) {
    if (!state) return;
    if (state.orientation) this.orientation = state.orientation;
    const dests = state.dests instanceof Map ? state.dests : new Map();
    const turnColor = state.fen.split(' ')[1] === 'w' ? 'white' : 'black';
    this.cg.set({
      fen: state.fen,
      orientation: this.orientation,
      turnColor,
      check: state.check ?? false,
      lastMove: state.lastMove || undefined,
      movable: {
        free: false,
        color: state.playerTurn ? turnColor : undefined,
        dests,
        showDests: !!state.playerTurn,
      },
      selectable: { enabled: true },
    });
  }

  arrows(list) {
    this.cg.setAutoShapes(list || []);
  }

  clearArrows() {
    this.cg.setAutoShapes([]);
  }

  flip() {
    this.flipped = !this.flipped;
    const next = this.orientation === 'white' ? 'black' : 'white';
    this.orientation = next;
    this.cg.toggleOrientation();
    return next;
  }

  /** Visual feedback: 'correct' | 'wrong' | 'opponent'. */
  pulse(kind) {
    const frame = this.frame;
    frame.classList.remove('pulse-correct', 'pulse-wrong', 'pulse-opponent');
    // force reflow so the animation restarts
    void frame.offsetWidth;
    if (kind) frame.classList.add('pulse-' + kind);
  }

  destroy() {
    try {
      this.cg.destroy();
    } catch {
      /* ignore */
    }
  }
}
