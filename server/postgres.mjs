// All SQL is application-owned; values are always separate parameters.
const tables = 'users|sessions|audit|limits|jobs|integration_state';
export function postgresSQL(source) {
  let index = 0;
  return source
    .replace(/json_extract\(external_json,'\$\.environment'\)/g, "(external_json::jsonb ->> 'environment')")
    .replace(/\b(WHERE|AND) username=\?/g, '$1 lower(username)=lower(?)')
    .replace(/AS createdAt/g, 'AS "createdAt"')
    .replace(new RegExp('\\b(FROM|JOIN|UPDATE|INTO)\\s+(' + tables + ')\\b', 'gi'), '$1 kirtle_private.$2')
    .replace(/\?/g, () => '$' + (++index));
}

export function connectionDatabase(query) {
  let depth = 0;
  return {
    prepare(source) {
      const sql = postgresSQL(source);
      const execute = async args => {
        const result = await query(sql, args);
        for (const row of result.rows) {
          for (const key of ['id','user_id','created_at','updated_at','expires_at','createdAt','external_version','revision','count']) {
            if (typeof row[key] === 'string' && /^\d+$/.test(row[key]) && Number.isSafeInteger(Number(row[key]))) row[key] = Number(row[key]);
          }
        }
        return result;
      };
      return {
        get: async (...args) => (await execute(args)).rows[0],
        all: async (...args) => (await execute(args)).rows,
        run: async (...args) => ({changes:(await execute(args)).count})
      };
    },
    async exec(statement) {
      if (statement === 'BEGIN') {
        if (depth) await query('SAVEPOINT kirtle_' + depth, []);
        else {
          await query('BEGIN', []);
          // One business: serialize multi-record mutations across edge instances.
          await query('SELECT pg_advisory_xact_lock(740328110)', []);
        }
        depth++;
      } else if (statement === 'COMMIT' || statement === 'ROLLBACK') {
        if (!depth) return;
        depth--;
        await query(depth ? (statement === 'COMMIT' ? 'RELEASE SAVEPOINT ' : 'ROLLBACK TO SAVEPOINT ') + 'kirtle_' + depth : statement, []);
      } else throw Error('Schema changes must be applied as migrations.');
    },
    async cleanup() { if (depth) { depth = 0; await query('ROLLBACK', []); } }
  };
}

export function postgresDatabase(sql) {
  return {
    async withConnection(action) {
      const connection = await sql.reserve();
      const db = connectionDatabase(async (statement,args) => {
        const rows = await connection.unsafe(statement,args);
        return {rows,count:rows.count};
      });
      try { return await action(db); }
      finally { try { await db.cleanup(); } finally { connection.release(); } }
    },
    close: () => sql.end({timeout:5})
  };
}
