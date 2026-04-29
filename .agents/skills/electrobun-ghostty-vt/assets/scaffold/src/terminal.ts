/**
 * Ghostty VT Terminal — TypeScript wrapper for libghostty-vt WASM.
 *
 * Loads ghostty-vt.wasm, auto-discovers C struct layouts via ghostty_type_json(),
 * and exposes a high-level Terminal API with managed memory.
 */

export interface TypeLayout {
  [structName: string]: {
    size: number;
    fields: {
      [fieldName: string]: {
        offset: number;
        type: string;
      };
    };
  };
}

export interface TerminalOptions {
  cols?: number;
  rows?: number;
  maxScrollback?: number;
}

export interface FormatOptions {
  unwrap?: boolean;
  trim?: boolean;
}

export class GhosttyError extends Error {
  constructor(message: string, public code: number) {
    super(message);
    this.name = "GhosttyError";
  }
}

/** Low-level WASM interface. Usually you only need `Terminal`. */
export class GhosttyWasm {
  exports!: WebAssembly.Exports;
  memory!: WebAssembly.Memory;
  typeLayout!: TypeLayout;

  private GHOSTTY_SUCCESS = 0;

  async load(wasmPath: string | URL | BufferSource) {
    const bytes =
      typeof wasmPath === "string" || wasmPath instanceof URL
        ? await Bun.file(wasmPath).arrayBuffer()
        : wasmPath;

    const mod = await WebAssembly.instantiate(bytes, {
      env: {
        memory: new WebAssembly.Memory({ initial: 256, maximum: 512 }),
      },
    });

    this.exports = mod.instance.exports;
    this.memory = this.exports.memory as WebAssembly.Memory;

    const jsonPtr = (this.exports.ghostty_type_json as CallableFunction)();
    const jsonStr = this.readCString(jsonPtr);
    this.typeLayout = JSON.parse(jsonStr);
  }

  /** Allocate a u8 array in WASM memory. Returns pointer. */
  allocU8Array(size: number): number {
    const fn = this.exports.ghostty_wasm_alloc_u8_array as CallableFunction;
    return fn(size) as number;
  }

  freeU8Array(ptr: number, size: number) {
    const fn = this.exports.ghostty_wasm_free_u8_array as CallableFunction;
    fn(ptr, size);
  }

  allocOpaque(): number {
    const fn = this.exports.ghostty_wasm_alloc_opaque as CallableFunction;
    return fn() as number;
  }

  freeOpaque(ptr: number) {
    const fn = this.exports.ghostty_wasm_free_opaque as CallableFunction;
    fn(ptr);
  }

  allocUsize(): number {
    const fn = this.exports.ghostty_wasm_alloc_usize as CallableFunction;
    return fn() as number;
  }

  freeUsize(ptr: number) {
    const fn = this.exports.ghostty_wasm_free_usize as CallableFunction;
    fn(ptr);
  }

  ghosttyFree(ptr: number, len: number) {
    const fn = this.exports.ghostty_free as CallableFunction;
    fn(0, ptr, len);
  }

  readCString(ptr: number): string {
    const buf = new Uint8Array(this.memory.buffer);
    let end = ptr;
    while (buf[end] !== 0) end++;
    return new TextDecoder().decode(buf.subarray(ptr, end));
  }

  readBytes(ptr: number, len: number): Uint8Array {
    return new Uint8Array(this.memory.buffer, ptr, len);
  }

  writeBytes(data: Uint8Array): number {
    const ptr = this.allocU8Array(data.length);
    new Uint8Array(this.memory.buffer).set(data, ptr);
    return ptr;
  }

  getBuffer(): ArrayBuffer {
    return this.memory.buffer;
  }

  fieldInfo(structName: string, fieldName: string) {
    const s = this.typeLayout[structName];
    if (!s) throw new GhosttyError(`Unknown struct: ${structName}`, -1);
    const f = s.fields[fieldName];
    if (!f) throw new GhosttyError(`Unknown field: ${structName}.${fieldName}`, -1);
    return f;
  }

