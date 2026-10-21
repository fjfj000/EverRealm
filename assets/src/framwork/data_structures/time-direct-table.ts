/** 小于 0 表示 a 排在 b 前面。同一分钟内用它排序。 */
export type TimeDirectCompare<T> = (a: T, b: T) => number;

/** 一天的分钟数。游戏最小时间是分钟，直址表按这个建槽。 */
export const MINUTES_PER_DAY = 24 * 60;

const BIT_WORD_BITS = 32;
const BIT_WORD_COUNT = MINUTES_PER_DAY / BIT_WORD_BITS;

interface MinuteBucket<T> {
    /** 含已取出的前缀。head 之前的位置不再读。 */
    items: T[];
    head: number;
}

/**
 * 当前游戏日的时间直址表。
 * 1440 个分钟只用一张占用位图标记，空分钟不建列表。
 * 取下一条时扫这 45 个 32 位字，代价是常数。
 * 同一分钟内按比较函数有序。比较函数决定 SequenceType、Priority、Id 的先后。
 */
export class TimeDirectTable<T> {
    /** 180 字节。第 i 位为 1 表示第 i 分钟有未取出的元素。 */
    private _bits: Uint32Array = new Uint32Array(BIT_WORD_COUNT);
    /** 只保存有元素的分钟。 */
    private _buckets: Map<number, MinuteBucket<T>> = new Map();
    private _size: number = 0;
    private _compare: TimeDirectCompare<T>;

    public constructor(compare: TimeDirectCompare<T>) {
        if (typeof compare !== "function") {
            throw new Error("TimeDirectTable 需要比较函数");
        }
        this._compare = compare;
    }

    public get size(): number {
        return this._size;
    }

    public get isEmpty(): boolean {
        return this._size === 0;
    }

    /** 当前最早一条，不取出。 */
    public get peek(): T | undefined {
        const minute = this._nextOccupiedMinute();
        if (minute === undefined) {
            return undefined;
        }
        const bucket = this._buckets.get(minute);
        if (!bucket) {
            return undefined;
        }
        return bucket.items[bucket.head];
    }

    /**
     * 插入当前游戏日的某一分钟。minute 是 0 到 1439 的整数。
     * 同一分钟内按比较函数保持有序。
     */
    public insert(minute: number, value: T): void {
        const slot = this._normalizeMinute(minute);
        if (!this._isAcceptable(value)) {
            return;
        }
        let bucket = this._buckets.get(slot);
        if (!bucket) {
            bucket = { items: [], head: 0 };
            this._buckets.set(slot, bucket);
            this._setBit(slot);
        }
        const index = this._findInsertIndex(bucket, value);
        bucket.items.splice(index, 0, value);
        this._size += 1;
    }

    /** 按分钟从早到晚取出下一条。同一分钟内按比较函数。 */
    public popNext(): T | undefined {
        const minute = this._nextOccupiedMinute();
        if (minute === undefined) {
            return undefined;
        }
        const bucket = this._buckets.get(minute);
        if (!bucket) {
            this._clearBit(minute);
            return undefined;
        }
        const value = bucket.items[bucket.head];
        bucket.head += 1;
        this._size -= 1;
        this._compact(minute, bucket);
        return value;
    }

    /** 按引用移除。找不到返回 false。 */
    public remove(minute: number, value: T): boolean {
        const slot = this._normalizeMinute(minute);
        const bucket = this._buckets.get(slot);
        if (!bucket) {
            return false;
        }
        for (let index = bucket.head; index < bucket.items.length; index++) {
            if (bucket.items[index] !== value) {
                continue;
            }
            bucket.items.splice(index, 1);
            this._size -= 1;
            this._compact(slot, bucket);
            return true;
        }
        return false;
    }

    /** 从当天第 0 分钟扫位图。执行中插入更早的分钟也能被下一次取到。 */
    private _nextOccupiedMinute(): number | undefined {
        const bits = this._bits;
        for (let wordIndex = 0; wordIndex < bits.length; wordIndex++) {
            let word = bits[wordIndex];
            if (word === 0) {
                continue;
            }
            let bit = 0;
            while ((word & 1) === 0) {
                word >>>= 1;
                bit += 1;
            }
            return wordIndex * BIT_WORD_BITS + bit;
        }
        return undefined;
    }

    private _findInsertIndex(bucket: MinuteBucket<T>, value: T): number {
        let low = bucket.head;
        let high = bucket.items.length;
        while (low < high) {
            const mid = (low + high) >> 1;
            const order = this._compare(value, bucket.items[mid]);
            if (typeof order !== "number" || !Number.isFinite(order)) {
                throw new Error("TimeDirectTable 比较函数必须返回有限数字");
            }
            if (order < 0) {
                high = mid;
            } else {
                low = mid + 1;
            }
        }
        return low;
    }

    /** 这一分钟已经取空就清位。取出前缀太长时丢掉，避免数组只增不减。 */
    private _compact(minute: number, bucket: MinuteBucket<T>): void {
        if (bucket.head >= bucket.items.length) {
            this._buckets.delete(minute);
            this._clearBit(minute);
            return;
        }
        if (bucket.head > 32 && bucket.head * 2 > bucket.items.length) {
            bucket.items = bucket.items.slice(bucket.head);
            bucket.head = 0;
        }
    }

    private _setBit(minute: number): void {
        const wordIndex = minute >>> 5;
        const bit = minute & 31;
        this._bits[wordIndex] = (this._bits[wordIndex] | (1 << bit)) >>> 0;
    }

    private _clearBit(minute: number): void {
        const wordIndex = minute >>> 5;
        const bit = minute & 31;
        this._bits[wordIndex] = (this._bits[wordIndex] & ~(1 << bit)) >>> 0;
    }

    private _normalizeMinute(minute: number): number {
        if (typeof minute !== "number" || !Number.isInteger(minute) || minute < 0 || minute >= MINUTES_PER_DAY) {
            throw new Error("分钟必须是 0 到 1439 的整数");
        }
        return minute;
    }

    private _isAcceptable(value: T | null | undefined): value is T {
        return value !== undefined && value !== null;
    }
}
