export function setInstance(ctor: any) {
    return new (class newCtor extends ctor {
        static _instance: InstanceType<typeof ctor>;
        static getInstance() {
            if (!this._instance) {
                this._instance = new newCtor();
            }
            return this._instance;
        }
    })();
}

export function Instance(target: any) {
    // setInstance 装饰后，导出的是实例，getInstance 在构造器上。
    // 已经是实例时直接返回，避免再调用不存在的实例方法。
    if (target && typeof target.getInstance === "function") {
        return target.getInstance();
    }
    return target;
}
