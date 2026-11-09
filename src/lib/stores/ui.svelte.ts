/**
 * Transient app-chrome state (doc 13 §1–§2).
 *
 * Deliberately not persisted: doc 13 §2 says edit state is not remembered
 * between visits, and a drawer that reopens itself on load would be a bug.
 * It lives in a store rather than in a component because the top bar sits in
 * the layout and the grid sits in the page, and both need the same answer.
 */
class UiStore {
	#editMode = $state(false);
	#drawerOpen = $state(false);
	#shortcutsOpen = $state(false);
	/** The tile the Arrange dialog is moving (doc 13 §8), or null. */
	#arranging = $state<string | null>(null);

	get editMode(): boolean {
		return this.#editMode;
	}

	get drawerOpen(): boolean {
		return this.#drawerOpen;
	}

	get shortcutsOpen(): boolean {
		return this.#shortcutsOpen;
	}

	get arranging(): string | null {
		return this.#arranging;
	}

	toggleEdit(): void {
		this.#editMode = !this.#editMode;
		// Leaving edit mode with the drawer open would strand it over an inert
		// grid, where its Add buttons still work but nothing can be moved.
		if (!this.#editMode) {
			this.#drawerOpen = false;
			this.#arranging = null;
		}
	}

	/** doc 13 §4: the drawer is an edit-mode surface, so opening it enters. */
	openDrawer(): void {
		this.#editMode = true;
		this.#drawerOpen = true;
		this.#arranging = null;
	}

	closeDrawer(): void {
		this.#drawerOpen = false;
	}

	toggleShortcuts(): void {
		this.#shortcutsOpen = !this.#shortcutsOpen;
	}

	closeShortcuts(): void {
		this.#shortcutsOpen = false;
	}

	/** The Arrange button is an edit-mode control, so this only ever narrows. */
	startArranging(instanceId: string): void {
		if (!this.#editMode) return;
		this.#drawerOpen = false;
		this.#arranging = instanceId;
	}

	stopArranging(): void {
		this.#arranging = null;
	}

	/**
	 * doc 13 §8: Esc closes the topmost layer — the shortcuts sheet, the Arrange
	 * dialog, the drawer, then edit mode. Returns whether anything was actually
	 * closed, so a caller can let the key fall through when there was no layer
	 * to close.
	 *
	 * The Arrange dialog closes here rather than in a handler of its own: the
	 * layout's listener is on `window` and registered first, so a second
	 * listener could not stop it, and one Esc would close the dialog and leave
	 * edit mode as well.
	 */
	escape(): boolean {
		if (this.#shortcutsOpen) {
			this.#shortcutsOpen = false;
			return true;
		}
		if (this.#arranging !== null) {
			this.#arranging = null;
			return true;
		}
		if (this.#drawerOpen) {
			this.#drawerOpen = false;
			return true;
		}
		if (this.#editMode) {
			this.#editMode = false;
			return true;
		}
		return false;
	}

	/** Test seam. */
	reset(): void {
		this.#editMode = false;
		this.#drawerOpen = false;
		this.#shortcutsOpen = false;
		this.#arranging = null;
	}
}

export const ui = new UiStore();