  setField(view: DataView, structName: string, fieldName: string, value: number | bigint) {
    const field = this.fieldInfo(structName, fieldName);
    switch (field.type) {
      case "u8":
      case "bool":
        view.setUint8(field.offset, Number(value));
        break;
      case "u16":
        view.setUint16(field.offset, Number(value), true);
        break;
      case "u32":
      case "enum":
        view.setUint32(field.offset, Number(value), true);
        break;
      case "u64":
        view.setBigUint64(field.offset, BigInt(value), true);
        break;
      default:
        throw new GhosttyError(`Unsupported field type: ${field.type}`, -1);
    }
  }

  getField(view: DataView, structName: string, fieldName: string): number | bigint {
    const field = this.fieldInfo(structName, fieldName);
    switch (field.type) {
      case "u8":
      case "bool":
        return view.getUint8(field.offset);
      case "u16":
        return view.getUint16(field.offset, true);
      case "u32":
      case "enum":
        return view.getUint32(field.offset, true);
      case "u64":
        return view.getBigUint64(field.offset, true);
      default:
        throw new GhosttyError(`Unsupported field type: ${field.type}`, -1);
    }
  }

  assertSuccess(result: number, msg: string) {
    if (result !== this.GHOSTTY_SUCCESS) {
      throw new GhosttyError(`${msg} failed with code ${result}`, result);
    }
  }
}

/** High-level terminal emulator backed by ghostty-vt.wasm. */
export class Terminal {
  private termPtr: number;

  constructor(
    private wasm: GhosttyWasm,
    cols: number,
    rows: number,
    options: TerminalOptions = {}
  ) {
    const optsSize = wasm.typeLayout["GhosttyTerminalOptions"]?.size ?? 24;
    const optsPtr = wasm.allocU8Array(optsSize);
    new Uint8Array(wasm.getBuffer(), optsPtr, optsSize).fill(0);

    const optsView = new DataView(wasm.getBuffer(), optsPtr, optsSize);
    wasm.setField(optsView, "GhosttyTerminalOptions", "cols", cols);
    wasm.setField(optsView, "GhosttyTerminalOptions", "rows", rows);
    if (options.maxScrollback !== undefined) {
      wasm.setField(optsView, "GhosttyTerminalOptions", "max_scrollback", options.maxScrollback);
    }

    const termPtrPtr = wasm.allocOpaque();
    const result = (wasm.exports.ghostty_terminal_new as CallableFunction)(0, termPtrPtr, optsPtr);
    wasm.freeU8Array(optsPtr, optsSize);

    wasm.assertSuccess(result, "ghostty_terminal_new");

    this.termPtr = new DataView(wasm.getBuffer()).getUint32(termPtrPtr, true);
    wasm.freeOpaque(termPtrPtr);
  }

  /** Write VT-encoded data (escape sequences, text, etc.) into the terminal. */
  write(data: string | Uint8Array) {
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
    const ptr = this.wasm.writeBytes(bytes);
    (this.wasm.exports.ghostty_terminal_vt_write as CallableFunction)(this.termPtr, ptr, bytes.length);
    this.wasm.freeU8Array(ptr, bytes.length);
  }

  /** Format terminal screen contents as plain text. */
  toPlainText(options: FormatOptions = {}): string {
    return this.format(0, options);
  }

  /** Format terminal screen contents as HTML. */
  toHTML(options: FormatOptions = {}): string {
    return this.format(1, options);
  }

