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

export function Instance(ctor: any) {
    return ctor.getInstance();
}
