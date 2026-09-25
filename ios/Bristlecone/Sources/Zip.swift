import Foundation
import Compression

/// Just enough of the zip format for Bristlecone backups. Writes stored (uncompressed) entries,
/// which every unzip tool reads, and reads both stored and deflated entries, so a backup made
/// by the Android app restores here and the other way round.
enum Zip {
    struct Failure: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    // MARK: Writing

    final class Writer {
        private let handle: FileHandle
        private var offset: UInt32 = 0
        private var central = Data()
        private var count: UInt16 = 0

        init(url: URL) throws {
            FileManager.default.createFile(atPath: url.path, contents: nil)
            handle = try FileHandle(forWritingTo: url)
        }

        func add(name: String, data: Data) throws {
            guard UInt64(offset) + 30 + UInt64(name.utf8.count) + UInt64(data.count) < 0xFFFF_FFFF, count < 0xFFFF else {
                throw Failure(message: "backup too large")
            }
            let nameBytes = Data(name.utf8)
            let crc = CRC32.checksum(data)
            let size = UInt32(data.count)
            var local = Data()
            local.u32(0x0403_4B50); local.u16(20); local.u16(0x0800); local.u16(0)
            local.u16(0); local.u16(0x21)
            local.u32(crc); local.u32(size); local.u32(size)
            local.u16(UInt16(nameBytes.count)); local.u16(0)
            local.append(nameBytes)
            handle.write(local)
            handle.write(data)

            central.u32(0x0201_4B50); central.u16(20); central.u16(20); central.u16(0x0800); central.u16(0)
            central.u16(0); central.u16(0x21)
            central.u32(crc); central.u32(size); central.u32(size)
            central.u16(UInt16(nameBytes.count)); central.u16(0); central.u16(0); central.u16(0); central.u16(0)
            central.u32(0); central.u32(offset)
            central.append(nameBytes)

            offset += UInt32(local.count) + size
            count += 1
        }

        func finish() throws {
            var end = Data()
            end.u32(0x0605_4B50); end.u16(0); end.u16(0); end.u16(count); end.u16(count)
            end.u32(UInt32(central.count)); end.u32(offset); end.u16(0)
            handle.write(central)
            handle.write(end)
            try handle.close()
        }
    }

    // MARK: Reading

    struct Entry { let name: String; let method: UInt16; let compressed: Int; let size: Int; let localOffset: Int }

    /// Lists entries from the central directory (sizes in local headers can be zero when the
    /// writer streamed them, as Android's ZipOutputStream does).
    static func entries(_ z: Data) throws -> [Entry] {
        guard z.count >= 22 else { throw Failure(message: "not a zip file") }
        var eocd = -1
        var i = z.count - 22
        let stop = max(0, z.count - 22 - 65_535)
        while i >= stop {
            if z.u32(at: i) == 0x0605_4B50 { eocd = i; break }
            i -= 1
        }
        guard eocd >= 0 else { throw Failure(message: "not a zip file") }
        let total = Int(z.u16(at: eocd + 10))
        var p = Int(z.u32(at: eocd + 16))
        var out: [Entry] = []
        for _ in 0..<total {
            guard p + 46 <= z.count, z.u32(at: p) == 0x0201_4B50 else { throw Failure(message: "damaged zip file") }
            let method = z.u16(at: p + 10)
            let csize = Int(z.u32(at: p + 20)), usize = Int(z.u32(at: p + 24))
            let nlen = Int(z.u16(at: p + 28)), xlen = Int(z.u16(at: p + 30)), clen = Int(z.u16(at: p + 32))
            let local = Int(z.u32(at: p + 42))
            guard p + 46 + nlen <= z.count else { throw Failure(message: "damaged zip file") }
            let name = String(decoding: z.subdata(in: (z.startIndex + p + 46)..<(z.startIndex + p + 46 + nlen)), as: UTF8.self)
            out.append(Entry(name: name, method: method, compressed: csize, size: usize, localOffset: local))
            p += 46 + nlen + xlen + clen
        }
        return out
    }

    static func read(_ z: Data, _ e: Entry) throws -> Data {
        let h = e.localOffset
        guard h + 30 <= z.count, z.u32(at: h) == 0x0403_4B50 else { throw Failure(message: "damaged zip file") }
        let start = h + 30 + Int(z.u16(at: h + 26)) + Int(z.u16(at: h + 28))
        guard start + e.compressed <= z.count else { throw Failure(message: "damaged zip file") }
        let raw = z.subdata(in: (z.startIndex + start)..<(z.startIndex + start + e.compressed))
        switch e.method {
        case 0: return raw
        case 8: return try inflate(raw, size: e.size)
        default: throw Failure(message: "unsupported zip entry")
        }
    }

    private static func inflate(_ raw: Data, size: Int) throws -> Data {
        if size == 0 { return Data() }
        guard !raw.isEmpty else { throw Failure(message: "damaged zip file") }
        var out = Data(count: size)
        let n = out.withUnsafeMutableBytes { dst -> Int in
            raw.withUnsafeBytes { src -> Int in
                // COMPRESSION_ZLIB is raw DEFLATE (no zlib header), which is what zip stores.
                compression_decode_buffer(dst.bindMemory(to: UInt8.self).baseAddress!, size,
                                          src.bindMemory(to: UInt8.self).baseAddress!, raw.count,
                                          nil, COMPRESSION_ZLIB)
            }
        }
        guard n == size else { throw Failure(message: "damaged zip file") }
        return out
    }
}

enum CRC32 {
    private static let table: [UInt32] = (0..<256).map { i -> UInt32 in
        var c = UInt32(i)
        for _ in 0..<8 { c = (c & 1) != 0 ? 0xEDB8_8320 ^ (c >> 1) : c >> 1 }
        return c
    }

    static func checksum(_ d: Data) -> UInt32 {
        var c: UInt32 = 0xFFFF_FFFF
        for b in d { c = table[Int((c ^ UInt32(b)) & 0xFF)] ^ (c >> 8) }
        return c ^ 0xFFFF_FFFF
    }
}

private extension Data {
    mutating func u16(_ v: UInt16) { append(UInt8(v & 0xFF)); append(UInt8(v >> 8)) }
    mutating func u32(_ v: UInt32) { u16(UInt16(v & 0xFFFF)); u16(UInt16(v >> 16)) }
    func u16(at i: Int) -> UInt16 { UInt16(self[startIndex + i]) | UInt16(self[startIndex + i + 1]) << 8 }
    func u32(at i: Int) -> UInt32 { UInt32(u16(at: i)) | UInt32(u16(at: i + 2)) << 16 }
}
