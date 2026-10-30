import { importSquare } from './jobs.mjs';
const day = 86400000;
const address = a => a ? [a.address_line_1, a.address_line_2, a.locality, a.administrative_district_level_1, a.postal_code, a.country].filter(Boolean).join(', ') : '';
export function createSquareSync(db, {
  token = '',
  environment = 'production',
  locationId = '',
  fetcher = fetch,
  now = () => Date.now()
} = {}) {
  if (!['production', 'sandbox'].includes(environment)) throw Error('SQUARE_ENVIRONMENT must be production or sandbox.');
  const base = environment === 'sandbox' ? 'https://connect.squareupsandbox.com' : 'https://connect.squareup.com';
  let pending = null,
    lastError = '';
  async function status() {
    return {
      configured: !!token,
      environment,
      running: !!pending,
      lastSuccess: Number((await db.prepare("SELECT value FROM integration_state WHERE key=?").get('square:' + environment))?.value) || null,
      lastError: lastError || (await db.prepare('SELECT value FROM integration_state WHERE key=?').get('square-error:' + environment))?.value || '',
      lookbackDays: 30,
      aheadDays: 180
    };
  }
  async function get(path, optional = false) {
    const response = await fetcher(base + path, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Square-Version': '2026-09-16',
        Accept: 'application/json'
      },
      signal: AbortSignal.timeout(15000)
    });
    if (optional && response.status === 404) return null;
    if (!response.ok) throw Error(`Square sync failed (HTTP ${response.status}). Check the server connection and Square permissions.`);
    const data = await response.json();
    if (data.errors?.length) throw Error('Square returned an error. Check the account permissions and try again.');
    return data;
  }
  async function run() {
    const storedEnvironments = await db.prepare("SELECT DISTINCT json_extract(external_json,'$.environment') AS environment FROM jobs WHERE source='square'").all();
    if (token && storedEnvironments.some(row => row.environment && row.environment !== environment)) throw Error('Use a separate DATA_DIR for Square sandbox and production.');
    if (!token) throw Object.assign(Error('Square is not connected yet. The administrator must configure the server connection.'), {
      status: 503
    });
    const bookings = new Map(),
      start = now() - 30 * day,
      end = now() + 180 * day;
    // Explicit windows and pagination avoid Square's default 31-day-only result.
    for (let from = start; from < end; from += 31 * day) {
      let cursor = '',
        pages = 0;
      const cursors = new Set();
      do {
        if (++pages > 100) throw Error('Square returned too many pages; sync did not complete.');
        const params = new URLSearchParams({
          start_at_min: new Date(from).toISOString(),
          start_at_max: new Date(Math.min(from + 31 * day, end)).toISOString(),
          limit: '100'
        });
        if (locationId) params.set('location_id', locationId);
        if (cursor) params.set('cursor', cursor);
        const data = await get('/v2/bookings?' + params);
        for (const booking of data.bookings || []) bookings.set(booking.id, booking);
        cursor = data.cursor || '';
        if (cursor && cursors.has(cursor)) throw Error('Square returned a repeated page cursor.');
        cursors.add(cursor);
      } while (cursor);
    }
    // Re-fetch known unfinished bookings omitted from the window (e.g. moved far away).
    for (const row of await db.prepare("SELECT external_id,external_json,work_json FROM jobs WHERE source='square'").all()) {
      if (bookings.has(row.external_id) || JSON.parse(row.work_json).stage === 'completed') continue;
      const data = await get('/v2/bookings/' + encodeURIComponent(row.external_id), true);
      if (data?.booking) bookings.set(data.booking.id, data.booking);else if (!data) throw Error('A previously imported Square booking is unavailable. Existing records were kept; check Square before relying on the schedule.');
    }
    const customers = new Map(),
      catalog = new Map(),
      records = [];
    for (const b of bookings.values()) {
      if (!b.id || !Number.isInteger(b.version) || !Number.isFinite(Date.parse(b.start_at))) throw Error('Square returned an incomplete booking; existing records were kept.');
      const missing = [];
      let customer = {};
      if (b.customer_id) {
        if (!customers.has(b.customer_id)) customers.set(b.customer_id, (await get('/v2/customers/' + encodeURIComponent(b.customer_id), true))?.customer || {});
        customer = customers.get(b.customer_id);
      }
      if (!customer.id) missing.push('Customer profile is missing in Square.');
      const services = [];
      for (const segment of b.appointment_segments || []) {
        if (!segment.service_variation_id) {
          services.push('Service details unavailable');
          continue;
        }
        const key = segment.service_variation_id + ':' + (segment.service_variation_version || '');
        if (!catalog.has(key)) {
          const params = new URLSearchParams({
            include_related_objects: 'true'
          });
          if (segment.service_variation_version) params.set('catalog_version', String(segment.service_variation_version));
          catalog.set(key, await get('/v2/catalog/object/' + encodeURIComponent(segment.service_variation_id) + '?' + params, true));
        }
        const entry = catalog.get(key),
          variation = entry?.object?.item_variation_data;
        const parent = entry?.related_objects?.find(o => o.id === variation?.item_id)?.item_data;
        services.push([parent?.name, variation?.name].filter(Boolean).join(' · ') || 'Service details unavailable');
      }
      const serviceAddress = b.location_type === 'CUSTOMER_LOCATION' ? address(b.address) : '';
      if (!serviceAddress) missing.push('Confirm the service address; customer profile addresses may be mailing addresses.');
      records.push({
        id: b.id,
        version: b.version,
        status: b.status || 'UNKNOWN',
        startAt: b.start_at,
        locationId: b.location_id || '',
        customerId: b.customer_id || '',
        name: [customer.given_name, customer.family_name].filter(Boolean).join(' ') || customer.company_name || 'Client details needed',
        email: customer.email_address || '',
        phone: customer.phone_number || '',
        address: serviceAddress,
        customerAddress: address(customer.address),
        customerNote: b.customer_note || '',
        sellerNote: b.seller_note || '',
        customerProfileNote: customer.note || '',
        service: services.join(', '),
        durationMinutes: (b.appointment_segments || []).reduce((sum, s) => sum + (s.duration_minutes || 0), 0),
        missing,
        environment
      });
    }
    // Apply a complete snapshot atomically. Failed syncs never erase saved progress/data.
    await db.exec('BEGIN');
    try {
      for (const record of records) await importSquare(db, record);
      await db.prepare('INSERT INTO integration_state VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('square:' + environment, String(now()));
      await db.exec('COMMIT');
    } catch (error) {
      await db.exec('ROLLBACK');
      throw error;
    }
    lastError = '';
    await db.prepare('DELETE FROM integration_state WHERE key=?').run('square-error:' + environment);
    return {
      count: records.length,
      ...(await status())
    };
  }
  return {
    status,
    sync() {
      if (pending) return pending;
      pending = run().catch(async e => {
        lastError = e.message.startsWith('Square') || e.message.startsWith('A previously') ? e.message : 'Square sync could not finish. Existing appointments are still saved. Try again or check the server connection.';
        await db.prepare('INSERT INTO integration_state VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('square-error:' + environment,lastError);
        throw Object.assign(Error(lastError), {
          status: e.status || 502
        });
      }).finally(() => {
        pending = null;
      });
      return pending;
    }
  };
}
