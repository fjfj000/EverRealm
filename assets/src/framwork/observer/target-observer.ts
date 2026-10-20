type AnyListener = (...args: any[]) => void;

/** `listen_xxx` 中下划线后面的部分就是事件名，空名字不算事件。 */
type ListenEventName<Name> = Name extends `listen_${infer EventName}` ? (EventName extends "" ? never : EventName) : never;

/**
 * 每个 listen_xxx 方法对应一个事件，回调参数就是该方法的参数列表。
 * 事件名和参数从子类实例的实际类型推出来。
 */
export type ListenEventMap<Target> = {
    [MethodName in keyof Target as ListenEventName<MethodName>]: Target[MethodName] extends (...args: infer Args) => unknown ? Args : never;
};

type ListenHost = Record<string, (...args: unknown[]) => unknown>;

/**
 * 泛型事件名要等调用处写死之后，参数元组才能展开。
 * 条件类型把这次展开推迟到那一步。
 */
type ListenHandler<Target, EventName extends keyof ListenEventMap<Target>> = ListenEventMap<Target>[EventName] extends infer Args
    ? Args extends any[]
        ? (...args: Args) => void
        : never
    : never;

/**
 * 子类写 `listen_xxx(...)` 即声明事件 `xxx`。
 * 调用该方法时，先执行方法体，再把同一组参数派发出去。
 * auto_on / auto_off 带事件名和参数提示；on / off / emit 处理任意普通事件。
 */
export class TargetObserver {
    /** 按事件名保存监听函数。auto 事件和普通事件共用这张表。 */
    private _listener: Map<string, Set<AnyListener>> = new Map();

    public constructor() {
        this._wrapListenMethods();
    }

    /** 监听任意普通事件。 */
    public on(eventName: string, listener: AnyListener): void {
        this._addListener(eventName, listener);
    }

    /**
     * 注销普通事件。
     * 传入 listener 时只移除这一条；不传则移除该事件的全部监听。
     */
    public off(eventName: string, listener?: AnyListener): void {
        this._removeListener(eventName, listener);
    }

    /** 派发普通事件，参数原样交给 on 注册的回调。 */
    public emit(eventName: string, ...args: any[]): void {
        this._dispatch(eventName, args);
    }

    /** 监听 listen_xxx 对应的 xxx 事件，事件名和回调参数有类型提示。 */
    public auto_on<EventName extends keyof ListenEventMap<this> & string>(
        eventName: EventName,
        listener: ListenHandler<this, EventName>,
    ): void {
        this._addListener(eventName, listener as AnyListener);
    }

    /**
     * 注销 listen_xxx 对应的事件。
     * 传入 listener 时只移除这一条；不传则移除该事件的全部监听。
     */
    public auto_off<EventName extends keyof ListenEventMap<this> & string>(
        eventName: EventName,
        listener?: ListenHandler<this, EventName>,
    ): void {
        this._removeListener(eventName, listener as AnyListener | undefined);
    }

    /**
     * 沿原型链识别 listen_xxx，并在实例上换成包装函数。
     * 同名方法只包装最外层，一次调用只派发一次。
     * 识别的是原型上的普通方法。
     */
    private _wrapListenMethods(): void {
        const wrappedNames = new Set<string>();
        const host = this;
        let proto = Object.getPrototypeOf(this) as object | null;
        while (proto && proto !== Object.prototype) {
            const methodNames = Object.getOwnPropertyNames(proto);
            for (let index = 0; index < methodNames.length; index++) {
                const methodName = methodNames[index];
                if (wrappedNames.has(methodName) || !isListenMethodName(methodName)) {
                    continue;
                }
                const descriptor = Object.getOwnPropertyDescriptor(proto, methodName);
                const original = descriptor?.value;
                if (typeof original !== "function") {
                    continue;
                }
                wrappedNames.add(methodName);
                const eventName = methodName.slice("listen_".length);
                // 包在实例上，原型方法仍留给 super.xxx() 调用，避免再进一层包装。
                const wrapped = (...args: unknown[]) => {
                    const result = original.apply(host, args);
                    host._dispatch(eventName, args);
                    return result;
                };
                (host as unknown as ListenHost)[methodName] = wrapped;
            }
            if (proto === TargetObserver.prototype) {
                break;
            }
            proto = Object.getPrototypeOf(proto);
        }
    }

    private _addListener(eventName: string, listener: AnyListener): void {
        let handlers = this._listener.get(eventName);
        if (!handlers) {
            handlers = new Set();
            this._listener.set(eventName, handlers);
        }
        handlers.add(listener);
    }

    private _removeListener(eventName: string, listener?: AnyListener): void {
        const handlers = this._listener.get(eventName);
        if (!handlers) {
            return;
        }
        if (!listener) {
            this._listener.delete(eventName);
            return;
        }
        handlers.delete(listener);
        if (handlers.size === 0) {
            this._listener.delete(eventName);
        }
    }

    /** 按注册顺序同步回调。先拷贝，避免回调里 off 打乱本次派发。 */
    private _dispatch(eventName: string, args: unknown[]): void {
        const handlers = this._listener.get(eventName);
        if (!handlers || handlers.size === 0) {
            return;
        }
        const snapshot = Array.from(handlers);
        for (let index = 0; index < snapshot.length; index++) {
            snapshot[index](...args);
        }
    }
}

function isListenMethodName(methodName: string): boolean {
    return methodName.startsWith("listen_") && methodName.length > "listen_".length;
}
