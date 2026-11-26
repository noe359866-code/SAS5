package com.streamflixreborn.streamflix.plugins

import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.File
import java.security.MessageDigest

/**
 * File-backed persistence for installed Nuvio plugin repositories and cached JS scraper files.
 */
class PluginStore(
    private val rootDir: File,
) {
    @Serializable
    data class PersistedState(
        val repositories: List<PluginRepository> = emptyList(),
        val scrapers: List<InstalledScraper> = emptyList(),
    )

    private val json = Json {
        ignoreUnknownKeys = true
        prettyPrint = true
        encodeDefaults = true
    }

    private val indexFile: File = File(rootDir, "plugins_index.json")
    private val scriptsDir: File = File(rootDir, "scripts")

    init {
        rootDir.mkdirs()
        scriptsDir.mkdirs()
    }

    @Synchronized
    fun loadState(): PersistedState {
        if (!indexFile.exists()) return PersistedState()
        return try {
            json.decodeFromString(PersistedState.serializer(), indexFile.readText(Charsets.UTF_8))
        } catch (_: Exception) {
            PersistedState()
        }
    }

    @Synchronized
    fun saveState(state: PersistedState) {
        rootDir.mkdirs()
        val tmpFile = File(rootDir, "plugins_index.json.tmp")
        tmpFile.writeText(json.encodeToString(state), Charsets.UTF_8)
        if (!tmpFile.renameTo(indexFile)) {
            indexFile.writeText(json.encodeToString(state), Charsets.UTF_8)
            tmpFile.delete()
        }
    }

    @Synchronized
    fun writeScraperCode(uniqueKey: String, code: String) {
        scriptsDir.mkdirs()
        scriptFileFor(uniqueKey).writeText(code, Charsets.UTF_8)
    }

    @Synchronized
    fun readScraperCode(uniqueKey: String): String? {
        val file = scriptFileFor(uniqueKey)
        if (!file.exists()) return null
        return runCatching { file.readText(Charsets.UTF_8) }.getOrNull()
    }

    @Synchronized
    fun deleteRepositoryScripts(repositoryId: String, scrapers: List<InstalledScraper>) {
        scrapers.filter { it.repositoryId == repositoryId }.forEach { scraper ->
            scriptFileFor(scraper.uniqueKey).delete()
        }
    }

    private fun scriptFileFor(uniqueKey: String): File {
        val hash = sha256Hex(uniqueKey).take(32)
        return File(scriptsDir, "$hash.js")
    }

    companion object {
        fun repositoryIdForUrl(manifestUrl: String): String {
            val normalized = manifestUrl.trim().lowercase()
            return "repo_" + sha256Hex(normalized).take(16)
        }

        private fun sha256Hex(value: String): String {
            val digest = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8))
            val sb = StringBuilder(digest.size * 2)
            for (b in digest) {
                sb.append(((b.toInt() shr 4) and 0xF).toString(16))
                sb.append((b.toInt() and 0xF).toString(16))
            }
            return sb.toString()
        }
    }
}
