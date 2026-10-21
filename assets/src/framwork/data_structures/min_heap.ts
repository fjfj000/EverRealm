/** 小于 0 表示 a 排在 b 前面。必须返回有限数字。 */
export type HeapCompare<T> = (a: T, b: T) => number;

/**
 * 二叉最小堆。顺序完全由比较函数决定，元素不限定为数字。
 * null、undefined、非有限数字不能进堆：空堆 pop 用 undefined 表示没有元素，NaN 会破坏堆序。
 */
export default class MinHeap<T = number> {
    private _heap: T[] = [];
    private _compare: HeapCompare<T>;

    public get peek(): T | undefined {
        return this._heap[0];
    }

    public get size(): number {
        return this._heap.length;
    }

    public get isEmpty(): boolean {
        return this._heap.length === 0;
    }

    public constructor(array: readonly T[] | null | undefined, compare: HeapCompare<T>) {
        if (typeof compare !== "function") {
            throw new Error("MinHeap 需要比较函数");
        }
        this._compare = compare;
        const source = array ?? [];
        if (!Array.isArray(source)) {
            throw new Error("MinHeap 初始数据必须是数组");
        }
        const heap: T[] = [];
        for (let index = 0; index < source.length; index++) {
            const value = source[index];
            if (!this.isAcceptable(value)) {
                continue;
            }
            heap.push(value);
        }
        this._heap = heap;
        this.buildHeap();
    }

    /** 比较函数没设好时直接失败，避免静默变成无序数组。 */
    public compare(a: T, b: T): number {
        if (typeof this._compare !== "function") {
            throw new Error("MinHeap 需要比较函数");
        }
        return this._compare(a, b);
    }

    public push(value: T): void {
        if (!this.isAcceptable(value)) {
            return;
        }
        this._heap.push(value);
        try {
            this.siftUp(this._heap.length - 1);
        } catch (error) {
            // 上浮在比较完成前不会改数组，这里只撤掉刚放进去的值。
            this._heap.pop();
            throw error;
        }
    }

    public pop(): T | undefined {
        if (this._heap.length === 0) {
            return undefined;
        }
        const top = this._heap[0];
        const end = this._heap.pop() as T;
        if (this._heap.length === 0) {
            return top;
        }
        this._heap[0] = end;
        try {
            this.siftDown(0);
        } catch (error) {
            this._heap[0] = top;
            this._heap.push(end);
            throw error;
        }
        return top;
    }

    public setKey(index: number, value: T): void {
        const normalized = this.normalizeIndex(index);
        if (normalized === undefined || !this.isAcceptable(value)) {
            return;
        }
        const beforeValue = this._heap[normalized];
        // 先比较。比较失败时这个位置还是旧值。
        const shouldSiftUp = this.isLess(value, beforeValue);
        const shouldSiftDown = !shouldSiftUp && this.isLess(beforeValue, value);
        this._heap[normalized] = value;
        try {
            if (shouldSiftUp) {
                this.siftUp(normalized);
            } else if (shouldSiftDown) {
                this.siftDown(normalized);
            }
        } catch (error) {
            this._heap[normalized] = beforeValue;
            throw error;
        }
    }

    public delete(index: number): void {
        const normalized = this.normalizeIndex(index);
        if (normalized === undefined) {
            return;
        }
        const lastIndex = this._heap.length - 1;
        if (normalized === lastIndex) {
            this._heap.pop();
            return;
        }
        const deletedValue = this._heap[normalized];
        const endValue = this._heap[lastIndex];
        // 先比较再挪动。比较失败时堆还是原来的样子。
        const endIsLess = this.isLess(endValue, deletedValue);
        const deletedIsLess = !endIsLess && this.isLess(deletedValue, endValue);
        this._heap.pop();
        this._heap[normalized] = endValue;
        try {
            if (endIsLess) {
                this.siftUp(normalized);
            } else if (deletedIsLess) {
                this.siftDown(normalized);
            }
        } catch (error) {
            this._heap[normalized] = deletedValue;
            this._heap.push(endValue);
            throw error;
        }
    }

