/** 小于 0 表示 a 排在 b 前面。同一单位内用它排序。 */
export type DirectAddressCompare<T> = (a: T, b: T) => number;

const BIT_WORD_BITS = 32;

interface UnitBucket<T> {
    /** 含已取出的前缀。head 之前的位置不再读。 */
    items: T[];
    head: number;
}

/**
 * 有界整数直址表。槽里放的元素不限定种类。
 * 每个单位一个槽，最小单位和最大单位都包含在内。
 * 占用位图按整个范围一次分配，只标记还有未取出元素的单位，空单位不建列表。
 * 取下一条时从最小单位扫位图。同一单位内按比较函数有序。
 * 范围就是位图长度，只传真正会用到的区间。
 */
export class DirectAddressTable<T> {
    private _minUnit: number;
    private _maxUnit: number;
    private _bits: Uint32Array;
    /** 键是槽下标，不是单位本身。单位减去最小单位得到槽下标。 */
    private _buckets: Map<number, UnitBucket<T>> = new Map();
    private _size: number = 0;
    private _compare: DirectAddressCompare<T>;

    public constructor(minUnit: number, maxUnit: number, compare: DirectAddressCompare<T>) {
        if (typeof compare !== "function") {
            throw new Error("DirectAddressTable 需要比较函数");
        }
        if (!isUnitBound(minUnit) || !isUnitBound(maxUnit) || maxUnit < minUnit) {
            throw new Error("最小单位和最大单位必须是整数，且最大单位不能小于最小单位");
        }
        const slotCount = maxUnit - minUnit + 1;
        // 槽下标要放进 32 位。超过后字和位的移位会对不上。
        if (!Number.isSafeInteger(slotCount) || slotCount <= 0 || slotCount > 0x100000000) {
            throw new Error("单位范围太大，无法建立直址表");
        }
        const wordCount = Math.ceil(slotCount / BIT_WORD_BITS);
        this._minUnit = minUnit;
        this._maxUnit = maxUnit;
        this._bits = new Uint32Array(wordCount);
        this._compare = compare;
    }

    public get size(): number {
        return this._size;
    }

    public get isEmpty(): boolean {
        return this._size === 0;
    }

    /**
     * 清空整张表。
     * 空表直接返回。有数据时位图一次置 0，桶换成空 Map，元素数组交给回收，不逐条删除。
     */
    public clear(): void {
        if (this._size === 0) {
            return;
        }
        this._size = 0;
        this._buckets = new Map();
        this._bits.fill(0);
    }

    /** 当前最小单位上的第一条，不取出。 */
    public get peek(): T | undefined {
        const slot = this._nextOccupiedSlot();
        if (slot === undefined) {
            return undefined;
        }
        const bucket = this._buckets.get(slot);
        if (!bucket) {
            return undefined;
        }
        return bucket.items[bucket.head];
    }

