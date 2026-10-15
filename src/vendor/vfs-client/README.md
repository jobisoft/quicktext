# VFS-Toolkit Client API

---

## Usage

```js
import * as vfs from '/vendor/vfs-toolkit/vfs-client/vfs-client.mjs';
```

## Picker UI features

The same picker UI is shared by all three picker functions. Behaviour adapts to the mode:

- **Select mode** (`showSelectFilePicker`): select one or more files, **Select File** / **Select Files** button
- **Save mode** (`showSaveFilePicker`): navigate to a folder and type a filename, **Save** button
- **Directory mode** (`showDirectoryPicker`): click a folder to select it, **Select Folder** button enabled only when exactly one folder is selected

Common features:

- Navigate into folders (double-click or breadcrumb)
- `..` entry to go up one level (double-click)
- Preview panel for selected files (images, audio, video, text/code, HTML rendered in sandboxed iframe)
- Files > 5 MB: preview skipped by default, with a "Preview anyway" button
- Create folders, add local files (toolbar button only enabled when provider supports it)
- **Multi-select:** Ctrl/Cmd+click to toggle, Shift+click for range, Ctrl+A to select all
- Rename, cut, copy, paste, move, delete - all supporting single and multi-select
- **Save as:** download a file to the local filesystem (right-click → "Save as…"). Requires the `downloads` permission.
- Provider dropdown in the location bar when multiple providers are available
- File type filter dropdown and filename filter input in the toolbar
- Storage usage shown in the footer
- Toolbar buttons and context menu items disabled automatically based on provider capabilities
- Progress bar with file counter for batch operations; **✕ cancel button** to abort mid-operation
- Dark mode support
- Localisation via `locales/<lang>.json`, falls back to `en`
- Keyboard shortcuts:

| Key | Action |
|-----|--------|
| Arrow Up / Down | Move selection |
| Enter | Open folder / confirm file selection |
| Backspace / Arrow Left | Go up one directory |
| F2 | Rename selected item |
| Delete | Delete selected item(s) |
| Ctrl+A | Select all |
| Ctrl+X | Cut selected item(s) |
| Ctrl+C | Copy selected item(s) |
| Ctrl+V | Paste |

---

## API Reference

All paths are absolute strings starting with `/`. The root is `/`.
Examples: `"/"`, `"/documents"`, `"/documents/notes.txt"`

### Functions


#### `vfs.init(options?)`

Initialises vfs-toolkit. Call **once from your background script** before using any
other vfs-toolkit API.

