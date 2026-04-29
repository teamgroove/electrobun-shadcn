# Ghostty WASM Bindings Deep Dive

## Table of Contents

- [C API Overview](#c-api-overview)
- [Type Layout JSON](#type-layout-json)
- [Working with Structs](#working-with-structs)
- [Custom Formatters](#custom-formatters)
- [Memory Management Rules](#memory-management-rules)
- [Performance Tips](#performance-tips)
- [Troubleshooting](#troubleshooting)

---

## C API Overview

The WASM module exports the same C API defined in `include/ghostty/vt.h`. Key functions:

| Function | Purpose |
|----------|---------|
| `ghostty_terminal_new` | Create a terminal instance |
| `ghostty_terminal_vt_write` | Write bytes into the terminal parser |
| `ghostty_terminal_free` | Destroy terminal and free memory |
| `ghostty_formatter_terminal_new` | Create a formatter for a terminal |
| `ghostty_formatter_format_alloc` | Format terminal screen into allocated string |
| `ghostty_formatter_free` | Destroy formatter |
| `ghostty_type_json` | Return pointer to type layout JSON string |
| `ghostty_wasm_alloc_u8_array` | Allocate u8 array in WASM memory |
| `ghostty_wasm_free_u8_array` | Free u8 array |
| `ghostty_wasm_alloc_opaque` | Allocate opaque pointer slot |
| `ghostty_wasm_alloc_usize` | Allocate usize slot |
| `ghostty_free` | Free memory allocated by `format_alloc` |

All functions use the C calling convention and are exported with `rdynamic`.

## Type Layout JSON

`ghostty_type_json()` returns a null-terminated JSON string describing every public struct:

```json
{
  "GhosttyTerminalOptions": {
    "size": 24,
    "fields": {
      "cols": { "offset": 0, "type": "u32" },
      "rows": { "offset": 4, "type": "u32" },
      "max_scrollback": { "offset": 8, "type": "u32" }
    }
  }
}
```

The `GhosttyWasm` class parses this automatically. For custom structs, use:

```ts
const field = wasm.fieldInfo("GhosttyMyStruct", "myField");
const view = new DataView(wasm.getBuffer(), ptr, wasm.typeLayout["GhosttyMyStruct"].size);
wasm.setField(view, "GhosttyMyStruct", "myField", 42);
```

## Working with Structs

Ghostty's C API is pointer-based. The wrapper abstracts this, but here's the manual pattern:

```ts
// 1. Allocate struct memory
const optsSize = wasm.typeLayout["GhosttyTerminalOptions"].size;
const optsPtr = wasm.allocU8Array(optsSize);
new Uint8Array(wasm.getBuffer(), optsPtr, optsSize).fill(0);

// 2. Fill fields via DataView
const view = new DataView(wasm.getBuffer(), optsPtr, optsSize);
wasm.setField(view, "GhosttyTerminalOptions", "cols", 80);

// 3. Call C function
const termPtrPtr = wasm.allocOpaque();
const result = wasm.exports.ghostty_terminal_new(0, termPtrPtr, optsPtr);

// 4. Read output pointer
const termPtr = new DataView(wasm.getBuffer()).getUint32(termPtrPtr, true);

// 5. Free temporaries
wasm.freeU8Array(optsPtr, optsSize);
wasm.freeOpaque(termPtrPtr);
```

## Custom Formatters

The bundled wrapper supports plain text (`emit = 0`) and HTML (`emit = 1`). To add other formats:

1. Check `include/ghostty/vt.h` for the enum values of `GhosttyFormatterFormat`
2. Create a helper method that passes the correct `emit` value
3. Set formatter options via `GhosttyFormatterTerminalOptions`

Available formatter options:
- `emit`: output format (plain, HTML, etc.)
- `unwrap`: unwrap wrapped lines
- `trim`: trim trailing whitespace
- `extra.screen.*`: screen-specific formatting flags

## Memory Management Rules

1. **Allocations from `ghostty_wasm_alloc_*`** — must be freed with the matching `ghostty_wasm_free_*`
2. **Allocation from `ghostty_formatter_format_alloc`** — must be freed with `ghostty_free(0, ptr, len)`
3. **Terminal handle** — freed with `ghostty_terminal_free(termPtr)`
4. **Formatter handle** — freed with `ghostty_formatter_free(fmtPtr)`

The `Terminal` class handles all of this automatically. If you access raw pointers, you are responsible for cleanup.

## Performance Tips

- **Reuse formatters** if formatting the same terminal multiple times in a loop (create once, call `format_alloc` many times, free once)
- **Batch writes** — call `write()` once with a larger buffer instead of many small writes
- **Avoid `toPlainText()` / `toHTML()` on every frame** — only format when the screen actually changes
- **Use `ReleaseSmall` or `ReleaseFast`** when building the WASM module; `Debug` is much larger and slower

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `ghostty_terminal_new failed` | Struct size mismatch or missing size fields | Ensure `GhosttyTerminalOptions` is zeroed and size fields match `typeLayout` |
| `ghostty_formatter_format_alloc failed` | Nested struct sizes not set | Set `extra.size` and `extra.screen.size` fields before creating formatter |
| `Unknown struct` in type layout | Using a struct not exported in the WASM build | Check ghostty version; the C API is unstable/WIP |
| WASM fails to instantiate | Missing `env.memory` import | Provide a `WebAssembly.Memory` in the import object |
| Screen text is garbled | VT data not properly encoded | Use `new TextEncoder().encode(data)` for binary data |
