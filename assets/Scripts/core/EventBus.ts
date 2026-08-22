export type EventCallback<T = unknown> = (data: T) => void;

export class EventBus {

    private listeners: Map<string, Set<EventCallback>> = new Map();

    public on<T>(
        event: string,
        callback: EventCallback<T>
    ): void {
        let callbacks = this.listeners.get(event);

        if (!callbacks) {
            callbacks = new Set<EventCallback>();
            this.listeners.set(event, callbacks);
        }

        callbacks.add(callback as EventCallback);
    }

    public off<T>(
        event: string,
        callback: EventCallback<T>
    ): void {
        const callbacks = this.listeners.get(event);

        if (!callbacks) {
            return;
        }

        callbacks.delete(callback as EventCallback);

        if (callbacks.size === 0) {
            this.listeners.delete(event);
        }
    }

    public emit<T>(
        event: string,
        data?: T
    ): void {
        const callbacks = this.listeners.get(event);

        if (!callbacks) {
            return;
        }

        for (const callback of callbacks) {
            callback(data);
        }
    }

    public clear(): void {
        this.listeners.clear();
    }

}

export const eventBus = new EventBus();
