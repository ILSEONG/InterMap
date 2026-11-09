package com.intermap.backend.review;

import javax.imageio.ImageIO;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.IOException;

// 사진의 흐린 미리보기 코드 (BlurHash, https://blurha.sh). 30자 남짓한 문자열에 사진의 색 분포를 담는다.
// 앱은 이 코드로 흐린 그림을 바로 그려 두고, 진짜 사진이 받아지면 그 위에 서서히 띄운다 — 빈 회색 칸이 안 보인다.
final class BlurHash {

    private static final String DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~";
    // 계산은 작은 그림으로 충분하다 (결과는 어차피 몇 개 색 성분)
    private static final int SAMPLE = 32;

    private BlurHash() {
    }

    // 이미지 바이트에서 코드를 만든다. 읽을 수 없는 형식(WebP 등)이면 "" — 다시 시도하지 않게 빈 값으로 남긴다.
    static String of(byte[] data) {
        try {
            BufferedImage image = ImageIO.read(new ByteArrayInputStream(data));
            if (image == null) return "";
            boolean portrait = image.getHeight() > image.getWidth();
            return encode(shrink(image), portrait ? 3 : 4, portrait ? 4 : 3);
        } catch (IOException | RuntimeException e) {
            return "";
        }
    }

    private static BufferedImage shrink(BufferedImage image) {
        double scale = (double) SAMPLE / Math.max(image.getWidth(), image.getHeight());
        int w = Math.max(1, (int) Math.round(image.getWidth() * scale));
        int h = Math.max(1, (int) Math.round(image.getHeight() * scale));
        BufferedImage small = new BufferedImage(w, h, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = small.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR);
        g.drawImage(image, 0, 0, w, h, null);
        g.dispose();
        return small;
    }

    static String encode(BufferedImage image, int cx, int cy) {
        int w = image.getWidth();
        int h = image.getHeight();
        int[] rgb = image.getRGB(0, 0, w, h, null, 0, w);
        double[][] factors = new double[cx * cy][];
        for (int j = 0; j < cy; j++) {
            for (int i = 0; i < cx; i++) {
                double norm = (i == 0 && j == 0) ? 1 : 2;
                double r = 0, g = 0, b = 0;
                for (int y = 0; y < h; y++) {
                    double basisY = Math.cos(Math.PI * j * y / h);
                    for (int x = 0; x < w; x++) {
                        double basis = norm * Math.cos(Math.PI * i * x / w) * basisY;
                        int p = rgb[y * w + x];
                        r += basis * toLinear((p >> 16) & 0xff);
                        g += basis * toLinear((p >> 8) & 0xff);
                        b += basis * toLinear(p & 0xff);
                    }
                }
                double scale = 1.0 / (w * h);
                factors[j * cx + i] = new double[]{r * scale, g * scale, b * scale};
            }
        }

        StringBuilder hash = new StringBuilder();
        append(hash, (cx - 1) + (cy - 1) * 9, 1);
        double max = 1;
        if (factors.length > 1) {
            double actual = 0;
            for (int k = 1; k < factors.length; k++) {
                for (double v : factors[k]) actual = Math.max(actual, Math.abs(v));
            }
            int quantised = (int) Math.max(0, Math.min(82, Math.floor(actual * 166 - 0.5)));
            max = (quantised + 1) / 166.0;
            append(hash, quantised, 1);
        } else {
            append(hash, 0, 1);
        }
        double[] dc = factors[0];
        append(hash, (toSrgb(dc[0]) << 16) + (toSrgb(dc[1]) << 8) + toSrgb(dc[2]), 4);
        for (int k = 1; k < factors.length; k++) {
            double[] f = factors[k];
            append(hash, quantAc(f[0], max) * 19 * 19 + quantAc(f[1], max) * 19 + quantAc(f[2], max), 2);
        }
        return hash.toString();
    }

    private static int quantAc(double v, double max) {
        double signPow = Math.copySign(Math.pow(Math.abs(v / max), 0.5), v);
        return (int) Math.max(0, Math.min(18, Math.floor(signPow * 9 + 9.5)));
    }

    private static double toLinear(int v) {
        double c = v / 255.0;
        return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }

    private static int toSrgb(double v) {
        double c = Math.max(0, Math.min(1, v));
        return c <= 0.0031308 ? (int) (c * 12.92 * 255 + 0.5) : (int) ((1.055 * Math.pow(c, 1 / 2.4) - 0.055) * 255 + 0.5);
    }

    private static void append(StringBuilder out, int value, int length) {
        for (int i = 1; i <= length; i++) {
            int digit = (int) (value / Math.pow(83, length - i)) % 83;
            out.append(DIGITS.charAt(digit));
        }
    }
}
