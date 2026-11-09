package com.intermap.backend.review;

import javax.imageio.ImageIO;
import javax.imageio.ImageReader;
import javax.imageio.stream.ImageInputStream;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.Iterator;

// 사진 원본 크기(px) — 앱이 사진이 오기 전부터 칸을 제 비율로 잡는 데 쓴다 (받아진 뒤 화면이 밀리지 않게).
// 머리(header)만 읽어 크기를 얻으므로 사진 전체를 풀지 않는다.
final class PhotoSize {

    // 읽을 수 없는 형식(WebP 등) — 다시 시도하지 않게 0×0으로 남긴다
    static final int[] UNKNOWN = {0, 0};

    private PhotoSize() {
    }

    static int[] of(byte[] data) {
        try (ImageInputStream in = ImageIO.createImageInputStream(new ByteArrayInputStream(data))) {
            if (in == null) return UNKNOWN;
            Iterator<ImageReader> readers = ImageIO.getImageReaders(in);
            if (!readers.hasNext()) return UNKNOWN;
            ImageReader reader = readers.next();
            try {
                reader.setInput(in, true, true);
                return new int[]{reader.getWidth(0), reader.getHeight(0)};
            } finally {
                reader.dispose();
            }
        } catch (IOException | RuntimeException e) {
            return UNKNOWN;
        }
    }
}
