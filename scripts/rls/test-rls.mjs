#!/usr/bin/env node
/**
 * Testy RLS + reguł domenowych po stronie bazy (bez Supabase — czysty PostgreSQL).
 * Odpala embedded-postgres, wczytuje migracje i seed, a następnie na roli
 * `authenticated` (z ustawionym auth.uid()) sprawdza, że polityki i funkcje
 * zachowują się dokładnie jak PermissionsProvider w aplikacji.
 *
 * Uruchomienie: npm run test:rls
 */
import EmbeddedPostgresPkg from 'embedded-postgres';
const EmbeddedPostgres = EmbeddedPostgresPkg.default ?? EmbeddedPostgresPkg;
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dataDir = path.join(root, '.tmp-rls-pg');
const PORT = 55432;

// te same identyfikatory co uid() w src/data/seed.ts
const uid = (n) => `${n.toString(16).padStart(8, '0')}-0000-4000-8000-00000000000${(n % 10).toString()}`;
const USERS = {
  anna: uid(0x11111111),      // ADMIN
  piotr: uid(0x22222222),     // COORDINATOR
  mariusz: uid(0x33333333),   // WORKER, prowadzi kran (1031) i oświetlenie (1035)
  tomasz: uid(0x44444444),    // WORKER
  katarzyna: uid(0x55555555), // WORKER
  marek: uid(0x66666666),     // WORKER (bez smartfona)
};
const WO = {
  kran: uid(0xb0000001),
  klamka: uid(0xb0000002),
  aula: uid(0xb0000003),
  bezZlecenia: uid(0xb0000004),
  oswietlenie: uid(0xb0000005),
  zamek: uid(0xb0000006),
  czujnik: uid(0xb0000007),
};
const LOC_HALL = uid(0x0a0a0a07);
const CAT_INNE = uid(0x0c0c0c0b);
const CAT_PORZ = uid(0x0c0c0c08);

fs.rmSync(dataDir, { recursive: true, force: true });

const pgServer = new EmbeddedPostgres({
  databaseDir: dataDir,
  persistent: false,
  port: PORT,
  user: 'postgres',
  password: 'postgres',
});

let passed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (e) {
    failures.push({ name, error: e });
    console.error(`FAIL  ${name}\n      ${e.message?.split('\n')[0]}`);
  }
}

function expectErr(code, re) {
  return (e) => {
    assert.equal(e.code, code, `oczekiwano sqlstate ${code}, jest ${e.code}: ${e.message}`);
    if (re && !re.test(e.message ?? '')) throw new Error(`komunikat nie pasuje do /${re}/: ${e.message}`);
    return true;
  };
}

