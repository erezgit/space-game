export class HUD {
  private scoreEl = document.getElementById("score") as HTMLElement;
  private healthPipsEl = document.getElementById("health") as HTMLElement;
  private deathEl = document.getElementById("death-screen") as HTMLElement;
  private finalScoreEl = document.getElementById("final-score") as HTMLElement;
  private restartBtn = document.getElementById("restart-btn") as HTMLButtonElement;
  private damageFlash = document.getElementById("damage-flash") as HTMLElement;

  private displayScore = 0;
  private targetScore = 0;
  private restartCallback: (() => void) | null = null;

  constructor() {
    this.restartBtn.addEventListener("click", () => {
      if (this.restartCallback) this.restartCallback();
    });
    this.restartBtn.addEventListener("touchend", (e) => {
      e.preventDefault();
      if (this.restartCallback) this.restartCallback();
    });
  }

  onRestart(cb: () => void): void {
    this.restartCallback = cb;
  }

  setScore(v: number): void {
    this.targetScore = v;
    // If big jump (restart → 0), snap immediately
    if (v === 0) {
      this.displayScore = 0;
      this.scoreEl.textContent = "0";
    }
  }

  setHealth(v: number): void {
    const pips = this.healthPipsEl.querySelectorAll(".hp-pip");
    pips.forEach((pip, i) => {
      if (i < v) {
        pip.classList.remove("off");
      } else {
        pip.classList.add("off");
      }
    });
  }

  flashDamage(): void {
    this.damageFlash.classList.remove("flash");
    // reflow
    void this.damageFlash.offsetWidth;
    this.damageFlash.classList.add("flash");
  }

  showDeath(finalScore: number): void {
    this.finalScoreEl.textContent = finalScore.toLocaleString();
    this.deathEl.classList.remove("hidden");
  }

  hideDeath(): void {
    this.deathEl.classList.add("hidden");
  }

  tick(dt: number): void {
    // Smoothly animate score count
    if (this.displayScore !== this.targetScore) {
      const diff = this.targetScore - this.displayScore;
      const step = Math.max(1, Math.abs(diff) * dt * 6);
      if (Math.abs(diff) <= step) {
        this.displayScore = this.targetScore;
      } else {
        this.displayScore += Math.sign(diff) * step;
      }
      this.scoreEl.textContent = Math.floor(this.displayScore).toLocaleString();
    }
  }
}
