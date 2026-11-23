// Stands in for mongoose, for the operations sign-in uses, so its routes and models can run
// without a database. tests/helpers/signInContract.ts runs the same cases against this and
// against a real MongoDB. Each operation is atomic and lets others run before it.

type Row = Record<string, unknown>;

const isObject = (value: unknown): value is Row =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);
const hasOperators = (value: unknown): value is Row =>
  isObject(value) && Object.keys(value).some((key) => key.startsWith('$'));

const valueAt = (row: Row, path: string) =>
  path.split('.').reduce<unknown>((value, key) => (value as Row | undefined)?.[key], row);

function meets(value: unknown, condition: unknown): boolean {
  if (!hasOperators(condition)) return value === condition;
  return Object.entries(condition).every(([operator, operand]) => {
    switch (operator) {
      case '$lt': return Number(value) < Number(operand);
      case '$lte': return Number(value) <= Number(operand);
      case '$gt': return Number(value) > Number(operand);
      case '$exists': return (value !== undefined) === operand;
      default: throw new Error(`memoryMongoose does not support ${operator}`);
    }
  });
}

const matches = (row: Row, filter: Row) =>
  Object.entries(filter).every(([path, condition]) => meets(valueAt(row, path), condition));

function applyUpdate(row: Row, update: Row) {
  for (const [operator, fields] of Object.entries(update)) {
    if (!operator.startsWith('$')) {
      row[operator] = fields;
      continue;
    }
    for (const [key, value] of Object.entries(fields as Row)) {
      const list = (row[key] ?? []) as unknown[];
      if (operator === '$set') row[key] = value;
      else if (operator === '$inc') row[key] = Number(row[key] ?? 0) + Number(value);
      else if (operator === '$push') row[key] = [...list, value];
      else if (operator === '$pull') row[key] = list.filter((item) => !meets(item, value));
      else throw new Error(`memoryMongoose does not support ${operator}`);
    }
  }
}

function createModel() {
  let rows: Row[] = [];
  let nextId = 0;

  function insert(row: Row) {
    const inserted: Row = { _id: `row-${++nextId}`, ...row };
    if (rows.some((existing) => existing._id === inserted._id)) throw new Error('Duplicate key');
    rows.push(inserted);
    return inserted;
  }

  async function update(filter: Row, changes: Row, upsert = false) {
    await Promise.resolve();
    const found = rows.find((row) => matches(row, filter));
    const before = found ? { ...found } : null;
    let row = found;
    if (!row && upsert) {
      row = insert(Object.fromEntries(Object.entries(filter).filter(([, value]) => !hasOperators(value))));
    }
    if (row) applyUpdate(row, changes);
    return { before, after: row ? { ...row } : null };
  }

  return {
    async findOne(filter: Row) {
      await Promise.resolve();
      const row = rows.find((candidate) => matches(candidate, filter));
      return row ? { ...row } : null;
    },
    async create(row: Row) {
      await Promise.resolve();
      return { ...insert(row) };
    },
    async findOneAndUpdate(filter: Row, changes: Row, options?: { upsert?: boolean; returnDocument?: string }) {
      const { before, after } = await update(filter, changes, options?.upsert);
      return options?.returnDocument === 'after' ? after : before;
    },
    async findByIdAndUpdate(id: unknown, changes: Row) {
      return (await update({ _id: id }, changes)).before;
    },
    async updateOne(filter: Row, changes: Row, options?: { upsert?: boolean }) {
      const { before } = await update(filter, changes, options?.upsert);
      return { modifiedCount: before ? 1 : 0 };
    },
    async deleteMany(filter: Row) {
      await Promise.resolve();
      const before = rows.length;
      rows = rows.filter((row) => !matches(row, filter));
      return { deletedCount: before - rows.length };
    },
    async deleteOne(filter: Row) {
      await Promise.resolve();
      const row = rows.find((candidate) => matches(candidate, filter));
      rows = rows.filter((candidate) => candidate !== row);
      return { deletedCount: row ? 1 : 0 };
    },
  };
}

export function createMemoryMongoose() {
  const models: Record<string, ReturnType<typeof createModel>> = {};
  class Schema {
    static Types = { ObjectId: 'ObjectId' };
    index() {}
  }
  const model = (name: string) => (models[name] ??= createModel());

  return { __esModule: true, default: { Schema, models, model }, Schema };
}
