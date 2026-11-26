package com.streamflixreborn.streamflix.plugins

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import java.net.URI

/**
 * Resolves raw manifest URLs (including GitHub repo/blob/tree shortcuts) and parses
 * Nuvio-compatible `manifest.json` files leniently.
 */
object PluginManifestParser {

    private val lenientJson = Json {
        ignoreUnknownKeys = true
        isLenient = true
    }

    private val GITHUB_BLOB_REGEX =
        Regex("""^https?://github\.com/([^/]+)/([^/]+)/(?:blob|raw)/([^/]+)/(.+)$""", RegexOption.IGNORE_CASE)
    private val GITHUB_TREE_REGEX =
        Regex("""^https?://github\.com/([^/]+)/([^/]+)/tree/([^/]+)(?:/(.*))?$""", RegexOption.IGNORE_CASE)
    private val GITHUB_REPO_REGEX =
        Regex("""^https?://github\.com/([^/]+)/([^/?#]+)/?$""", RegexOption.IGNORE_CASE)

    fun normalizeManifestUrlCandidates(rawInput: String): List<String> {
        var cleaned = rawInput.trim()
            .trim('"', '\'', '`')
            .removePrefix("nuvio://")
            .trim()

        if (cleaned.startsWith("streamflix://plugin", ignoreCase = true)) {
            val query = cleaned.substringAfter('?', "")
            val urlParam = query.split('&')
                .firstOrNull { it.startsWith("url=", ignoreCase = true) }
                ?.substringAfter('=')
                ?.let { java.net.URLDecoder.decode(it, "UTF-8") }
            if (!urlParam.isNullOrBlank()) {
                cleaned = urlParam.trim()
            }
        }

        if (cleaned.isBlank()) return emptyList()

        if (!cleaned.startsWith("http://", ignoreCase = true) &&
            !cleaned.startsWith("https://", ignoreCase = true)
        ) {
            cleaned = "https://$cleaned"
        }

        GITHUB_BLOB_REGEX.matchEntire(cleaned)?.let { match ->
            val (owner, repo, branch, path) = match.destructured
            val cleanRepo = repo.removeSuffix(".git")
            return listOf("https://raw.githubusercontent.com/$owner/$cleanRepo/$branch/$path")
        }

        GITHUB_TREE_REGEX.matchEntire(cleaned)?.let { match ->
            val owner = match.groupValues[1]
            val repo = match.groupValues[2].removeSuffix(".git")
            val branch = match.groupValues[3]
            val subPath = match.groupValues.getOrNull(4)?.trim('/').orEmpty()
            val prefix = if (subPath.isEmpty()) "" else "$subPath/"
            return listOf("https://raw.githubusercontent.com/$owner/$repo/$branch/${prefix}manifest.json")
        }

        GITHUB_REPO_REGEX.matchEntire(cleaned)?.let { match ->
            val owner = match.groupValues[1]
            val repo = match.groupValues[2].removeSuffix(".git")
            return listOf(
                "https://raw.githubusercontent.com/$owner/$repo/main/manifest.json",
                "https://raw.githubusercontent.com/$owner/$repo/master/manifest.json",
            )
        }

        val withoutQuery = cleaned.substringBefore('?').substringBefore('#')
        if (withoutQuery.endsWith(".json", ignoreCase = true)) {
            return listOf(cleaned)
        }

        val trimmedSlash = cleaned.trimEnd('/')
        return listOf(
            "$trimmedSlash/manifest.json",
            cleaned,
        )
    }

    fun computeBaseUrl(manifestUrl: String): String {
        val clean = manifestUrl.substringBefore('?').substringBefore('#')
        val slashIndex = clean.lastIndexOf('/')
        return if (slashIndex > "https://".length) {
            clean.substring(0, slashIndex)
        } else {
            clean.trimEnd('/')
        }
    }

    fun resolveScriptUrl(baseUrl: String, filename: String): String {
        val trimmed = filename.trim()
        if (trimmed.startsWith("https://", ignoreCase = true) ||
            trimmed.startsWith("http://", ignoreCase = true)
        ) {
            return trimmed
        }
        val cleanRel = trimmed.removePrefix("./").removePrefix("/")
        return try {
            URI("${baseUrl.trimEnd('/')}/").resolve(cleanRel).toString()
        } catch (_: Exception) {
            "${baseUrl.trimEnd('/')}/$cleanRel"
        }
    }

