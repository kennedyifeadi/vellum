import EmailAllowance from '@/models/emailAllowance';

// Stands in for MongoDB for the queries lib/email/daily-limits.ts makes, so the routes that
// count emails can run without a database. tests/helpers/emailLimitsContract.ts runs the same
// cases against this and against a real MongoDB. Each update is atomic and lets others run
// before it.

type Row = Record<string, unknown>;
type Send = { at: Date; keys: string[] };

const isOperator = (value: unknown): value is Row =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);

// The aggregation operators lib/email/daily-limits.ts uses in its $expr.
function evaluate(expression: unknown, row: Row, self?: Send): unknown {
  if (typeof expression === 'string' && expression.startsWith('$$this.')) {
    return (self as Row)[expression.slice('$$this.'.length)];
  }
  if (typeof expression === 'string' && expression.startsWith('$')) return row[expression.slice(1)];
  if (!isOperator(expression)) return expression;

  const [[operator, operand]] = Object.entries(expression);
  const args = operand as unknown[];
  switch (operator) {
    case '$and': return args.every((arg) => evaluate(arg, row, self));
    case '$lt': return (evaluate(args[0], row, self) as number) < (evaluate(args[1], row, self) as number);
    case '$ifNull': return evaluate(args[0], row, self) ?? evaluate(args[1], row, self);
    case '$in': return (evaluate(args[1], row, self) as unknown[]).includes(evaluate(args[0], row, self));
    case '$size': return (evaluate(operand, row, self) as unknown[]).length;
    case '$filter': {
      const { input, cond } = operand as { input: unknown; cond: unknown };
      return (evaluate(input, row, self) as Send[]).filter((send) => evaluate(cond, row, send));
    }
    default: throw new Error(`memoryEmailAllowances does not support ${operator}`);
  }
}

/** Backs the EmailAllowance model with a map, until jest.restoreAllMocks. */
export function keepEmailAllowancesInMemory() {
  const rows = new Map<string, Row>();

  jest.spyOn(EmailAllowance, 'updateOne').mockImplementation((async (filter: Row, update: Row, options?: { upsert?: boolean }) => {
    await Promise.resolve();
    const id = filter._id as string;
    if (!rows.has(id) && options?.upsert) rows.set(id, { _id: id });
    const row = rows.get(id);
    if (!row || (filter.$expr && !evaluate(filter.$expr, row))) return { modifiedCount: 0 };

    const sends = (row.sends ?? []) as Send[];
    const { $pull, $set, $push } = update as { $pull?: Row; $set?: Row; $push?: { sends: Send } };
    if ($pull) {
      const { $lte } = ($pull.sends as { at: { $lte: Date } }).at;
      row.sends = sends.filter((send) => send.at.getTime() > $lte.getTime());
    }
    if ($set) Object.assign(row, $set);
    if ($push) row.sends = [...((row.sends ?? []) as Send[]), $push.sends];
    return { modifiedCount: 1 };
  }) as never);
}