Always sets up the storage-change relay so that `vfs.onStorageChanged` listeners work
in all extension pages (including the picker). Pass `enableExternalProviders: true` to
additionally enable support for external storage backend providers.

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enableExternalProviders` | `boolean` | `false` | Enable external provider support. Requires the `management` and `storage` permissions. |
| `configStorageKey` | `string` | — | Storage key for persisting provider connection data. Required when `enableExternalProviders` is `true`. |

**Example — OPFS only (background script):**

```js
import * as vfs from '/vendor/vfs-toolkit/vfs-client/vfs-client.mjs';
vfs.init();
```

**Example — with external providers (background script):**

```js
import * as vfs from '/vendor/vfs-toolkit/vfs-client/vfs-client.mjs';
vfs.init({ enableExternalProviders: true, configStorageKey: "vfs-toolkit-config-data" });
```

---

#### `vfs.parseManifest(manifest)`

Parses a partial manifest, used to register a toolbar action button that appears in every picker popup opened by the extension. Call **once from your background script**.

**Note:** While the VFS Toolkit is still a vendored module, the parsed manifest only affects pickers opened by the local extension, not *all* pickers. This will change when the VFS Toolkit is merged into Thunderbird as an
official API.

Accepts an object with a `vfs_action` key, modelled on the standard WebExtension `message_display_action`. Supported fields:

| Field | Type | Description |
|-------|------|-------------|
| `default_label` | `string` | Button label shown in the toolbar. Takes precedence over `default_title`. |
| `default_title` | `string` | Fallback label / tooltip text when `default_label` is not set. |
| `default_icon` | `string` | URL of the button icon. Use `browser.runtime.getURL(...)` to reference a bundled asset. When provided the icon is shown instead of the label text, with the label used as `alt`/`title`. |

When the button is clicked in the picker, `vfs.action.onClicked` listeners are fired with the currently active [`StorageRef`](#storageref) (or `null` for OPFS).

**Example (background script):**

```js
vfs.parseManifest({
  vfs_action: {
    default_label: "Run Tests",
    default_title: "Open the VFS test suite",
    default_icon: browser.runtime.getURL("icons/run-tests.svg"),
  }
});
```

---

#### `vfs.action.onClicked`

Event fired when the action button registered via `parseManifest` is clicked in the picker toolbar. Follows the standard WebExtension event shape.

| Method | Description |
|--------|-------------|
| `addListener(listener)` | Register a listener. `listener` receives the active [`StorageRef`](#storageref) (or `null` for OPFS). |
| `hasListener(listener)` | Returns `true` if the listener is currently registered. |
| `removeListener(listener)` | Unregisters the listener. |

**Example:**

```js
vfs.action.onClicked.addListener((storageRef) => {
  const url = '/test/test.html' +
    (storageRef ? '?storageRef=' + encodeURIComponent(JSON.stringify(storageRef)) : '');
  browser.tabs.create({ url });
});
```

---

#### `vfs.showSelectFilePicker(options?)` → `Promise<Array<Entry>>`

Opens a file picker popup to select one or more files. Always resolves with [`Array<Entry>`](#entry), empty if cancelled. When `multiple: false` (default), the array contains at most one entry.

The picker always supports multi-selecting files for management (copy, move, delete). The `multiple` option only controls whether the **Select** button can confirm a multi-file result.

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `types` | [`Array<PickerFileType>`](#pickerfiletype) | `null` | File type filter entries. Adds a type dropdown to the toolbar. |
| `excludeAcceptAllOption` | `boolean` | `false` | Omit the "All files" option from the type dropdown and pre-select the first type. |
| `storageRef` | [`StorageRef`](#storageref) | `null` | Open the picker pre-set to this connection. Ignored when `id` has saved state — unless `lockStorage` is set, in which case the lock wins over the saved state. |
| `lockStorage` | `'strict' \| 'soft'` | `null` | Restrict the picker to the connection given by `storageRef`. `'strict'` hides the provider selector entirely. `'soft'` keeps the selector interactive (useful for copying between connections) but disables the **Select** button while the active connection does not match. If the locked connection is unavailable, the picker still opens but stays in a disabled error state. Requires `storageRef`; otherwise ignored. |
| `id` | `string` | `null` | Picker context ID. Remembers the last-used directory and connection (`storageRef`); both are restored on the next open, overriding `startIn` and `storageRef`. |
| `startIn` | `string` | `null` | Absolute path to open in initially. Ignored when `id` has saved state. |
| `multiple` | `boolean` | `false` | Allow confirming multiple files at once. |
| `opfsStorageName` | `string` | - | Display name for the `OPFS` backend. |
| `width` | `number` | `800` | Popup width in pixels |
| `height` | `number` | `600` | Popup height in pixels |

**Example:**

```js
const [result] = await vfs.showSelectFilePicker();
if (result) await vfs.readFile(result);

const results = await vfs.showSelectFilePicker({ multiple: true });

