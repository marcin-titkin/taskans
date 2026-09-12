import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { IDBKeyRange } from 'fake-indexeddb';

// pełne środowisko IndexedDB per plik: każdy test dostaje własną nazwę bazy
globalThis.indexedDB = new IDBFactory();
globalThis.IDBKeyRange = IDBKeyRange;
// jsdom nie ma structuredClone w niektórych ścieżkach — node 22 ma natywny, zostawiamy
// Uwaga: nazwy baz per test ustawiają same pliki testowe (resetDbForTests w beforeEach),
// żeby nie zwalczać się z otwartymi transakcjami Dexie.
