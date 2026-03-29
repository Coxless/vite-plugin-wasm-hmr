declare module "virtual:wasm-hmr" {
	/** Subscribe to WASM update events. Returns an unsubscribe function. */
	export function onUpdate(callback: (timestamp: number) => void): () => void;
}
