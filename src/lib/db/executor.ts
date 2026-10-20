export type Row = Record<string, unknown>;

export interface Executor {
  query<T = Row>(text: string, params?: readonly unknown[]): Promise<T[]>;
  exec(text: string): Promise<void>;
  transaction<T>(fn: (tx: Executor) => Promise<T>): Promise<T>;
}

export async function wrapPglite(db: {
  query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
  exec: (text: string) => Promise<unknown>;
  transaction: <T>(fn: (tx: {
    query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
    exec: (text: string) => Promise<unknown>;
  }) => Promise<T>) => Promise<T>;
}): Promise<Executor> {
  const wrap = (target: {
    query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
    exec: (text: string) => Promise<unknown>;
  }): Executor => ({
    async query<T>(text: string, params: readonly unknown[] = []) {
      const result = await target.query(text, [...params]);
      return result.rows as T[];
    },
    async exec(text: string) {
      await target.exec(text);
    },
    transaction(fn) {
      return db.transaction(async (tx) => fn(wrap(tx)));
    },
  });
  return wrap(db);
}
