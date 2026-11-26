package com.streamflixreborn.streamflix.plugins

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PluginManifestParserTest {

    @Test
    fun `parse standard Nuvio manifest with scrapers and platform filters`() {
        val json = """
            {
              "name": "Nuvio Community Scrapers",
              "version": "2.1.0",
              "description": "External JS providers",
              "author": "community",
              "scrapers": [
                {
                  "id": "vidsrc",
                  "name": "VidSrc",
                  "version": "1.3.0",
                  "filename": "providers/vidsrc.js",
                  "supportedTypes": ["movie", "tv"],
                  "enabled": true,
                  "contentLanguage": ["es", "en"],
                  "formats": ["m3u8", "mp4"]
                },
                {
                  "id": "tv_only_scraper",
                  "name": "TV Only",
                  "version": "1.0.0",
                  "filename": "providers/tv_only.js",
                  "supportedTypes": ["movie"],
                  "disabledPlatforms": ["mobile"]
                }
              ]
            }
        """.trimIndent()

        val manifest = PluginManifestParser.parse(json)
        assertEquals("Nuvio Community Scrapers", manifest.name)
        assertEquals("2.1.0", manifest.version)
        assertEquals(2, manifest.scrapers.size)

        val vidsrc = manifest.scrapers.first { it.id == "vidsrc" }
        assertTrue(vidsrc.isCompatibleWithMobile())
        assertEquals(listOf("es", "en"), vidsrc.contentLanguage)

        val tvOnly = manifest.scrapers.first { it.id == "tv_only_scraper" }
        assertFalse(tvOnly.isCompatibleWithMobile())
    }

    @Test
    fun `normalizeManifestUrlCandidates converts GitHub repo and blob URLs to raw manifest URLs`() {
        val fromRepo = PluginManifestParser.normalizeManifestUrlCandidates(
            "https://github.com/example/nuvio-providers"
        )
        assertTrue(
            fromRepo.contains("https://raw.githubusercontent.com/example/nuvio-providers/main/manifest.json")
        )
        assertTrue(
            fromRepo.contains("https://raw.githubusercontent.com/example/nuvio-providers/master/manifest.json")
        )

        val fromBlob = PluginManifestParser.normalizeManifestUrlCandidates(
            "https://github.com/example/nuvio-providers/blob/main/plugins/manifest.json"
        )
        assertEquals(
            listOf("https://raw.githubusercontent.com/example/nuvio-providers/main/plugins/manifest.json"),
            fromBlob
        )
    }

    @Test
    fun `resolveScriptUrl resolves relative scraper paths against manifest base URL`() {
        val manifestUrl = "https://raw.githubusercontent.com/example/repo/main/sub/manifest.json"
        val baseUrl = PluginManifestParser.computeBaseUrl(manifestUrl)
        assertEquals("https://raw.githubusercontent.com/example/repo/main/sub", baseUrl)
        assertEquals(
            "https://raw.githubusercontent.com/example/repo/main/sub/providers/vidsrc.js",
            PluginManifestParser.resolveScriptUrl(baseUrl, "./providers/vidsrc.js")
        )
    }

    @Test
    fun `StreamFormatHelper detects HLS DASH MP4 and rejects magnet or torrent links`() {
        assertNull(StreamFormatHelper.inferMimeType("magnet:?xt=urn:btih:123456"))
        assertFalse(StreamFormatHelper.isPlayableHttpUrl("magnet:?xt=urn:btih:123456"))
        assertFalse(StreamFormatHelper.isPlayableHttpUrl("https://example.com/file.torrent"))

        assertTrue(StreamFormatHelper.isPlayableHttpUrl("https://cdn.example.com/live/master.m3u8?token=abc"))
        assertTrue(StreamFormatHelper.isPlayableHttpUrl("https://cdn.example.com/stream/opaque-endpoint"))
        assertNotNull(StreamFormatHelper.inferMimeType("https://cdn.example.com/live/master.m3u8?token=abc"))
    }
}
