import { IdType } from "../id/id-define";
import { generateId } from "../id/id-generator";
import { TargetObserver } from "./target-observer";

interface PropertyAccessor {
    get?: (this: unknown) => unknown;
    set?: (this: unknown, value: unknown) => void;
}

/**
 * 给成对的 get/set 加变化通知。
 * 事件名是 `${Id}_${属性名}_change`，参数是写入前、写入后的值。
 * 子类覆盖 getIdType 决定 ID 的类型。
 */
export abstract class PropertyObserver extends TargetObserver {
    public constructor() {
        super();
        // 子类覆盖 getIdType 时这里能取到。不要在 getIdType 里读还没初始化的字段。
        this._id = generateId(this.getIdType());
        this._wrapPropertySetters();
    }

    /** 生成 ID 用的类型。更细的 idType 由子类补。 */
    protected abstract getIdType(): IdType;

    public get Id(): string {
        return this._id;
    }

    /**
     * 监听某个 get/set 属性的变化。
     * 事件名是 `${Id}_${属性名}_change`。值没变不会发。
     * beforeValue、afterValue 的类型就是该属性的类型。
     * 属性名用 keyof this，才能在子类的 this 上推出具体类型。
     * 没有成对 setter 的成员不会发事件，例如只读的 Id。
     */
    public on_change<Key extends keyof this & string>(
        propName: Key,
        listener: (beforeValue: this[Key], afterValue: this[Key]) => void
    ): void {
        this.on(this._changeEventName(propName), listener);
    }

    /**
     * 注销属性变化监听。
     * 传入 listener 时只移除这一条；不传则移除该属性的全部监听。
     */
    public off_change<Key extends keyof this & string>(
        propName: Key,
        listener?: (beforeValue: this[Key], afterValue: this[Key]) => void
    ): void {
        this.off(this._changeEventName(propName), listener);
    }

    /** `${id}_${属性名}_change` */
    private _changeEventName(propName: string): string {
        return `${this._id}_${propName}_change`;
    }

    /**
     * 沿原型链收集成对的 get/set，并在实例上包一层。
     * 同一属性只包最外层的 getter 和 setter，原型上的访问器留给 super.xxx。
     * 比较的是写入前后 getter 读到的值，值相同不发事件。
     * setter 重入时合并成一次，派发最外层看到的旧值和最终新值。
     * 直接改底层字段不会经过这里。
     */
    private _wrapPropertySetters(): void {
        const accessors = new Map<string, PropertyAccessor>();
        let proto = Object.getPrototypeOf(this) as object | null;
        while (proto && proto !== Object.prototype && proto !== TargetObserver.prototype) {
            const propNames = Object.getOwnPropertyNames(proto);
            for (let index = 0; index < propNames.length; index++) {
                const propName = propNames[index];
                const descriptor = Object.getOwnPropertyDescriptor(proto, propName);
                if (!descriptor) {
                    continue;
                }
                let accessor = accessors.get(propName);
                if (!accessor) {
                    accessor = {};
                    accessors.set(propName, accessor);
                }
                // 从派生类往基类走，先遇到的就是最外层，不能被父类覆盖。
                if (!accessor.get && typeof descriptor.get === "function") {
                    accessor.get = descriptor.get as PropertyAccessor["get"];
                }
                if (!accessor.set && typeof descriptor.set === "function") {
                    accessor.set = descriptor.set as PropertyAccessor["set"];
                }
            }
            proto = Object.getPrototypeOf(proto);
        }

        const host = this;
        const propNames = Array.from(accessors.keys());
        for (let index = 0; index < propNames.length; index++) {
            const propName = propNames[index];
            const accessor = accessors.get(propName);
            const originalGet = accessor?.get;
            const originalSet = accessor?.set;
            if (!originalGet || !originalSet) {
                continue;
            }
            // 每个属性单独记重入。监听回调里再改同一个属性，算下一次变化。
            let depth = 0;
            let beforeValue: unknown = undefined;
            const set = (value: unknown) => {
                if (depth === 0) {
                    beforeValue = originalGet.call(host);
                }
                depth += 1;
                try {
                    originalSet.call(host, value);
                } finally {
                    depth -= 1;
                }
                if (depth !== 0) {
                    return;
                }
                const afterValue = originalGet.call(host);
                if (Object.is(beforeValue, afterValue)) {
                    return;
                }
                host.emit(host._changeEventName(propName), beforeValue, afterValue);
            };
            Object.defineProperty(host, propName, {
                configurable: true,
                enumerable: false,
                get() {
                    return originalGet.call(host);
                },
                set,
            });
        }
    }
}
