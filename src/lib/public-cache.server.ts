/** Public display data only. Never use for identity, balances or mutation eligibility. */
export class PublicCache {
  private entries = new Map<string, { expires: number; value: Promise<unknown> }>();
  private ttl: number;
  private limit: number;
  constructor(ttl = 5000, limit = 64) { this.ttl = ttl; this.limit = limit; }
  clear() { this.entries.clear(); }
  read<T>(key: string, load: () => Promise<T>): Promise<T> {
    const old = this.entries.get(key);
    if (old && old.expires > Date.now()) return old.value as Promise<T>;
    this.entries.delete(key);
    if (this.entries.size >= this.limit) this.entries.delete(this.entries.keys().next().value!);
    const entry = { expires: Date.now() + this.ttl, value: Promise.resolve().then(load) };
    this.entries.set(key, entry);
    entry.value.catch(() => { if (this.entries.get(key) === entry) this.entries.delete(key); });
    return entry.value;
  }
}
export const publicCache = new PublicCache();
