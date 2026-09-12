import { getDb, type AssigneeRow, type ReportRow } from '@/data/db';
import type {
  Attachment,
  Category,
  Location,
  MaterialRequest,
  Notification,
  Profile,
  WorkOrder,
  WorkOrderUpdate,
} from '@/types/domain';
import type { DailyReportSnapshot } from '@/types/domain';

/**
 * Dane demonstracyjne (tryb demo + supabase/seed.sql — ten sam zestaw).
 * Odzwierciedlają cały opisany w briefie przekrój: awarie, blokadę, pracę bez zlecenia,
 * ponowne otwarcie i wpis „w imieniu” pracownika bez smartfona.
 */

const uid = (n: number): string =>
  `${n.toString(16).padStart(8, '0')}-0000-4000-8000-00000000000${(n % 10).toString()}`;

export const DEMO_USERS = {
  anna: uid(0x11111111), // dyrektor
  piotr: uid(0x22222222), // koordynator
  mariusz: uid(0x33333333),
  tomasz: uid(0x44444444),
  katarzyna: uid(0x55555555),
  marek: uid(0x66666666), // „bez smartfona” — wpisy wprowadza ktos za niego
} as const;

const LOC = {
  aula: uid(0x0a0a0a01),
  sala104: uid(0x0a0a0a02),
  sala212: uid(0x0a0a0a03),
  korytarz1: uid(0x0a0a0a04),
  pok15: uid(0x0a0a0a05),
  sala007: uid(0x0a0a0a06),
  hall: uid(0x0a0a0a07),
  magazyn: uid(0x0a0a0a08),
  wcAula: uid(0x0a0a0a09),
} as const;

const CAT = {
  awaria: uid(0x0c0c0c01),
  elektryka: uid(0x0c0c0c02),
  hydraulika: uid(0x0c0c0c03),
  drzwi: uid(0x0c0c0c04),
  wyposazenie: uid(0x0c0c0c05),
  przygotowanie: uid(0x0c0c0c06),
  transport: uid(0x0c0c0c07),
 porzadkowo: uid(0x0c0c0c08),
  kontrola: uid(0x0c0c0c09),
  firma: uid(0x0c0c0c0a),
  inne: uid(0x0c0c0c0b),
} as const;

