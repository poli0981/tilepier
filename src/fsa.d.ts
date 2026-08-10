/**
 * File System Access additions that TypeScript's `lib.dom` does not yet carry.
 *
 * `showDirectoryPicker`, `queryPermission` and `requestPermission` are the
 * three pieces doc 09 §2's path A is built on, and all three are missing from
 * the shipped DOM lib. Declaring them here keeps the call sites honest — the
 * alternative is `as any` at four places, which would also silence a genuine
 * mistake.
 *
 * They are Chromium-only, so every use is behind a feature check
 * (`supportsFsa()` / `typeof handle.queryPermission === 'function'`).
 */

type TpFsaPermissionState = 'granted' | 'denied' | 'prompt';

interface TpFsaPermissionDescriptor {
	mode?: 'read' | 'readwrite';
}

interface FileSystemHandle {
	queryPermission?(descriptor?: TpFsaPermissionDescriptor): Promise<TpFsaPermissionState>;
	requestPermission?(descriptor?: TpFsaPermissionDescriptor): Promise<TpFsaPermissionState>;
}

interface DirectoryPickerOptions {
	id?: string;
	mode?: 'read' | 'readwrite';
	startIn?: FileSystemHandle | string;
}

interface Window {
	showDirectoryPicker?(options?: DirectoryPickerOptions): Promise<FileSystemDirectoryHandle>;
}