const [result] = await vfs.showSelectFilePicker({
  storageRef: {
    providerId: 'my-addon@example.com',
    storageId: 'my-storage-id'
  },
  types: [{ description: 'Images', accept: { 'image/*': ['.png', '.jpg'] } }],
});
```

---

#### `vfs.showSaveFilePicker(options?)` → `Promise<Entry | null>`

Opens a save file picker popup. The user can navigate to a folder and type (or edits) a filename. Returns a single `Entry` pointing to that file, or `null` if cancelled.

**Note**: The picker does not create the file!

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `types` | [`Array<PickerFileType>`](#pickerfiletype) | `null` | File type filter entries. Adds a type dropdown to the toolbar. |
| `excludeAcceptAllOption` | `boolean` | `false` | Omit the "All files" option from the type dropdown and pre-select the first type. |
| `storageRef` | [`StorageRef`](#storageref) | `null` | Open the picker pre-set to this connection. Ignored when `id` has saved state — unless `lockStorage` is set, in which case the lock wins over the saved state. |
| `lockStorage` | `'strict' \| 'soft'` | `null` | Restrict the picker to the connection given by `storageRef`. See `showSelectFilePicker` for semantics. Requires `storageRef`. |
| `id` | `string` | `null` | Picker context ID. Remembers the last-used directory and connection (`storageRef`); both are restored on the next open, overriding `startIn` and `storageRef`. |
| `startIn` | `string` | `null` | Absolute path to open in initially. Ignored when `id` has saved state. |
| `suggestedName` | `string` | - | Pre-filled filename in the save input |
| `opfsStorageName` | `string` | - | Display name for the `OPFS` backend. |
| `width` | `number` | `800` | Popup width in pixels |
| `height` | `number` | `600` | Popup height in pixels |

**Example:**

```js
const result = await vfs.showSaveFilePicker({ suggestedName: 'export.csv' });
if (result) await vfs.writeFile(result, csvBlob);
```

---

#### `vfs.showDirectoryPicker(options?)` → `Promise<Entry | null>`

Opens a directory picker popup. The user can navigate to and select a folder. Returns a single `Entry` pointing to that folder, or `null` if cancelled.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `storageRef` | [`StorageRef`](#storageref) | `null` | Open the picker pre-set to this connection. Ignored when `id` has saved state — unless `lockStorage` is set, in which case the lock wins over the saved state. |
| `lockStorage` | `'strict' \| 'soft'` | `null` | Restrict the picker to the connection given by `storageRef`. See `showSelectFilePicker` for semantics. Requires `storageRef`. |
| `id` | `string` | `null` | Picker context ID (remembers last-used directory and connection) |
| `startIn` | `string` | `null` | Absolute path to open in initially |
| `opfsStorageName` | `string` | - | Display name for the `OPFS` backend. |
| `width` | `number` | `800` | Popup width in pixels |
| `height` | `number` | `600` | Popup height in pixels |

**Example:**

```js
const dir = await vfs.showDirectoryPicker();
if (dir) await vfs.list(dir);
```

---

#### `vfs.fetchProviderConnections()` → `Promise<Array<{providerId, name, connections}>>`

Fetch all known providers and their established connections. Each entry in the returned array represents one installed provider. Connections is empty when no connections have been set up yet for that provider.

**Provider entry:**

| Field | Type | Description |
|-------|------|-------------|
| `providerId` | `string` | Extension ID of the provider |
| `name` | `string` | Human-readable provider name |
| `icon` | `Blob\|null` | Provider icon blob, or `null` if not available |
| `hasConfig` | `boolean` | Whether the provider has a config page (opened via `vfs.openProviderConfig`) |
| `connections` | `Array` | Established connections for this provider (see below) |

**Connection entry** (within `connections`):

| Field | Type | Description |
|-------|------|-------------|
| `storageRef` | [`StorageRef`](#storageref) | Identifies the provider and specific storage slot |
| `name` | `string` | Human-readable name for this connection (set by the provider's setup page) |
| `capabilities` | `object` | `{ file: {...}, folder: {...} }` — see [Capabilities](#capabilities) |

---

#### `vfs.onStorageChanged`

Event fired when storage contents change. Follows the standard WebExtension event shape. Requires `vfs.init()` to have been called in the background script. Listeners receive an array of [`StorageChangeEntry`](#onstoragechange) objects.

| Method | Description |
|--------|-------------|
| `addListener(listener)` | Register a listener |
| `hasListener(listener)` | Returns `true` if the listener is currently registered |
| `removeListener(listener)` | Unregisters the listener |

```js
function onChanged(entries) {
  for (const { kind, action, target, source } of entries) {
    console.log(`${action} ${kind} ${target.path} on`, target.storageRef?.providerId ?? 'OPFS');
    if (source) console.log('  from', source.path, 'on', source.storageRef?.providerId ?? 'OPFS');
  }
}
vfs.onStorageChanged.addListener(onChanged);
// To unsubscribe:
vfs.onStorageChanged.removeListener(onChanged);
```


---

#### `vfs.list(entry?, options?)` → [`Promise<Array<Entry>>`](#entry)

Lists the contents of a directory. Returns [`Array<Entry>`](#entry) with sorted folders-first, then alphabetically within each group.

| Parameter | Type | Description |
|-----------|------|-------------|
| `entry` | [`Entry`](#entry) | Directory to list. Defaults to the root of the `OPFS` storage backend. |

| Option | Type | Description |
|--------|------|-------------|
| `onProgress` | [`OnProgress`](#onprogress) | Progress callback |

**Example:**

```js
// List OPFS root
const entries = await vfs.list({ path: '/documents' });
// [
//   { name: 'subfolder', path: '/documents/subfolder', kind: 'directory', storageRef: null },
//   { name: 'notes.txt', path: '/documents/notes.txt', kind: 'file', size: 42, lastModified: 1700000000000, storageRef: null },
// ]

