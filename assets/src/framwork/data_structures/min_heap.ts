export default class MinHeap {
    private heap: number[] = [];

    get peek() {
        return this.heap[0];
    }
    get size() {
        return this.heap.length;
    }
    get isEmpty() {
        return this.size === 0;
    }

    constructor(array: number[]) {
        const heap: number[] = [];
        for (let i = 0; i < array.length; i++) {
            const value = array[i];
            if (Number.isNaN(value) || value === undefined || value === null) {
                continue;
            }
            heap.push(value);
        }
        this.heap = heap;
        this.buildHeap();
    }

    private buildHeap() {
        for (let i = Math.floor(this.heap.length / 2); i >= 0; i--) {
            this.siftDown(i);
        }
    }

    private parentIndex(index: number) {
        return Math.floor((index - 1) / 2);
    }

    private siftUp(index: number) {
        const heap = this.heap;
        const value = heap[index];
        while (index > 0) {
            const parentIndex = this.parentIndex(index);
            const parentValue = heap[parentIndex];
            if (!(value < parentValue)) break;
            // 父节点下移一格，上浮值留到循环结束后一次写入。
            heap[index] = parentValue;
            index = parentIndex;
        }
        heap[index] = value;
    }

    private siftDown(index: number) {
        if (index < 0) return;
        let len = this.heap.length;
        while (index < len) {
            let leftChildIndex = 2 * index + 1;
            let rightChildIndex = 2 * index + 2;
            if (leftChildIndex >= len) {
                return;
            }
            let smallestIndex = index;
            if (leftChildIndex < len && this.heap[leftChildIndex] < this.heap[smallestIndex]) {
                smallestIndex = leftChildIndex;
            }
            if (rightChildIndex < len && this.heap[rightChildIndex] < this.heap[smallestIndex]) {
                smallestIndex = rightChildIndex;
            }
            if (smallestIndex === index) return;
            [this.heap[index], this.heap[smallestIndex]] = [
                this.heap[smallestIndex],
                this.heap[index],
            ];
            index = smallestIndex;
        }
    }

    public push(value: number) {
        if (Number.isNaN(value) || value === undefined || value === null) return;
        this.heap.push(value);
        this.siftUp(this.heap.length - 1);
    }

    public pop() {
        if (this.isEmpty) return undefined;
        const value = this.heap[0];
        const end = this.heap.pop();
        if (this.size > 0) {
            this.heap[0] = end;
            this.siftDown(0);
        }
        return value;
    }

    public setKey(index: number, value: number) {
        if (index < 0 || index >= this.size) return;
        if (Number.isNaN(value) || value === undefined || value === null || Number.isNaN(index))
            return;
        index = Math.floor(index);
        let beforeValue = this.heap[index];
        this.heap[index] = value;
        if (beforeValue < value) {
            this.siftDown(index);
        } else {
            this.siftUp(index);
        }
    }

    public delete(index: number) {
        if (index < 0 || index >= this.size) return;
        if (Number.isNaN(index)) return;
        index = Math.floor(index);
        if (this.size === 1 || index === this.size - 1) {
            this.heap.pop();
            return;
        }
        let deletedValue = this.heap[index];
        let endValue = this.heap.pop();
        this.heap[index] = endValue;
        if (deletedValue < endValue) {
            this.siftDown(index);
        } else {
            this.siftUp(index);
        }
    }

    public merge(heap: MinHeap) {
        const incoming = heap.heap;
        const incomingSize = incoming.length;
        if (incomingSize === 0) return;

        const current = this.heap;
        const currentSize = current.length;
        // 空堆直接拿走对方的副本。对方已经满足堆序，不用再调整。
        if (currentSize === 0) {
            this.heap = incoming.slice();
            return;
        }

        // 写入入口已经排除 NaN，这里不再逐个判断。
        // 较大一侧保持为前缀，堆序仍然有效；只把较小一侧接到末尾再上浮。
        // 全量建堆要碰所有元素，上浮较短的一侧更短。
        let prefixSize = currentSize;
        if (currentSize >= incomingSize) {
            this.heap = current.concat(incoming);
        } else {
            this.heap = incoming.concat(current);
            prefixSize = incomingSize;
        }
        for (let i = prefixSize; i < this.heap.length; i++) {
            this.siftUp(i);
        }
    }
}
