import * as pc from "playcanvas";
import type { Enemy, EnemySystem } from "./enemies";

/**
 * Missile lock-on.
 *
 * Keep an enemy aircraft inside the centre circle for LOCK_TIME seconds and the
 * lock completes: the circle and the box on the target turn green, the tone goes
 * high and fast, and a missile fired now is guided. Losing the target for longer
 * than a short grace period resets the lock.
 */

const LOCK_TIME = 2;
const GRACE = 0.3;
const RANGE = 900;

export class Targeting {
  target: Enemy | null = null;
  progress = 0; // seconds held
  private lostFor = 0;
  private screen = new pc.Vec3();
  private reticle = document.getElementById("reticle") as HTMLElement;
  private box = document.getElementById("lock-box") as HTMLElement;
  private label = document.getElementById("lock-label") as HTMLElement;

  get locked(): boolean {
    return !!this.target && this.progress >= LOCK_TIME;
  }

  /** 0 = nothing, 1 = seeking, 2 = locked — for the tone. */
  get state(): 0 | 1 | 2 {
    return this.locked ? 2 : this.target ? 1 : 0;
  }

  update(dt: number, camera: pc.Entity, jet: pc.Entity, enemies: EnemySystem): void {
    const cam = camera.camera!;
    const canvas = cam.system.app.graphicsDevice.canvas as HTMLCanvasElement;
    const cx = canvas.clientWidth / 2, cy = canvas.clientHeight / 2;
    const radius = this.reticle.offsetWidth / 2 || 75;
    const jp = jet.getPosition(), fwd = jet.forward;

    let best: Enemy | null = null;
    let bestD = Infinity;
    for (const e of enemies.targets()) {
      const p = e.entity.getPosition();
      const dx = p.x - jp.x, dy = p.y - jp.y, dz = p.z - jp.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > RANGE || (dx * fwd.x + dy * fwd.y + dz * fwd.z) / dist < 0.3) continue;
      cam.worldToScreen(p, this.screen);
      const d = Math.hypot(this.screen.x - cx, this.screen.y - cy);
      if (d < radius && d < bestD) { best = e; bestD = d; }
    }

    if (this.target && (this.target.mode === "falling" || !this.target.entity.enabled)) this.reset();
    if (best && best === this.target) {
      this.progress += dt;
      this.lostFor = 0;
    } else if (best && !this.target) {
      this.target = best;
      this.progress = 0;
      this.lostFor = 0;
    } else if (this.target) {
      this.lostFor += dt;
      if (this.lostFor > GRACE) {
        this.reset();
        if (best) { this.target = best; this.progress = 0; }
      }
    }
    this.render(cam);
  }

  reset(): void {
    this.target = null;
    this.progress = 0;
    this.lostFor = 0;
  }

  private render(cam: pc.CameraComponent): void {
    const locked = this.locked;
    this.reticle.classList.toggle("locked", locked);
    this.reticle.style.setProperty("--p", String(Math.min(1, this.progress / LOCK_TIME)));
    this.label.classList.toggle("locked", locked);
    if (this.target) {
      cam.worldToScreen(this.target.entity.getPosition(), this.screen);
      this.box.classList.remove("hidden");
      this.box.classList.toggle("locked", locked);
      this.box.style.left = `${this.screen.x}px`;
      this.box.style.top = `${this.screen.y}px`;
      const kind = this.target.kind === "bomber" ? "BOMBER" : "FIGHTER";
      this.label.textContent = locked ? `LOCKED · ${kind} · FIRE ⌘` : `LOCKING ${kind} ${Math.max(0, LOCK_TIME - this.progress).toFixed(1)}`;
    } else {
      this.box.classList.add("hidden");
      this.label.textContent = "";
    }
  }
}
