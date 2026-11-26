package com.streamflixreborn.streamflix.plugins

import android.util.Log
import com.dokar.quickjs.QuickJs
import com.dokar.quickjs.QuickJsException
import com.dokar.quickjs.binding.define
import com.dokar.quickjs.binding.function
import com.dokar.quickjs.quickJs
import com.google.gson.Gson
import com.google.gson.GsonBuilder
import com.google.gson.reflect.TypeToken
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.withTimeout
import okhttp3.Call
import okhttp3.Headers
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.jsoup.Jsoup
import org.jsoup.nodes.Document
import org.jsoup.nodes.Element
import org.jsoup.select.Elements
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.URL
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import java.util.Collections
import java.util.Locale
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.zip.GZIPInputStream
import java.util.zip.InflaterInputStream
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec
import kotlin.coroutines.coroutineContext

/**
 * Sandboxed QuickJS runtime executing external Nuvio-compatible JS scrapers (`manifest.json`).
 *
 * Exposes standard Web/Node/Nuvio APIs to plugin scripts:
 * - Async `fetch` / `Headers` / `Request` / `Response` / `AbortController` backed by OkHttp
 * - `axios` (`axios.get`, `axios.post`, `axios.request`, `axios.create`)
 * - `cheerio` (`require('cheerio')`) backed by Jsoup
 * - `CryptoJS` (`require('crypto-js')`) backed by `org.webjars.npm:crypto-js`
 * - WebCrypto (`crypto.getRandomValues`, `crypto.randomUUID`, `crypto.subtle`)
 * - `URL`, `URLSearchParams`, `atob`, `btoa`, `Buffer`, `TextEncoder`, `TextDecoder`
 * - `setTimeout` / `clearTimeout` / `setInterval` / `clearInterval`
 * - `TMDB_API_KEY`, `SCRAPER_ID`, `SCRAPER_SETTINGS`, `IMDB_ID`
 */
