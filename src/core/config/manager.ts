import { CorpConfig } from "./types.js";

export class CorpContext {
  private current: CorpConfig | null = null;
  private readonly corps = new Map<string, CorpConfig>();

  constructor(corps: CorpConfig[]) {
    for (const corp of corps) {
      this.corps.set(corp.id, corp);
    }
    this.current = corps[0] ?? null;
  }

  getCurrent(): CorpConfig | null {
    return this.current;
  }

  switchCorp(corpId: string): boolean {
    const corp = this.corps.get(corpId);
    if (!corp) return false;
    this.current = corp;
    return true;
  }

  listCorps(): Array<{ id: string; name: string; sourceType: string; current: boolean }> {
    return Array.from(this.corps.values()).map((corp) => ({
      id: corp.id,
      name: corp.name,
      sourceType: corp.source.type,
      current: corp.id === this.current?.id
    }));
  }
}