    /**
     * 插入一个单位。unit 是最小单位到最大单位之间的整数，两端都包含。
     * 同一单位内按比较函数保持有序。
     */
    public insert(unit: number, value: T): void {
        const slot = this._slotOf(unit);
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

    /** 按单位从小到大取出下一条。同一单位内按比较函数。 */
    public popNext(): T | undefined {
        const slot = this._nextOccupiedSlot();
        if (slot === undefined) {
            return undefined;
        }
        const bucket = this._buckets.get(slot);
        if (!bucket) {
            this._clearBit(slot);
            return undefined;
        }
        const value = bucket.items[bucket.head];
        bucket.head += 1;
        this._size -= 1;
        this._compact(slot, bucket);
        return value;
    }

    /**
     * 从指定槽起读第一条还在的元素，包含这个槽。
     * 只读 head 指向的队头，不移动 head。
     */
    public readNextFromSlot(slot: number): { value: T; slot: number } | undefined {
        let startSlot = slot;
        const slotCount = this._maxUnit - this._minUnit + 1;
        while (startSlot < slotCount) {
            const nextSlot = this._nextOccupiedSlot(startSlot);
            if (nextSlot === undefined) {
                return undefined;
            }
            const bucket = this._buckets.get(nextSlot);
            if (!bucket || bucket.head >= bucket.items.length) {
                startSlot = nextSlot + 1;
                continue;
            }
            return {
                value: bucket.items[bucket.head],
                slot: nextSlot,
            };
        }
        return undefined;
    }

    /** 按引用移除。找不到返回 false。 */
    public remove(unit: number, value: T): boolean {
        const slot = this._slotOf(unit);
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

    /**
     * 按槽从小到大遍历还没取走的元素。不移动 head，避免影响 popNext。
     * 更小的槽在遍历途中插入，不再读到。当前槽里还没读到的位置，以及更后面的槽，会读到。
     */
    public [Symbol.iterator](): Iterator<T> {
        let slot = -1;
        let lastIndex = 0;
        let lastValue: T | undefined;

        return {
            next: (): IteratorResult<T> => {
                if (slot >= 0) {
                    const bucket = this._buckets.get(slot);
                    const nextIndex = bucket ? this._indexAfter(bucket, lastValue as T, lastIndex) : 0;
                    if (bucket && nextIndex < bucket.items.length) {
                        lastIndex = nextIndex;
                        lastValue = bucket.items[nextIndex];
                        return { value: lastValue, done: false };
                    }
                }

                const found = this.readNextFromSlot(slot + 1);
                if (!found) {
                    return { value: undefined as T, done: true };
                }
                const bucket = this._buckets.get(found.slot);
                slot = found.slot;
                lastValue = found.value;
                lastIndex = bucket ? bucket.items.indexOf(found.value, bucket.head) : 0;
                return { value: lastValue, done: false };
            },
        };
    }

    /**
     * 从 startSlot 起找下一个有元素的槽，包含 startSlot。
     * 不传时从最小槽开始。popNext 依赖这一点：执行中插入更小的单位，下一次取出也能拿到。
     */
    private _nextOccupiedSlot(startSlot: number = 0): number | undefined {
        const bits = this._bits;
        if (startSlot < 0) {
            startSlot = 0;
        }
        const wordIdx = startSlot >>> 5;
        const startBit = startSlot & 31;
        for (let wordIndex = wordIdx; wordIndex < bits.length; wordIndex++) {
            let word = bits[wordIndex];
            // 同一个字里，起点之前的位清掉。更早的槽不参与这次查找。
            if (wordIndex === wordIdx && startBit > 0) {
                const mask = (0xffffffff << startBit) >>> 0;
                word = (word & mask) >>> 0;
            }
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

    /**
     * 返回排在 value 后面的第一个下标。
     * fromIndex 是上次读到它的位置。同一引用出现多次时，从这里往后找，避免又回到前一个。
     */
    private _indexAfter(bucket: UnitBucket<T>, value: T, fromIndex: number): number {
        const start = Math.max(fromIndex, bucket.head);
        const found = bucket.items.indexOf(value, start);
        if (found !== -1) {
            return found + 1;
        }
        return this._findInsertIndex(bucket, value);
    }

    private _findInsertIndex(bucket: UnitBucket<T>, value: T): number {
        let low = bucket.head;
        let high = bucket.items.length;
        while (low < high) {
            const mid = (low + high) >> 1;
            const order = this._compare(value, bucket.items[mid]);
            if (typeof order !== "number" || !Number.isFinite(order)) {
                throw new Error("DirectAddressTable 比较函数必须返回有限数字");
            }
            if (order < 0) {
                high = mid;
            } else {
                low = mid + 1;
            }
        }
        return low;
    }

    /** 这一单位已经取空就清位。取出前缀太长时丢掉，避免数组只增不减。 */
    private _compact(slot: number, bucket: UnitBucket<T>): void {
        if (bucket.head >= bucket.items.length) {
            this._buckets.delete(slot);
            this._clearBit(slot);
            return;
        }
        if (bucket.head > 32 && bucket.head * 2 > bucket.items.length) {
            bucket.items = bucket.items.slice(bucket.head);
            bucket.head = 0;
        }
    }

    private _setBit(slot: number): void {
        const wordIndex = slot >>> 5;
        const bit = slot & 31;
        this._bits[wordIndex] = (this._bits[wordIndex] | (1 << bit)) >>> 0;
    }

    private _clearBit(slot: number): void {
        const wordIndex = slot >>> 5;
        const bit = slot & 31;
        this._bits[wordIndex] = (this._bits[wordIndex] & ~(1 << bit)) >>> 0;
    }

    private _slotOf(unit: number): number {
        if (!isUnitBound(unit) || unit < this._minUnit || unit > this._maxUnit) {
            throw new Error(`单位必须是 ${this._minUnit} 到 ${this._maxUnit} 的整数`);
        }
        return unit - this._minUnit;
    }

    private _isAcceptable(value: T | null | undefined): value is T {
        return value !== undefined && value !== null;
    }
}

function isUnitBound(unit: number): boolean {
    return typeof unit === "number" && Number.isInteger(unit);
}
