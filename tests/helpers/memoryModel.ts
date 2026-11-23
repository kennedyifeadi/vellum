// A Mongoose model on an array: the queries, updates and indexes the app uses on stored
// files and users. tests/file-retention-mongo.test.ts runs the same flows on a real MongoDB.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;
type Index = { name: string; key: Record<string, number>; expireAfterSeconds?: number };

let nextId = 0;

function newObjectId(): string {
  nextId += 1;
  return `65${nextId.toString(16).padStart(22, '0')}`;
}

function comparable(value: unknown): unknown {
  if (value instanceof Date) return value.getTime();
  return value !== null && typeof value === 'object' ? String(value) : value;
}

function meets(value: unknown, condition: unknown): boolean {
  const operators = condition !== null && typeof condition === 'object' && Object.getPrototypeOf(condition) === Object.prototype;
  if (!operators) return comparable(value) === comparable(condition);

  return Object.entries(condition as Row).every(([operator, expected]) => {
    switch (operator) {
      case '$exists':
        return (value !== undefined) === expected;
      case '$in':
        return (expected as unknown[]).some((item) => comparable(item) === comparable(value));
      case '$gt':
        return value !== undefined && (comparable(value) as number) > (comparable(expected) as number);
      case '$lte':
        return value !== undefined && (comparable(value) as number) <= (comparable(expected) as number);
      default:
        throw new Error(`memoryModel does not support ${operator}`);
    }
  });
}

function matches(row: Row, filter: Row = {}): boolean {
  return Object.entries(filter).every(([field, condition]) => meets(row[field], condition));
}

function query<Result>(run: () => Result) {
  const chain = {
    select: () => chain,
    lean: () => chain,
    then: <A, B>(resolve?: (value: Result) => A, reject?: (reason: unknown) => B) =>
      Promise.resolve().then(run).then(resolve, reject),
  };
  return chain;
}

export function createMemoryModel() {
  let rows: Row[] = [];
  let indexes: Index[] = [];
  const copy = (row: Row | undefined): Row | null => (row ? { ...row } : null);
  const select = (filter?: Row) => rows.filter((row) => matches(row, filter));

  function remove(targets: Row[]) {
    rows = rows.filter((row) => !targets.includes(row));
    return { deletedCount: targets.length };
  }

  function apply(targets: Row[], update: Row) {
    for (const row of targets) Object.assign(row, update.$set);
    return { matchedCount: targets.length };
  }

  function seed(row: Row): Row {
    const stored = { _id: newObjectId(), createdAt: new Date(), ...row };
    rows.push(stored);
    return { ...stored };
  }

  return {
    reset() {
      rows = [];
      indexes = [];
    },
    all: () => rows.map((row) => ({ ...row })),
    seed,
    create: async (row: Row) => seed(row),
    find(filter?: Row) {
      let order: [string, number][] = [];
      let most = Infinity;
      const run = () =>
        select(filter)
          .sort((a, b) => {
            for (const [field, direction] of order) {
              const [left, right] = [comparable(a[field]) as number, comparable(b[field]) as number];
              if (left !== right) return left < right ? -direction : direction;
            }
            return 0;
          })
          .slice(0, most)
          .map((row) => ({ ...row }));
      const chain = {
        sort(spec: Record<string, number>) {
          order = Object.entries(spec);
          return chain;
        },
        limit(count: number) {
          most = count;
          return chain;
        },
        select: () => chain,
        lean: () => chain,
        then: query(run).then,
      };
      return chain;
    },
    findOne: (filter?: Row) => query(() => copy(select(filter)[0])),
    findById: (_id: unknown) => query(() => copy(select({ _id })[0])),
    findByIdAndDelete: (_id: unknown) =>
      query(() => {
        const found = select({ _id })[0];
        if (found) remove([found]);
        return copy(found);
      }),
    updateOne: async (filter: Row, update: Row) => apply(select(filter).slice(0, 1), update),
    updateMany: async (filter: Row, update: Row) => apply(select(filter), update),
    deleteOne: async (filter: Row) => remove(select(filter).slice(0, 1)),
    countDocuments: (filter?: Row) => query(() => select(filter).length),
    async aggregate([{ $match }]: [{ $match: Row }]) {
      const found = select($match);
      return found.length ? [{ _id: null, total: found.reduce((sum, row) => sum + row.fileSize, 0) }] : [];
    },
    collection: {
      seedIndex(index: Index) {
        indexes.push(index);
      },
      indexes: async () => indexes.map((index) => ({ ...index })),
      async createIndex(key: Index['key'], options: { expireAfterSeconds?: number } = {}) {
        const name = Object.entries(key).flat().join('_');
        const existing = indexes.find((index) => index.name === name);
        if (existing && existing.expireAfterSeconds !== options.expireAfterSeconds) {
          throw Object.assign(new Error('An equivalent index already exists with different options'), { code: 85 });
        }
        if (!existing) indexes.push({ name, key, ...options });
        return name;
      },
      async dropIndex(name: string) {
        if (!indexes.some((index) => index.name === name)) {
          throw Object.assign(new Error(`index not found with name [${name}]`), { code: 27 });
        }
        indexes = indexes.filter((index) => index.name !== name);
      },
    },
  };
}

export type MemoryModel = ReturnType<typeof createMemoryModel>;

/** For jest.mock factories of the models. */
export function memoryModelModule() {
  return { __esModule: true, default: createMemoryModel() };
}
