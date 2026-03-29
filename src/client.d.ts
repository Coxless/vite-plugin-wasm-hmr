declare module "virtual:wasm-hotreload" {
	/** Subscribe to WASM update events. Returns an unsubscribe function. */
	export function onUpdate(callback: (timestamp: number) => void): () => void;
}