    public merge(heap: MinHeap<T> | null | undefined): void {
        if (!heap || heap === this) {
            return;
        }
        if (!(heap instanceof MinHeap)) {
            throw new Error("MinHeap.merge 需要另一个 MinHeap");
        }
        const incoming = heap._heap;
        if (incoming.length === 0) {
            return;
        }
        // 比较函数不是同一个时，对方的堆序不能沿用，按本堆的顺序重建。
        if (heap._compare !== this._compare) {
            const previous = this._heap;
            this._heap = previous.concat(incoming);
            try {
                this.buildHeap();
            } catch (error) {
                this._heap = previous;
                throw error;
            }
            return;
        }
        this.mergeSameOrder(incoming);
    }

    private buildHeap(): void {
        // 最后一个父节点是 floor(n / 2) - 1。再往右都是叶子，下沉没有意义。
        for (let index = Math.floor(this._heap.length / 2) - 1; index >= 0; index--) {
            this.siftDown(index);
        }
    }

    private parentIndex(index: number): number {
        return Math.floor((index - 1) / 2);
    }

    /**
     * 先只比较、确定落点，再移动元素。
     * 比较函数中途抛错时，数组还保持进入这个方法之前的样子。
     */
    private siftUp(index: number): void {
        const heap = this._heap;
        const value = heap[index];
        let cursor = index;
        while (cursor > 0) {
            const parentIndex = this.parentIndex(cursor);
            if (!this.isLess(value, heap[parentIndex])) {
                break;
            }
            cursor = parentIndex;
        }
        while (index > cursor) {
            const parentIndex = this.parentIndex(index);
            heap[index] = heap[parentIndex];
            index = parentIndex;
        }
        heap[cursor] = value;
    }

    /**
     * 先沿更小的子节点找到落点，再把路径上的节点上移。
     * 比较失败时不改数组。
     */
    private siftDown(index: number): void {
        const heap = this._heap;
        const length = heap.length;
        if (index < 0 || index >= length) {
            return;
        }
        const value = heap[index];
        const path: number[] = [];
        let cursor = index;
        while (cursor < length) {
            const leftChildIndex = 2 * cursor + 1;
            if (leftChildIndex >= length) {
                break;
            }
            let smallestIndex = leftChildIndex;
            const rightChildIndex = leftChildIndex + 1;
            if (rightChildIndex < length && this.isLess(heap[rightChildIndex], heap[leftChildIndex])) {
                smallestIndex = rightChildIndex;
            }
            if (!this.isLess(heap[smallestIndex], value)) {
                break;
            }
            path.push(smallestIndex);
            cursor = smallestIndex;
        }
        let hole = index;
        for (let pathIndex = 0; pathIndex < path.length; pathIndex++) {
            const childIndex = path[pathIndex];
            heap[hole] = heap[childIndex];
            hole = childIndex;
        }
        heap[hole] = value;
    }

    /**
     * 两侧都已按同一个比较函数排好。
     * 较大一侧留在前面，堆序仍然有效；只把较小一侧接到末尾再上浮。
     * 全量建堆要碰所有元素，上浮较短的一侧更短。
     */
    private mergeSameOrder(incoming: T[]): void {
        const current = this._heap;
        const currentSize = current.length;
        const incomingSize = incoming.length;
        if (currentSize === 0) {
            this._heap = incoming.slice();
            return;
        }
        let prefixSize = currentSize;
        const merged = currentSize >= incomingSize ? current.concat(incoming) : incoming.concat(current);
        if (currentSize < incomingSize) {
            prefixSize = incomingSize;
        }
        this._heap = merged;
        try {
            for (let index = prefixSize; index < this._heap.length; index++) {
                this.siftUp(index);
            }
        } catch (error) {
            this._heap = current;
            throw error;
        }
    }

    /** 下标必须是范围内的安全整数。小数会先向下取整。 */
    private normalizeIndex(index: number): number | undefined {
        if (typeof index !== "number" || !Number.isFinite(index)) {
            return undefined;
        }
        const normalized = Math.floor(index);
        if (!Number.isSafeInteger(normalized) || normalized < 0 || normalized >= this._heap.length) {
            return undefined;
        }
        return normalized;
    }

    private isAcceptable(value: T | null | undefined): value is T {
        if (value === undefined || value === null) {
            return false;
        }
        if (typeof value === "number" && !Number.isFinite(value)) {
            return false;
        }
        return true;
    }

    /** 比较结果不是有限数字时中断，避免 NaN 把堆序比乱。 */
    private isLess(a: T, b: T): boolean {
        const result = this._compare(a, b);
        if (typeof result !== "number" || !Number.isFinite(result)) {
            throw new Error("MinHeap 比较函数必须返回有限数字");
        }
        return result < 0;
    }
}
