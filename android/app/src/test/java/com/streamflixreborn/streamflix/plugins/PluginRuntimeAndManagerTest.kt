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
                const streamUrl = bytes.toString(CryptoJS.enc.Utf8);

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

        // Encrypt the target m3u8 URL inside a small helper evaluation or use a self-encrypted page:
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
                        // Compute valid CryptoJS OpenSSL passphrase ciphertext via CryptoJS itself?
                        // Even simpler: serve an endpoint that echoes encrypted value or precomputed CryptoJS ciphertext.
                        // Let's return HTML with a dynamically valid ciphertext generated on the JS side if needed,
                        // or precompute with QuickJs!
                        val targetM3u8 = "$baseUrl/hls/master.m3u8?path=${request.path}"
                        val cipher = encryptWithCryptoJs(targetM3u8, "streamflix-secret")
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

        // Movie execution should run BOTH vidsrc_aes and cine_axios concurrently and filter out magnet links
        val movieServers = manager.getServersForMedia(
            tmdbId = "550",
            mediaType = "movie",
        )
        assertEquals(2, movieServers.size)

        val vidsrcServer = movieServers.first { it.name.contains("VidSrc") }
        assertTrue(vidsrcServer.name.contains("test-tmdb-key-123"))
        val vidsrcVideo = vidsrcServer.video
        assertNotNull(vidsrcVideo)
        assertTrue(vidsrcVideo!!.source.startsWith("$baseUrl/hls/master.m3u8"))
        assertEquals("$baseUrl/", vidsrcVideo.headers?.get("Referer"))
        assertEquals(1, vidsrcVideo.subtitles.size)
        assertEquals("$baseUrl/subs/es.vtt", vidsrcVideo.subtitles.first().file)

        val axiosServer = movieServers.first { it.name.contains("Cine Axios") }
        assertEquals("$baseUrl/mp4/movie-720p.mp4", axiosServer.video?.source)
        assertEquals("CustomMobileAgent/1.0", axiosServer.video?.headers?.get("User-Agent"))

        // TV episode execution should only run vidsrc_aes (cine_axios only supports "movie")
        val tvServers = manager.getServersForMedia(
            tmdbId = "1396",
            mediaType = "tv",
            season = 2,
            episode = 5,
        )
        assertEquals(1, tvServers.size)
        assertTrue(tvServers.first().video!!.source.contains("s=2&e=5"))

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
        val cryptoSource = javaClass.classLoader!!
            .getResourceAsStream("META-INF/resources/webjars/crypto-js/4.2.0/crypto-js.min.js")!!
            .bufferedReader()
            .use { it.readText() }

        com.dokar.quickjs.quickJs {
            evaluate<Any?>(cryptoSource, "crypto-js.min.js")
            evaluate<String>(
                "CryptoJS.AES.encrypt(${org.json.JSONObject.quote(plainText)}, ${org.json.JSONObject.quote(passphrase)}).toString()"
            )
        }
    }
}