    fun parse(jsonString: String): PluginManifest {
        val root = lenientJson.parseToJsonElement(jsonString.trim()).jsonObject
        val repoName = root.stringOrNull("name")?.takeIf { it.isNotBlank() }
            ?: throw IllegalArgumentException("El manifest.json no contiene el campo obligatorio 'name'.")
        val repoVersion = root.stringOrVersion("version") ?: "1.0.0"
        val description = root.stringOrNull("description")
        val author = root.stringOrNull("author")

        val scrapersArray: JsonArray = (
            root["scrapers"]
                ?: root["providers"]
                ?: root["plugins"]
            )?.let { it as? JsonArray }
            ?: throw IllegalArgumentException("El manifest.json no contiene una lista 'scrapers' o 'providers'.")

        val entries = scrapersArray.mapNotNull { elem ->
            val obj = elem as? JsonObject ?: return@mapNotNull null
            val id = obj.stringOrNull("id")?.takeIf { it.isNotBlank() } ?: return@mapNotNull null
            val name = obj.stringOrNull("name")?.takeIf { it.isNotBlank() } ?: id
            val filename = (
                obj.stringOrNull("filename")
                    ?: obj.stringOrNull("file")
                    ?: obj.stringOrNull("script")
                    ?: obj.stringOrNull("url")
                )?.takeIf { it.isNotBlank() } ?: return@mapNotNull null

            val supportedTypes = obj.stringList("supportedTypes")
                .ifEmpty { obj.stringList("types") }
                .ifEmpty { listOf("movie", "tv") }

            val formats = obj.stringList("formats")
                .ifEmpty { obj.stringList("supportedFormats") }
                .takeIf { it.isNotEmpty() }

            ScraperManifestEntry(
                id = id,
                name = name,
                description = obj.stringOrNull("description"),
                version = obj.stringOrVersion("version") ?: "1.0.0",
                filename = filename,
                supportedTypes = supportedTypes,
                enabled = obj.boolOrDefault("enabled", true),
                hasSettings = obj.boolOrDefault("hasSettings", false),
                logo = obj.stringOrNull("logo") ?: obj.stringOrNull("icon"),
                contentLanguage = obj.stringList("contentLanguage")
                    .ifEmpty { obj.stringList("languages") }
                    .ifEmpty { obj.stringList("language") },
                supportedPlatforms = obj.stringList("supportedPlatforms").takeIf { it.isNotEmpty() },
                disabledPlatforms = obj.stringList("disabledPlatforms").takeIf { it.isNotEmpty() },
                formats = formats,
            )
        }

        return PluginManifest(
            name = repoName,
            version = repoVersion,
            description = description,
            author = author,
            scrapers = entries,
        )
    }

    private fun JsonObject.stringOrNull(key: String): String? {
        val el = this[key] as? JsonPrimitive ?: return null
        if (!el.isString && el.content == "null") return null
        return el.content.takeIf { it != "null" }
    }

    private fun JsonObject.stringOrVersion(key: String): String? {
        val el = this[key] as? JsonPrimitive ?: return null
        return el.content.takeIf { it.isNotBlank() && it != "null" }
    }

    private fun JsonObject.boolOrDefault(key: String, default: Boolean): Boolean {
        val el = this[key] as? JsonPrimitive ?: return default
        return el.booleanOrNull ?: when (el.content.lowercase()) {
            "true", "1" -> true
            "false", "0" -> false
            else -> default
        }
    }

    private fun JsonObject.stringList(key: String): List<String> {
        val el: JsonElement = this[key] ?: return emptyList()
        return when (el) {
            is JsonArray -> el.mapNotNull { (it as? JsonPrimitive)?.content?.trim()?.takeIf(String::isNotEmpty) }
            is JsonPrimitive -> {
                val raw = el.content.trim()
                if (raw.isEmpty() || raw == "null") emptyList()
                else raw.split(',').map { it.trim() }.filter { it.isNotEmpty() }
            }
            else -> emptyList()
        }
    }
}
