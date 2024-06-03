import Keyv from "keyv";
import { LoggerBuilder, chalk } from "@made-simple/logging";

/**
 * Wrapper for Keyv SQLite databases.
 *
 * ```js
 * const store = new Store("db/store");
 * store.set("key", "value");
 * store.get("key"); // "value"
 * ```
 */
export default class Store<T extends {} = {}> {
    protected readonly cleanUri: string;
    protected readonly inDevMode: boolean = false;
    readonly uri: string;
    protected keyv: Keyv | null = null;
    protected store: T = {} as T;
    protected logger = new LoggerBuilder("store", chalk.magentaBright);
    private connected_: boolean = false;

    get internalStore(): T {
        return this.store;
    }

    get connected(): boolean {
        return this.connected_ && this.keyv !== null;
    }

    /**
     * Creates an instance of Store.
     * @param {string} uri The URI of the database.
     * @param {boolean} clean Whether to clear the database. Optional.
     * 
     * ```js
     * const store = new Store("db/store");
     * ```
     */
    constructor(uri: string, clean?: boolean, logger?: LoggerBuilder) {
        if (!uri.endsWith(".sqlite")) uri += ".sqlite";
        if (!uri.startsWith("sqlite://")) uri = "sqlite://" + uri;
        this.cleanUri = uri.slice(9, -7);
        this.uri = uri;

        if (logger) this.logger = logger;

        if (process.env.NODE_ENV === "development") {
            this.inDevMode = true;
            this.logger.warn(`Loading %s in development mode. Data will be fetched once but not updated.`, chalk.bold(this.cleanUri))
        }

        this.connect();
        if (clean) this.clear();
    }

    /**
     * Adds a listener to the database.
     * Returns `undefined` if the database is not connected.
     * @param {string | symbol} event The event to listen to.
     * @param {(...args: any[]) => void} listener The listener to add.
     * 
     * ```js
     * store.addListener("error", console.error);
     * ```
     */
    addListener(event: string | symbol, listener: (...args: any[]) => void): true | undefined {
        if (!this.connected) return undefined;
        this.keyv!.addListener(event, listener);
        return true;
    }

    /**
     * Connects to the database.
     *
     * ```js
     * this.connect();
     * ```
     */
    protected async connect(): Promise<void> {
        this.keyv = new Keyv(this.uri);
        this.logger.debug("Connected to", chalk.bold(this.cleanUri));

        this.addListener("error", (error: Error) => {
            this.logger.error(`Error in %s: %s`, chalk.bold(this.cleanUri), error.message);
        });

        const data = await this.keyv.get("store") ?? {};
        this.connected_ = true;
        this.store = data;
    }

    /**
     * Reconnects to the database if disconnected.
     *
     * ```js
     * store.reconnect();
     * ```
     */
    reconnect(): true {
        if (this.connected) return true;
        this.logger.debug("Reconnecting to", chalk.bold(this.cleanUri));
        this.connect();

        return true;
    }

    /**
     * Disconnects from the database.
     * Returns `undefined` if the database is already disconnected.
     *
     * ```js
     * store.disconnect(); // true
     * store.disconnect(); // undefined
     * ```
     */
    disconnect(): true | undefined {
        if (!this.connected) return undefined;
        this.keyv!.disconnect().finally(() => {
            this.logger.debug("Disconnected from", chalk.bold(this.cleanUri));
            this.store = {} as T;
            this.connected_ = false;
        });

        this.keyv = null;
        return true;
    }

    /**
     * Reconciles the database with a template.
     * Returns `undefined` if the database is not connected.
     * If the operation fails, the database is reverted and `false` is returned.
     * @param {T} template The template to reconcile with.
     *
     * ```js
     * store.reconcile({ key: "value" });
     * store.get("key"); // "value"
     * ```
     */
    reconcile(template: T): boolean | undefined {
        if (!this.connected) return undefined;
        this.logger.debug("Reconciling %s with template", chalk.bold(this.cleanUri));

        const before = { ...this.store };
        for (const key in template) {
            if (!this.has(key)) this.store[key] = template[key];
        }

        return this.update(before, "reconcile");
    }

    /**
     * Clears the database.
     * Returns `undefined` if the database is not connected.
     * If the operation fails, the database is reverted and `false` is returned.
     *
     * ```js
     * store.clear();
     * ```
     */
    clear(): boolean | undefined {
        if (!this.connected) return undefined;
        this.logger.debug("Clearing", chalk.bold(this.cleanUri));

        const before = { ...this.store };
        this.store = {} as T;
        return this.update(before, "clear");
    }

