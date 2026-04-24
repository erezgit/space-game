export class GameState {
  score = 0;
  health = 5;
  alive = true;

  reset(): void {
    this.score = 0;
    this.health = 5;
    this.alive = true;
  }

  addScore(value: number): void {
    if (!this.alive) return;
    this.score += value;
  }

  takeDamage(): void {
    if (!this.alive) return;
    this.health = Math.max(0, this.health - 1);
    if (this.health === 0) {
      this.alive = false;
    }
  }
}
