import { IdType } from "./id-define";

/**
 * 进程内单调编号。
 * 同一次运行里编号只增不减，任务顺序不依赖墙上时间和随机数。
 * 读档时用 restoreNextSerial 接着已保存的序号，避免新编号和旧编号撞车。
 */
let nextSerial = 1;

export function generateId(type: IdType): string {
    const serial = nextSerial;
    nextSerial += 1;
    return `${type}:${serial}`;
}

export function peekNextSerial(): number {
    return nextSerial;
}

export function restoreNextSerial(value: number): void {
    if (!Number.isInteger(value) || value < 1) {
        throw new Error("编号序号必须是正整数");
    }
    nextSerial = value;
}
