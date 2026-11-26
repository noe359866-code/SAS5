package com.streamflixreborn.streamflix.plugins

import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.File
import java.nio.file.Files

class PluginRuntimeAndManagerTest {

    private lateinit var mockServer: MockWebServer
    private lateinit var tempDir: File
    private lateinit var httpClient: OkHttpClient

    @Before
    fun setUp() {
        mockServer = MockWebServer()
        tempDir = Files.createTempDirectory("streamflix-plugins-test").toFile()
        httpClient = OkHttpClient.Builder().build()
    }

    @After
    fun tearDown() {
        mockServer.shutdown()
        tempDir.deleteRecursively()
    }

    @Test
    fun `install manifest and execute QuickJS scrapers with fetch cheerio CryptoJS axios headers and subtitles`() = runBlocking {
        val baseUrl = mockServer.url("/").toString().removeSuffix("/")

        val moviePlainUrl = "$baseUrl/hls/master.m3u8?type=movie&id=550"
        val tvPlainUrl = "$baseUrl/hls/master.m3u8?type=tv&id=1396&s=2&e=5"
        val movieCipher = encryptWithCryptoJs(moviePlainUrl, "streamflix-secret")
        val tvCipher = encryptWithCryptoJs(tvPlainUrl, "streamflix-secret")
        assertTrue("Expected OpenSSL Salted__ base64 ciphertext", movieCipher.startsWith("U2FsdGVkX1"))

        val vidsrcScript = """
            const cheerio = require('cheerio');
            const CryptoJS = require('crypto-js');

            async function getStreams(tmdbId, mediaType, season, episode) {
                const pageRes = await fetch('$baseUrl/embed/' + mediaType + '/' + tmdbId + '?s=' + (season || 0) + '&e=' + (episode || 0), {
                    headers: { 'X-Scraper': SCRAPER_ID, 'X-Tmdb-Key': TMDB_API_KEY }
                });
                const html = await pageRes.text();
                const ${'$'} = cheerio.load(html);
                const encryptedUrl = ${'$'}('#player-data').attr('data-cipher');
                const label = ${'$'}('.server-label').text().trim();

                const bytes = CryptoJS.AES.decrypt(encryptedUrl, 'streamflix-secret');
                const roundTrip = CryptoJS.AES.encrypt(bytes.toString(CryptoJS.enc.Utf8), 'ephemeral-key').toString();
                const streamUrl = CryptoJS.AES.decrypt(roundTrip, 'ephemeral-key').toString(CryptoJS.enc.Utf8);

                return [
                    {
                        name: label,
                        title: '1080p Latino',
                        url: streamUrl,
                        quality: '1080p',
                        headers: {
                            'Referer': '$baseUrl/',
                            'Origin': '$baseUrl'
                        },
                        subtitles: [
                            {
                                url: '$baseUrl/subs/es.vtt',
                                label: 'Español',
                                lang: 'es'
                            }
                        ]
                    },
                    {
                        name: 'Ignored Magnet',
                        url: 'magnet:?xt=urn:btih:deadbeef'
                    }
                ];
            }

            module.exports = { getStreams };
        """.trimIndent()

        val axiosScript = """
            const axios = require('axios');

            globalThis.getStreams = async function(tmdbId, mediaType, season, episode) {
                const res = await axios.post('$baseUrl/api/resolve', {
                    tmdbId: String(tmdbId),
                    mediaType: mediaType,
                    season: season,
                    episode: episode
                });
                return res.data.streams;
            };
        """.trimIndent()

        val runtime = PluginRuntime(
            httpClient = httpClient,
            tmdbApiKeyProvider = { "test-tmdb-key-123" },
        )

        mockServer.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.path.orEmpty()
                return when {
                    path == "/repo/manifest.json" -> MockResponse()
                        .setResponseCode(200)
                        .setHeader("Content-Type", "application/json")
                        .setBody(
                            """
                            {
                              "name": "Test Nuvio Repo",
                              "version": "1.2.0",
                              "scrapers": [
                                {
                                  "id": "vidsrc_aes",
                                  "name": "VidSrc AES",
                                  "version": "1.0.1",
                                  "filename": "scrapers/vidsrc.js",
                                  "supportedTypes": ["movie", "tv"],
                                  "enabled": true
                                },
                                {
                                  "id": "cine_axios",
                                  "name": "Cine Axios",
                                  "version": "1.0.0",
                                  "filename": "scrapers/cine_axios.js",
                                  "supportedTypes": ["movie"],
                                  "enabled": true
                                }
                              ]
                            }
                            """.trimIndent()
                        )

                    path == "/repo/scrapers/vidsrc.js" -> MockResponse()
                        .setResponseCode(200)
                        .setBody(vidsrcScript)

                    path == "/repo/scrapers/cine_axios.js" -> MockResponse()
                        .setResponseCode(200)
                        .setBody(axiosScript)

                    path.startsWith("/embed/") -> {
                        val cipher = if (path.startsWith("/embed/tv/")) tvCipher else movieCipher
                        val tmdbHeader = request.getHeader("X-Tmdb-Key").orEmpty()
                        MockResponse()
                            .setResponseCode(200)
                            .setBody(
                                """
                                <html>
                                  <body>
                                    <span class="server-label">VidSrc ($tmdbHeader)</span>
                                    <div id="player-data" data-cipher="$cipher"></div>
                                  </body>
                                </html>
                                """.trimIndent()
                            )
                    }

                    path == "/api/resolve" -> MockResponse()
                        .setResponseCode(200)
                        .setHeader("Content-Type", "application/json")
                        .setBody(
                            """
                            {
                              "streams": [
                                {
                                  "name": "Direct CDN",
                                  "title": "720p Dual",
                                  "url": "$baseUrl/mp4/movie-720p.mp4",
                                  "headers": {
                                    "User-Agent": "CustomMobileAgent/1.0"
                                  }
                                }
                              ]
                            }
                            """.trimIndent()
                        )

                    else -> MockResponse().setResponseCode(404)
                }
            }
        }

        val store = PluginStore(tempDir)
        val manager = PluginManager(
            store = store,
            httpClient = httpClient,
            runtime = runtime,
        )

        val manifestUrl = "$baseUrl/repo/manifest.json"
        val addResult = manager.addRepository(manifestUrl)
        assertTrue("Expected repository install to succeed: ${addResult.exceptionOrNull()}", addResult.isSuccess)

        val repo = addResult.getOrThrow()
        assertEquals("Test Nuvio Repo", repo.name)
        assertEquals(2, manager.scrapers.value.size)
        assertTrue(manager.hasEnabledScrapers())

        // Movie execution runs BOTH vidsrc_aes and cine_axios concurrently and filters out magnet links
        val movieServers = manager.getServersForMedia(
            tmdbId = "550",
            mediaType = "movie",
        )
        assertEquals("Movie servers=${movieServers.map { it.name }}", 2, movieServers.size)

        val vidsrcServer = movieServers.first { it.name.contains("VidSrc") }
        assertTrue(vidsrcServer.name.contains("test-tmdb-key-123"))
        val vidsrcVideo = vidsrcServer.video
        assertNotNull(vidsrcVideo)
        assertEquals(moviePlainUrl, vidsrcVideo!!.source)
        assertEquals("$baseUrl/", vidsrcVideo.headers?.get("Referer"))
        assertEquals(1, vidsrcVideo.subtitles.size)
        assertEquals("$baseUrl/subs/es.vtt", vidsrcVideo.subtitles.first().file)

        val axiosServer = movieServers.first { it.name.contains("Cine Axios") || it.name.contains("Direct CDN") }
        assertEquals("$baseUrl/mp4/movie-720p.mp4", axiosServer.video?.source)
        assertEquals("CustomMobileAgent/1.0", axiosServer.video?.headers?.get("User-Agent"))

        // TV episode execution only runs vidsrc_aes (cine_axios only supports "movie")
        val tvServers = manager.getServersForMedia(
            tmdbId = "1396",
            mediaType = "tv",
            season = 2,
            episode = 5,
        )
        assertEquals(1, tvServers.size)
        assertEquals(tvPlainUrl, tvServers.first().video!!.source)

        // Disabling scraper persists across a fresh PluginManager reload
        val vidsrcKey = manager.scrapers.value.first { it.id == "vidsrc_aes" }.uniqueKey
        manager.setScraperEnabled(vidsrcKey, false)

        val reloadedManager = PluginManager(
            store = PluginStore(tempDir),
            httpClient = httpClient,
            runtime = runtime,
        )
        assertEquals(1, reloadedManager.enabledScraperCount())
        assertEquals(0, reloadedManager.getServersForMedia("1396", "tv", 1, 1).size)

        // Removing repository cleans up cached JS scripts and state
        reloadedManager.removeRepository(repo.id)
        assertFalse(reloadedManager.hasEnabledScrapers())
        assertTrue(reloadedManager.repositories.value.isEmpty())
    }

    private fun encryptWithCryptoJs(plainText: String, passphrase: String): String = runBlocking {
        val cl = javaClass.classLoader!!
        val candidates = listOf(
            "META-INF/resources/webjars/crypto-js/4.2.0/crypto-js.min.js",
            "META-INF/resources/webjars/crypto-js/4.2.0/crypto-js.js",
            "META-INF/resources/webjars/crypto-js/4.2.0/crypto-js/crypto-js.min.js",
            "META-INF/resources/webjars/crypto-js/4.2.0/crypto-js/crypto-js.js",
        )
        val cryptoSource = candidates.firstNotNullOfOrNull { path ->
            cl.getResourceAsStream(path)?.bufferedReader()?.use { it.readText() }
        } ?: error("crypto-js resource not found on classpath")

        // Must share the process-wide QuickJS session lock used by PluginRuntime: two live runtimes
        // clear each other's cached JavaVM in the native library.
        PluginRuntime.withQuickJsSession {
            com.dokar.quickjs.quickJs {
                evaluate<Any?>(
                    """
                    globalThis.crypto = {
                        getRandomValues: function(typedArray) {
                            var u8 = new Uint8Array(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength);
                            for (var i = 0; i < u8.length; i++) u8[i] = (i * 37 + 13) & 0xff;
                            return typedArray;
                        }
                    };
                    """.trimIndent(),
                    "crypto-polyfill.js"
                )
                evaluate<Any?>(cryptoSource, "crypto-js.js")
                evaluate<String>(
                    "CryptoJS.AES.encrypt(${org.json.JSONObject.quote(plainText)}, ${org.json.JSONObject.quote(passphrase)}).toString()"
                )
            }
        }
    }
}