// List a specific external provider connection (storageRef comes from fetchProviderConnections or a picker result)
const entries = await vfs.list({ path: '/', storageRef });
```

---

#### `vfs.readFile(entry, options?)` → `Promise<File>`

Reads a file and returns a [`File`](https://developer.mozilla.org/en-US/docs/Web/API/File) object.

| Parameter | Type | Description |
|-----------|------|-------------|
| `entry` | [`Entry`](#entry) | File to read |

| Option | Type | Description |
|--------|------|-------------|
| `onProgress` | [`OnProgress`](#onprogress) | Progress callback |

**Example:**

```js
const file = await vfs.readFile({ path: '/documents/notes.txt' });
const text = await file.text();
```

---

#### `vfs.writeFile(entry, fileOrBlob, options?)` → `Promise<void>`

Writes a `File` or `Blob`. Creates intermediate directories as needed.

| Parameter | Type | Description |
|-----------|------|-------------|
| `entry` | [`Entry`](#entry) | Destination path and provider |
| `fileOrBlob` | `File\|Blob` | Data to write |

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `overwrite` | `boolean` | `false` | **Throws** if the target file exists already and `overwrite` is `false` |
| `onProgress` | [`OnProgress`](#onprogress) | - | Progress callback |

**Example:**

```js
await vfs.writeFile({ path: '/documents/notes.txt' }, new Blob(['hello'], { type: 'text/plain' }));
await vfs.writeFile({ path: '/uploads/photo.png' }, imageBlob, { overwrite: false });
```

---

#### `vfs.moveFile(from, to, options?)` → `Promise<void>`

Moves or renames a file. Supports cross-provider moves.

| Parameter | Type | Description |
|-----------|------|-------------|
| `from` | [`Entry`](#entry) | Source file |
| `to` | [`Entry`](#entry) \| `string` | Destination file, or a plain path string (same provider as `from`) |

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `overwrite` | `boolean` | `false` | **Throws** if the target file exists already and `overwrite` is `false` |
| `onProgress` | [`OnProgress`](#onprogress) | - | Progress callback |

**Example:**

```js
// Plain path string (same provider as `from` — legacy form, still supported)
await vfs.moveFile({ path: '/draft.txt' }, '/documents/final.txt');

