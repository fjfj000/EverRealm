import { TaskResultCommand } from "../task-contract";

/**
 * 外部结果的持久化入口。
 * Promise 回调只入队，当前边界处理完之后的安全点再按 commandSequence 消费。
 */
export class DurableResultInbox {
    private _commands: TaskResultCommand[] = [];
    private _nextSequence: number = 1;

    public peekSequence(): number {
        return this._nextSequence;
    }

    public takeSequence(): number {
        const sequence = this._nextSequence;
        this._nextSequence += 1;
        return sequence;
    }

    public enqueue(command: TaskResultCommand): void {
        this._commands.push(command);
    }

    /** 取出当前全部命令。调用方若还不能提交，再放回来。 */
    public drain(): TaskResultCommand[] {
        const commands = this._commands.slice().sort((left, right) => {
            if (left.commandSequence !== right.commandSequence) {
                return left.commandSequence - right.commandSequence;
            }
            if (left.commandId === right.commandId) {
                return 0;
            }
            return left.commandId < right.commandId ? -1 : 1;
        });
        this._commands = [];
        return commands;
    }

    public list(): TaskResultCommand[] {
        return this._commands.slice();
    }

    public restore(commands: readonly TaskResultCommand[], nextSequence: number): void {
        this._commands = commands.slice();
        this._nextSequence = nextSequence;
    }

    public clear(): void {
        this._commands = [];
        this._nextSequence = 1;
    }
}
