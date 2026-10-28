import { ExecutionRecord, TaskResourceClaim } from "../task-contract";
import { TaskResourceAccess } from "../task-define";

interface ResourceHold {
    executionId: string;
    access: TaskResourceAccess;
}

/** 显式资源互斥。读可以并存，写和独占会挡住其他访问。 */
export class ResourceArbiter {
    private readonly _holds: Map<string, ResourceHold[]> = new Map();
    private readonly _keysByExecution: Map<string, string[]> = new Map();

    public canAcquire(claims: readonly TaskResourceClaim[]): boolean {
        return claims.every((claim) => !this._conflicts(claim.resourceKey, claim.access));
    }

    public tryAcquire(execution: ExecutionRecord, claims: readonly TaskResourceClaim[]): boolean {
        for (const claim of claims) {
            if (this._conflicts(claim.resourceKey, claim.access)) {
                return false;
            }
        }
        const keys: string[] = [];
        for (const claim of claims) {
            const holds = this._holds.get(claim.resourceKey) ?? [];
            holds.push({ executionId: execution.executionId, access: claim.access });
            this._holds.set(claim.resourceKey, holds);
            keys.push(claim.resourceKey);
        }
        this._keysByExecution.set(execution.executionId, keys);
        execution.acquiredResources = keys;
        return true;
    }

    public release(executionId: string): void {
        const keys = this._keysByExecution.get(executionId);
        this._keysByExecution.delete(executionId);
        if (!keys) {
            return;
        }
        for (const key of keys) {
            const holds = this._holds.get(key);
            if (!holds) {
                continue;
            }
            const next = holds.filter((hold) => hold.executionId !== executionId);
            if (next.length === 0) {
                this._holds.delete(key);
            } else {
                this._holds.set(key, next);
            }
        }
    }

    public wake(_resourceKey: string): ExecutionRecord[] {
        return [];
    }

    public clear(): void {
        this._holds.clear();
        this._keysByExecution.clear();
    }

    private _conflicts(resourceKey: string, access: TaskResourceAccess): boolean {
        const holds = this._holds.get(resourceKey) ?? [];
        return holds.some((hold) => this._accessConflicts(hold.access, access));
    }

    private _accessConflicts(left: TaskResourceAccess, right: TaskResourceAccess): boolean {
        if (left === TaskResourceAccess.Read && right === TaskResourceAccess.Read) {
            return false;
        }
        return true;
    }
}
