package com.streamflixreborn.streamflix.plugins

import kotlinx.serialization.Serializable
import java.util.Locale

@Serializable
data class PluginRepository(
    val id: String,
    val name: String,
    val manifestUrl: String,
    val baseUrl: String,
    val version: String = "1.0.0",
    val description: String? = null,
    val author: String? = null,
    val enabled: Boolean = true,
    val lastUpdated: Long = 0L,
    val scraperCount: Int = 0,
)

@Serializable
data class PluginManifest(
    val name: String,
    val version: String = "1.0.0",
    val description: String? = null,
    val author: String? = null,
    val scrapers: List<ScraperManifestEntry> = emptyList(),
)

@Serializable
data class ScraperManifestEntry(
    val id: String,
    val name: String,
    val description: String? = null,
    val version: String = "1.0.0",
    val filename: String,
    val supportedTypes: List<String> = listOf("movie", "tv"),
    val enabled: Boolean = true,
    val hasSettings: Boolean = false,
    val logo: String? = null,
    val contentLanguage: List<String> = emptyList(),
    val supportedPlatforms: List<String>? = null,
    val disabledPlatforms: List<String>? = null,
    val formats: List<String>? = null,
) {
    fun isCompatibleWithMobile(): Boolean {
        val disabled = disabledPlatforms?.map { it.lowercase(Locale.ROOT).trim() }.orEmpty()
        if ("android" in disabled || "mobile" in disabled) return false

        val supported = supportedPlatforms?.map { it.lowercase(Locale.ROOT).trim() }.orEmpty()
        if (supported.isNotEmpty() && "android" !in supported && "mobile" !in supported && "all" !in supported) {
            return false
        }
        return true
    }
}

@Serializable
data class InstalledScraper(
    val uniqueKey: String,
    val id: String,
    val repositoryId: String,
    val repositoryName: String,
    val name: String,
    val description: String = "",
    val version: String = "1.0.0",
    val filename: String,
    val scriptUrl: String,
    val supportedTypes: List<String> = listOf("movie", "tv"),
    val enabled: Boolean = true,
    val manifestEnabled: Boolean = true,
    val logo: String? = null,
    val contentLanguage: List<String> = emptyList(),
    val formats: List<String> = emptyList(),
) {
    fun supportsMediaType(requestedType: String): Boolean {
        val normalizedRequested = normalizeMediaType(requestedType)
        if (supportedTypes.isEmpty()) return true
        return supportedTypes.any { normalizeMediaType(it) == normalizedRequested }
    }

    /**
     * Nuvio standard passes `"movie"` or `"tv"` to `getStreams(tmdbId, mediaType, season, episode)`.
     * If a manifest explicitly declares `"series"` without `"tv"`, pass `"series"` for compatibility.
     */
    fun preferredMediaTypeArg(requestedType: String): String {
        val normalized = normalizeMediaType(requestedType)
        if (normalized == "tv") {
            val rawLower = supportedTypes.map { it.lowercase(Locale.ROOT).trim() }
            if ("series" in rawLower && "tv" !in rawLower) {
                return "series"
            }
        }
        return normalized
    }

    companion object {
        fun buildUniqueKey(repositoryId: String, scraperId: String): String =
            "$repositoryId::$scraperId"

        fun normalizeMediaType(raw: String): String = when (raw.lowercase(Locale.ROOT).trim()) {
            "series", "show", "tvshow", "tv_show", "anime", "other" -> "tv"
            "film", "movies" -> "movie"
            else -> raw.lowercase(Locale.ROOT).trim()
        }
    }
}

data class PluginSubtitleResult(
    val id: String,
    val url: String,
    val label: String,
    val headers: Map<String, String>? = null,
)

data class PluginStreamResult(
    val scraperId: String,
    val scraperName: String,
    val repositoryName: String = "",
    val title: String,
    val name: String? = null,
    val url: String,
    val quality: String? = null,
    val size: String? = null,
    val language: String? = null,
    val provider: String? = null,
    val type: String? = null,
    val headers: Map<String, String>? = null,
    val subtitles: List<PluginSubtitleResult> = emptyList(),
) {
    fun buildServerLabel(): String {
        val sourceTag = (provider?.takeIf { it.isNotBlank() } ?: scraperName).trim()
        val primaryName = listOfNotNull(
            name?.trim()?.takeIf { it.isNotBlank() && !it.equals(sourceTag, ignoreCase = true) },
            title.trim().takeIf {
                it.isNotBlank() &&
                    !it.equals(sourceTag, ignoreCase = true) &&
                    !it.equals(name?.trim(), ignoreCase = true)
            }
        ).joinToString(" - ")

        val badges = buildList {
            quality?.trim()?.takeIf {
                it.isNotBlank() &&
                    !primaryName.contains(it, ignoreCase = true) &&
                    !sourceTag.contains(it, ignoreCase = true)
            }?.let { add(it) }

            language?.trim()?.takeIf {
                it.isNotBlank() && !primaryName.contains(it, ignoreCase = true)
            }?.let { add(it.uppercase(Locale.ROOT)) }

            size?.trim()?.takeIf {
                it.isNotBlank() && !primaryName.contains(it, ignoreCase = true)
            }?.let { add(it) }
        }

        val sb = StringBuilder()
        sb.append("[$sourceTag]")
        if (primaryName.isNotBlank()) {
            sb.append(" ").append(primaryName)
        }
        if (badges.isNotEmpty()) {
            sb.append(" · ").append(badges.joinToString(" · "))
        }
        return sb.toString().replace(Regex("\\s+"), " ").trim()
    }
}