/** Czas względem „dziś” rano — demo wygląda realistycznie każdego dnia. */
function t(daysAgo: number, hour: number, min = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, min, 0, 0);
  return d.toISOString();
}
function dateStr(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const profiles: Profile[] = [
  { id: DEMO_USERS.anna, display_name: 'Anna Kowalska', role: 'ADMIN', active: true },
  { id: DEMO_USERS.piotr, display_name: 'Piotr Nowak', role: 'COORDINATOR', active: true },
  { id: DEMO_USERS.mariusz, display_name: 'Mariusz Wiśniewski', role: 'WORKER', active: true },
  { id: DEMO_USERS.tomasz, display_name: 'Tomasz Zieliński', role: 'WORKER', active: true },
  { id: DEMO_USERS.katarzyna, display_name: 'Katarzyna Mazur', role: 'WORKER', active: true },
  { id: DEMO_USERS.marek, display_name: 'Marek Lewandowski', role: 'WORKER', active: true },
];

const locations: Location[] = [
  { id: LOC.aula, name: 'Aula', building: 'Budynek A', floor: 'Parter', room: 'A-0', active: true },
  { id: LOC.sala104, name: 'Sala 104', building: 'Budynek A', floor: 'I', room: 'A-104', active: true },
  { id: LOC.sala212, name: 'Sala 212', building: 'Budynek A', floor: 'II', room: 'A-212', active: true },
  { id: LOC.korytarz1, name: 'Korytarz I piętro', building: 'Budynek A', floor: 'I', room: null, active: true },
  { id: LOC.pok15, name: 'Pokój 15 (sekretariat)', building: 'Budynek B', floor: 'Parter', room: 'B-15', active: true },
  { id: LOC.sala007, name: 'Sala 007', building: 'Budynek B', floor: 'Parter', room: 'B-007', active: true },
  { id: LOC.hall, name: 'Hall główny', building: 'Budynek A', floor: 'Parter', room: null, active: true },
  { id: LOC.magazyn, name: 'Magazyn techniczny', building: 'Budynek B', floor: null, room: 'B-M1', active: true },
  { id: LOC.wcAula, name: 'WC przy auli', building: 'Budynek A', floor: 'Parter', room: 'A-WC2', active: true },
];

const categories: Category[] = [
  { id: CAT.awaria, name: 'Awaria', icon: 'alert-triangle', color: '#b91c1c', active: true },
  { id: CAT.elektryka, name: 'Elektryka', icon: 'zap', color: '#d97706', active: true },
  { id: CAT.hydraulika, name: 'Hydraulika', icon: 'droplets', color: '#0284c7', active: true },
  { id: CAT.drzwi, name: 'Drzwi, zamki i stolarka', icon: 'door-open', color: '#78716c', active: true },
  { id: CAT.wyposazenie, name: 'Wyposażenie', icon: 'armchair', color: '#7c3aed', active: true },
  { id: CAT.przygotowanie, name: 'Przygotowanie sali', icon: 'presentation', color: '#059669', active: true },
  { id: CAT.transport, name: 'Transport i przenoszenie', icon: 'truck', color: '#2563eb', active: true },
  { id: CAT.porzadkowo, name: 'Prace porządkowo-techniczne', icon: 'brush', color: '#65a30d', active: true },
  { id: CAT.kontrola, name: 'Kontrola lub przegląd', icon: 'search-check', color: '#475569', active: true },
  { id: CAT.firma, name: 'Firma zewnętrzna', icon: 'hard-hat', color: '#9333ea', active: true },
  { id: CAT.inne, name: 'Inne', icon: 'wrench', color: '#334155', active: true },
];

interface SeedWo {
  id: string;
  num: number;
  wo: Omit<WorkOrder, 'id' | 'sequential_number'>;
  updates: Omit<WorkOrderUpdate, 'id'>[];
  attachments?: { photoId: string; fileName: string }[];
  materials?: Omit<MaterialRequest, 'id' | 'work_order_id'>[];
}

const W = (over: Partial<WorkOrder>): WorkOrder => ({
  id: '',
  sequential_number: 0,
  title: '',
  description: '',
  category_id: CAT.inne,
  location_id: LOC.hall,
  priority: 'NORMAL',
  status: 'NEW',
  requester_id: DEMO_USERS.anna,
  lead_worker_id: null,
  contact_person: null,
  access_notes: null,
  expected_date: null,
  hold_reason: null,
  hold_details: null,
  next_action: null,
  hold_waiting_on: null,
  completion_summary: null,
  is_unrequested: false,
  created_at: t(0, 8),
  updated_at: t(0, 8),
  started_at: null,
  completed_at: null,
  closed_at: null,
  reopened_at: null,
  ...over,
});

const U = (over: Partial<WorkOrderUpdate> & { work_order_id: string }): WorkOrderUpdate => ({
  id: '',
  update_type: 'NOTE',
  previous_status: null,
  new_status: null,
  message: null,
  next_action: null,
  performed_by: null,
  entered_by: DEMO_USERS.anna,
  created_at: t(0, 8),
  client_created_at: null,
  device_operation_id: null,
  ...over,
});

export function buildSeedWorld(): {
  workOrders: WorkOrder[];
  updates: WorkOrderUpdate[];
  assignees: AssigneeRow[];
  attachments: Attachment[];
  materials: MaterialRequest[];
  notifications: Notification[];
  reports: ReportRow[];
} {
  const seed: SeedWo[] = [
    {
      // 1. Cieknący kran — w trakcie, z aktualizacją
      id: uid(0xb0000001),
      num: 1031,
      wo: W({
        title: 'Cieknący kran w sali 104',
        description: 'Z kranu przy tablicy cały czas kapie woda, w zlewie stoi kałuża. Wykładowcy proszą o naprawę przed zajęciami.',
        category_id: CAT.hydraulika,
        location_id: LOC.sala104,
        priority: 'BREAKDOWN',
        status: 'IN_PROGRESS',
        requester_id: DEMO_USERS.anna,
        lead_worker_id: DEMO_USERS.mariusz,
        access_notes: 'Klucz do zaplecza wod-kan w magazynie B-M1.',
        expected_date: dateStr(-1),
        created_at: t(0, 8, 5),
        updated_at: t(0, 10, 15),
        started_at: t(0, 8, 40),
      }),
      updates: [
        U({ work_order_id: uid(0xb0000001), update_type: 'STATUS', new_status: 'ASSIGNED', entered_by: DEMO_USERS.anna, performed_by: DEMO_USERS.anna, message: 'Do Mariusza, dziś rano. Zanim wejdzie ekipa sprzątająca.', created_at: t(0, 8, 10) }),
        U({ work_order_id: uid(0xb0000001), update_type: 'STATUS', previous_status: 'ASSIGNED', new_status: 'IN_PROGRESS', entered_by: DEMO_USERS.mariusz, performed_by: DEMO_USERS.mariusz, message: 'Zaczynam. Rozebrana batería, widać zużytą uszczelkę.', created_at: t(0, 8, 40) }),
        U({ work_order_id: uid(0xb0000001), update_type: 'COMMENT', entered_by: DEMO_USERS.mariusz, performed_by: DEMO_USERS.mariusz, message: 'Sterówka uszczelki rozmiar 3/4. Część jest w magazynie, składam z powrotem.', next_action: null, created_at: t(0, 10, 15) }),
      ],
      attachments: [{ photoId: uid(0xd0000001), fileName: 'kran-sala104.jpg' }],
    },
    {
      // 2. Klamka — wykonane, czeka na zamknięcie
      id: uid(0xb0000002),
      num: 1032,
      wo: W({
        title: 'Uszkodzona klamka w drzwiach sali 212',
        description: 'Klamka luźna, drzwi trudno domknąć. Sale wynajmowane od 9:00, więc usterka przeszkadza w zajęciach.',
        category_id: CAT.drzwi,
        location_id: LOC.sala212,
        priority: 'URGENT',
        status: 'DONE',
        lead_worker_id: DEMO_USERS.tomasz,
        completion_summary: 'Wymieniona klamka na nową z zasobów magazynowych, regulacja zamka. Drzwi domykają się normalnie — sprawdzone.',
        created_at: t(1, 13, 20),
        updated_at: t(0, 11, 5),
        started_at: t(0, 10, 20),
        completed_at: t(0, 11, 5),
      }),
      updates: [
        U({ work_order_id: uid(0xb0000002), update_type: 'STATUS', new_status: 'ASSIGNED', entered_by: DEMO_USERS.piotr, performed_by: DEMO_USERS.piotr, message: 'Tomasz ma wolne 15 minut po porannej obchodzie.', created_at: t(1, 13, 40) }),
        U({ work_order_id: uid(0xb0000002), update_type: 'STATUS', previous_status: 'ASSIGNED', new_status: 'IN_PROGRESS', entered_by: DEMO_USERS.tomasz, performed_by: DEMO_USERS.tomasz, created_at: t(0, 10, 20) }),
        U({ work_order_id: uid(0xb0000002), update_type: 'STATUS', previous_status: 'IN_PROGRESS', new_status: 'DONE', entered_by: DEMO_USERS.tomasz, performed_by: DEMO_USERS.tomasz, message: 'Wymieniona klamka na nową z zasobów magazynowych, regulacja zamka. Drzwi domykają się normalnie.', created_at: t(0, 11, 5) }),
      ],
    },
    {
      // 3. Przygotowanie auli — przydzielone, na jutro
      id: uid(0xb0000003),
      num: 1033,
      wo: W({
        title: 'Przygotowanie auli na inaugurację roku',
        description: 'Ustawić 180 krzeseł w trzech rzędach, rozwiesić baner, sprawdzić mikrofony i projektor. Próba generalna dla służb o 16:00.',
        category_id: CAT.przygotowanie,
        location_id: LOC.aula,
        priority: 'URGENT',
        status: 'ASSIGNED',
        lead_worker_id: DEMO_USERS.tomasz,
        access_notes: 'Wejście od strony podjazdu, klucze u portierni do 7:30.',
        contact_person: 'Dziekanat, p. Ilona (wew. 214)',
        expected_date: dateStr(-1),
        created_at: t(1, 15, 0),
        updated_at: t(1, 15, 30),
      }),
      updates: [
        U({ work_order_id: uid(0xb0000003), update_type: 'STATUS', new_status: 'ASSIGNED', entered_by: DEMO_USERS.anna, performed_by: DEMO_USERS.anna, message: 'Prowadzi Tomasz, pomaga Katarzyna. Do wykonania do jutra do 15:00.', created_at: t(1, 15, 30) }),
      ],
    },
    {
      // 4. Praca bez zlecenia — przeniesienie krzeseł
      id: uid(0xb0000004),
      num: 1034,
      wo: W({
        title: 'Przeniesienie 12 krzeseł do sali 007',
        description: 'Potrzebne na zajęcia grupy porannej, decyzja podjęta na miejscu.',
        category_id: CAT.transport,
        location_id: LOC.sala007,
        priority: 'NORMAL',
        status: 'DONE',
        is_unrequested: true,
        requester_id: DEMO_USERS.tomasz,
        lead_worker_id: DEMO_USERS.tomasz,
        completion_summary: '12 krzeseł przeniesionych z auli do sali 007, ustawione wg wskazań prowadzącej zajęcia.',
        created_at: t(0, 13, 20),
        updated_at: t(0, 13, 20),
        started_at: t(0, 12, 40),
        completed_at: t(0, 13, 20),
      }),
      updates: [
        U({ work_order_id: uid(0xb0000004), update_type: 'STATUS', new_status: 'DONE', entered_by: DEMO_USERS.tomasz, performed_by: DEMO_USERS.tomasz, message: 'Praca wykonana bez wcześniejszego zlecenia. Wykonawcy: Tomasz Zieliński.', created_at: t(0, 13, 20) }),
      ],
    },
    {
      // 5. Awaria oświetlenia — zablokowana, czeka na część
      id: uid(0xb0000005),
      num: 1035,
      wo: W({
        title: 'Awaria oświetlenia na korytarzu I piętra',
        description: 'Nie działa ok. 2/3 świetlówek na korytarzu przy salach 101–110. Rano ciemno, studenci potykają się przy schodach.',
        category_id: CAT.elektryka,
        location_id: LOC.korytarz1,
        priority: 'BREAKDOWN',
        status: 'ON_HOLD',
        lead_worker_id: DEMO_USERS.mariusz,
        hold_reason: 'brak_materialow',
        hold_details: 'Spalony zasilacz/sterownik oświetlenia, brak zamiennika w magazynie. Bezpiecznik wymieniony, nie pomógł.',
        next_action: 'Zamówić zasilacz LED 150 W (model jak w sali 104) i wrócić do zadania po dostawie.',
        hold_waiting_on: DEMO_USERS.piotr,
        created_at: t(0, 7, 50),
        updated_at: t(0, 9, 30),
        started_at: t(0, 8, 10),
      }),
      updates: [
        U({ work_order_id: uid(0xb0000005), update_type: 'STATUS', new_status: 'ASSIGNED', entered_by: DEMO_USERS.anna, performed_by: DEMO_USERS.anna, created_at: t(0, 8, 0) }),
        U({ work_order_id: uid(0xb0000005), update_type: 'STATUS', previous_status: 'ASSIGNED', new_status: 'IN_PROGRESS', entered_by: DEMO_USERS.mariusz, performed_by: DEMO_USERS.mariusz, message: 'Sprawdzam obwód i zasilacze.', created_at: t(0, 8, 10) }),
        U({ work_order_id: uid(0xb0000005), update_type: 'STATUS', previous_status: 'IN_PROGRESS', new_status: 'ON_HOLD', entered_by: DEMO_USERS.mariusz, performed_by: DEMO_USERS.mariusz, message: 'Powód: brak części. Nastepny krok: zamówić zasilacz 150 W. Korytarz tymczasowo doświetlony lampą budowlaną.', next_action: 'Kierownik zamawia zasilacz LED 150 W.', created_at: t(0, 9, 30) }),
      ],
      materials: [{ name: 'Zasilacz LED 150 W (IP20, do korytarza A-I)', quantity: 1, unit: 'szt.', status: 'REQUESTED', note: 'Ten sam model co w sali 104 — sprawdzić symbol na starej obudowie.', created_by: DEMO_USERS.mariusz, created_at: t(0, 9, 35) }],
    },
    {
      // 6. Zamek — ponownie otwarte; wpis w imieniu Marka
      id: uid(0xb0000006),
      num: 1030,
      wo: W({
        title: 'Naprawa zamka w pokoju 15 (sekretariat)',
        description: 'Zamek w drzwiach sekretariatu zacina się, trzeba mocno naciskać klamkę. Sekretariat pracuje od 7:30.',
        category_id: CAT.drzwi,
        location_id: LOC.pok15,
        priority: 'NORMAL',
        status: 'REOPENED',
        lead_worker_id: DEMO_USERS.marek,
        completion_summary: 'Wymieniona wkładka i wyregulowany zamknięcie — wykonane wczoraj, dziś zamek znowu pracuje źle.',
        created_at: t(2, 9, 10),
        updated_at: t(0, 11, 45),
        started_at: t(1, 9, 0),
        completed_at: null,
        closed_at: null,
        reopened_at: t(0, 9, 0),
      }),
      updates: [
        U({ work_order_id: uid(0xb0000006), update_type: 'STATUS', new_status: 'ASSIGNED', entered_by: DEMO_USERS.piotr, performed_by: DEMO_USERS.piotr, message: 'Marek — jak będzie przy budynku B.', created_at: t(2, 9, 15) }),
        U({ work_order_id: uid(0xb0000006), update_type: 'STATUS', previous_status: 'ASSIGNED', new_status: 'DONE', entered_by: DEMO_USERS.piotr, performed_by: DEMO_USERS.marek, message: 'Wymieniona wkładka zamka, wyregulowane domknięcie. Działa.', created_at: t(1, 12, 0) }),
        U({ work_order_id: uid(0xb0000006), update_type: 'STATUS', previous_status: 'DONE', new_status: 'CLOSED', entered_by: DEMO_USERS.anna, performed_by: DEMO_USERS.anna, message: 'Zamknięte po akceptacji.', created_at: t(1, 12, 40) }),
        U({ work_order_id: uid(0xb0000006), update_type: 'STATUS', previous_status: 'CLOSED', new_status: 'REOPENED', entered_by: DEMO_USERS.anna, performed_by: DEMO_USERS.anna, message: 'Sekretariat zgłasza, że zamek znowu zacina — prawdopodobnie spasowanie klamki. Wracamy do tematu.', created_at: t(0, 9, 0) }),
        U({ work_order_id: uid(0xb0000006), update_type: 'NOTE', entered_by: DEMO_USERS.piotr, performed_by: DEMO_USERS.marek, message: 'Marek sprawdził rano: wkładka luźna w korpusie, dociśnięcie klamki pomaga. Zamówiona nowa klamka z wkładką.', next_action: 'Montaż nowej klamki po dostawie (jutro rano).', created_at: t(0, 11, 45) }),
      ],
    },
    {
      // 7. Zgłoszenie nowe, bez przydziału
      id: uid(0xb0000007),
      num: 1036,
      wo: W({
        title: 'Czujnik ruchu w WC przy auli nie reaguje',
        description: 'Światło nie gaśnie po wyjściu — czujnik świeci ciągle albo w ogóle nie wykrywa ruchu. Zgłasza sprzątanie.',
        category_id: CAT.elektryka,
        location_id: LOC.wcAula,
        priority: 'NORMAL',
        status: 'NEW',
        requester_id: DEMO_USERS.piotr,
        created_at: t(0, 7, 30),
        updated_at: t(0, 7, 30),
      }),
      updates: [],
    },
    {
      // 8. Przegląd gaśnic — wykonane dziś
      id: uid(0xb0000008),
      num: 1037,
      wo: W({
        title: 'Przegląd gaśnic w budynkach A i B',
        description: 'Kontrola ważności i plomb gaśnic. W razie braków — wpisać do materiału i zgłosić wymianę.',
        category_id: CAT.kontrola,
        location_id: LOC.hall,
        priority: 'NORMAL',
        status: 'DONE',
        lead_worker_id: DEMO_USERS.marek,
        completion_summary: 'Sprawdzono 14 gaśnic. 12 OK, 2 z nieczytelną etykietą przeglądu — oznaczone do wymiany przez dostawcę.',
        created_at: t(0, 7, 45),
        updated_at: t(0, 10, 30),
        started_at: t(0, 9, 15),
        completed_at: t(0, 10, 30),
      }),
      updates: [
        U({ work_order_id: uid(0xb0000008), update_type: 'STATUS', previous_status: 'ASSIGNED', new_status: 'DONE', entered_by: DEMO_USERS.piotr, performed_by: DEMO_USERS.marek, message: 'Marek zgłosił przez telefon na wspólnym komputerze: 12 OK, 2 do wymiany.', created_at: t(0, 10, 30) }),
      ],
      materials: [{ name: 'Gaśnica proszkowa ABC 4 kg (zamiast wycofanych 2 szt.)', quantity: 2, unit: 'szt.', status: 'APPROVED', note: null, created_by: DEMO_USERS.piotr, created_at: t(0, 10, 40) }],
    },
    {
      // 9. Praca bez zlecenia — zabezpieczenie płytki
      id: uid(0xb0000009),
      num: 1038,
      wo: W({
        title: 'Zabezpieczenie luzującej się płytki w hallu',
        description: 'Odchodząca płytka gresowa przy wejściu głównym — ryzyko potknięcia.',
        category_id: CAT.porzadkowo,
        location_id: LOC.hall,
        priority: 'NORMAL',
        status: 'DONE',
        is_unrequested: true,
        requester_id: DEMO_USERS.katarzyna,
        lead_worker_id: DEMO_USERS.katarzyna,
        completion_summary: 'Miejsce oznaczone taśmą i pachołkiem, zgłoszone do trwałej naprawy. Na razie bezpiecznie.',
        created_at: t(0, 12, 10),
        updated_at: t(0, 12, 10),
        started_at: t(0, 12, 5),
        completed_at: t(0, 12, 10),
      }),
      updates: [
        U({ work_order_id: uid(0xb0000009), update_type: 'STATUS', new_status: 'DONE', entered_by: DEMO_USERS.katarzyna, performed_by: DEMO_USERS.katarzyna, message: 'Praca wykonana bez wcześniejszego zlecenia. Wykonawcy: Katarzyna Mazur.', created_at: t(0, 12, 10) }),
      ],
    },
  ];

  const workOrders: WorkOrder[] = [];
  const updates: WorkOrderUpdate[] = [];
  const assignees: AssigneeRow[] = [];
  const attachments: Attachment[] = [];
  const materials: MaterialRequest[] = [];

  let updateSeq = 0;
  for (const item of seed) {
    workOrders.push({ ...item.wo, id: item.id, sequential_number: item.num });
    item.updates.forEach((u) => {
      updateSeq += 1;
      updates.push({ ...u, id: uid(0xe0000000 + updateSeq) });
    });
    if (item.wo.lead_worker_id) {
      assignees.push({ id: `${item.id}:${item.wo.lead_worker_id}`, work_order_id: item.id, user_id: item.wo.lead_worker_id, assignment_type: 'LEAD' });
    }
    for (const a of item.attachments ?? []) {
      attachments.push({
        id: a.photoId,
        work_order_id: item.id,
        update_id: null,
        storage_path: `wo/${item.id}/${a.photoId}.jpg`,
        file_name: a.fileName,
        mime_type: 'image/jpeg',
        size: 84_000,
        uploaded_by: item.wo.lead_worker_id ?? DEMO_USERS.anna,
        created_at: item.wo.updated_at,
      });
    }
    for (const m of item.materials ?? []) {
      materials.push({ ...m, id: uid(0xf0000000 + workOrders.length + materials.length), work_order_id: item.id });
    }
  }
  // współpracownik przy auli
  assignees.push({ id: `${uid(0xb0000003)}:${DEMO_USERS.katarzyna}`, work_order_id: uid(0xb0000003), user_id: DEMO_USERS.katarzyna, assignment_type: 'HELPER' });
  // i przy kranie (pomoc)
  assignees.push({ id: `${uid(0xb0000001)}:${DEMO_USERS.katarzyna}`, work_order_id: uid(0xb0000001), user_id: DEMO_USERS.katarzyna, assignment_type: 'HELPER' });

  const notifications: Notification[] = [
    { id: uid(0x12340001), recipient_id: DEMO_USERS.mariusz, work_order_id: uid(0xb0000005), kind: 'ASSIGNED', message: 'Nowy przydział: Awaria oświetlenia na korytarzu I piętra', read_at: null, created_at: t(0, 8, 0) },
    { id: uid(0x12340002), recipient_id: DEMO_USERS.piotr, work_order_id: uid(0xb0000005), kind: 'HOLD_RAISED', message: 'Blokada wymaga decyzji: Awaria oświetlenia na korytarzu I piętra', read_at: null, created_at: t(0, 9, 30) },
    { id: uid(0x12340003), recipient_id: DEMO_USERS.anna, work_order_id: uid(0xb0000005), kind: 'HOLD_RAISED', message: 'Blokada wymaga decyzji: Awaria oświetlenia na korytarzu I piętra', read_at: null, created_at: t(0, 9, 30) },
    { id: uid(0x12340004), recipient_id: DEMO_USERS.tomasz, work_order_id: uid(0xb0000003), kind: 'ASSIGNED', message: 'Nowy przydział: Przygotowanie auli na inaugurację roku', read_at: t(1, 16, 0), created_at: t(1, 15, 30) },
    { id: uid(0x12340005), recipient_id: DEMO_USERS.katarzyna, work_order_id: uid(0xb0000003), kind: 'ASSIGNED', message: 'Nowy przydział: Przygotowanie auli na inaugurację roku', read_at: null, created_at: t(1, 15, 30) },
    { id: uid(0x12340006), recipient_id: DEMO_USERS.marek, work_order_id: uid(0xb0000006), kind: 'REOPENED', message: 'Zadanie wróciło do pracy: Naprawa zamka w pokoju 15 (sekretariat)', read_at: null, created_at: t(0, 9, 0) },
  ];

  const yesterdayReport: ReportRow = {
    id: uid(0x13570001),
    report_date: dateStr(1),
    status: 'APPROVED',
    general_note: 'Wszystko zgodnie z planem; zamek w B-15 do obserwacji.',
    generated_by: DEMO_USERS.anna,
    approved_by: DEMO_USERS.anna,
    generated_at: t(1, 15, 50),
    approved_at: t(1, 16, 0),
    snapshot_json: yesterdaySnapshot(),
  };

  return { workOrders, updates, assignees, attachments, materials, notifications, reports: [yesterdayReport] };
}

function yesterdaySnapshot(): DailyReportSnapshot {
  return {
    report_date: dateStr(1),
    generated_at: t(1, 15, 50),
    generated_by_name: 'Anna Kowalska',
    counters: { completed: 1, inProgress: 0, onHold: 0, newUrgent: 0, unrequested: 0 },
    sections: {
      completed: [
        {
          work_order_id: uid(0xb0000006),
          sequential_number: 1030,
          title: 'Naprawa zamka w pokoju 15 (sekretariat)',
          location: 'Pokój 15 (sekretariat)',
          summary: 'Wymieniona wkładka zamka, wyregulowane domknięcie. Działa.',
          workers: ['Marek Lewandowski'],
          hold_reason: null,
          next_action: null,
        },
      ],
      inProgress: [],
      onHold: [],
      newUrgent: [],
      materials: [],
      handover: [
        {
          work_order_id: uid(0xb0000003),
          sequential_number: 1033,
          title: 'Przygotowanie auli na inaugurację roku',
          location: 'Aula',
          summary: 'Przydzielone: Tomasz + Katarzyna; wykonanie do jutra 15:00.',
          workers: ['Tomasz Zieliński', 'Katarzyna Mazur'],
          hold_reason: null,
          next_action: 'Rozstawienie krzeseł rano',
        },
      ],
      unrequested: [],
    },
  };
}

/** Wypełnia demo-bazę, jeśli jest pusta. */
export async function ensureDemoSeed(): Promise<boolean> {
  const db = getDb();
  const existing = await db.server_profiles.count();
  if (existing > 0) return false;
  const world = buildSeedWorld();
  await db.transaction(
    'rw',
    [
      db.server_profiles,
      db.server_locations,
      db.server_categories,
      db.server_workOrders,
      db.server_updates,
      db.server_assignees,
      db.server_attachments,
      db.server_materials,
      db.server_notifications,
      db.server_reports,
      db.meta,
    ],
    async () => {
      await db.server_profiles.bulkPut(profiles);
      await db.server_locations.bulkPut(locations);
      await db.server_categories.bulkPut(categories);
      await db.server_workOrders.bulkPut(world.workOrders);
      await db.server_updates.bulkPut(world.updates);
      await db.server_assignees.bulkPut(world.assignees);
      await db.server_attachments.bulkPut(world.attachments);
      await db.server_materials.bulkPut(world.materials);
      await db.server_notifications.bulkPut(world.notifications);
      await db.server_reports.bulkPut(world.reports);
      await db.meta.put({ key: 'nextNumber', value: 1039 });
    }
  );
  return true;
}

export function demoProfiles(): Profile[] {
  return profiles;
}
export function demoLocations(): Location[] {
  return locations;
}
export function demoCategories(): Category[] {
  return categories;
}

/** Eksporty dla generatora supabase/seed.sql (scripts/gen-seed-sql.mjs) — jedno źródło danych. */
export const DEMO_PROFILES = profiles;
export const DEMO_LOCATIONS = locations;
export const DEMO_CATEGORIES = categories;
