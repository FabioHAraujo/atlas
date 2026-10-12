/** Thrown by importers only when the input holds nothing usable. */
export class ThemeImportError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ThemeImportError";
	}
}
