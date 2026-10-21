import MinHeap from "../framwork/data_structures/min_heap";
import { EventBase } from "./event-base";

export class EventSequence {
    private _events: MinHeap<EventBase>[] = [];
}
