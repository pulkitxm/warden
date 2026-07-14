export interface Page<T> {
  items: T[];
  cursor: number | null;
}

export class Paginator<T> {
  private readonly source: T[];
  private readonly size: number;

  constructor(source: T[], size: number) {
    this.source = source;
    this.size = size;
  }

  page(cursor: number): Page<T> {
    const start = cursor * this.size;
    const items = this.source.slice(start, start + this.size);
    const next = start + this.size < this.source.length ? cursor + 1 : null;
    return { items, cursor: next };
  }

  count(): number {
    return Math.ceil(this.source.length / this.size);
  }

  first(): Page<T> {
    return this.page(0);
  }

  last(): Page<T> {
    return this.page(Math.max(0, this.count() - 1));
  }

  isEmpty(): boolean {
    return this.source.length === 0;
  }

  pages(): T[][] {
    const out: T[][] = [];
    let cursor: number | null = 0;
    while (cursor !== null) {
      const next: Page<T> = this.page(cursor);
      out.push(next.items);
      cursor = next.cursor;
    }
    return out;
  }
}

export function paginate<T>(items: T[], size: number): T[][] {
  if (!items.length) return [];
  return new Paginator(items, size).pages();
}

export function pageCount<T>(items: T[], size: number): number {
  return new Paginator(items, size).count();
}
