package com.mct.legacy;

import java.io.File;
import java.io.IOException;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.URLDecoder;

/** Vanilla 1.12 URL restrictions, plus containment after decoding local paths. */
final class LegacyResourcePackUrls {
    private LegacyResourcePackUrls() { }

    static void validate(String url) throws URISyntaxException {
        URI uri = new URI(url);
        String scheme = uri.getScheme();
        if (!("http".equals(scheme) || "https".equals(scheme) || "level".equals(scheme))) {
            throw new URISyntaxException(url, "Unsupported resource-pack URL");
        }
        if ("level".equals(scheme) && (url.contains("..") || !url.endsWith("/resources.zip"))) {
            throw new URISyntaxException(url, "Invalid local resource-pack path");
        }
    }

    static File localPack(File gameDir, String url) throws IOException, URISyntaxException {
        validate(url);
        if (!url.startsWith("level://")) throw new IOException("Not a local resource pack");
        String path = URLDecoder.decode(url.substring(8), "UTF-8");
        File saves = new File(gameDir, "saves");
        File pack = new File(saves, path);
        if (!pack.getCanonicalPath().startsWith(saves.getCanonicalPath() + File.separator) || !pack.isFile()) {
            throw new IOException("Invalid local resource pack");
        }
        return pack;
    }
}