  private format(formatType: number, options: FormatOptions): string {
    const fmtOptsSize = this.wasm.typeLayout["GhosttyFormatterTerminalOptions"]?.size ?? 64;
    const fmtOptsPtr = this.wasm.allocU8Array(fmtOptsSize);
    new Uint8Array(this.wasm.getBuffer(), fmtOptsPtr, fmtOptsSize).fill(0);

    const fmtOptsView = new DataView(this.wasm.getBuffer(), fmtOptsPtr, fmtOptsSize);
    this.wasm.setField(fmtOptsView, "GhosttyFormatterTerminalOptions", "size", fmtOptsSize);
    this.wasm.setField(fmtOptsView, "GhosttyFormatterTerminalOptions", "emit", formatType);
    this.wasm.setField(fmtOptsView, "GhosttyFormatterTerminalOptions", "unwrap", options.unwrap ? 1 : 0);
    this.wasm.setField(fmtOptsView, "GhosttyFormatterTerminalOptions", "trim", options.trim !== false ? 1 : 0);

    // Set nested struct size fields if they exist in the layout
    try {
      const extraOffset = this.wasm.fieldInfo("GhosttyFormatterTerminalOptions", "extra").offset;
      const extraSize = this.wasm.typeLayout["GhosttyFormatterTerminalExtra"]?.size ?? 0;
      if (extraSize) {
        const extraSizeOff = this.wasm.fieldInfo("GhosttyFormatterTerminalExtra", "size").offset;
        fmtOptsView.setUint32(extraOffset + extraSizeOff, extraSize, true);

        const screenOffset = this.wasm.fieldInfo("GhosttyFormatterTerminalExtra", "screen").offset;
        const screenSize = this.wasm.typeLayout["GhosttyFormatterScreenExtra"]?.size ?? 0;
        if (screenSize) {
          const screenSizeOff = this.wasm.fieldInfo("GhosttyFormatterScreenExtra", "size").offset;
          fmtOptsView.setUint32(extraOffset + screenOffset + screenSizeOff, screenSize, true);
        }
      }
    } catch {
      // Nested size fields may not exist in all ghostty versions
    }

    const fmtPtrPtr = this.wasm.allocOpaque();
    const fmtResult = (this.wasm.exports.ghostty_formatter_terminal_new as CallableFunction)(
      0, fmtPtrPtr, this.termPtr, fmtOptsPtr
    );
    this.wasm.freeU8Array(fmtOptsPtr, fmtOptsSize);
    this.wasm.assertSuccess(fmtResult, "ghostty_formatter_terminal_new");

    const fmtPtr = new DataView(this.wasm.getBuffer()).getUint32(fmtPtrPtr, true);
    this.wasm.freeOpaque(fmtPtrPtr);

    const outPtrPtr = this.wasm.allocOpaque();
    const outLenPtr = this.wasm.allocUsize();
    const formatResult = (this.wasm.exports.ghostty_formatter_format_alloc as CallableFunction)(
      fmtPtr, 0, outPtrPtr, outLenPtr
    );

    if (formatResult !== 0) {
      (this.wasm.exports.ghostty_formatter_free as CallableFunction)(fmtPtr);
      throw new GhosttyError(`ghostty_formatter_format_alloc failed with code ${formatResult}`, formatResult);
    }

    const outPtr = new DataView(this.wasm.getBuffer()).getUint32(outPtrPtr, true);
    const outLen = new DataView(this.wasm.getBuffer()).getUint32(outLenPtr, true);

    const text = new TextDecoder().decode(this.wasm.readBytes(outPtr, outLen));

    // Cleanup
    this.wasm.ghosttyFree(outPtr, outLen);
    this.wasm.freeOpaque(outPtrPtr);
    this.wasm.freeUsize(outLenPtr);
    (this.wasm.exports.ghostty_formatter_free as CallableFunction)(fmtPtr);

    return text;
  }

  /** Access the raw terminal pointer for advanced use. */
  get ptr() {
    return this.termPtr;
  }

  /** Free the terminal and all associated state. */
  free() {
    (this.wasm.exports.ghostty_terminal_free as CallableFunction)(this.termPtr);
    this.termPtr = 0;
  }
}

/** Convenience: load the WASM module and return a GhosttyWasm instance. */
export async function loadGhostty(wasmPath: string | URL | BufferSource): Promise<GhosttyWasm> {
  const g = new GhosttyWasm();
  await g.load(wasmPath);
  return g;
}
