export interface ControlInput {
  /** -1..1 horizontal (yaw). +1 = push joystick right. */
  x: number;
  /** -1..1 vertical (pitch). +1 = push joystick down, -1 = push up. */
  y: number;
  /** True while player is pressing fire */
  firing: boolean;
}

interface ActiveTouch {
  id: number;
  side: "left" | "right";
  /** Current touch position in px (screen coordinates) */
  currentX: number;
  currentY: number;
}

/**
 * Touch controls for iPhone landscape.
 *
 * Left half of screen → static joystick. Base is fixed in bottom-left. The
 * visible inner knob tracks the touch's delta from the base center. Touch
 * anywhere on the left half engages it (finger does NOT have to start on the
 * visible base), but the base itself never moves.
 *
 * Right half of screen → tap anywhere to fire.
 *
 * Keyboard fallback: WASD / arrow keys + Space for desktop testing.
 */
export class TouchControls {
  private touches = new Map<number, ActiveTouch>();
  private keyState = { up: false, down: false, left: false, right: false, fire: false };

  private joystickEl = document.getElementById("joystick") as HTMLElement;
  private joystickKnobEl = document.getElementById("joystick-knob") as HTMLElement;
  private zoneLeft = document.getElementById("zone-left") as HTMLElement;
  private zoneRight = document.getElementById("zone-right") as HTMLElement;

  private static readonly MAX_DIST = 60; // px — knob travel radius

  /** Center of the visible joystick base in screen pixels, recomputed on resize. */
  private baseCenterX = 0;
  private baseCenterY = 0;

  /** Track an active left-thumb touch so we can move the knob. */
  private leftTouchId: number | null = null;

  constructor() {
    this.refreshJoystickBaseCenter();
    window.addEventListener("resize", () => this.refreshJoystickBaseCenter());
    window.addEventListener("orientationchange", () =>
      setTimeout(() => this.refreshJoystickBaseCenter(), 200)
    );
    this.bindTouch(this.zoneLeft, "left");
    this.bindTouch(this.zoneRight, "right");
    this.bindKeyboard();
  }

  private refreshJoystickBaseCenter(): void {
    const r = this.joystickEl.getBoundingClientRect();
    this.baseCenterX = r.left + r.width / 2;
    this.baseCenterY = r.top + r.height / 2;
  }

  private bindTouch(el: HTMLElement, side: "left" | "right"): void {
    el.addEventListener(
      "touchstart",
      (e: TouchEvent) => {
        e.preventDefault();
        for (const t of Array.from(e.changedTouches)) {
          this.touches.set(t.identifier, {
            id: t.identifier,
            side,
            currentX: t.clientX,
            currentY: t.clientY,
          });
          if (side === "left") {
            this.leftTouchId = t.identifier;
            this.joystickEl.classList.add("active");
            this.updateJoystickKnob(t.clientX, t.clientY);
          }
        }
      },
      { passive: false }
    );

    el.addEventListener(
      "touchmove",
      (e: TouchEvent) => {
        e.preventDefault();
        for (const t of Array.from(e.changedTouches)) {
          const at = this.touches.get(t.identifier);
          if (!at) continue;
          at.currentX = t.clientX;
          at.currentY = t.clientY;
          if (at.side === "left" && this.leftTouchId === t.identifier) {
            this.updateJoystickKnob(t.clientX, t.clientY);
          }
        }
      },
      { passive: false }
    );

    const endHandler = (e: TouchEvent): void => {
      e.preventDefault();
      for (const t of Array.from(e.changedTouches)) {
        const at = this.touches.get(t.identifier);
        if (!at) continue;
        this.touches.delete(t.identifier);
        if (at.side === "left" && this.leftTouchId === t.identifier) {
          this.leftTouchId = null;
          this.joystickEl.classList.remove("active");
          this.joystickKnobEl.style.transform = "translate(-50%, -50%)";
        }
      }
    };
    el.addEventListener("touchend", endHandler, { passive: false });
    el.addEventListener("touchcancel", endHandler, { passive: false });
  }

  private bindKeyboard(): void {
    window.addEventListener("keydown", (e) => {
      if (e.code === "ArrowUp" || e.code === "KeyW") this.keyState.up = true;
      if (e.code === "ArrowDown" || e.code === "KeyS") this.keyState.down = true;
      if (e.code === "ArrowLeft" || e.code === "KeyA") this.keyState.left = true;
      if (e.code === "ArrowRight" || e.code === "KeyD") this.keyState.right = true;
      if (e.code === "Space") {
        this.keyState.fire = true;
        e.preventDefault();
      }
    });
    window.addEventListener("keyup", (e) => {
      if (e.code === "ArrowUp" || e.code === "KeyW") this.keyState.up = false;
      if (e.code === "ArrowDown" || e.code === "KeyS") this.keyState.down = false;
      if (e.code === "ArrowLeft" || e.code === "KeyA") this.keyState.left = false;
      if (e.code === "ArrowRight" || e.code === "KeyD") this.keyState.right = false;
      if (e.code === "Space") this.keyState.fire = false;
    });
  }

  private updateJoystickKnob(touchX: number, touchY: number): void {
    const dx = touchX - this.baseCenterX;
    const dy = touchY - this.baseCenterY;
    const dist = Math.hypot(dx, dy);
    const scale = dist > TouchControls.MAX_DIST ? TouchControls.MAX_DIST / dist : 1;
    const knobDx = dx * scale;
    const knobDy = dy * scale;
    // Knob is absolutely positioned at center; offset by translate on top of the
    // -50%/-50% centering transform.
    this.joystickKnobEl.style.transform = `translate(calc(-50% + ${knobDx}px), calc(-50% + ${knobDy}px))`;
  }

  sample(): ControlInput {
    let x = 0;
    let y = 0;
    let firing = false;

    if (this.leftTouchId !== null) {
      const t = this.touches.get(this.leftTouchId);
      if (t) {
        const dx = t.currentX - this.baseCenterX;
        const dy = t.currentY - this.baseCenterY;
        const dist = Math.hypot(dx, dy);
        if (dist > 0.01) {
          const clamped = Math.min(dist, TouchControls.MAX_DIST);
          x = (dx / dist) * (clamped / TouchControls.MAX_DIST);
          y = (dy / dist) * (clamped / TouchControls.MAX_DIST);
        }
      }
    }

    for (const t of this.touches.values()) {
      if (t.side === "right") firing = true;
    }

    // Keyboard fallback (desktop testing)
    if (this.keyState.left) x = -1;
    if (this.keyState.right) x = 1;
    if (this.keyState.up) y = -1;
    if (this.keyState.down) y = 1;
    if (this.keyState.fire) firing = true;

    return { x, y, firing };
  }
}
