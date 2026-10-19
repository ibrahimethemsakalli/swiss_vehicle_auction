type Point = { x: number; y: number };
export class GalleryGesture {
  points = new Map<number, Point>();
  scale = 1;
  x = 0;
  y = 0;
  private start: Point | null = null;
  private previous: Point | null = null;
  private distance = 0;
  private multi = false;
  constructor(
    public width = 1,
    public height = 1,
  ) {}
  snapshot() {
    return { scale: this.scale, x: this.x, y: this.y };
  }
  zoom(scale: number) {
    this.scale = Math.min(4, Math.max(1, scale));
    this.clamp();
    return this.snapshot();
  }
  private clamp() {
    if (this.scale === 1) {
      this.x = 0;
      this.y = 0;
      return;
    }
    const limitX = (this.width * (this.scale - 1)) / 2;
    const limitY = (this.height * (this.scale - 1)) / 2;
    this.x = Math.max(-limitX, Math.min(limitX, this.x));
    this.y = Math.max(-limitY, Math.min(limitY, this.y));
  }
  private pair() {
    const [a, b] = [...this.points.values()];
    return {
      distance: Math.hypot(a.x - b.x, a.y - b.y),
      center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    };
  }
  down(id: number, point: Point) {
    this.points.set(id, point);
    if (this.points.size === 1) {
      this.start = point;
      this.previous = point;
      this.multi = false;
    } else {
      const pair = this.pair();
      this.distance = pair.distance;
      this.previous = pair.center;
      this.multi = true;
    }
  }
  move(id: number, point: Point) {
    if (!this.points.has(id)) return this.snapshot();
    const old = this.points.get(id)!;
    this.points.set(id, point);
    if (this.points.size >= 2) {
      const pair = this.pair();
      if (this.distance > 0)
        this.scale = Math.min(4, Math.max(1, (this.scale * pair.distance) / this.distance));
      if (this.previous) {
        this.x += pair.center.x - this.previous.x;
        this.y += pair.center.y - this.previous.y;
      }
      this.distance = pair.distance;
      this.previous = pair.center;
    } else if (this.scale > 1) {
      this.x += point.x - old.x;
      this.y += point.y - old.y;
    }
    this.clamp();
    return this.snapshot();
  }
  up(id: number, point: Point, cancelled = false): number {
    if (!this.points.has(id)) return 0;
    this.points.delete(id);
    let direction = 0;
    if (!cancelled && !this.multi && this.scale === 1 && this.start && this.points.size === 0) {
      const dx = point.x - this.start.x,
        dy = point.y - this.start.y;
      if (Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy) * 1.4) direction = dx < 0 ? 1 : -1;
    }
    if (!this.points.size) {
      this.start = null;
      this.previous = null;
    }
    return direction;
  }
}