// Entry object — same provider
await vfs.moveFile({ path: '/draft.txt' }, { path: '/documents/final.txt' });

// Entry object — cross-provider move
await vfs.moveFile(
  { path: '/file.txt', storageRef: providerA },
  { path: '/file.txt', storageRef: providerB },
);
```

---

#### `vfs.copyFile(from, to, options?)` → `Promise<void>`

Copies a file. Supports cross-provider copies.

| Parameter | Type | Description |
|-----------|------|-------------|
| `from` | [`Entry`](#entry) | Source file |
| `to` | [`Entry`](#entry) \| `string` | Destination file, or a plain path string (same provider as `from`) |

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `overwrite` | `boolean` | `false` | **Throws** if target file exists already and `overwrite` is `false` |
| `onProgress` | [`OnProgress`](#onprogress) | - | Progress callback |

**Example:**

```js
// Plain path string (legacy form, still supported)
await vfs.copyFile({ path: '/documents/notes.txt' }, '/documents/notes-backup.txt');

// Entry object
await vfs.copyFile({ path: '/documents/notes.txt' }, { path: '/documents/notes-backup.txt' });
```

---

#### `vfs.deleteFile(entry, options?)` → `Promise<void>`

Deletes a file. **Silent** if the file does not exist.

| Parameter | Type | Description |
|-----------|------|-------------|
| `entry` | [`Entry`](#entry) | File to delete |

| Option | Type | Description |
|--------|------|-------------|
| `onProgress` | [`OnProgress`](#onprogress) | Progress callback |

**Example:**

```js
await vfs.deleteFile({ path: '/documents/notes.txt' });
```

---

#### `vfs.addFolder(entry, options?)` → `Promise<void>`

Creates a folder and all intermediate folders. **Throws** an `E:EXIST` error if the folder already exists.

| Parameter | Type | Description |
|-----------|------|-------------|
| `entry` | [`Entry`](#entry) | Folder to create |

| Option | Type | Description |
|--------|------|-------------|
| `onProgress` | [`OnProgress`](#onprogress) | Progress callback — fires once per path segment created |

**Example:**

```js
await vfs.addFolder({ path: '/documents/archive/2024' });
```

---

#### `vfs.moveFolder(from, to, options?)` → `Promise<void>`

Moves or renames a folder. Supports cross-provider moves.

| Parameter | Type | Description |
|-----------|------|-------------|
| `from` | [`Entry`](#entry) | Source folder |
| `to` | [`Entry`](#entry) \| `string` | Destination folder, or a plain path string (same provider as `from`) |

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `merge` | `boolean` | `false` | **Throws** if the target folder exists already and `merge` is `false` |
| `onProgress` | [`OnProgress`](#onprogress) | - | Progress callback |

**Example:**

```js
// Plain path string (legacy form, still supported)
await vfs.moveFolder({ path: '/drafts' }, '/documents/drafts');

// Entry object — same provider
await vfs.moveFolder({ path: '/drafts' }, { path: '/documents/drafts' });

// Entry object — cross-provider move
await vfs.moveFolder(
  { path: '/archive', storageRef: providerA },
  { path: '/archive', storageRef: providerB },
);
```

> **Note:** For `OPFS` and cross-provider moves, there is no native directory move. The folder is copied to the new location and the original is deleted.

---

#### `vfs.copyFolder(from, to, options?)` → `Promise<void>`

Recursively copies a folder. Supports cross-provider copies.

| Parameter | Type | Description |
|-----------|------|-------------|
| `from` | [`Entry`](#entry) | Source folder |
| `to` | [`Entry`](#entry) \| `string` | Destination folder, or a plain path string (same provider as `from`) |

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `merge` | `boolean` | `false` | **Throws** if target folder already exists and `merge` is `false` |
| `onProgress` | [`OnProgress`](#onprogress) | - | Progress callback |

**Example:**

```js
// Plain path string (legacy form, still supported)
await vfs.copyFolder({ path: '/documents' }, '/documents-backup');

