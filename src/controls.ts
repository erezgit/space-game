export interface ControlInput {
  /** -1..1 horizontal (yaw) */
  x: number;
  /** -1..1 vertical (pitch) */
  y: number;
  /** True while player is pressing fire */
  firing: boolean;
}

interface ActiveTouch {
  id: number;
  side: "left" | "right";
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

/**
 * Touch-first controls for iPhone landscape.
 * Left half of screen = virtual joystick (pitch/yaw).
 * Right half of screen = fire (tap or hold).
 * Also supports keyboard (WASD + space) as optional fallback for desktop.
 */
export class TouchControls {
  private touches = new Map<number, ActiveTouch>();
  private keyState = { up: false, down: false, left: false, right: false, fire: false };

  private joystickEl = document.getElementById("joystick") as HTMLElement;
  private joystickKnobEl = document.getElementById("joystick-knob") as HTMLElement;
  private zoneLeft = document.getElementById("zone-left") as HTMLElement;
  private zoneRight = document.getElementById("zone-right") as HTMLElement;

  private static readonly MAX_DIST = 60; // px

  constructor() {
    this.bindTouch(this.zoneLeft, "left");
    this.bindTouch(this.zoneRight, "right");
    this.bindKeyboard();
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
            startX: t.clientX,
            startY: t.clientY,
            currentX: t.clientX,
            currentY: t.clientY,
          });
          if (side === "left") {
            this.showJoystick(t.clientX, t.clientY);
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
          if (at.side === "left") {
            this.updateJoystickKnob(at);
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
        if (at.side === "left") {
          this.hideJoystick();
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

  private showJoystick(x: number, y: number): void {
    this.joystickEl.style.left = `${x - 65}px`;
    this.joystickEl.style.top = `${y - 65}px`;
    this.joystickEl.classList.add("active");
    this.joystickKnobEl.style.transform = "translate(0,0)";
  }

  private hideJoystick(): void {
    this.joystickEl.classList.remove("active");
  }

  private updateJoystickKnob(at: ActiveTouch): void {
    let dx = at.currentX - at.startX;
    let dy = at.currentY - at.startY;
    const dist = Math.hypot(dx, dy);
    if (dist > TouchControls.MAX_DIST) {
      dx = (dx / dist) * TouchControls.MAX_DIST;
      dy = (dy / dist) * TouchControls.MAX_DIST;
    }
    this.joystickKnobEl.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  sample(): ControlInput {
    let x = 0;
    let y = 0;
    let firing = false;

    for (const t of this.touches.values()) {
      if (t.side === "left") {
        const dx = t.currentX - t.startX;
        const dy = t.currentY - t.startY;
        const dist = Math.hypot(dx, dy);
        const clamped = Math.min(dist, TouchControls.MAX_DIST);
        if (dist > 0.01) {
          x = (dx / dist) * (clamped / TouchControls.MAX_DIST);
          y = (dy / dist) * (clamped / TouchControls.MAX_DIST);
        }
      } else {
        firing = true;
      }
    }

    // Keyboard overrides (nice for desktop testing)
    if (this.keyState.left) x = -1;
    if (this.keyState.right) x = 1;
    if (this.keyState.up) y = -1;
    if (this.keyState.down) y = 1;
    if (this.keyState.fire) firing = true;

    return { x, y, firing };
  }
}