    /**
     * Deletes a key from the database.
     * Returns `undefined` if the database is not connected.
     * Returns `null` if the key does not exist.
     * If the operation fails, the database is reverted and `false` is returned.
     * @param {string} key The key to delete.
     *
     * ```js
     * store.delete("key");
     * store.get("key"); // null
     * store.delete("key"); // null
     * ```
     */
    delete(key: string): boolean | null | undefined {
        if (!this.connected) return undefined;
        if (!this.has(key)) return null;

        const before = { ...this.store };
        delete this.store[key];
        return this.update(before);
    }

    /**
     * Gets a value from the database.
     * If a fallback is provided, it will be set in the database and returned.
     * If setting the fallback fails, the database is reverted and `null` is returned as if the fallback was never provided.
     * Returns `undefined` if the database is not connected.
     * Returns `null` if the key does not exist and no fallback is provided.
     * @param {string} key The key to get.
     * @param {T} fallback The fallback value to use. Optional.
     *
     * ```js
     * store.get("key"); // null
     * store.get("key", "value"); // "value"
     * store.get("key"); // "value"
     * ```
     */
    get<T extends unknown>(key: string, fallback?: T): T | null | undefined {
        if (!this.connected) return undefined;
        if (!this.has(key)) {
            if (fallback === undefined) return null;
            if (this.set(key, fallback) === false) return null;
        }

        return this.store[key] as T;
    }

    /**
     * Checks if a key exists in the database.
     * Returns `undefined` if the database is not connected.
     * @param {string} key The key to check.
     *
     * ```js
     * store.has("key"); // false
     * store.set("key", "value");
     * store.has("key"); // true
     * ```
     */
    has(key: string): boolean | undefined {
        if (!this.connected) return undefined;
        return key in this.store;
    }

    /**
     * Sets a value in the database.
     * Returns `undefined` if the database is not connected.
     * If the operation fails, the database is reverted and `false` is returned.
     * @param {string} key The key to set.
     * @param {T} value The value to set.
     *
     * ```js
     * store.set("key", "value");
     * store.get("key"); // "value"
     * ```
     */
    set<T extends unknown>(key: string, value: T): boolean | undefined {
        if (!this.connected) return undefined;

        const before = { ...this.store };
        this.store[key] = value;
        return this.update(before);
    }

    /**
     * Copies a key from another Store.
     * If a fallback is provided, it will be set in the database and returned.
     * Returns `undefined` if either database is not connected.
     * Returns `null` if the key does not exist in the other Store.
     * If the operation fails, the database is reverted and `false` is returned.
     * @param {Store<Y>} store The Store to copy from.
     * @param {string} key The key to copy.
     * @param {Z} fallback The fallback value to use. Optional.
     *
     * ```js
     * store2.set("key", "value");
     * store.copyKey(store2, "key"); // true
     * store.get("key"); // "value"
     * ```
     */
    copyKey<Z extends unknown, Y extends {} = {}>(store: Store<Y>, key: string, fallback?: Z): boolean | null | undefined {
        if (!this.connected || !store.connected) return undefined;

        const value = store.get(key, fallback);
        if (value === null) return null;
        return this.set(key, value as unknown as T[keyof T]);
    }

    /**
     * Copies all keys from another Store.
     * Returns `undefined` if either database is not connected.
     * If the operation fails, the database is reverted and `false` is returned.
     * @param {Store<Y>} store The Store to copy from.
     * @param {boolean} clean Whether to clear the database before copying. Optional.
     *
     * ```js
     * store2.set("key", "value");
     * store.copyFrom(store2);
     * store.get("key"); // "value"
     * ```
     */
    copyFrom<Y extends {} = {}>(store: Store<Y>, clean?: boolean): boolean | undefined {
        if (!this.connected || !store.connected) return undefined;

        const before = { ...this.store };
        if (clean) this.store = {} as T;
        for (const key in store.internalStore) {
            this.store[key as string] = store.internalStore[key];
        }

        return this.update(before, "copyFrom");
    }

    /**
     * Updates the database. Primarily used internally.
     * Returns `undefined` if the database is not connected.
     * If the operation fails, the database is reverted and `false` is returned.
     * @param {T} before The state of the database before the update. Optional.
     *
     * ```js
     * store.store = { key: "value" };
     * store.update();
     * ```
     */
    protected update(before?: T, action?: string): boolean | undefined {
        if (!this.connected) return undefined;
        if (this.inDevMode) return true;
        let failed = false;

        this.keyv!.set("store", this.store).catch(() => {
            if (action) this.logger.error("Failed to execute %s on %s", action, chalk.bold(this.cleanUri));
            if (before) {
                if (action) this.logger.warn("Reverting to state before %s", action);
                this.store = before;
            }

            failed = true;
        });

        return !failed;
    }

    /**
     * Sets the logger for the Store.
     * 
     * ```js
     * const logger = new LoggerBuilder("MyStore", chalk.red);
     * store.setLogger(logger);
     * ```
     */
    setLogger(logger: LoggerBuilder): void {
        this.logger = logger;
    }
}