// Entry object
await vfs.copyFolder({ path: '/documents' }, { path: '/documents-backup' });
```

---

#### `vfs.copyFolderWithProgress(from, to, options?)` → `Promise<void>`

Recursively copies a folder by processing each entry (file or sub-folder) **one at a time**. Unlike `copyFolder`, this reports progress after every single entry, enabling an accurate 0→100% progress bar. A separate `onCollect` callback is fired after each directory listing during the initial collection phase, allowing callers to display a growing counter while the tree is scanned. Fires a **single** `onStorageChanged` event when the whole operation is complete. Supports cross-provider copies.

| Parameter | Type | Description |
|-----------|------|-------------|
| `from` | [`Entry`](#entry) | Source folder |
| `to` | [`Entry`](#entry) | Destination folder (may be on a different provider) |

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `merge` | `boolean` | `false` | **Throws** if a destination file already exists and `merge` is `false` |
| `onProgress` | `({ percent: number, currentFile: number, totalFiles: number }) => void` | - | Called after each entry; `percent` is size-weighted (falls back to entry count when sizes are unknown) |
| `onCollect` | `(total: number) => void` | - | Called after each `list()` batch during collection; `total` grows as more directories are scanned |

**Example:**

```js
await vfs.copyFolderWithProgress({ path: '/documents' }, { path: '/documents-backup' }, {
  onCollect: total => console.log(`scanning… ${total} entries found`),
  onProgress: ({ percent, currentFile, totalFiles }) => console.log(`${percent}% (${currentFile}/${totalFiles})`),
});
```

---

#### `vfs.moveFolderWithProgress(from, to, options?)` → `Promise<void>`

Recursively moves a folder by processing each entry (file or sub-folder) **one at a time**. Unlike `moveFolder`, this reports progress after every single entry, enabling an accurate 0→100% progress bar. A separate `onCollect` callback is fired after each directory listing during the initial collection phase. Fires a **single** `onStorageChanged` event when the whole operation is complete. Supports cross-provider moves.

| Parameter | Type | Description |
|-----------|------|-------------|
| `from` | [`Entry`](#entry) | Source folder |
| `to` | [`Entry`](#entry) | Destination folder (may be on a different provider) |

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `merge` | `boolean` | `false` | **Throws** if a destination file already exists and `merge` is `false` |
| `onProgress` | `({ percent: number, currentFile: number, totalFiles: number }) => void` | - | Called after each entry; `percent` is size-weighted (falls back to entry count when sizes are unknown) |
| `onCollect` | `(total: number) => void` | - | Called after each `list()` batch during collection; `total` grows as more directories are scanned |

**Example:**

```js
await vfs.moveFolderWithProgress({ path: '/downloads/project' }, { path: '/documents/project' }, {
  onCollect: total => console.log(`scanning… ${total} entries found`),
  onProgress: ({ percent, currentFile, totalFiles }) => console.log(`${percent}% (${currentFile}/${totalFiles})`),
});
```

---

#### `vfs.deleteFolder(entry, options?)` → `Promise<void>`

Deletes a folder and all its contents recursively. **Silent** if not found. **Throws** if `entry.path` is `"/"`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `entry` | [`Entry`](#entry) | Folder to delete |

| Option | Type | Description |
|--------|------|-------------|
| `onProgress` | [`OnProgress`](#onprogress) | Progress callback |

**Example:**

```js
await vfs.deleteFolder({ path: '/documents/archive' });
```

---

#### `vfs.getCapabilities(storageRef?)` → `Promise<{file, folder}>`

Returns the capabilities for a specific storage backend.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `storageRef` | [`StorageRef`](#storageref) | `null` | Connection to query. `null` returns the built-in OPFS capabilities. |

**Example:**
```js
const caps = await vfs.getCapabilities(storageRef);
// {
//  file: { read: true, add: true, modify: true, delete: true },
//  folder: { read: true, add: true, modify: true, delete: true }
// }
```

---

#### `vfs.getStorageUsage(storageRef?)` → `Promise<{usage, quota}>`

Returns current storage usage (if available).

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `storageRef` | [`StorageRef`](#storageref) | `null` | Connection to query. `null` queries the built-in OPFS backend. |

Returns `{ usage: number, quota: number }`. Either field may be `null` if the backend does not track it.

---

#### `vfs.abort(storageRef)` → `void`

Cancels all pending operations for an external provider. Each pending action is rejected immediately with `AbortError` and a `cancel` notification is sent to the provider so it can abort early.

**Note:** Has no effect on the built-in `OPFS` provider (`storageRef = null`).

| Parameter | Type | Description |
|-----------|------|-------------|
| `storageRef` | [`StorageRef`](#storageref) | Connection whose operations to abort. `null` is a no-op. |

See [Cancellation](#cancellation) for the full cancel flow.

---

### Types

#### `StorageRef`

Identifies an external provider storage connection. `null` always refers to the built-in OPFS backend.

```ts
type StorageRef = null | { providerId: string; storageId: string }
```

| Field | Type | Description |
|-------|------|-------------|
| `providerId` | `string` | Extension ID of the provider add-on |
| `storageId` | `string` | Unique ID of the storage slot within that provider (assigned when the connection was created) |

A `StorageRef` is obtained from:
- [`vfs.fetchProviderConnections()`](#vfsfetchproviderconnections--promisearrayproviderid-name-connections) — the `storageRef` field inside each provider's `connections` array
- Picker result entries — each returned `Entry` carries the `storageRef` that was active when the user confirmed

---

#### `PickerFileType`

A single entry in the `types` array passed to `showSelectFilePicker`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `description` | `string` | no | Human-readable label shown in the type dropdown, e.g. `"Images"`. Defaults to the list of extensions if omitted. |
| `accept` | `Object<string, Array<string>>` | yes | Map of MIME type → array of file extensions (each starting with `.`), e.g. `{ "image/*": [".png", ".jpg"] }` |

---

#### `OnProgress`

Callback passed via `options.onProgress` on operations that transfer or copy data.

```js
({ percent, currentFile, totalFiles }) => void
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `percent` | `number` | Completion percentage, 0–100. `null` if the provider does not report progress |
| `currentFile` | `number` | 1-based index of the file currently being processed (batch operations only) |
| `totalFiles` | `number` | Total number of files in the batch (batch operations only) |

