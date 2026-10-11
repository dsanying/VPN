package com.dsanying.shadowvpn.app;

import java.io.*;
import java.nio.ByteBuffer;
import java.nio.charset.*;

/** Bounded UTF-8 files selected through Android's document provider, never arbitrary filesystem paths. */
final class NativeDocumentIO {
    static final int MAX_BYTES = 16 * 1024 * 1024;
    static byte[] encode(String content) throws CharacterCodingException {
        if (content == null) throw new IllegalArgumentException("文件内容为空");
        ByteBuffer encoded = StandardCharsets.UTF_8.newEncoder().onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT).encode(java.nio.CharBuffer.wrap(content));
        if (encoded.remaining() > MAX_BYTES) throw new IllegalArgumentException("文件超过大小限制");
        byte[] bytes = new byte[encoded.remaining()]; encoded.get(bytes); return bytes;
    }
    static String read(InputStream source) throws IOException {
        if (source == null) throw new IOException("无法读取文件");
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        byte[] buffer = new byte[32768];
        int count;
        while ((count = source.read(buffer)) != -1) {
            if (count > MAX_BYTES - bytes.size()) throw new IOException("文件超过大小限制");
            bytes.write(buffer, 0, count);
        }
        return StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes.toByteArray())).toString();
    }
    private NativeDocumentIO() {}
}