class PluginRuntime(
    private val httpClient: OkHttpClient = defaultHttpClient(),
    private val tmdbApiKeyProvider: () -> String = { "" },
    private val pluginTimeoutMs: Long = DEFAULT_PLUGIN_TIMEOUT_MS,
) {
    companion object {
        private const val TAG = "PluginRuntime"
        const val DEFAULT_PLUGIN_TIMEOUT_MS = 45_000L
        private const val MAX_FETCH_RESPONSE_BYTES = 2 * 1024 * 1024
        private const val MAX_FETCH_BODY_CHARS = 2 * 1024 * 1024
        private const val QUICKJS_MEMORY_LIMIT = 64L * 1024 * 1024
        private const val QUICKJS_MAX_STACK_SIZE = 1024L * 1024
        private const val DEFAULT_USER_AGENT =
            "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36"

        fun defaultHttpClient(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(25, TimeUnit.SECONDS)
            .writeTimeout(20, TimeUnit.SECONDS)
            .followRedirects(true)
            .followSslRedirects(true)
            .build()
    }

    private val gson: Gson = GsonBuilder().disableHtmlEscaping().create()
    private val containsSelectorRegex = Regex(""":contains\(["']([^"']+)["']\)""")
    private val secureRandom = SecureRandom()

    @Volatile
    private var cachedCryptoJsSource: String? = null

    @Volatile
    private var compiledCryptoJsBytecode: ByteArray? = null

    @Volatile
    private var compiledPolyfillBytecode: ByteArray? = null

    @Volatile
    private var compiledCallBytecode: ByteArray? = null

    suspend fun executeScraper(
        scraper: InstalledScraper,
        code: String,
        tmdbId: String,
        mediaType: String,
        season: Int?,
        episode: Int?,
        imdbId: String? = null,
        scraperSettings: Map<String, Any?> = emptyMap(),
    ): List<PluginStreamResult> = withTimeout(pluginTimeoutMs) {
        executeScraperInternal(
            scraper = scraper,
            code = code,
            tmdbId = tmdbId,
            mediaType = scraper.preferredMediaTypeArg(mediaType),
            season = season,
            episode = episode,
            imdbId = imdbId,
            scraperSettings = scraperSettings,
        )
    }

    private suspend fun executeScraperInternal(
        scraper: InstalledScraper,
        code: String,
        tmdbId: String,
        mediaType: String,
        season: Int?,
        episode: Int?,
        imdbId: String?,
        scraperSettings: Map<String, Any?>,
    ): List<PluginStreamResult> {
        val documentCache = ConcurrentHashMap<String, Document>()
        val loadedDocIds = Collections.synchronizedList(mutableListOf<String>())
        val elementCache = ConcurrentHashMap<String, Element>()
        val inFlightCalls = ConcurrentHashMap.newKeySet<Call>()

        val currentJob = coroutineContext[Job]
        val cancelHandle = currentJob?.invokeOnCompletion { cause ->
            if (cause is CancellationException) {
                inFlightCalls.forEach { call -> runCatching { call.cancel() } }
            }
        }

        var capturedResultJson = "[]"
        val callArgsJson = gson.toJson(
            mapOf(
                "tmdbId" to tmdbId,
                "mediaType" to mediaType,
                "season" to season,
                "episode" to episode,
                "imdbId" to imdbId,
            )
        )
        val settingsJson = gson.toJson(scraperSettings)
        val qjsExecutor = Executors.newSingleThreadExecutor { runnable ->
            Thread(runnable, "streamflix-qjs-${scraper.id}").apply {
                isDaemon = true
            }
        }
        val qjsDispatcher = qjsExecutor.asCoroutineDispatcher()

        try {
            quickJs(qjsDispatcher) {
                memoryLimit = QUICKJS_MEMORY_LIMIT
                maxStackSize = QUICKJS_MAX_STACK_SIZE

                define("console") {
                    function("log") { args ->
                        Log.d("Plugin:${scraper.id}", args.joinToString(" ") { it?.toString() ?: "null" })
                        null
                    }
                    function("info") { args ->
                        Log.i("Plugin:${scraper.id}", args.joinToString(" ") { it?.toString() ?: "null" })
                        null
                    }
                    function("warn") { args ->
                        Log.w("Plugin:${scraper.id}", args.joinToString(" ") { it?.toString() ?: "null" })
                        null
                    }
                    function("error") { args ->
                        val msg = args.joinToString(" ") { it?.toString() ?: "null" }
                        if (Log.e("Plugin:${scraper.id}", msg) == 0) {
                            System.err.println("[Plugin:${scraper.id}] $msg")
                        }
                        null
                    }
                    function("debug") { args ->
                        Log.d("Plugin:${scraper.id}", args.joinToString(" ") { it?.toString() ?: "null" })
                        null
                    }
                }

                function("__get_scraper_id") { scraper.id }
                function("__get_scraper_settings") { settingsJson }
                function("__get_tmdb_api_key") { tmdbApiKeyProvider() }
                function("__get_imdb_id") { imdbId ?: "" }
                function("__get_call_args") { callArgsJson }
                function("__capture_result") { args ->
                    capturedResultJson = args.getOrNull(0)?.toString() ?: "[]"
                    null
                }

                function("__plugin_sleep") { args ->
                    val rawMs = when (val v = args.getOrNull(0)) {
                        is Number -> v.toLong()
                        is String -> v.toLongOrNull() ?: 0L
                        else -> 0L
                    }.coerceIn(0L, 15_000L)
                    if (rawMs > 0L) {
                        try {
                            Thread.sleep(rawMs)
                        } catch (_: InterruptedException) {
                            Thread.currentThread().interrupt()
                        }
                    }
                    null
                }

                function("__native_fetch") { args ->
                    val url = args.getOrNull(0)?.toString().orEmpty()
                    val method = args.getOrNull(1)?.toString() ?: "GET"
                    val headersJson = args.getOrNull(2)?.toString() ?: "{}"
                    val bodyKind = args.getOrNull(3)?.toString() ?: "none"
                    val bodyValue = args.getOrNull(4)?.toString().orEmpty()
                    val followRedirects = args.getOrNull(5)?.toString()?.let {
                        !it.equals("false", ignoreCase = true)
                    } ?: true

                    performNativeFetch(
                        url = url,
                        method = method,
                        headersJson = headersJson,
                        bodyKind = bodyKind,
                        body = bodyValue,
                        followRedirects = followRedirects,
                        inFlightCalls = inFlightCalls,
                    )
                }

                function("__parse_url") { args ->
                    parseUrlJson(args.getOrNull(0)?.toString().orEmpty())
                }

                registerDomBindings(documentCache, loadedDocIds, elementCache)
                registerCryptoBindings()

                evaluate<Any?>(getCompiledPolyfillBytecode(this))
                getCompiledCryptoJsBytecode(this)?.let { evaluate<Any?>(it) }

                evaluateScraperScript(this, code, "${scraper.id}.js")
                evaluate<Any?>(getCompiledCallBytecode(this))
            }
        } catch (ce: CancellationException) {
            throw ce
        } catch (t: Throwable) {
            if (Log.e(TAG, "Plugin '${scraper.name}' (${scraper.id}) failed: ${t.message}", t) == 0) {
                System.err.println("[$TAG] Plugin '${scraper.name}' (${scraper.id}) failed: ${t.message}")
            }
            return emptyList()
        } finally {
            runCatching { qjsDispatcher.close() }
            runCatching { qjsExecutor.shutdownNow() }
            cancelHandle?.dispose()
            inFlightCalls.forEach { call -> runCatching { call.cancel() } }
            inFlightCalls.clear()
            elementCache.clear()
            documentCache.clear()
            loadedDocIds.clear()
        }

        return parseStreamsJson(capturedResultJson, scraper)
    }

    private fun wrapPluginModule(body: String): String = buildString(body.length + 420) {
        append("var module = { exports: {} };\n")
        append("var exports = module.exports;\n")
        append("globalThis.module = module;\n")
        append("globalThis.exports = exports;\n")
        append("(function(module, exports, require) {\n")
        append(body)
        append("\nif (typeof getStreams === 'function' && (!module.exports || (typeof module.exports === 'object' && !module.exports.getStreams)) && !globalThis.getStreams) { module.exports.getStreams = getStreams; }\n")
        append("})(module, module.exports, globalThis.require);")
    }

    private suspend fun evaluateScraperScript(qjs: QuickJs, rawCode: String, filename: String) {
        try {
            qjs.evaluate<Any?>(wrapPluginModule(rawCode), filename)
        } catch (firstError: QuickJsException) {
            val transformed = transformEsmExportsIfNeeded(rawCode)
            if (transformed != rawCode) {
                qjs.evaluate<Any?>(wrapPluginModule(transformed), filename)
            } else {
                throw firstError
            }
        }
    }

    private fun transformEsmExportsIfNeeded(code: String): String {
        if (!code.contains("export ")) return code
        var out = code
        out = out.replace(
            Regex("""(?m)^\s*export\s+default\s+"""),
            "module.exports = "
        )
        out = out.replace(
            Regex("""(?m)^\s*export\s+(async\s+function|function)\s+([A-Za-z0-9_$]+)"""),
            "$1 $2"
        )
        out = out.replace(
            Regex("""(?m)^\s*export\s+(const|let|var)\s+([A-Za-z0-9_$]+)"""),
            "$1 $2"
        )
        out = out.replace(
            Regex("""(?m)^\s*export\s*\{([^}]+)\}\s*;?""")
        ) { match ->
            val bindings = match.groupValues[1].split(',').mapNotNull { token ->
                val parts = token.trim().split(Regex("""\s+as\s+"""))
                val local = parts.getOrNull(0)?.trim()?.takeIf { it.isNotEmpty() } ?: return@mapNotNull null
                val exported = parts.getOrNull(1)?.trim()?.takeIf { it.isNotEmpty() } ?: local
                "$exported: $local"
            }.joinToString(", ")
            "Object.assign(module.exports, { $bindings });"
        }
        if (!out.contains("module.exports.getStreams") && out.contains("function getStreams")) {
            out += "\nif (typeof getStreams === 'function' && (!module.exports || !module.exports.getStreams)) { module.exports.getStreams = getStreams; }\n"
        }
        return out
    }

    private fun QuickJs.registerDomBindings(
        documentCache: ConcurrentHashMap<String, Document>,
        loadedDocIds: MutableList<String>,
        elementCache: ConcurrentHashMap<String, Element>,
    ) {
        function("__cheerio_load") { args ->
            val html = args.getOrNull(0)?.toString().orEmpty()
            val docId = UUID.randomUUID().toString()
            documentCache[docId] = Jsoup.parse(html)
            loadedDocIds.add(docId)
            while (loadedDocIds.size > 12) {
                val evicted = runCatching { loadedDocIds.removeAt(0) }.getOrNull() ?: break
                documentCache.remove(evicted)
                elementCache.keys.removeIf { it.startsWith("$evicted:") }
            }
            docId
        }

        function("__cheerio_select") { args ->
            val docId = args.getOrNull(0)?.toString().orEmpty()
            val rawSelector = args.getOrNull(1)?.toString().orEmpty()
            val doc = documentCache[docId] ?: return@function "[]"
            try {
                val selector = rawSelector.replace(containsSelectorRegex, ":contains($1)")
                val elements = if (selector.isBlank()) Elements() else doc.select(selector)
                val ids = elements.mapIndexed { idx, el ->
                    val elId = "$docId:sel:$idx:${System.identityHashCode(el)}"
                    elementCache[elId] = el
                    elId
                }
                gson.toJson(ids)
            } catch (_: Exception) {
                "[]"
            }
        }

        function("__cheerio_find") { args ->
            val docId = args.getOrNull(0)?.toString().orEmpty()
            val elementId = args.getOrNull(1)?.toString().orEmpty()
            val rawSelector = args.getOrNull(2)?.toString().orEmpty()
            val element = elementCache[elementId] ?: return@function "[]"
            try {
                val selector = rawSelector.replace(containsSelectorRegex, ":contains($1)")
                val elements = if (selector.isBlank()) Elements() else element.select(selector)
                val ids = elements.mapIndexed { idx, el ->
                    val elId = "$docId:find:$idx:${System.identityHashCode(el)}"
                    elementCache[elId] = el
                    elId
                }
                gson.toJson(ids)
            } catch (_: Exception) {
                "[]"
            }
        }

        function("__cheerio_children") { args ->
            val docId = args.getOrNull(0)?.toString().orEmpty()
            val elementId = args.getOrNull(1)?.toString().orEmpty()
            val rawSelector = args.getOrNull(2)?.toString().orEmpty()
            val element = elementCache[elementId] ?: return@function "[]"
            try {
                val children = element.children()
                val filtered = if (rawSelector.isBlank()) {
                    children
                } else {
                    val selector = rawSelector.replace(containsSelectorRegex, ":contains($1)")
                    Elements(children.filter { it.`is`(selector) })
                }
                val ids = filtered.mapIndexed { idx, el ->
                    val elId = "$docId:child:$idx:${System.identityHashCode(el)}"
                    elementCache[elId] = el
                    elId
                }
                gson.toJson(ids)
            } catch (_: Exception) {
                "[]"
            }
        }

        function("__cheerio_parent") { args ->
            val docId = args.getOrNull(0)?.toString().orEmpty()
            val elementId = args.getOrNull(1)?.toString().orEmpty()
            val parent = elementCache[elementId]?.parent() ?: return@function "__NONE__"
            val parentId = "$docId:parent:${System.identityHashCode(parent)}"
            elementCache[parentId] = parent
            parentId
        }

        function("__cheerio_text") { args ->
            val elementIds = args.getOrNull(1)?.toString().orEmpty()
            val ids = elementIds.split(',').filter { it.isNotEmpty() }
            ids.mapNotNull { elementCache[it]?.text() }.joinToString(" ")
        }

        function("__cheerio_html") { args ->
            val docId = args.getOrNull(0)?.toString().orEmpty()
            val elementId = args.getOrNull(1)?.toString().orEmpty()
            if (elementId.isEmpty()) {
                documentCache[docId]?.outerHtml().orEmpty()
            } else {
                elementCache[elementId]?.outerHtml().orEmpty()
            }
        }

        function("__cheerio_inner_html") { args ->
            val elementId = args.getOrNull(1)?.toString().orEmpty()
            elementCache[elementId]?.html().orEmpty()
        }

        function("__cheerio_attr") { args ->
            val elementId = args.getOrNull(1)?.toString().orEmpty()
            val attrName = args.getOrNull(2)?.toString().orEmpty()
            val el = elementCache[elementId] ?: return@function "__UNDEFINED__"
            if (!el.hasAttr(attrName)) "__UNDEFINED__" else el.attr(attrName)
        }

        function("__cheerio_has_class") { args ->
            val elementId = args.getOrNull(1)?.toString().orEmpty()
            val className = args.getOrNull(2)?.toString().orEmpty()
            elementCache[elementId]?.hasClass(className) ?: false
        }

        function("__cheerio_next") { args ->
            val docId = args.getOrNull(0)?.toString().orEmpty()
            val elementId = args.getOrNull(1)?.toString().orEmpty()
            val next = elementCache[elementId]?.nextElementSibling() ?: return@function "__NONE__"
            val nextId = "$docId:next:${System.identityHashCode(next)}"
            elementCache[nextId] = next
            nextId
        }

        function("__cheerio_prev") { args ->
            val docId = args.getOrNull(0)?.toString().orEmpty()
            val elementId = args.getOrNull(1)?.toString().orEmpty()
            val prev = elementCache[elementId]?.previousElementSibling() ?: return@function "__NONE__"
            val prevId = "$docId:prev:${System.identityHashCode(prev)}"
            elementCache[prevId] = prev
            prevId
        }
    }

    private fun QuickJs.registerCryptoBindings() {
        function("__crypto_random_bytes") { args ->
            val size = ((args.getOrNull(0) as? Number)?.toInt() ?: 16).coerceIn(0, 65_536)
            val bytes = ByteArray(size)
            secureRandom.nextBytes(bytes)
            base64Encode(bytes)
        }

        function("__crypto_digest") { args ->
            val algoRaw = args.getOrNull(0)?.toString() ?: "SHA-256"
            val dataB64 = args.getOrNull(1)?.toString().orEmpty()
            val jcaAlgo = when (algoRaw.uppercase(Locale.ROOT).replace("-", "")) {
                "MD5" -> "MD5"
                "SHA1" -> "SHA-1"
                "SHA256" -> "SHA-256"
                "SHA384" -> "SHA-384"
                "SHA512" -> "SHA-512"
                else -> "SHA-256"
            }
            val digest = MessageDigest.getInstance(jcaAlgo).digest(base64Decode(dataB64))
            base64Encode(digest)
        }

        function("__crypto_hmac") { args ->
            val algoRaw = args.getOrNull(0)?.toString() ?: "SHA-256"
            val keyB64 = args.getOrNull(1)?.toString().orEmpty()
            val dataB64 = args.getOrNull(2)?.toString().orEmpty()
            val jcaAlgo = when (algoRaw.uppercase(Locale.ROOT).replace("-", "")) {
                "MD5" -> "HmacMD5"
                "SHA1" -> "HmacSHA1"
                "SHA256" -> "HmacSHA256"
                "SHA384" -> "HmacSHA384"
                "SHA512" -> "HmacSHA512"
                else -> "HmacSHA256"
            }
            val mac = Mac.getInstance(jcaAlgo)
            mac.init(SecretKeySpec(base64Decode(keyB64), jcaAlgo))
            base64Encode(mac.doFinal(base64Decode(dataB64)))
        }

        function("__crypto_pbkdf2") { args ->
            val passBytes = base64Decode(args.getOrNull(0)?.toString().orEmpty())
            val saltBytes = base64Decode(args.getOrNull(1)?.toString().orEmpty())
            val iterations = ((args.getOrNull(2) as? Number)?.toInt() ?: 1000).coerceAtLeast(1)
            val lengthBits = ((args.getOrNull(3) as? Number)?.toInt() ?: 256).coerceAtLeast(8)
            val hashRaw = args.getOrNull(4)?.toString() ?: "SHA-256"
            val factoryAlgo = when (hashRaw.uppercase(Locale.ROOT).replace("-", "")) {
                "SHA1" -> "PBKDF2WithHmacSHA1"
                "SHA384" -> "PBKDF2WithHmacSHA384"
                "SHA512" -> "PBKDF2WithHmacSHA512"
                else -> "PBKDF2WithHmacSHA256"
            }
            val passChars = String(passBytes, Charsets.UTF_8).toCharArray()
            val spec = PBEKeySpec(passChars, saltBytes, iterations, lengthBits)
            val derived = SecretKeyFactory.getInstance(factoryAlgo).generateSecret(spec).encoded
            base64Encode(derived)
        }

        function("__crypto_aes") { args ->
            val op = args.getOrNull(0)?.toString() ?: "decrypt"
            val mode = (args.getOrNull(1)?.toString() ?: "AES-CBC").uppercase(Locale.ROOT)
            val keyBytes = base64Decode(args.getOrNull(2)?.toString().orEmpty())
            val ivBytes = base64Decode(args.getOrNull(3)?.toString().orEmpty())
            val dataBytes = base64Decode(args.getOrNull(4)?.toString().orEmpty())
            val cipherMode = if (op.equals("encrypt", ignoreCase = true)) {
                Cipher.ENCRYPT_MODE
            } else {
                Cipher.DECRYPT_MODE
            }
            val secretKey = SecretKeySpec(keyBytes, "AES")
            val cipher = when {
                mode.contains("GCM") -> {
                    Cipher.getInstance("AES/GCM/NoPadding").apply {
                        init(cipherMode, secretKey, GCMParameterSpec(128, ivBytes))
                    }
                }
                mode.contains("ECB") -> {
                    Cipher.getInstance("AES/ECB/PKCS5Padding").apply {
                        init(cipherMode, secretKey)
                    }
                }
                else -> {
                    Cipher.getInstance("AES/CBC/PKCS5Padding").apply {
                        init(cipherMode, secretKey, IvParameterSpec(ivBytes))
                    }
                }
            }
            base64Encode(cipher.doFinal(dataBytes))
        }
    }

    private fun performNativeFetch(
        url: String,
        method: String,
        headersJson: String,
        bodyKind: String,
        body: String,
        followRedirects: Boolean,
        inFlightCalls: MutableSet<Call>,
    ): String {
        if (url.isBlank()) {
            return errorFetchResponse(url, "Empty URL")
        }
        return try {
            val mapType = object : TypeToken<Map<String, Any?>>() {}.type
            val rawHeaders: Map<String, Any?> = runCatching {
                gson.fromJson<Map<String, Any?>>(headersJson, mapType)
            }.getOrNull().orEmpty()

            val headersMap = LinkedHashMap<String, String>()
            rawHeaders.forEach { (k, v) ->
                if (k.isNotBlank() && v != null) {
                    headersMap[k] = v.toString()
                }
            }
            if (headersMap.keys.none { it.equals("User-Agent", ignoreCase = true) }) {
                headersMap["User-Agent"] = DEFAULT_USER_AGENT
            }

            val requestBuilder = Request.Builder().url(url)
            headersMap.forEach { (k, v) -> requestBuilder.header(k, v) }

            val requestBytes: ByteArray = when (bodyKind) {
                "base64" -> base64Decode(body)
                "text" -> body.toByteArray(Charsets.UTF_8)
                else -> ByteArray(0)
            }
            val contentTypeHeader = headersMap.entries
                .firstOrNull { it.key.equals("Content-Type", ignoreCase = true) }
                ?.value

            val upperMethod = method.uppercase(Locale.ROOT)
            when (upperMethod) {
                "GET" -> requestBuilder.get()
                "HEAD" -> requestBuilder.head()
                "POST" -> requestBuilder.post(
                    requestBytes.toRequestBody((contentTypeHeader ?: "application/json").toMediaTypeOrNull())
                )
                "PUT" -> requestBuilder.put(
                    requestBytes.toRequestBody((contentTypeHeader ?: "application/json").toMediaTypeOrNull())
                )
                "PATCH" -> requestBuilder.patch(
                    requestBytes.toRequestBody((contentTypeHeader ?: "application/json").toMediaTypeOrNull())
                )
                "DELETE" -> if (bodyKind == "none") {
                    requestBuilder.delete()
                } else {
                    requestBuilder.delete(
                        requestBytes.toRequestBody((contentTypeHeader ?: "application/json").toMediaTypeOrNull())
                    )
                }
                else -> requestBuilder.method(
                    upperMethod,
                    if (bodyKind == "none") null
                    else requestBytes.toRequestBody(contentTypeHeader?.toMediaTypeOrNull())
                )
            }

            val client = if (followRedirects) {
                httpClient
            } else {
                httpClient.newBuilder()
                    .followRedirects(false)
                    .followSslRedirects(false)
                    .build()
            }

            val call = client.newCall(requestBuilder.build())
            inFlightCalls.add(call)
            try {
                call.execute().use { response ->
                    val contentType = response.body?.contentType()
                    val encoding = response.header("Content-Encoding")?.lowercase(Locale.ROOT)?.trim()
                    val bytes = readDecodedBytesBounded(response.body?.byteStream(), encoding, MAX_FETCH_RESPONSE_BYTES)
                    val charset = contentType?.charset(Charsets.UTF_8) ?: Charsets.UTF_8
                    val decodedString = runCatching { String(bytes, charset) }
                        .getOrElse { String(bytes, Charsets.UTF_8) }
                        .let { if (it.length > MAX_FETCH_BODY_CHARS) it.substring(0, MAX_FETCH_BODY_CHARS) else it }

                    gson.toJson(
                        mapOf(
                            "ok" to response.isSuccessful,
                            "status" to response.code,
                            "statusText" to response.message,
                            "url" to response.request.url.toString(),
                            "body" to decodedString,
                            "bodyBase64" to base64Encode(bytes),
                            "headers" to flattenResponseHeaders(response.headers),
                        )
                    )
                }
            } finally {
                inFlightCalls.remove(call)
            }
        } catch (t: Throwable) {
            errorFetchResponse(url, t.message ?: "Fetch failed")
        }
    }

    private fun flattenResponseHeaders(headers: Headers): Map<String, String> {
        val out = LinkedHashMap<String, String>()
        for (i in 0 until headers.size) {
            val name = headers.name(i).lowercase(Locale.ROOT)
            val value = headers.value(i)
            val existing = out[name]
            out[name] = if (existing == null) {
                value
            } else if (name == "set-cookie") {
                "$existing; $value"
            } else {
                "$existing, $value"
            }
        }
        return out
    }

    private fun readDecodedBytesBounded(
        rawStream: InputStream?,
        encoding: String?,
        maxBytes: Int,
    ): ByteArray {
        if (rawStream == null) return ByteArray(0)
        val decoded: InputStream = when (encoding) {
            "gzip" -> GZIPInputStream(rawStream)
            "deflate" -> InflaterInputStream(rawStream)
            else -> rawStream
        }
        return decoded.use { input ->
            val out = ByteArrayOutputStream(minOf(maxBytes, 16 * 1024))
            val buffer = ByteArray(8 * 1024)
            var remaining = maxBytes
            while (remaining > 0) {
                val read = input.read(buffer, 0, minOf(buffer.size, remaining))
                if (read <= 0) break
                out.write(buffer, 0, read)
                remaining -= read
            }
            out.toByteArray()
        }
    }

    private fun errorFetchResponse(url: String, message: String): String = gson.toJson(
        mapOf(
            "ok" to false,
            "status" to 0,
            "statusText" to message,
            "url" to url,
            "body" to "",
            "bodyBase64" to "",
            "headers" to emptyMap<String, String>(),
        )
    )

    private fun parseUrlJson(urlString: String): String {
        return try {
            val u = URL(urlString)
            val defaultPort = u.defaultPort
            val showPort = u.port > 0 && u.port != defaultPort
            gson.toJson(
                mapOf(
                    "protocol" to "${u.protocol}:",
                    "host" to if (showPort) "${u.host}:${u.port}" else u.host,
                    "hostname" to u.host,
                    "port" to if (showPort) u.port.toString() else "",
                    "pathname" to (u.path?.ifEmpty { "/" } ?: "/"),
                    "search" to (u.query?.let { "?$it" } ?: ""),
                    "hash" to (u.ref?.let { "#$it" } ?: ""),
                )
            )
        } catch (_: Exception) {
            gson.toJson(
                mapOf(
                    "protocol" to "",
                    "host" to "",
                    "hostname" to "",
                    "port" to "",
                    "pathname" to "/",
                    "search" to "",
                    "hash" to "",
                )
            )
        }
    }

    private fun getCompiledCryptoJsBytecode(qjs: QuickJs): ByteArray? {
        compiledCryptoJsBytecode?.let { return it }
        synchronized(this) {
            compiledCryptoJsBytecode?.let { return it }
            val source = loadCryptoJsSourceOrNull() ?: return null
            return runCatching {
                qjs.compile(source, "crypto-js.js", asModule = false).also {
                    compiledCryptoJsBytecode = it
                }
            }.getOrNull()
        }
    }

    private fun loadCryptoJsSourceOrNull(): String? {
        cachedCryptoJsSource?.let { return it }
        val cl = this::class.java.classLoader ?: return null
        val candidates = listOf(
            "META-INF/resources/webjars/crypto-js/4.2.0/crypto-js.min.js",
            "META-INF/resources/webjars/crypto-js/4.2.0/crypto-js.js",
            "META-INF/resources/webjars/crypto-js/4.2.0/crypto-js/crypto-js.min.js",
            "META-INF/resources/webjars/crypto-js/4.2.0/crypto-js/crypto-js.js",
        )
        for (path in candidates) {
            val loaded = runCatching {
                cl.getResourceAsStream(path)?.use { it.readBytes().toString(Charsets.UTF_8) }
            }.getOrNull()
            if (!loaded.isNullOrBlank()) {
                cachedCryptoJsSource = loaded
                return loaded
            }
        }
        return null
    }

    private fun getCompiledPolyfillBytecode(qjs: QuickJs): ByteArray {
        compiledPolyfillBytecode?.let { return it }
        synchronized(this) {
            compiledPolyfillBytecode?.let { return it }
            return qjs.compile(buildPolyfillJs(), "polyfill.js", asModule = false).also {
                compiledPolyfillBytecode = it
            }
        }
    }

    private fun getCompiledCallBytecode(qjs: QuickJs): ByteArray {
        compiledCallBytecode?.let { return it }
        synchronized(this) {
            compiledCallBytecode?.let { return it }
            return qjs.compile(buildInvocationJs(), "invoke.js", asModule = false).also {
                compiledCallBytecode = it
            }
        }
    }

    private fun buildInvocationJs(): String = """
        (async function() {
            try {
                var exported = (typeof module !== 'undefined' && module && module.exports) ? module.exports : {};
                var fn = exported.getStreams
                    || (exported.default && exported.default.getStreams)
                    || (typeof exported === 'function' ? exported : null)
                    || globalThis.getStreams;
                if (typeof fn !== 'function') {
                    console.error('getStreams function not found on module.exports or globalThis');
                    __capture_result('[]');
                    return;
                }
                var args = JSON.parse(__get_call_args());
                var raw = await fn(args.tmdbId, args.mediaType, args.season, args.episode);
                var list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.streams) ? raw.streams : []);
                __capture_result(JSON.stringify(list || []));
            } catch (err) {
                console.error('Plugin execution error:', err && (err.stack || err.message || String(err)));
                __capture_result('[]');
            }
        })();
    """.trimIndent()

    private fun buildPolyfillJs(): String = """
        (function() {
        if (typeof globalThis.global === 'undefined') globalThis.global = globalThis;
        if (typeof globalThis.window === 'undefined') globalThis.window = globalThis;
        if (typeof globalThis.self === 'undefined') globalThis.self = globalThis;

        globalThis.SCRAPER_ID = __get_scraper_id();
        globalThis.SCRAPER_SETTINGS = JSON.parse(__get_scraper_settings() || '{}');
        globalThis.IMDB_ID = __get_imdb_id();
        if (typeof globalThis.TMDB_API_KEY === 'undefined' || !globalThis.TMDB_API_KEY) {
            globalThis.TMDB_API_KEY = __get_tmdb_api_key();
        }
        globalThis.process = globalThis.process || { env: { NODE_ENV: 'production', TMDB_API_KEY: globalThis.TMDB_API_KEY } };

        (function() {
            var nextTimerId = 1;
            var activeTimers = {};
            globalThis.setTimeout = function(cb, ms) {
                var id = nextTimerId++;
                var extraArgs = Array.prototype.slice.call(arguments, 2);
                activeTimers[id] = true;
                var delayMs = typeof ms === 'number' && ms > 0 ? ms : 0;
                Promise.resolve(__plugin_sleep(delayMs)).then(function() {
                    if (!activeTimers[id]) return;
                    delete activeTimers[id];
                    if (typeof cb === 'function') cb.apply(globalThis, extraArgs);
                });
                return id;
            };
            globalThis.clearTimeout = function(id) { delete activeTimers[id]; };
            globalThis.setInterval = function(cb, ms) {
                var id = nextTimerId++;
                var extraArgs = Array.prototype.slice.call(arguments, 2);
                activeTimers[id] = true;
                var stepMs = typeof ms === 'number' && ms > 0 ? ms : 10;
                function tick() {
                    Promise.resolve(__plugin_sleep(stepMs)).then(function() {
                        if (!activeTimers[id]) return;
                        if (typeof cb === 'function') cb.apply(globalThis, extraArgs);
                        if (activeTimers[id]) tick();
                    });
                }
                tick();
                return id;
            };
            globalThis.clearInterval = function(id) { delete activeTimers[id]; };
            globalThis.queueMicrotask = globalThis.queueMicrotask || function(cb) { Promise.resolve().then(cb); };
        })();

        if (typeof globalThis.atob === 'undefined') {
            globalThis.atob = function(input) {
                var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
                var str = String(input || '').replace(/[\r\n\s]/g, '').replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
                var output = '';
                var bc = 0, bs = 0, buffer, idx = 0;
                while ((buffer = str.charAt(idx++))) {
                    buffer = chars.indexOf(buffer);
                    if (buffer === -1) continue;
                    bs = bc % 4 ? bs * 64 + buffer : buffer;
                    if (bc++ % 4) {
                        output += String.fromCharCode(255 & (bs >> ((-2 * bc) & 6)));
                    }
                }
                return output;
            };
        }

        if (typeof globalThis.btoa === 'undefined') {
            globalThis.btoa = function(input) {
                var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
                var str = String(input == null ? '' : input);
                var output = '';
                for (
                    var block = 0, charCode, idx = 0, map = chars;
                    str.charAt(idx | 0) || (map = '=', idx % 1);
                    output += map.charAt(63 & (block >> (8 - (idx % 1) * 8)))
                ) {
                    charCode = str.charCodeAt(idx += 3 / 4);
                    block = (block << 8) | (charCode & 0xFF);
                }
                return output;
            };
        }

        function __bytesToBase64(bytes) {
            var u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
            var bin = '';
            for (var i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
            return globalThis.btoa(bin);
        }

        function __base64ToBytes(b64) {
            var bin = globalThis.atob(b64 || '');
            var out = new Uint8Array(bin.length);
            for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 0xFF;
            return out;
        }

        if (typeof globalThis.TextEncoder === 'undefined') {
            globalThis.TextEncoder = function() {};
            globalThis.TextEncoder.prototype.encode = function(str) {
                str = String(str == null ? '' : str);
                var utf8 = unescape(encodeURIComponent(str));
                var out = new Uint8Array(utf8.length);
                for (var i = 0; i < utf8.length; i++) out[i] = utf8.charCodeAt(i);
                return out;
            };
        }

        if (typeof globalThis.TextDecoder === 'undefined') {
            globalThis.TextDecoder = function() {};
            globalThis.TextDecoder.prototype.decode = function(input) {
                if (!input) return '';
                var bytes = input instanceof Uint8Array ? input : (input.buffer ? new Uint8Array(input.buffer, input.byteOffset || 0, input.byteLength || input.length) : new Uint8Array(input));
                var bin = '';
                for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
                try {
                    return decodeURIComponent(escape(bin));
                } catch (_) {
                    return bin;
                }
            };
        }

        // Minimal Node Buffer polyfill
        (function() {
            function makeBuffer(u8) {
                var b = new Uint8Array(u8.length);
                b.set(u8);
                b.toString = function(enc) {
                    var e = String(enc || 'utf8').toLowerCase();
                    if (e === 'base64') return __bytesToBase64(b);
                    if (e === 'base64url') return __bytesToBase64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
                    if (e === 'hex') {
                        var h = '';
                        for (var i = 0; i < b.length; i++) h += ('0' + b[i].toString(16)).slice(-2);
                        return h;
                    }
                    if (e === 'latin1' || e === 'binary') {
                        var s = '';
                        for (var j = 0; j < b.length; j++) s += String.fromCharCode(b[j]);
                        return s;
                    }
                    return new TextDecoder().decode(b);
                };
                b.readInt32LE = function(offset) {
                    var o = offset || 0;
                    return (b[o]) | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24);
                };
                b.readUInt32LE = function(offset) {
                    return b.readInt32LE(offset) >>> 0;
                };
                return b;
            }
            var BufferPolyfill = {
                from: function(data, enc) {
                    if (typeof data === 'string') {
                        var e = String(enc || 'utf8').toLowerCase();
                        if (e === 'base64' || e === 'base64url') return makeBuffer(__base64ToBytes(data));
                        if (e === 'hex') {
                            var clean = data.replace(/[^0-9a-fA-F]/g, '');
                            var out = new Uint8Array(Math.floor(clean.length / 2));
                            for (var i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
                            return makeBuffer(out);
                        }
                        if (e === 'latin1' || e === 'binary') {
                            var l = new Uint8Array(data.length);
                            for (var j = 0; j < data.length; j++) l[j] = data.charCodeAt(j) & 0xFF;
                            return makeBuffer(l);
                        }
                        return makeBuffer(new TextEncoder().encode(data));
                    }
                    if (data instanceof ArrayBuffer) return makeBuffer(new Uint8Array(data));
                    if (ArrayBuffer.isView(data)) return makeBuffer(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
                    if (Array.isArray(data)) return makeBuffer(new Uint8Array(data));
                    return makeBuffer(new Uint8Array(0));
                },
                alloc: function(size) { return makeBuffer(new Uint8Array(size || 0)); },
                concat: function(list) {
                    var total = 0;
                    for (var i = 0; i < list.length; i++) total += list[i].length;
                    var out = new Uint8Array(total);
                    var offset = 0;
                    for (var j = 0; j < list.length; j++) { out.set(list[j], offset); offset += list[j].length; }
                    return makeBuffer(out);
                },
                isBuffer: function(v) { return v instanceof Uint8Array; }
            };
            globalThis.Buffer = globalThis.Buffer || BufferPolyfill;
        })();

        // WebCrypto polyfill
        (function() {
            function toU8(input) {
                if (input instanceof Uint8Array) return input;
                if (input instanceof ArrayBuffer) return new Uint8Array(input);
                if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
                if (typeof input === 'string') return new TextEncoder().encode(input);
                return new Uint8Array(0);
            }
            function algoName(alg) {
                return typeof alg === 'string' ? alg : (alg && alg.name ? alg.name : 'SHA-256');
            }
            globalThis.crypto = globalThis.crypto || {};
            globalThis.crypto.getRandomValues = function(typedArray) {
                var raw = __base64ToBytes(__crypto_random_bytes(typedArray.byteLength));
                new Uint8Array(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength).set(raw);
                return typedArray;
            };
            globalThis.crypto.randomUUID = function() {
                var b = new Uint8Array(16);
                globalThis.crypto.getRandomValues(b);
                b[6] = (b[6] & 0x0f) | 0x40;
                b[8] = (b[8] & 0x3f) | 0x80;
                var hex = [];
                for (var i = 0; i < 16; i++) hex.push(('0' + b[i].toString(16)).slice(-2));
                return hex.slice(0, 4).join('') + '-' + hex.slice(4, 6).join('') + '-' + hex.slice(6, 8).join('') + '-' + hex.slice(8, 10).join('') + '-' + hex.slice(10, 16).join('');
            };
            globalThis.crypto.subtle = {
                digest: function(alg, data) {
                    var res = __base64ToBytes(__crypto_digest(algoName(alg), __bytesToBase64(toU8(data))));
                    return Promise.resolve(res.buffer);
                },
                importKey: function(format, keyData, alg) {
                    return Promise.resolve({ raw: toU8(keyData), algorithm: alg });
                },
                sign: function(alg, key, data) {
                    var hashName = (key && key.algorithm && key.algorithm.hash) ? algoName(key.algorithm.hash) : algoName(alg);
                    var res = __base64ToBytes(__crypto_hmac(hashName, __bytesToBase64(key.raw), __bytesToBase64(toU8(data))));
                    return Promise.resolve(res.buffer);
                },
                encrypt: function(alg, key, data) {
                    var iv = alg && alg.iv ? toU8(alg.iv) : new Uint8Array(16);
                    var res = __base64ToBytes(__crypto_aes('encrypt', algoName(alg), __bytesToBase64(key.raw), __bytesToBase64(iv), __bytesToBase64(toU8(data))));
                    return Promise.resolve(res.buffer);
                },
                decrypt: function(alg, key, data) {
                    var iv = alg && alg.iv ? toU8(alg.iv) : new Uint8Array(16);
                    var res = __base64ToBytes(__crypto_aes('decrypt', algoName(alg), __bytesToBase64(key.raw), __bytesToBase64(iv), __bytesToBase64(toU8(data))));
                    return Promise.resolve(res.buffer);
                }
            };
        })();

        // URL & URLSearchParams
        var URLSearchParams = function(init, onMutate) {
            this._entries = [];
            this._onMutate = onMutate || null;
            var self = this;
            if (typeof init === 'string') {
                var clean = init.replace(/^\?/, '');
                if (clean) {
                    clean.split('&').forEach(function(pair) {
                        if (!pair) return;
                        var eq = pair.indexOf('=');
                        var k = eq >= 0 ? pair.slice(0, eq) : pair;
                        var v = eq >= 0 ? pair.slice(eq + 1) : '';
                        self._entries.push([
                            decodeURIComponent(k.replace(/\+/g, ' ')),
                            decodeURIComponent(v.replace(/\+/g, ' '))
                        ]);
                    });
                }
            } else if (Array.isArray(init)) {
                init.forEach(function(p) { if (p && p.length >= 2) self._entries.push([String(p[0]), String(p[1])]); });
            } else if (init && typeof init === 'object') {
                Object.keys(init).forEach(function(k) { self._entries.push([k, String(init[k])]); });
            }
        };
        URLSearchParams.prototype._notify = function() { if (this._onMutate) this._onMutate(); };
        URLSearchParams.prototype.append = function(k, v) { this._entries.push([String(k), String(v)]); this._notify(); };
        URLSearchParams.prototype.set = function(k, v) {
            var key = String(k), val = String(v), replaced = false;
            this._entries = this._entries.filter(function(e) {
                if (e[0] !== key) return true;
                if (!replaced) { e[1] = val; replaced = true; return true; }
                return false;
            });
            if (!replaced) this._entries.push([key, val]);
            this._notify();
        };
        URLSearchParams.prototype.get = function(k) {
            var key = String(k);
            for (var i = 0; i < this._entries.length; i++) if (this._entries[i][0] === key) return this._entries[i][1];
            return null;
        };
        URLSearchParams.prototype.getAll = function(k) {
            var key = String(k);
            return this._entries.filter(function(e) { return e[0] === key; }).map(function(e) { return e[1]; });
        };
        URLSearchParams.prototype.has = function(k) { return this.get(k) !== null; };
        URLSearchParams.prototype.delete = function(k) {
            var key = String(k);
            this._entries = this._entries.filter(function(e) { return e[0] !== key; });
            this._notify();
        };
        URLSearchParams.prototype.forEach = function(cb) {
            var self = this;
            this._entries.forEach(function(e) { cb(e[1], e[0], self); });
        };
        URLSearchParams.prototype.entries = function() { return this._entries.slice(); };
        URLSearchParams.prototype.keys = function() { return this._entries.map(function(e) { return e[0]; }); };
        URLSearchParams.prototype.values = function() { return this._entries.map(function(e) { return e[1]; }); };
        URLSearchParams.prototype.toString = function() {
            return this._entries.map(function(e) {
                return encodeURIComponent(e[0]) + '=' + encodeURIComponent(e[1]);
            }).join('&');
        };
        globalThis.URLSearchParams = URLSearchParams;

        var URL = function(urlString, base) {
            var fullUrl = String(urlString || '');
            if (base && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(fullUrl)) {
                var b = typeof base === 'string' ? base : String(base.href || '');
                if (fullUrl.indexOf('//') === 0) {
                    var pm = b.match(/^([a-zA-Z]+:)/);
                    fullUrl = (pm ? pm[1] : 'https:') + fullUrl;
                } else if (fullUrl.charAt(0) === '/') {
                    var om = b.match(/^(https?:\/\/[^\/]+)/i);
                    fullUrl = om ? om[1] + fullUrl : fullUrl;
                } else {
                    fullUrl = b.replace(/\/[^\/]*$/, '/') + fullUrl;
                }
            }
            var data = JSON.parse(__parse_url(fullUrl));
            var self = this;
            this.protocol = data.protocol || 'https:';
            this.host = data.host || '';
            this.hostname = data.hostname || '';
            this.port = data.port || '';
            this.pathname = data.pathname || '/';
            this.hash = data.hash || '';
            this.origin = this.protocol + '//' + this.host;
            this.searchParams = new URLSearchParams(data.search || '', function() { self._syncHref(); });
            this._syncHref = function() {
                var q = self.searchParams.toString();
                self.search = q ? ('?' + q) : '';
                self.href = self.origin + self.pathname + self.search + (self.hash || '');
            };
            this._syncHref();
        };
        URL.prototype.toString = function() { return this.href; };
        globalThis.URL = URL;

        // AbortController & Headers & Fetch
        if (typeof globalThis.AbortSignal === 'undefined') {
            var AbortSignal = function() { this.aborted = false; this.reason = undefined; this._l = []; };
            AbortSignal.prototype.addEventListener = function(t, fn) { if (t === 'abort' && typeof fn === 'function') this._l.push(fn); };
            AbortSignal.prototype.removeEventListener = function(t, fn) { if (t === 'abort') this._l = this._l.filter(function(x) { return x !== fn; }); };
            AbortSignal.prototype.dispatchEvent = function(ev) {
                this._l.slice().forEach(function(fn) { try { fn(ev); } catch (_) {} });
                return true;
            };
            globalThis.AbortSignal = AbortSignal;
        }
        if (typeof globalThis.AbortController === 'undefined') {
            var AbortController = function() { this.signal = new globalThis.AbortSignal(); };
            AbortController.prototype.abort = function(reason) {
                if (this.signal.aborted) return;
                this.signal.aborted = true;
                this.signal.reason = reason;
                this.signal.dispatchEvent({ type: 'abort' });
            };
            globalThis.AbortController = AbortController;
        }

        var Headers = function(init) {
            this._map = {};
            var self = this;
            if (init instanceof Headers) {
                init.forEach(function(v, k) { self.set(k, v); });
            } else if (Array.isArray(init)) {
                init.forEach(function(p) { if (p && p.length >= 2) self.append(p[0], p[1]); });
            } else if (init && typeof init === 'object') {
                Object.keys(init).forEach(function(k) { if (init[k] !== undefined && init[k] !== null) self.set(k, init[k]); });
            }
        };
        Headers.prototype.set = function(k, v) { this._map[String(k).toLowerCase()] = String(v); };
        Headers.prototype.append = function(k, v) {
            var lk = String(k).toLowerCase();
            this._map[lk] = this._map[lk] ? (this._map[lk] + ', ' + String(v)) : String(v);
        };
        Headers.prototype.get = function(k) {
            var lk = String(k).toLowerCase();
            return this._map.hasOwnProperty(lk) ? this._map[lk] : null;
        };
        Headers.prototype.has = function(k) { return this._map.hasOwnProperty(String(k).toLowerCase()); };
        Headers.prototype.delete = function(k) { delete this._map[String(k).toLowerCase()]; };
        Headers.prototype.forEach = function(cb) {
            var self = this;
            Object.keys(this._map).forEach(function(k) { cb(self._map[k], k, self); });
        };
        Headers.prototype.entries = function() {
            var self = this;
            return Object.keys(this._map).map(function(k) { return [k, self._map[k]]; });
        };
        Headers.prototype.toPlainObject = function() {
            var out = {};
            var self = this;
            Object.keys(this._map).forEach(function(k) { out[k] = self._map[k]; });
            return out;
        };
        globalThis.Headers = Headers;

        function __normalizeFetchBody(body) {
            if (body === undefined || body === null) return { kind: 'none', value: '' };
            if (typeof body === 'string') return { kind: 'text', value: body };
            if (body instanceof URLSearchParams) return { kind: 'text', value: body.toString(), contentType: 'application/x-www-form-urlencoded;charset=UTF-8' };
            if (body instanceof ArrayBuffer) return { kind: 'base64', value: __bytesToBase64(new Uint8Array(body)) };
            if (ArrayBuffer.isView(body)) return { kind: 'base64', value: __bytesToBase64(new Uint8Array(body.buffer, body.byteOffset, body.byteLength)) };
            if (typeof body === 'object') return { kind: 'text', value: JSON.stringify(body), contentType: 'application/json' };
            return { kind: 'text', value: String(body) };
        }

        globalThis.fetch = async function(input, options) {
            options = options || {};
            var url = typeof input === 'string' ? input : (input && (input.url || input.href) ? String(input.url || input.href) : String(input));
            var method = String(options.method || (input && input.method) || 'GET').toUpperCase();
            var hdrs = new Headers((input && input.headers) || undefined);
            if (options.headers) {
                var extra = new Headers(options.headers);
                extra.forEach(function(v, k) { hdrs.set(k, v); });
            }
            var normalizedBody = __normalizeFetchBody(options.body);
            if (normalizedBody.contentType && !hdrs.has('content-type')) {
                hdrs.set('content-type', normalizedBody.contentType);
            }
            var signal = options.signal || null;
            if (signal && signal.aborted) {
                var abortErr = new Error('The operation was aborted.');
                abortErr.name = 'AbortError';
                throw abortErr;
            }
            var followRedirects = options.redirect !== 'manual';
            var rawJson = await __native_fetch(
                url,
                method,
                JSON.stringify(hdrs.toPlainObject()),
                normalizedBody.kind,
                normalizedBody.value,
                String(followRedirects)
            );
            var parsed = JSON.parse(rawJson);
            if (signal && signal.aborted) {
                var postAbortErr = new Error('The operation was aborted.');
                postAbortErr.name = 'AbortError';
                throw postAbortErr;
            }
            var respHeaders = new Headers(parsed.headers || {});
            var bodyBytesCache = null;
            function getBodyBytes() {
                if (!bodyBytesCache) bodyBytesCache = __base64ToBytes(parsed.bodyBase64 || '');
                return bodyBytesCache;
            }
            var responseObj = {
                ok: !!parsed.ok,
                status: parsed.status || 0,
                statusText: parsed.statusText || '',
                url: parsed.url || url,
                redirected: !!(parsed.url && parsed.url !== url),
                headers: respHeaders,
                text: function() { return Promise.resolve(parsed.body || ''); },
                json: function() {
                    return new Promise(function(resolve, reject) {
                        try {
                            if (!parsed.body) resolve(null);
                            else resolve(JSON.parse(parsed.body));
                        } catch (e) { reject(e); }
                    });
                },
                arrayBuffer: function() {
                    var src = getBodyBytes();
                    var copy = new Uint8Array(src.length);
                    copy.set(src);
                    return Promise.resolve(copy.buffer);
                },
                clone: function() { return responseObj; }
            };
            return responseObj;
        };

        // Axios-compatible client on top of fetch
        (function() {
            function buildAxiosUrl(baseURL, url, params) {
                var full = url || '';
                if (baseURL && !/^https?:\/\//i.test(full)) {
                    full = baseURL.replace(/\/+$/, '') + '/' + full.replace(/^\/+/, '');
                }
                if (params && typeof params === 'object') {
                    var usp = new URLSearchParams(params);
                    var qs = usp.toString();
                    if (qs) full += (full.indexOf('?') >= 0 ? '&' : '?') + qs;
                }
                return full;
            }
            function createAxiosInstance(defaults) {
                defaults = defaults || {};
                var instance = async function(configOrUrl, maybeConfig) {
                    var cfg = typeof configOrUrl === 'string'
                        ? Object.assign({}, defaults, maybeConfig || {}, { url: configOrUrl })
                        : Object.assign({}, defaults, configOrUrl || {});
                    var method = String(cfg.method || 'GET').toUpperCase();
                    var fullUrl = buildAxiosUrl(cfg.baseURL, cfg.url, cfg.params);
                    var mergedHeaders = Object.assign({}, defaults.headers || {}, cfg.headers || {});
                    var body = cfg.data !== undefined ? cfg.data : cfg.body;
                    var resp = await globalThis.fetch(fullUrl, {
                        method: method,
                        headers: mergedHeaders,
                        body: (method === 'GET' || method === 'HEAD') ? undefined : body,
                        redirect: cfg.maxRedirects === 0 ? 'manual' : 'follow'
                    });
                    var rawText = await resp.text();
                    var data = rawText;
                    if (cfg.responseType !== 'text') {
                        try { data = JSON.parse(rawText); } catch (_) {}
                    }
                    var plainHeaders = resp.headers.toPlainObject();
                    var axiosResp = {
                        data: data,
                        status: resp.status,
                        statusText: resp.statusText,
                        headers: plainHeaders,
                        config: cfg,
                        request: { responseURL: resp.url }
                    };
                    var validate = cfg.validateStatus || function(s) { return s >= 200 && s < 300; };
                    if (!validate(resp.status)) {
                        var err = new Error('Request failed with status code ' + resp.status);
                        err.response = axiosResp;
                        err.status = resp.status;
                        throw err;
                    }
                    return axiosResp;
                };
                instance.defaults = defaults;
                instance.request = function(cfg) { return instance(cfg); };
                instance.get = function(url, cfg) { return instance(Object.assign({}, cfg || {}, { url: url, method: 'GET' })); };
                instance.delete = function(url, cfg) { return instance(Object.assign({}, cfg || {}, { url: url, method: 'DELETE' })); };
                instance.head = function(url, cfg) { return instance(Object.assign({}, cfg || {}, { url: url, method: 'HEAD' })); };
                instance.post = function(url, data, cfg) { return instance(Object.assign({}, cfg || {}, { url: url, method: 'POST', data: data })); };
                instance.put = function(url, data, cfg) { return instance(Object.assign({}, cfg || {}, { url: url, method: 'PUT', data: data })); };
                instance.patch = function(url, data, cfg) { return instance(Object.assign({}, cfg || {}, { url: url, method: 'PATCH', data: data })); };
                instance.create = function(childDefaults) { return createAxiosInstance(Object.assign({}, defaults, childDefaults || {})); };
                return instance;
            }
            globalThis.axios = createAxiosInstance({});
        })();

        // Cheerio wrapper backed by Jsoup
        var cheerio = (function() {
            function makeWrapper(docId, ids) {
                var wrapper = {
                    _docId: docId,
                    _elementIds: ids,
                    length: ids.length,
                    each: function(cb) {
                        for (var i = 0; i < ids.length; i++) {
                            var single = makeWrapper(docId, [ids[i]]);
                            if (cb.call(single, i, single) === false) break;
                        }
                        return wrapper;
                    },
                    map: function(cb) {
                        var out = [];
                        for (var i = 0; i < ids.length; i++) {
                            var single = makeWrapper(docId, [ids[i]]);
                            var v = cb.call(single, i, single);
                            if (v !== undefined && v !== null) out.push(v);
                        }
                        return {
                            length: out.length,
                            get: function(idx) { return typeof idx === 'number' ? out[idx] : out; },
                            toArray: function() { return out; }
                        };
                    },
                    find: function(sel) {
                        var found = [];
                        for (var i = 0; i < ids.length; i++) {
                            found = found.concat(JSON.parse(__cheerio_find(docId, ids[i], sel || '')));
                        }
                        return makeWrapper(docId, found);
                    },
                    children: function(sel) {
                        var found = [];
                        for (var i = 0; i < ids.length; i++) {
                            found = found.concat(JSON.parse(__cheerio_children(docId, ids[i], sel || '')));
                        }
                        return makeWrapper(docId, found);
                    },
                    parent: function() {
                        var parents = [];
                        for (var i = 0; i < ids.length; i++) {
                            var pid = __cheerio_parent(docId, ids[i]);
                            if (pid && pid !== '__NONE__' && parents.indexOf(pid) === -1) parents.push(pid);
                        }
                        return makeWrapper(docId, parents);
                    },
                    next: function() {
                        var out = [];
                        for (var i = 0; i < ids.length; i++) {
                            var nid = __cheerio_next(docId, ids[i]);
                            if (nid && nid !== '__NONE__') out.push(nid);
                        }
                        return makeWrapper(docId, out);
                    },
                    prev: function() {
                        var out = [];
                        for (var i = 0; i < ids.length; i++) {
                            var pid = __cheerio_prev(docId, ids[i]);
                            if (pid && pid !== '__NONE__') out.push(pid);
                        }
                        return makeWrapper(docId, out);
                    },
                    first: function() { return makeWrapper(docId, ids.length > 0 ? [ids[0]] : []); },
                    last: function() { return makeWrapper(docId, ids.length > 0 ? [ids[ids.length - 1]] : []); },
                    eq: function(idx) {
                        var n = idx < 0 ? ids.length + idx : idx;
                        return makeWrapper(docId, (n >= 0 && n < ids.length) ? [ids[n]] : []);
                    },
                    get: function(idx) {
                        if (typeof idx === 'number') {
                            return (idx >= 0 && idx < ids.length) ? makeWrapper(docId, [ids[idx]]) : undefined;
                        }
                        return ids.map(function(id) { return makeWrapper(docId, [id]); });
                    },
                    toArray: function() { return ids.map(function(id) { return makeWrapper(docId, [id]); }); },
                    filter: function(fnOrSel) {
                        if (typeof fnOrSel === 'function') {
                            var kept = [];
                            for (var i = 0; i < ids.length; i++) {
                                var single = makeWrapper(docId, [ids[i]]);
                                if (fnOrSel.call(single, i, single)) kept.push(ids[i]);
                            }
                            return makeWrapper(docId, kept);
                        }
                        return wrapper;
                    },
                    text: function() { return ids.length === 0 ? '' : __cheerio_text(docId, ids.join(',')); },
                    html: function() { return ids.length === 0 ? '' : __cheerio_inner_html(docId, ids[0]); },
                    attr: function(name) {
                        if (ids.length === 0) return undefined;
                        var v = __cheerio_attr(docId, ids[0], String(name || ''));
                        return v === '__UNDEFINED__' ? undefined : v;
                    },
                    val: function() { return this.attr('value'); },
                    data: function(key) { return key ? this.attr('data-' + key) : undefined; },
                    hasClass: function(cls) { return ids.length > 0 ? !!__cheerio_has_class(docId, ids[0], String(cls || '')) : false; }
                };
                return wrapper;
            }
            return {
                load: function(html) {
                    var docId = __cheerio_load(String(html || ''));
                    var $ = function(selector, context) {
                        if (selector && selector._elementIds) return selector;
                        if (context && context._elementIds) return context.find(selector);
                        if (typeof selector === 'string') return makeWrapper(docId, JSON.parse(__cheerio_select(docId, selector)));
                        return makeWrapper(docId, []);
                    };
                    $.html = function(el) {
                        if (el && el._elementIds && el._elementIds.length > 0) return __cheerio_html(docId, el._elementIds[0]);
                        return __cheerio_html(docId, '');
                    };
                    $.root = function() { return makeWrapper(docId, JSON.parse(__cheerio_select(docId, ':root'))); };
                    return $;
                }
            };
        })();
        globalThis.cheerio = cheerio;

        globalThis.require = function(moduleName) {
            var name = String(moduleName || '').trim();
            if (name === 'cheerio' || name === 'cheerio-without-node-native' || name === 'react-native-cheerio') return cheerio;
            if (name === 'crypto-js') {
                if (globalThis.CryptoJS) return globalThis.CryptoJS;
                throw new Error("Module 'crypto-js' is not loaded");
            }
            if (name === 'crypto' || name === 'node:crypto') {
                return {
                    randomBytes: function(size) {
                        return globalThis.Buffer.from(__crypto_random_bytes(size || 16), 'base64');
                    },
                    randomUUID: function() { return globalThis.crypto.randomUUID(); },
                    getRandomValues: function(arr) { return globalThis.crypto.getRandomValues(arr); },
                    webcrypto: globalThis.crypto
                };
            }
            if (name === 'axios') return globalThis.axios;
            if (name === 'buffer') return { Buffer: globalThis.Buffer };
            if (name === 'url') return { URL: globalThis.URL, URLSearchParams: globalThis.URLSearchParams };
            throw new Error("Module '" + name + "' is not available in plugin sandbox");
        };

        if (!Array.prototype.flat) {
            Array.prototype.flat = function(depth) {
                var d = depth === undefined ? 1 : Math.floor(depth);
                if (d < 1) return Array.prototype.slice.call(this);
                return (function flatten(arr, rem) {
                    return rem > 0
                        ? arr.reduce(function(acc, val) { return acc.concat(Array.isArray(val) ? flatten(val, rem - 1) : val); }, [])
                        : arr.slice();
                })(this, d);
            };
        }
        if (!Array.prototype.flatMap) {
            Array.prototype.flatMap = function(cb, thisArg) { return this.map(cb, thisArg).flat(1); };
        }
        if (!Object.entries) {
            Object.entries = function(obj) {
                return Object.keys(obj || {}).map(function(k) { return [k, obj[k]]; });
            };
        }
        if (!Object.fromEntries) {
            Object.fromEntries = function(entries) {
                var out = {};
                (entries || []).forEach(function(p) { if (p && p.length >= 2) out[p[0]] = p[1]; });
                return out;
            };
        }
        if (!String.prototype.replaceAll) {
            String.prototype.replaceAll = function(search, replacement) {
                if (search instanceof RegExp) return this.replace(search, replacement);
                return this.split(String(search)).join(String(replacement));
            };
        }
        })();
    """.trimIndent()

    private fun parseStreamsJson(json: String, scraper: InstalledScraper): List<PluginStreamResult> {
        if (json.isBlank() || json == "[]") return emptyList()
        return try {
            val listType = object : TypeToken<List<Map<String, Any?>>>() {}.type
            val rawItems: List<Map<String, Any?>> = gson.fromJson(json, listType) ?: return emptyList()

            rawItems.mapNotNull { item ->
                val rawUrl = extractStreamUrl(item) ?: return@mapNotNull null
                if (!StreamFormatHelper.isPlayableHttpUrl(rawUrl)) return@mapNotNull null

                val mergedHeaders = extractHeaders(item)
                val subtitles = extractSubtitles(item["subtitles"], scraper.name)

                val cleanName = cleanField(item["name"])
                val cleanTitle = cleanField(item["title"])
                    ?: cleanField(item["description"])
                    ?: cleanName
                    ?: scraper.name

                PluginStreamResult(
                    scraperId = scraper.id,
                    scraperName = scraper.name,
                    repositoryName = scraper.repositoryName,
                    title = cleanTitle,
                    name = cleanName,
                    url = rawUrl,
                    quality = cleanField(item["quality"]),
                    size = cleanField(item["size"]),
                    language = cleanField(item["language"]) ?: cleanField(item["lang"]),
                    provider = cleanField(item["provider"]),
                    type = cleanField(item["type"]) ?: cleanField(item["format"]),
                    headers = mergedHeaders.takeIf { it.isNotEmpty() },
                    subtitles = subtitles,
                )
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed parsing stream JSON from ${scraper.id}: ${e.message}")
            emptyList()
        }
    }

    private fun extractStreamUrl(item: Map<String, Any?>): String? {
        val candidates = listOf(item["url"], item["streamUrl"], item["file"], item["src"])
        for (candidate in candidates) {
            when (candidate) {
                is String -> cleanField(candidate)?.let { return it }
                is Map<*, *> -> cleanField(candidate["url"])?.let { return it }
            }
        }
        return null
    }

    private fun extractHeaders(item: Map<String, Any?>): Map<String, String> {
        val out = LinkedHashMap<String, String>()

        fun mergeMap(raw: Any?) {
            val map = raw as? Map<*, *> ?: return
            map.forEach { (k, v) ->
                val key = cleanField(k) ?: return@forEach
                val value = cleanField(v) ?: return@forEach
                out[key] = value
            }
        }

        val behaviorHints = item["behaviorHints"] as? Map<*, *>
        val proxyHeaders = behaviorHints?.get("proxyHeaders") as? Map<*, *>
        mergeMap(proxyHeaders?.get("request"))
        mergeMap(item["httpHeaders"])
        mergeMap(item["headers"])

        cleanField(item["referer"])?.let { if (out.keys.none { k -> k.equals("Referer", true) }) out["Referer"] = it }
        cleanField(item["origin"])?.let { if (out.keys.none { k -> k.equals("Origin", true) }) out["Origin"] = it }
        cleanField(item["userAgent"])?.let { if (out.keys.none { k -> k.equals("User-Agent", true) }) out["User-Agent"] = it }

        return out
    }

    private fun extractSubtitles(raw: Any?, fallbackAddonName: String): List<PluginSubtitleResult> {
        val list = raw as? List<*> ?: return emptyList()
        return list.mapNotNull { entry ->
            val obj = entry as? Map<*, *> ?: return@mapNotNull null
            val url = cleanField(obj["url"]) ?: cleanField(obj["file"]) ?: return@mapNotNull null
            val label = cleanField(obj["label"])
                ?: cleanField(obj["language"])
                ?: cleanField(obj["lang"])
                ?: cleanField(obj["name"])
                ?: fallbackAddonName
            val subHeaders = (obj["headers"] as? Map<*, *>)?.entries
                ?.mapNotNull { (k, v) ->
                    val ks = cleanField(k) ?: return@mapNotNull null
                    val vs = cleanField(v) ?: return@mapNotNull null
                    ks to vs
                }?.toMap()?.takeIf { it.isNotEmpty() }

            PluginSubtitleResult(
                id = cleanField(obj["id"]) ?: url,
                url = url,
                label = label,
                headers = subHeaders,
            )
        }
    }

    private fun cleanField(value: Any?): String? {
        val s = value?.toString()?.trim() ?: return null
        if (s.isEmpty() || s == "null" || s == "undefined" || s.contains("[object ")) return null
        return s
    }

    private fun normalizeBase64(input: String): String {
        var s = input.trim().replace("\n", "").replace("\r", "").replace(" ", "")
            .replace('-', '+')
            .replace('_', '/')
        val rem = s.length % 4
        if (rem != 0) s += "=".repeat(4 - rem)
        return s
    }

    private fun base64Decode(input: String): ByteArray {
        if (input.isBlank()) return ByteArray(0)
        return runCatching { Base64.getDecoder().decode(normalizeBase64(input)) }
            .getOrDefault(ByteArray(0))
    }

    private fun base64Encode(bytes: ByteArray): String =
        Base64.getEncoder().encodeToString(bytes)
}
