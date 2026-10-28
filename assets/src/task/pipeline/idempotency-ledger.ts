/** 已提交副作用的账本。重复 ResultCommand 和读档重试都先查这里。 */
export class IdempotencyLedger {
    private readonly _commits: Map<string, number> = new Map();
    private _nextSequence: number = 1;

    public has(idempotencyKey: string): boolean {
        return this._commits.has(idempotencyKey);
    }

    public sequenceOf(idempotencyKey: string): number | undefined {
        return this._commits.get(idempotencyKey);
    }

    public record(idempotencyKey: string, commitSequence: number): void {
        this._commits.set(idempotencyKey, commitSequence);
        if (commitSequence >= this._nextSequence) {
            this._nextSequence = commitSequence + 1;
        }
    }

    public nextCommitSequence(): number {
        return this._nextSequence;
    }

    public clear(): void {
        this._commits.clear();
        this._nextSequence = 1;
    }

    public exportEntries(): { key: string; sequence: number }[] {
        return Array.from(this._commits.entries()).map(([key, sequence]) => ({ key, sequence }));
    }

    public restore(entries: readonly { key: string; sequence: number }[], nextSequence: number): void {
        this._commits.clear();
        for (const entry of entries) {
            this._commits.set(entry.key, entry.sequence);
        }
        this._nextSequence = nextSequence;
    }
}
