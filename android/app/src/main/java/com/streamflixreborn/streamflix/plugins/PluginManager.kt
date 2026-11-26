package com.streamflixreborn.streamflix.plugins

import android.content.Context
import android.util.Log
import com.streamflixreborn.streamflix.models.Video
import com.streamflixreborn.streamflix.utils.TMDb3
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * Central coordinator for external Nuvio-compatible JS plugin repositories (`manifest.json`).
 *
 * All stream resolution in StreamFlix Mobile goes exclusively through installed external plugins;
 * zero internal scrapers or extractors exist in the app.
 */
class PluginManager(
    private val store: PluginStore,
    private val httpClient: OkHttpClient = defaultHttpClient(),
    private val runtime: PluginRuntime = PluginRuntime(
        httpClient = httpClient,
        tmdbApiKeyProvider = { TMDb3.effectiveApiKey() },
    ),
    private val ioDispatcher: CoroutineDispatcher = Dispatchers.IO,
) {
    companion object {
        private const val TAG = "PluginManager"
        private const val MAX_CONCURRENT_SCRAPERS = 4

        @Volatile
        private var sharedInstance: PluginManager? = null

        fun initialize(context: Context): PluginManager {
            sharedInstance?.let { return it }
            return synchronized(this) {
                sharedInstance ?: PluginManager(
                    store = PluginStore(File(context.applicationContext.filesDir, "nuvio_plugins")),
                ).also { sharedInstance = it }
            }
        }

        fun getInstance(context: Context? = null): PluginManager {
            sharedInstance?.let { return it }
            val ctx = context ?: com.streamflixreborn.streamflix.StreamFlixApp.instance.applicationContext
            return initialize(ctx)
        }

        fun defaultHttpClient(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(25, TimeUnit.SECONDS)
            .writeTimeout(20, TimeUnit.SECONDS)
            .followRedirects(true)
            .followSslRedirects(true)
            .build()
    }

    private val mutex = Mutex()

    private val _repositories = MutableStateFlow<List<PluginRepository>>(emptyList())
    val repositories: StateFlow<List<PluginRepository>> = _repositories.asStateFlow()

    private val _scrapers = MutableStateFlow<List<InstalledScraper>>(emptyList())
    val scrapers: StateFlow<List<InstalledScraper>> = _scrapers.asStateFlow()

    init {
        val initial = store.loadState()
        _repositories.value = initial.repositories
        _scrapers.value = initial.scrapers
    }

    fun hasEnabledScrapers(): Boolean {
        val enabledRepoIds = _repositories.value.filter { it.enabled }.map { it.id }.toSet()
        return _scrapers.value.any { it.enabled && it.repositoryId in enabledRepoIds }
    }

    fun enabledScraperCount(): Int {
        val enabledRepoIds = _repositories.value.filter { it.enabled }.map { it.id }.toSet()
        return _scrapers.value.count { it.enabled && it.repositoryId in enabledRepoIds }
    }

    /**
     * Installs or updates a Nuvio plugin repository from a raw `manifest.json` URL
     * (or GitHub repo/blob/tree URL).
     */
    suspend fun addRepository(rawManifestInput: String): Result<PluginRepository> =
        withContext(ioDispatcher) {
            runCatching {
                val candidates = PluginManifestParser.normalizeManifestUrlCandidates(rawManifestInput)
                if (candidates.isEmpty()) {
                    throw IllegalArgumentException("Introduce una URL válida de manifest.json.")
                }

                var resolvedUrl: String? = null
                var manifest: PluginManifest? = null
                var lastError: Throwable? = null

                for (candidate in candidates) {
                    try {
                        val body = downloadText(candidate)
                        val parsed = PluginManifestParser.parse(body)
                        resolvedUrl = candidate
                        manifest = parsed
                        break
                    } catch (e: Throwable) {
                        lastError = e
                    }
                }

                val finalManifestUrl = resolvedUrl
                    ?: throw (lastError ?: IllegalArgumentException("No se pudo descargar el manifest.json"))
                val finalManifest = manifest!!

                installParsedManifest(finalManifestUrl, finalManifest)
            }
        }

    suspend fun refreshRepository(repositoryId: String): Result<PluginRepository> =
        withContext(ioDispatcher) {
            runCatching {
                val repo = _repositories.value.find { it.id == repositoryId }
                    ?: throw IllegalArgumentException("Repositorio no encontrado.")
                val body = downloadText(repo.manifestUrl)
                val manifest = PluginManifestParser.parse(body)
                installParsedManifest(repo.manifestUrl, manifest, preserveEnabledState = true)
            }
        }

    suspend fun refreshAllRepositories(): Int = withContext(ioDispatcher) {
        val currentRepos = _repositories.value
        var updatedCount = 0
        for (repo in currentRepos) {
            if (refreshRepository(repo.id).isSuccess) {
                updatedCount++
            }
        }
        updatedCount
    }

    suspend fun setRepositoryEnabled(repositoryId: String, enabled: Boolean) {
        mutex.withLock {
            val updatedRepos = _repositories.value.map {
                if (it.id == repositoryId) it.copy(enabled = enabled) else it
            }
            persist(updatedRepos, _scrapers.value)
        }
    }

    suspend fun setScraperEnabled(uniqueKey: String, enabled: Boolean) {
        mutex.withLock {
            val updatedScrapers = _scrapers.value.map {
                if (it.uniqueKey == uniqueKey) it.copy(enabled = enabled) else it
            }
            persist(_repositories.value, updatedScrapers)
        }
    }

    suspend fun removeRepository(repositoryId: String) {
        mutex.withLock {
            val currentScrapers = _scrapers.value
            store.deleteRepositoryScripts(repositoryId, currentScrapers)
            val remainingRepos = _repositories.value.filterNot { it.id == repositoryId }
            val remainingScrapers = currentScrapers.filterNot { it.repositoryId == repositoryId }
            persist(remainingRepos, remainingScrapers)
        }
    }

    /**
     * Executes all enabled scrapers supporting [mediaType] (`"movie"` or `"tv"`) and converts
     * their streams into playable StreamFlix [Video.Server] entries with pre-populated [Video]
     * (including HTTP headers and subtitles).
     */
    suspend fun getServersForMedia(
        tmdbId: String,
        mediaType: String,
        season: Int? = null,
        episode: Int? = null,
        imdbId: String? = null,
    ): List<Video.Server> = withContext(ioDispatcher) {
        val enabledRepoIds = _repositories.value.filter { it.enabled }.map { it.id }.toSet()
        val matchingScrapers = _scrapers.value.filter { scraper ->
            scraper.enabled &&
                scraper.repositoryId in enabledRepoIds &&
                scraper.supportsMediaType(mediaType)
        }

        if (matchingScrapers.isEmpty()) {
            Log.w(TAG, "No enabled external scrapers found for mediaType=$mediaType tmdbId=$tmdbId")
            return@withContext emptyList()
        }

        val semaphore = Semaphore(MAX_CONCURRENT_SCRAPERS)
        val allResults: List<PluginStreamResult> = coroutineScope {
            matchingScrapers.map { scraper ->
                async {
                    semaphore.withPermit {
                        runSingleScraper(
                            scraper = scraper,
                            tmdbId = tmdbId,
                            mediaType = mediaType,
                            season = season,
                            episode = episode,
                            imdbId = imdbId,
                        )
                    }
                }
            }.awaitAll().flatten()
        }

        val rawServers = allResults.mapIndexed { index, stream ->
            val video = Video(
                source = stream.url,
                subtitles = stream.subtitles.map { sub ->
                    Video.Subtitle(
                        label = sub.label,
                        file = sub.url,
                    )
                },
                headers = stream.headers,
                type = StreamFormatHelper.inferMimeType(stream.url, stream.type),
            )
            Video.Server(
                id = "plugin_${stream.scraperId}_${index}_${stream.url.hashCode()}",
                name = stream.buildServerLabel(),
                src = stream.url,
            ).also { server ->
                server.video = video
            }
        }

        StreamFormatHelper.sanitizeServers(rawServers)
    }

    private suspend fun runSingleScraper(
        scraper: InstalledScraper,
        tmdbId: String,
        mediaType: String,
        season: Int?,
        episode: Int?,
        imdbId: String?,
    ): List<PluginStreamResult> {
        val code = store.readScraperCode(scraper.uniqueKey)
            ?: runCatching {
                downloadText(scraper.scriptUrl).also { store.writeScraperCode(scraper.uniqueKey, it) }
            }.getOrNull()

        if (code.isNullOrBlank()) {
            Log.w(TAG, "Scraper code missing for ${scraper.name} (${scraper.scriptUrl})")
            return emptyList()
        }

        return runtime.executeScraper(
            scraper = scraper,
            code = code,
            tmdbId = tmdbId,
            mediaType = mediaType,
            season = season,
            episode = episode,
            imdbId = imdbId,
        )
    }

    private suspend fun installParsedManifest(
        manifestUrl: String,
        manifest: PluginManifest,
        preserveEnabledState: Boolean = true,
    ): PluginRepository = mutex.withLock {
        val repositoryId = PluginStore.repositoryIdForUrl(manifestUrl)
        val baseUrl = PluginManifestParser.computeBaseUrl(manifestUrl)
        val existingRepo = _repositories.value.find { it.id == repositoryId }
        val existingScrapersByKey = _scrapers.value
            .filter { it.repositoryId == repositoryId }
            .associateBy { it.uniqueKey }

        val compatibleEntries = manifest.scrapers.filter { it.isCompatibleWithMobile() }
        if (compatibleEntries.isEmpty()) {
            throw IllegalArgumentException("El manifest '${manifest.name}' no contiene scrapers compatibles con Android móvil.")
        }

        val semaphore = Semaphore(6)
        val downloadedPairs = coroutineScope {
            compatibleEntries.map { entry ->
                async {
                    semaphore.withPermit {
                        val scriptUrl = PluginManifestParser.resolveScriptUrl(baseUrl, entry.filename)
                        val uniqueKey = InstalledScraper.buildUniqueKey(repositoryId, entry.id)
                        val scriptCode = runCatching { downloadText(scriptUrl) }.getOrNull()
                            ?: store.readScraperCode(uniqueKey)

                        if (scriptCode.isNullOrBlank()) {
                            Log.w(TAG, "Skipping scraper '${entry.name}': failed to download $scriptUrl")
                            null
                        } else {
                            val previous = existingScrapersByKey[uniqueKey]
                            val isEnabled = if (preserveEnabledState && previous != null) {
                                previous.enabled
                            } else {
                                entry.enabled
                            }
                            val installed = InstalledScraper(
                                uniqueKey = uniqueKey,
                                id = entry.id,
                                repositoryId = repositoryId,
                                repositoryName = manifest.name,
                                name = entry.name,
                                description = entry.description.orEmpty(),
                                version = entry.version,
                                filename = entry.filename,
                                scriptUrl = scriptUrl,
                                supportedTypes = entry.supportedTypes,
                                enabled = isEnabled,
                                manifestEnabled = entry.enabled,
                                logo = entry.logo?.let {
                                    if (it.startsWith("http://", true) || it.startsWith("https://", true)) it
                                    else PluginManifestParser.resolveScriptUrl(baseUrl, it)
                                },
                                contentLanguage = entry.contentLanguage,
                                formats = entry.formats.orEmpty(),
                            )
                            installed to scriptCode
                        }
                    }
                }
            }.awaitAll().filterNotNull()
        }

        if (downloadedPairs.isEmpty()) {
            throw IllegalStateException("No se pudo descargar ningún archivo JS de '${manifest.name}'. Verifica la URL raw del manifest.")
        }

        downloadedPairs.forEach { (scraper, code) ->
            store.writeScraperCode(scraper.uniqueKey, code)
        }

        val installedScrapers = downloadedPairs.map { it.first }
        val updatedRepository = PluginRepository(
            id = repositoryId,
            name = manifest.name,
            manifestUrl = manifestUrl,
            baseUrl = baseUrl,
            version = manifest.version,
            description = manifest.description,
            author = manifest.author,
            enabled = existingRepo?.enabled ?: true,
            lastUpdated = System.currentTimeMillis(),
            scraperCount = installedScrapers.size,
        )

        val mergedRepos = _repositories.value
            .filterNot { it.id == repositoryId } + updatedRepository
        val mergedScrapers = _scrapers.value
            .filterNot { it.repositoryId == repositoryId } + installedScrapers

        persist(mergedRepos, mergedScrapers)
        updatedRepository
    }

    private fun persist(
        repos: List<PluginRepository>,
        scrapers: List<InstalledScraper>,
    ) {
        _repositories.value = repos
        _scrapers.value = scrapers
        store.saveState(PluginStore.PersistedState(repositories = repos, scrapers = scrapers))
    }

    private fun downloadText(url: String): String {
        val request = Request.Builder()
            .url(url)
            .header(
                "User-Agent",
                "StreamFlix-Mobile-Plugins/1.1 (Android; NuvioManifestCompatible)"
            )
            .header("Accept", "application/json, application/javascript, text/plain, */*")
            .get()
            .build()

        httpClient.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw IllegalStateException("HTTP ${response.code} al descargar $url")
            }
            val body = response.body?.string()
                ?: throw IllegalStateException("Respuesta vacía desde $url")
            if (body.isBlank()) {
                throw IllegalStateException("Contenido vacío desde $url")
            }
            return body
        }
    }
}
