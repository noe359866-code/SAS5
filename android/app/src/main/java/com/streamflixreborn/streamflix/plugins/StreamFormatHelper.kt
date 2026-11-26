package com.streamflixreborn.streamflix.plugins

import androidx.media3.common.MimeTypes
import com.streamflixreborn.streamflix.models.Video
import java.util.Locale

/**
 * Pure stream URL & MIME type helper for streams returned by external JS plugins.
 * Contains zero scraping or extractor logic.
 */
object StreamFormatHelper {

    private val NON_STREAM_PATTERNS = listOf(
        "t.me/",
        "telegram.me/",
        "discord.gg/",
        "discord.com/invite",
        "ko-fi.com/",
        "patreon.com/",
        "buymeacoffee.com/",
        "paypal.me/",
        "youtube.com/watch",
        "youtu.be/",
    )

    fun inferMimeType(url: String, explicitType: String? = null): String? {
        val hint = explicitType?.trim()?.lowercase(Locale.ROOT).orEmpty()
        when {
            hint == "hls" || hint == "m3u8" ||
                hint == MimeTypes.APPLICATION_M3U8.lowercase(Locale.ROOT) ||
                hint == "application/vnd.apple.mpegurl" ||
                hint == "audio/mpegurl" -> return MimeTypes.APPLICATION_M3U8

            hint == "dash" || hint == "mpd" ||
                hint == MimeTypes.APPLICATION_MPD.lowercase(Locale.ROOT) -> return MimeTypes.APPLICATION_MPD

            hint == "mp4" || hint == "video/mp4" -> return MimeTypes.VIDEO_MP4
            hint == "webm" || hint == "video/webm" -> return MimeTypes.VIDEO_WEBM
            hint == "mkv" || hint == "matroska" || hint == "video/x-matroska" -> return MimeTypes.VIDEO_MATROSKA
        }

        val cleanPath = url.substringBefore('#').substringBefore('?').lowercase(Locale.ROOT)
        val fullLower = url.lowercase(Locale.ROOT)

        return when {
            cleanPath.endsWith(".m3u8") ||
                fullLower.contains(".m3u8?") ||
                fullLower.contains("format=m3u8") ||
                fullLower.contains("type=m3u8") ||
                cleanPath.contains("/hls/") ||
                cleanPath.endsWith("/master.txt") ||
                cleanPath.endsWith("/index.txt") -> MimeTypes.APPLICATION_M3U8

            cleanPath.endsWith(".mpd") ||
                fullLower.contains(".mpd?") ||
                fullLower.contains("format=mpd") -> MimeTypes.APPLICATION_MPD

            cleanPath.endsWith(".mp4") || cleanPath.endsWith(".m4v") -> MimeTypes.VIDEO_MP4
            cleanPath.endsWith(".webm") -> MimeTypes.VIDEO_WEBM
            cleanPath.endsWith(".mkv") -> MimeTypes.VIDEO_MATROSKA
            else -> null
        }
    }

    fun isDirectMedia(url: String): Boolean {
        if (!isPlayableHttpUrl(url)) return false
        if (inferMimeType(url) != null) return true
        val lower = url.lowercase(Locale.ROOT)
        return lower.contains("/stream/") ||
            lower.contains("/playlist") ||
            lower.contains("mime=video") ||
            lower.contains(".ts?") ||
            lower.endsWith(".ts")
    }

    fun isPlayableHttpUrl(url: String): Boolean {
        val trimmed = url.trim()
        if (!trimmed.startsWith("https://", ignoreCase = true) &&
            !trimmed.startsWith("http://", ignoreCase = true)
        ) {
            return false
        }
        val cleanPath = trimmed.substringBefore('#').substringBefore('?').lowercase(Locale.ROOT)
        if (cleanPath.endsWith(".torrent")) return false
        val lower = trimmed.lowercase(Locale.ROOT)
        return NON_STREAM_PATTERNS.none { lower.contains(it) }
    }

    fun sanitizeServers(servers: List<Video.Server>): List<Video.Server> {
        val seen = HashSet<String>()
        return servers.filter { server ->
            val targetUrl = server.video?.source?.ifBlank { server.src } ?: server.src
            if (!isPlayableHttpUrl(targetUrl)) return@filter false
            val dedupKey = "${targetUrl.trim()}|${server.video?.headers?.entries?.sortedBy { it.key }?.joinToString("&") { "${it.key}=${it.value}" }.orEmpty()}"
            seen.add(dedupKey)
        }
    }
}