async function run() {
  await pgServer.initialise();
  await pgServer.start();
  await pgServer.createDatabase('taskans');

  const admin = new pg.Client({ host: '127.0.0.1', port: PORT, user: 'postgres', password: 'postgres', database: 'taskans' });
  admin.on('error', (e) => console.error('admin client error:', e.message));
  await admin.connect();

  await admin.query(fs.readFileSync(path.join(root, 'scripts/rls/setup-pre.sql'), 'utf8'));
  for (const file of fs.readdirSync(path.join(root, 'supabase/migrations')).sort()) {
    await admin.query(fs.readFileSync(path.join(root, 'supabase/migrations', file), 'utf8'));
    console.log(`migracja wczytana: ${file}`);
  }
  await admin.query(fs.readFileSync(path.join(root, 'scripts/rls/setup-post.sql'), 'utf8'));
  await admin.query(fs.readFileSync(path.join(root, 'supabase/seed.sql'), 'utf8'));
  console.log('seed wczytany');

  const asUserCommit = async (uid, fn) => {
    await user.query('begin');
    await user.query(`set local app.uid = '${uid}'`);
    try {
      const r = await fn(user);
      await user.query('commit');
      return r;
    } catch (e) {
      await user.query('rollback');
      throw e;
    }
  };

  const user = new pg.Client({ host: '127.0.0.1', port: PORT, user: 'authenticated', password: 'authenticated', database: 'taskans' });
  user.on('error', (e) => console.error('user client error:', e.message));
  await user.connect();
  const asUser = async (uid, fn) => {
    await user.query('begin');
    await user.query(`set local app.uid = '${uid}'`);
    try {
      return await fn(user);
    } finally {
      await user.query('rollback');
    }
  };

  const anon = new pg.Client({ host: '127.0.0.1', port: PORT, user: 'anon', password: 'anon', database: 'taskans' });
  anon.on('error', (e) => console.error('anon client error:', e.message));
  await anon.connect();

  console.log('\n— RLS —');

  await test('anon nie widzi zleceń (brak polityki SELECT → zero wierszy)', async () => {
    const r = await anon.query('select * from public.work_orders');
    assert.equal(r.rowCount, 0, 'anon nie może czytać danych firmowych');
  });

  await test('pracownik widzi wszystkie zlecenia i profile załogi', async () => {
    await asUser(USERS.mariusz, async (c) => {
      const wo = await c.query('select count(*)::int n from public.work_orders');
      assert.equal(wo.rows[0].n, 9);
      const pr = await c.query('select count(*)::int n from public.profiles');
      assert.equal(pr.rows[0].n, 6);
    });
  });

  await test('pracownik nie czyta powiadomień innych osób', async () => {
    await asUser(USERS.mariusz, async (c) => {
      const r = await c.query('select count(*)::int n from public.notifications');
      assert.equal(r.rows[0].n, 1, 'mariusz powinien mieć dokładnie 1 powiadomienie');
    });
  });

  await test('pracownik nie zmieni priorytetu (strażnik kolumn)', async () => {
    await asUser(USERS.mariusz, (c) =>
      c.query(`update public.work_orders set priority='NORMAL' where id='${WO.kran}'`).then(
        () => { throw new Error('update przeszedł!'); },
        expectErr('42501', /Nie masz uprawnień/),
      ));
  });

  await test('pracownik nie rusza slownika lokalizacji (RLS: zero zaktualizowanych wierszy)', async () => {
    await asUser(USERS.tomasz, async (c) => {
      const r = await c.query(`update public.locations set name='X' where 1=1`);
      assert.equal(r.rowCount, 0, 'żaden wiersz słownika nie może być zmieniony przez pracownika');
    });
  });

  await test('pracownik nie wejdzie w raporty', async () => {
    await asUser(USERS.tomasz, (c) =>
      c.query('select * from public.daily_reports').then((r) => {
        if (r.rowCount > 0) throw new Error('widzi raporty!');
      }));
  });

  await test('sfałszowany wpis historii (entered_by nie swoj) odrzucony przez RLS', async () => {
    await asUser(USERS.tomasz, (c) =>
      c
        .query(
          `insert into public.work_order_updates (work_order_id, update_type, message, entered_by, performed_by)
           values ('${WO.klamka}', 'COMMENT', 'podszycie sie', '${USERS.anna}', '${USERS.anna}')`,
        )
        .then(() => { throw new Error('insert przeszedł!'); }, expectErr('42501')));
  });

  await test('pracownik NIE zmieni roli we własnym profilu', async () => {
    await asUser(USERS.tomasz, (c) =>
      c.query(`update public.profiles set role='ADMIN' where id='${USERS.tomasz}'`).then(
        () => { throw new Error('awans przeszedł!'); },
        expectErr('42501', /administrator/),
      ));
  });

  console.log('\n— funkcje domenowe (RPC) —');

  await test('transition: uczestnik DONE→IN_PROGRESS odrzucony (macierz)', async () => {
    await asUser(USERS.tomasz, (c) =>
      c
        .query(`select public.transition_work_order('${WO.klamka}', 'IN_PROGRESS')`)
        .then(() => { throw new Error('przeszło!'); }, expectErr('P0001', /przejścia statusów/)));
  });

  await test('transition: zamkniecie przez koordynatora OK + closed_at + historia', async () => {
    await asUser(USERS.piotr, async (c) => {
      const updId = await c.query(
        `select public.transition_work_order('${WO.klamka}', 'CLOSED', 'Akceptacja po obchodzie', null,null,null,null,null,null,null,null) t`,
      );
      assert.ok(updId.rows[0].t);
      const wo = await c.query(`select status, closed_at is not null as has_close from public.work_orders where id='${WO.klamka}'`);
      assert.equal(wo.rows[0].status, 'CLOSED');
      assert.equal(wo.rows[0].has_close, true);
      const h = await c.query(
        `select message, performed_by, entered_by from public.work_order_updates where work_order_id='${WO.klamka}' and message ilike 'Akceptacja%'`,
      );
      assert.equal(h.rowCount, 1, 'historia musi zawierać wpis zamknięcia');
    });
  });

  await test('transition: zamkniecie przez WORKERA odrzucone (rola)', async () => {
    await asUser(USERS.tomasz, (c) =>
      c.query(`select public.transition_work_order('${WO.bezZlecenia}', 'CLOSED')`).then(
        () => { throw new Error('przeszło!'); },
        expectErr('42501', /przełożonego/),
      ));
  });

  await test('transition: osoba postronna nie ruszy zadania (FOR UPDATE + RLS → P0002)', async () => {
    await asUser(USERS.marek, (c) =>
      c.query(`select public.transition_work_order('${WO.czujnik}', 'CLOSED')`).then(
        () => { throw new Error('przeszło!'); },
        expectErr('P0002', /Nie znaleziono/),
      ));
  });

  await test('ON_HOLD wymaga powodu + następnego kroku', async () => {
    await asUser(USERS.mariusz, (c) =>
      c
        .query(`select public.transition_work_order('${WO.kran}', 'ON_HOLD', 'brak dostępu', 'dostep', '', 'kr.') u`)
        .then(() => { throw new Error('przeszło!'); }, expectErr('P0001', /Wstrzymanie wymaga/)));
  });

  await test('ON_HOLD poprawny: pola wpisane, menedżerowie dostają HOLD_RAISED', async () => {
    await asUserCommit(USERS.mariusz, async (c) => {
      await c.query(
        `select public.transition_work_order('${WO.kran}', 'ON_HOLD', 'zalany chodnik', 'dostep', 'Trzeba czekać na hydraulika z miasta', 'Umówić dostęp na jutro', null, null, null, 'IN_PROGRESS', null)`,
      );
      const wo = await c.query(`select status, hold_reason, hold_details from public.work_orders where id='${WO.kran}'`);
      assert.equal(wo.rows[0].status, 'ON_HOLD');
      assert.equal(wo.rows[0].hold_reason, 'dostep');
    });
    // RLS pokazuje odbiorcy tylko jego powiadomienia — pełny bilans robi właściciel tabel (jak serwis管理 w dashboardzie)
    const n = await admin.query(
      `select recipient_id, count(*)::int n from public.notifications where kind='HOLD_RAISED' and work_order_id='${WO.kran}' group by recipient_id`,
    );
    assert.equal(n.rowCount, 2, 'obaj przełożeni (Anna, Piotr) muszą dostać HOLD_RAISED');
  });

  await test('idempotentnosc kolejki: ten sam device_operation_id = brak drugiego wpisu', async () => {
    await asUser(USERS.mariusz, async (c) => {
      const op = '00000000-0000-4000-8000-00000000c0de';
      const q = `select public.transition_work_order('${WO.oswietlenie}', 'IN_PROGRESS', 'wracam do pracy', null,null,null,null,null,null,null, '${op}') t`;
      const a = await c.query(q);
      const b = await c.query(q);
      assert.equal(a.rows[0].t, b.rows[0].t);
      const cnt = await c.query(
        `select count(*)::int n from public.work_order_updates where work_order_id='${WO.oswietlenie}' and device_operation_id='${op}'`,
      );
      assert.equal(cnt.rows[0].n, 1);
    });
  });

  await test('konflikt wersji: expected_previous inny niż stan bazy → P0001', async () => {
    await asUser(USERS.mariusz, (c) =>
      c
        .query(
          `select public.transition_work_order('${WO.kran}', 'DONE', 'skończone', null,null,null,null,'Zakręcony i sprawdzony, kalosze suche', null,'ASSIGNED','${crypto.randomUUID()}')`,
        )
        .then(() => { throw new Error('miał być konflikt, a przeszło!'); }, expectErr('P0001', /Status na serwerze jest już inny/)),
    );
  });

  await test('performed_by innej osoby przez workerów zabroniony, przez koordynatora dozwolony', async () => {
    await asUser(USERS.mariusz, (c) =>
      c
        .query(
          `select public.log_work_order_update('${WO.kran}', 'NOTE', 'wpis w czyim imieniu', null, '${USERS.marek}', null) t`,
        )
        .then(() => { throw new Error('przeszło!'); }, expectErr('42501', /przełożon/)),
    );
    await asUser(USERS.piotr, async (c) => {
      const r = await c.query(
        `select public.log_work_order_update('${WO.kran}', 'NOTE', 'Marek zgłosił telefonicznie: dokończę pojutrze', null, '${USERS.marek}', null) t`,
      );
      assert.ok(r.rows[0].t);
      const h = await c.query(`select entered_by, performed_by from public.work_order_updates where id=$1`, [r.rows[0].t]);
      assert.equal(h.rows[0].entered_by, USERS.piotr);
      assert.equal(h.rows[0].performed_by, USERS.marek);
    });
  });

  await test('create_work_order offline: idempotentnie po created_offline_id', async () => {
    await asUser(USERS.anna, async (c) => {
      const args = `'${crypto.randomUUID()}', 'Test seed harness', 'Opis testowy', '${LOC_HALL}', '${CAT_INNE}', 'NORMAL', null, null, null, null, '{}', null`;
      const r1 = await c.query(`select public.create_work_order(${args}) id`);
      const r2 = await c.query(`select public.create_work_order(${args}) id`);
      assert.equal(r1.rows[0].id, r2.rows[0].id);
    });
  });

  await test('praca bez zlecenia: wykonawca moją — OK; cudzą bez roli — 42501', async () => {
    await asUser(USERS.tomasz, async (c) => {
      const r = await c.query(
        `select public.create_unrequested_work('${crypto.randomUUID()}', 'Umycie okna w hallu', 'padło szkło', '${LOC_HALL}', '${CAT_PORZ}', array['${USERS.tomasz}']::uuid[], 'Okno umyte, szkło uprzątnięte, kosz na odpady wyczyszczony.', null) id`,
      );
      assert.ok(r.rows[0].id);
    });
    await asUser(USERS.katarzyna, (c) =>
      c
        .query(
          `select public.create_unrequested_work('${crypto.randomUUID()}', 'Drobne porządki w hallu', 'sprzątanie po imprezie', '${LOC_HALL}', '${CAT_PORZ}', array['${USERS.tomasz}']::uuid[], 'Zrobione, porządek, dywan odkurzony.', null) id`,
        )
        .then(() => { throw new Error('przeszło!'); }, expectErr('42501', /przełożon/)),
    );
  });

  await test('raport: draft zapisze koordynator, zatwierdzi tylko ADMIN, potem niezmienny', async () => {
    const snap = JSON.stringify({ report_date: '2026-09-12', generated_at: new Date().toISOString(), generated_by_name: 'x', counters: {}, sections: {} });
    await asUser(USERS.piotr, async (c) => {
      await c.query(`select public.save_report_draft(current_date, '${snap}'::jsonb, 'notatka')`);
      await c.query(`select public.approve_report(current_date, '${snap}'::jsonb, 'x')`).then(
        () => { throw new Error('koordynator zatwierdził!'); },
        expectErr('42501', /dyrektor/),
      );
    });
    await asUser(USERS.anna, async (c) => {
      await c.query(`select public.approve_report(current_date, '${snap}'::jsonb, 'OK')`);
      await c.query(`select public.save_report_draft(current_date, '${snap}'::jsonb, 'zmiana')`).then(
        () => { throw new Error('zmienił zatwierdzony!'); },
        expectErr('42501', /niezmienny/),
      );
    });
  });

  await test('asignacja: tylko przełożony; po przydziale status NEW→ASSIGNED', async () => {
    await asUser(USERS.mariusz, (c) =>
      c.query(`select public.assign_work_order('${WO.czujnik}', '${USERS.mariusz}', '{}', null)`).then(
        () => { throw new Error('przeszło!'); },
        expectErr('42501', /dyrektor lub koordynator/),
      ));
    await asUserCommit(USERS.piotr, async (c) => {
      await c.query(`select public.assign_work_order('${WO.czujnik}', '${USERS.mariusz}', array['${USERS.katarzyna}']::uuid[], null)`);
      const st = await c.query(`select status, lead_worker_id from public.work_orders where id='${WO.czujnik}'`);
      assert.equal(st.rows[0].status, 'ASSIGNED');
      const a = await c.query(`select count(*)::int n from public.work_order_assignees where work_order_id='${WO.czujnik}'`);
      assert.equal(a.rows[0].n, 2);
    });
    await asUser(USERS.mariusz, async (c) => {
      const n = await c.query(`select count(*)::int n from public.notifications where kind='ASSIGNED' and work_order_id='${WO.czujnik}'`);
      assert.equal(n.rows[0].n, 1, 'nowy przydział musi dać powiadomienie odbiorcy');
    });
  });

  await test('materiały: zgłasza uczestnik, status ustawia przełożony', async () => {
    await asUser(USERS.mariusz, async (c) => {
      const r = await c.query(`select public.add_material_request('${WO.kran}', 'Uszczelka 3/4', 2, 'szt.', null) id`);
      assert.ok(r.rows[0].id);
      const u = await c.query(`update public.material_requests set status='APPROVED' where id='${r.rows[0].id}'`);
      assert.equal(u.rowCount, 0, 'worker nie zatwierdzi materiału (RLS)');
      // zapamiętaj id przeżywając rollback: wstaw w osobnej zatwierdzonej transakcji Piotra
    });
    await asUserCommit(USERS.piotr, async (c) => {
      const r = await c.query(`select public.add_material_request('${WO.oswietlenie}', 'Żarówka LED 12W', 4, 'szt.', null) id`);
      await c.query(`select public.set_material_status('${r.rows[0].id}', 'APPROVED')`);
      const s = await c.query(`select status from public.material_requests where id='${r.rows[0].id}'`);
      assert.equal(s.rows[0].status, 'APPROVED');
    });
  });

  await test('mark_notifications_read: tylko własne', async () => {
    await asUser(USERS.mariusz, async (c) => {
      await c.query(`select public.mark_notifications_read()`);
      const mine = await c.query('select count(*)::int n from public.notifications where recipient_id=$1 and read_at is not null', [USERS.mariusz]);
      assert.ok(mine.rows[0].n >= 1);
      const other = await c.query('select count(*)::int n from public.notifications where recipient_id=$1 and read_at is not null', [USERS.piotr]);
      assert.equal(other.rows[0].n, 0);
    });
  });

  await test('wyzwalacz eskalacji priorytetu powiadamia uczestników', async () => {
    await asUserCommit(USERS.anna, (c) =>
      c.query(`select public.update_work_order_fields('${WO.zamek}', null, null, null, null, 'BREAKDOWN', null, null, null)`),
    );
    await asUser(USERS.marek, async (c) => {
      const n = await c.query(`select count(*)::int n from public.notifications where kind='PRIORITY_ESCALATED' and work_order_id='${WO.zamek}'`);
      assert.equal(n.rows[0].n, 1, 'Marek (prowadzi zadanie) powinien dostać PRIORITY_ESCALATED');
    });
  });

  await anon.end();
  await user.end();
  await admin.end();
  await pgServer.stop();

  console.log(`\nRLS: ${passed} testów OK, ${failures.length} błędów`);
  if (failures.length) {
    for (const f of failures) console.error(`— ${f.name}: ${f.error.stack?.split('\n').slice(0,3).join('\n')}`);
    process.exitCode = 1;
  }
}

run().catch(async (e) => {
  console.error(e);
  try { await pgServer.stop(); } catch { /* już zatrzymany */ }
  process.exitCode = 1;
});
