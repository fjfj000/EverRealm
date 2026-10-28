import { TaskChangeSet, TaskEntityWrite } from "../task-contract";

/** 提交临界区里的实体版本。只有串行提交可以改版本。 */
export class EntityStore {
    private readonly _versions: Map<string, number> = new Map();
    private readonly _values: Map<string, number> = new Map();

    public version(entityKey: string): number {
        return this._versions.get(entityKey) ?? 0;
    }

    public value(entityKey: string): number | undefined {
        return this._values.get(entityKey);
    }

    public canCommit(readSet: Record<string, number>): boolean {
        for (const entityKey of Object.keys(readSet)) {
            if (this.version(entityKey) !== readSet[entityKey]) {
                return false;
            }
        }
        return true;
    }

    /**
     * 读集全部命中后才写入。
     * 同一个实体在这次提交里只把版本加一，避免一条变更里写两次就跳版。
     */
    public apply(changeSet: TaskChangeSet): void {
        if (!this.canCommit(changeSet.readSet)) {
            throw new Error("提交时读集版本已经变化");
        }
        const bumped = new Set<string>();
        for (const command of changeSet.commands) {
            if (!isEntityWrite(command)) {
                continue;
            }
            this._values.set(command.entityKey, command.value);
            this._bump(command.entityKey, bumped);
        }
        for (const entityKey of Object.keys(changeSet.readSet)) {
            this._bump(entityKey, bumped);
        }
    }

    public clear(): void {
        this._versions.clear();
        this._values.clear();
    }

    public exportEntries(): { entityKey: string; version: number; value: number }[] {
        const keys = new Set([...this._versions.keys(), ...this._values.keys()]);
        return Array.from(keys).map((entityKey) => ({
            entityKey,
            version: this.version(entityKey),
            value: this._values.get(entityKey) ?? 0,
        }));
    }

    public restore(entries: readonly { entityKey: string; version: number; value: number }[]): void {
        this.clear();
        for (const entry of entries) {
            this._versions.set(entry.entityKey, entry.version);
            this._values.set(entry.entityKey, entry.value);
        }
    }

    private _bump(entityKey: string, bumped: Set<string>): void {
        if (bumped.has(entityKey)) {
            return;
        }
        this._versions.set(entityKey, this.version(entityKey) + 1);
        bumped.add(entityKey);
    }
}

function isEntityWrite(command: unknown): command is TaskEntityWrite {
    if (!command || typeof command !== "object") {
        return false;
    }
    const write = command as TaskEntityWrite;
    return typeof write.entityKey === "string" && typeof write.value === "number";
}
