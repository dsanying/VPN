import type { ConfigDocumentStore } from './config-repository';
import { CatalogStateError, type CatalogAcceptance, type CatalogReceipt } from './release-catalog';

const DOCUMENT = 'release-catalog-trust';
/** One serialized durable high-water mark per signer, shared by software and core checks. */
export class ReleaseCatalogState implements CatalogAcceptance {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly store: ConfigDocumentStore) {}
  accept(receipt: CatalogReceipt): Promise<void> {
    const result = this.queue.then(async () => {
      try {
        const content = await this.store.read(DOCUMENT);
        let records: Record<string, CatalogReceipt> = {};
        if (content !== null) {
          const saved = JSON.parse(content);
          if (saved.schema !== 1 || !Array.isArray(saved.records))
            throw new Error('Invalid trust state');
          records = Object.fromEntries(
            saved.records.map((record: CatalogReceipt) => {
              if (
                !record ||
                typeof record.keyId !== 'string' ||
                !Number.isSafeInteger(record.issuedAt) ||
                !/^[a-f0-9]{64}$/.test(record.digest)
              )
                throw new Error('Invalid catalog receipt');
              return [record.keyId, record];
            })
          );
        }
        const previous = records[receipt.keyId];
        if (
          previous &&
          (receipt.issuedAt < previous.issuedAt ||
            (receipt.issuedAt === previous.issuedAt && receipt.digest !== previous.digest))
        )
          throw new Error('Release catalog rollback or conflicting issuance');
        if (previous?.issuedAt === receipt.issuedAt) return;
        records[receipt.keyId] = receipt;
        await this.store.write(
          DOCUMENT,
          JSON.stringify({ schema: 1, records: Object.values(records) })
        );
      } catch (error) {
        throw new CatalogStateError(`Release catalog trust state rejected: ${String(error)}`);
      }
    });
    this.queue = result.catch(() => undefined);
    return result;
  }
}
