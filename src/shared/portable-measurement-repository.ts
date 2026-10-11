import type { ConfigDocumentStore } from './config-repository';

export interface MeasurementValue<T> {
  fingerprint: string;
  observedAt: number;
  value: T;
}

/** Separate private database document. Every write rechecks current ownership and identity. */
export class PortableMeasurementRepository<T> {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly store: ConfigDocumentStore,
    private readonly name: string,
    private readonly identities: () => Promise<Map<string, string>>,
    private readonly validValue: (value: unknown) => value is T
  ) {}

  private serialize<R>(operation: () => Promise<R>): Promise<R> {
    const result = this.tail.then(operation);
    this.tail = result.catch(() => undefined);
    return result;
  }
  private async load(): Promise<{ records: Record<string, MeasurementValue<T>>; dirty: boolean }> {
    const content = await this.store.read(this.name);
    if (content === null) return { records: Object.create(null), dirty: false };
    const document = JSON.parse(content);
    if (
      document?.schema !== 1 ||
      !document.records ||
      Array.isArray(document.records) ||
      typeof document.records !== 'object'
    )
      throw new Error('Invalid measurement document');
    const records: Record<string, MeasurementValue<T>> = Object.create(null);
    for (const [id, raw] of Object.entries(document.records)) {
      const record = raw as MeasurementValue<unknown>;
      if (
        record &&
        /^[a-f0-9]{64}$/.test(record.fingerprint) &&
        Number.isFinite(record.observedAt) &&
        record.observedAt >= 0 &&
        this.validValue(record.value)
      )
        records[id] = record as MeasurementValue<T>;
    }
    return { records, dirty: Object.keys(records).length !== Object.keys(document.records).length };
  }
  private persist(records: Record<string, MeasurementValue<T>>): Promise<void> {
    return this.store.write(this.name, JSON.stringify({ schema: 1, records }));
  }
  private async current(): Promise<{
    records: Record<string, MeasurementValue<T>>;
    dirty: boolean;
  }> {
    const loaded = await this.load();
    const records = loaded.records;
    const identities = await this.identities();
    let dirty = loaded.dirty;
    for (const [id, record] of Object.entries(records))
      if (identities.get(id) !== record.fingerprint) {
        delete records[id];
        dirty = true;
      }
    return { records, dirty };
  }
  read(): Promise<Record<string, MeasurementValue<T>>> {
    return this.serialize(async () => {
      const { records, dirty } = await this.current();
      if (dirty) await this.persist(records);
      return structuredClone(records);
    });
  }
  save(id: string, observation: MeasurementValue<T>): Promise<boolean> {
    return this.serialize(async () => {
      if (
        !/^[a-f0-9]{64}$/.test(observation.fingerprint) ||
        !Number.isFinite(observation.observedAt) ||
        observation.observedAt < 0 ||
        !this.validValue(observation.value)
      )
        throw new Error('Invalid measurement observation');
      const loaded = await this.load();
      const records = loaded.records;
      const identities = await this.identities();
      let dirty = loaded.dirty;
      for (const [key, record] of Object.entries(records))
        if (identities.get(key) !== record.fingerprint) {
          delete records[key];
          dirty = true;
        }
      const accepted =
        identities.get(id) === observation.fingerprint &&
        (!records[id] || records[id].observedAt <= observation.observedAt);
      if (accepted) records[id] = structuredClone(observation);
      if (accepted || dirty) await this.persist(records);
      return accepted;
    });
  }
}