---

#### `OnStorageChange`

Callback passed via `vfs.onStorageChanged`. Receives an array of change entries.

```js
(entries: Array<StorageChangeEntry>) => void
```

Each `StorageChangeEntry` has the following fields:

| Field | Type | Present | Description |
|-------|------|---------|-------------|
| `kind` | `'file'\|'directory'` | always | Item type |
| `action` | `'created'\|'modified'\|'deleted'\|'moved'\|'copied'` | always | What happened |
| `target` | `{ path, storageRef }` | always | Destination location (or the only location for non-move/copy actions) |
| `source` | `{ path, storageRef }` | `moved`, `copied` | Original location before the operation |

---

#### `Entry`

The universal type to describe an entry in the virtual file system.

| Field | Type | Description |
|-------|------|-------------|
| `path` | `string` | Absolute path, e.g. `"/documents/notes.txt"` |
| `storageRef` | [`StorageRef`](#storageref) | `null` for the built-in OPFS backend; otherwise identifies the provider and storage slot |
| `name` | `string` | File or folder name without path. Present in `list()` results; not required as input. |
| `kind` | `'file'\|'directory'` | Item type. Present in `list()` results; not required as input. |
| `size` | `number` | File size in bytes. Present in `list()` results for files only. |
| `lastModified` | `number` | Last-modified timestamp in ms since epoch. Present in `list()` results for files only. |
