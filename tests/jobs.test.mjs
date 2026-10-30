import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDatabase, createApp, createAccount } from '../server/app.mjs';
import { createRequest, getJob, listJobs, reviewJob, updateJob, linkRequest, importSquare, easternTime } from '../server/jobs.mjs';
import { createSquareSync } from '../server/square.mjs';
const intake = () => ({
  submissionKey: randomUUID(),
  name: 'Fixture Client',
  email: 'client@example.test',
  phone: '216-555-0100',
  address: '123 Example Lane, Cleveland OH',
  date: '2030-05-10',
  time: '09:00',
  service: 'detailed',
  rooms: {
    beds: 2,
    baths: 1,
    kitchens: 1
  },
  extras: {
    fridge: 1,
    linen: 2
  },
  notes: 'Skip the study.',
  pets: 'Cat; fragrance-free products.',
  arrival: 'Park in driveway.',
  acknowledged: true,
  photoConsent: 'declined'
});
const approved = j => ({
  revision: j.revision,
  approved: true,
  name: j.intake.name || 'Fixture Client',
  email: 'client@example.test',
  phone: '216-555-0100',
  address: '123 Example Lane, Cleveland OH',
  date: '2030-05-10',
  time: '09:00',
  service: 'detailed',
  rooms: {
    beds: 2,
    baths: 1,
    kitchens: 1
  },
  extras: {
    fridge: 1,
    linen: 2
  },
  staffNotes: 'Keep the study closed.'
});
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'kirtle-jobs-')),
    db = openDatabase(join(dir, 'db.sqlite'));
  return {
    db,
    close() {
      db.close();
      rmSync(dir, {
        recursive: true,
        force: true
      });
    }
  };
}
const squareRecord = (extra = {}) => ({
  id: 'square-booking',
  version: 1,
  status: 'ACCEPTED',
  startAt: '2030-05-10T13:00:00Z',
  name: 'Fixture Client',
  email: 'client@example.test',
  phone: '216-555-0100',
  address: '123 Example Lane',
  service: 'Detailed cleaning',
  customerNote: 'Avoid fragrances',
  sellerNote: 'Call before arrival',
  customerId: 'customer-1',
  ...extra
});
test('durable intake, ordered checklist, approval, progress, conflicts, and completion', async () => {
  const {
    db,
    close
  } = fixture();
  try {
    const data = intake(),
      id = await createRequest(db, data);
    assert.equal(await createRequest(db, data), id);
    assert.equal((await listJobs(db)).length, 1);
    await assert.rejects(async () => await createRequest(db, {
      ...data,
      notes: 'different'
    }), /already saved/);
    await assert.rejects(async () => await createRequest(db, {
      ...intake(),
      rooms: {
        beds: -1
      }
    }), /quantities/);
    await assert.rejects(async () => await createRequest(db, {
      ...intake(),
      acknowledged: false
    }), /acknowledge/);
    await assert.rejects(async () => await createRequest(db, {
      ...intake(),
      photoConsent: 'granted'
    }), /photo release/);
    let job = await getJob(db, id);
    assert.equal(job.intake.notes, 'Skip the study.');
    assert.equal(job.intake.address, data.address);
    const labels = job.tasks.map(t => t.label).join('\n');
    assert.match(labels, /interior fridge/);
    assert(!labels.includes('Clean freezer'));
    assert(!labels.includes('Offices ×'));
    assert.match(labels, /Bedrooms × 2/);
    assert.equal(job.tasks[0].section, '1. Arrival & preparation');
    assert.match(job.tasks.at(-1).section, /Final walkthrough/);
    await assert.rejects(async () => await updateJob(db, id, {
      revision: job.revision,
      action: 'task',
      taskId: job.tasks[0].id,
      done: true
    }, 'Owner'), /Review/);
    job = await reviewJob(db, id, approved(job), 'Owner');
    assert.equal(job.work.stage, 'ready');
    const previous = job.revision;
    job = await updateJob(db, id, {
      revision: job.revision,
      action: 'task',
      taskId: job.tasks[0].id,
      done: true
    }, 'Owner');
    assert.equal((await getJob(db, id)).tasks[0].completedBy, 'Owner');
    assert.equal(job.work.stage, 'in_progress');
    await assert.rejects(async () => await updateJob(db, id, {
      revision: previous,
      action: 'task',
      taskId: job.tasks[1].id,
      done: true
    }, 'Admin'), /another screen/);
    await assert.rejects(async () => await updateJob(db, id, {
      revision: job.revision,
      action: 'complete'
    }, 'Owner'), /every checklist/);
    for (const t of job.tasks) job = await updateJob(db, id, {
      revision: job.revision,
      action: 'task',
      taskId: t.id,
      done: true
    }, 'Owner');
    job = await updateJob(db, id, {
      revision: job.revision,
      action: 'complete'
    }, 'Owner');
    assert.equal(job.work.stage, 'completed');
    await assert.rejects(async () => await reviewJob(db, id, approved(job), 'Owner'), /closed/);
    job = await updateJob(db, id, {
      revision: job.revision,
      action: 'note',
      notes: 'All agreed work completed.'
    }, 'Owner');
    assert.equal(job.work.staffNotes, 'All agreed work completed.');
  } finally {
    close();
  }
});
test('Square linkage, reschedule review, cancellation, and preserved completed tasks', async () => {
  const {
    db,
    close
  } = fixture();
  try {
    const requestId = await createRequest(db, intake());
    await importSquare(db, squareRecord());
    let job = (await listJobs(db)).find(j => j.source === 'square');
    job = await linkRequest(db, job.id, {
      revision: job.revision,
      requestId,
      requestRevision: 1,
      confirmed: true
    }, 'Owner');
    assert.equal((await listJobs(db)).length, 1);
    assert.equal((await getJob(db, requestId)).linkedTo, job.id);
    assert.equal(job.intake.pets, 'Cat; fragrance-free products.');
    job = await reviewJob(db, job.id, approved(job), 'Owner');
    job = await updateJob(db, job.id, {
      revision: job.revision,
      action: 'task',
      taskId: job.tasks[0].id,
      done: true
    }, 'Owner');
    const version = job.revision;
    await importSquare(db, squareRecord());
    assert.equal((await getJob(db, job.id)).revision, version);
    await importSquare(db, squareRecord({
      version: 2,
      startAt: '2030-05-11T13:00:00Z'
    }));
    job = await getJob(db, job.id);
    assert.equal(job.work.stage, 'needs_review');
    assert(job.tasks[0].done);
    assert.equal(job.intake.notes, 'Skip the study.');
    await assert.rejects(async () => await updateJob(db, job.id, {
      revision: job.revision,
      action: 'task',
      taskId: job.tasks[1].id,
      done: true
    }, 'Owner'), /Review/);
    await importSquare(db, squareRecord({
      version: 1
    }));
    assert.equal((await getJob(db, job.id)).squareVersion, 2);
    job = await reviewJob(db, job.id, approved(job), 'Owner');
    assert.equal(job.work.startAt, '2030-05-11T13:00:00Z');
    await importSquare(db, squareRecord({
      version: 3,
      status: 'CANCELLED_BY_CUSTOMER'
    }));
    job = await getJob(db, job.id);
    await assert.rejects(async () => await updateJob(db, job.id, {
      revision: job.revision,
      action: 'task',
      taskId: job.tasks[1].id,
      done: true
    }, 'Owner'), /cancelled/);
    assert(job.tasks[0].done);
  } finally {
    close();
  }
});
test('Eastern scheduling validates daylight saving transitions', () => {
  assert.equal(easternTime('2030-05-10', '09:00'), '2030-05-10T13:00:00.000Z');
  assert.equal(easternTime('2030-01-10', '09:00'), '2030-01-10T14:00:00.000Z');
  assert.throws(() => easternTime('2030-03-10', '02:30'), /daylight saving/);
  assert.throws(() => easternTime('2030-11-03', '01:30'), /daylight saving/);
  assert.throws(() => easternTime('2030-02-30', '09:00'), /daylight saving/);
});
test('Square sync paginates, resolves customers and services, and retains snapshots on failure', async () => {
  const {
    db,
    close
  } = fixture();
  let fail = false,
    pageCount = 0;
  const now = () => Date.parse('2030-05-01T00:00:00Z');
  const fetcher = async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer fixture-token');
    assert.equal(options.headers['Square-Version'], '2026-09-16');
    const u = new URL(url);
    let data = {};
    if (fail) return new Response('{}', {
      status: 401
    });
    if (u.pathname === '/v2/bookings') {
      pageCount++;
      if (pageCount === 1) data = {
        bookings: [],
        cursor: 'second-page'
      };else if (u.searchParams.get('cursor')) data = {
        bookings: [{
          id: 'square-booking',
          version: 1,
          status: 'ACCEPTED',
          start_at: '2030-05-10T13:00:00Z',
          customer_id: 'customer-1',
          customer_note: 'Skip study',
          seller_note: 'Private staff note',
          location_type: 'CUSTOMER_LOCATION',
          address: {
            address_line_1: 'Service address'
          },
          appointment_segments: [{
            service_variation_id: 'variation-1',
            duration_minutes: 120
          }]
        }]
      };
    } else if (u.pathname.startsWith('/v2/customers/')) data = {
      customer: {
        id: 'customer-1',
        given_name: 'Fixture',
        family_name: 'Client',
        phone_number: '216-555-0100',
        email_address: 'client@example.test',
        address: {
          address_line_1: 'Mailing address'
        }
      }
    };else if (u.pathname.startsWith('/v2/catalog/object/')) data = {
      object: {
        item_variation_data: {
          item_id: 'item-1',
          name: 'Two hours'
        }
      },
      related_objects: [{
        id: 'item-1',
        item_data: {
          name: 'Standard clean'
        }
      }]
    };else if (u.pathname.startsWith('/v2/bookings/')) data = {
      booking: {
        id: 'square-booking',
        version: 1,
        status: 'ACCEPTED',
        start_at: '2030-05-10T13:00:00Z',
        customer_id: 'customer-1'
      }
    };else throw Error('Unexpected Square endpoint');
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        'content-type': 'application/json'
      }
    });
  };
  try {
    const square = createSquareSync(db, {
      token: 'fixture-token',
      fetcher,
      now
    });
    await square.sync();
    assert(pageCount > 2);
    const job = (await listJobs(db))[0];
    assert.equal(job.external.address, 'Service address');
    assert.equal(job.external.customerAddress, 'Mailing address');
    assert.equal(job.external.phone, '216-555-0100');
    assert.match(job.external.service, /Standard clean/);
    assert.equal(job.external.sellerNote, 'Private staff note');
    assert((await square.status()).lastSuccess);
    fail = true;
    await assert.rejects(square.sync(), /HTTP 401/);
    assert.equal((await listJobs(db)).length, 1);
    assert.equal((await getJob(db, job.id)).external.sellerNote, 'Private staff note');
    assert((await square.status()).lastError);
    const disconnected = createSquareSync(db);
    assert.equal((await disconnected.status()).configured, false);
    await assert.rejects(disconnected.sync(), /not connected/);
  } finally {
    close();
  }
});
test('public requests store privately; authenticated owner/admin can access and update jobs', async () => {
  const {
    db,
    close
  } = fixture();
  await createAccount(db, 'Owner', 'Owner-pass-123', 'owner');
  await createAccount(db, 'Admin', 'Admin-pass-123', 'admin');
  const port = 30000 + Math.floor(Math.random() * 10000),
    origin = `http://127.0.0.1:${port}`,
    app = createApp({
      db,
      origin
    });
  await new Promise(resolve => app.listen(port, '127.0.0.1', resolve));
  async function call(path, method = 'GET', data, identity = {}, headers = {}) {
    const res = await fetch(origin + path, {
      method,
      headers: {
        origin,
        'content-type': 'application/json',
        ...identity,
        ...headers
      },
      ...(data ? {
        body: JSON.stringify(data)
      } : {})
    });
    return {
      code: res.status,
      data: await res.json(),
      cookie: res.headers.get('set-cookie')?.split(';')[0]
    };
  }
  try {
    assert.equal((await call('/api/jobs')).code, 401);
    assert.equal((await call('/api/requests', 'POST', intake(), {}, {
      origin: 'https://evil.test'
    })).code, 403);
    const submitted = await call('/api/requests', 'POST', intake());
    assert.equal(submitted.code, 201);
    assert(!JSON.stringify(submitted.data).includes('address'));
    const id = submitted.data.reference;
    assert.equal((await call('/api/jobs/' + id)).code, 401);
    const owner = await call('/api/login', 'POST', {
      username: 'Owner',
      password: 'Owner-pass-123'
    });
    const identity = {
      cookie: owner.cookie,
      'x-csrf-token': owner.data.csrf
    };
    let result = await call('/api/jobs', 'GET', null, identity);
    assert.equal(result.data.jobs[0].intake.address, '123 Example Lane, Cleveland OH');
    result = await call('/api/jobs/' + id + '/review', 'PATCH', approved(result.data.jobs[0]), identity);
    assert.equal(result.code, 200);
    const job = result.data.job;
    assert.equal((await call('/api/jobs/' + id, 'PATCH', {
      revision: job.revision,
      action: 'task',
      taskId: job.tasks[0].id,
      done: true
    }, identity, {
      'x-csrf-token': 'bad'
    })).code, 403);
    result = await call('/api/jobs/' + id, 'PATCH', {
      revision: job.revision,
      action: 'task',
      taskId: job.tasks[0].id,
      done: true
    }, identity);
    assert.equal(result.code, 200);
    const admin = await call('/api/login', 'POST', {
      username: 'Admin',
      password: 'Admin-pass-123'
    });
    assert((await call('/api/jobs/' + id, 'GET', null, {
      cookie: admin.cookie
    })).data.job.tasks[0].done);
    assert.equal((await call('/api/square/sync', 'POST', {}, identity)).code, 503);
  } finally {
    await new Promise(resolve => app.close(resolve));
    close();
  }
});
